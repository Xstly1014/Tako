import {randomUUID} from 'node:crypto';
import type {Transport} from '../../../mobile/src/auth/session.ts';
import {WorkSubmissionsApi} from '../../../mobile/src/publication/submissions.ts';
import {UUID} from '../../../mobile/src/api/reader.ts';
import {ApiError} from '../../../mobile/src/api/client.ts';
import {createAuthorTools,safeToolError,type ToolResult} from './tools.ts';
import type {NextStep} from './delivery.ts';

// Called explicitly by the consumer/user, never automatically by delivery.
// Identity comes from the existing session.authorized transport on every GET.
export async function followUp(step:NextStep,authorized:Transport):Promise<ToolResult>{
  const evidence_id=randomUUID();
  try{
    if(!step||typeof step!=='object')throw new ApiError('invalid_input');
    const key=step.kind==='read_original_result'?'preview_id':step.kind==='read_submission_record'?'submission_id':step.kind==='read_work_state'?'work_id':null;
    if(Object.keys(step).some(x=>x!=='kind'&&x!==key))throw new ApiError('invalid_input');
    const read:Transport=(p,o)=>{
      if(o?.body!==undefined||(o?.method&&o.method!=='GET'))throw new ApiError('invalid_input');
      return authorized(p,{...o,method:'GET'});
    };
    const valid=(value:unknown)=>typeof value==='string'&&UUID.test(value);
    if(step.kind==='read_original_result'&&valid(step.preview_id))return createAuthorTools(read).invoke('read_publication_result',{preview_id:step.preview_id});
    if(step.kind==='read_work_state'&&valid(step.work_id))return createAuthorTools(read).invoke('read_work_state',{work_id:step.work_id});
    if(step.kind==='read_submission_record'&&valid(step.submission_id)){
      const detail=await new WorkSubmissionsApi(read).detail(step.submission_id),s=detail.submission;
      return {evidence_id,observed_at:new Date().toISOString(),status:'ok',data:{submission_id:s.id,work_id:s.work_id,state:s.state,accepted_at:s.accepted_at,decided_at:s.decided_at,meaning:'current_submission_state_not_public_visibility'}};
    }
    if(['provide_identifiers','contact_support','reauthenticate'].includes(step.kind))return {evidence_id,observed_at:new Date().toISOString(),status:'ok',data:{action_required:step.kind,no_request_sent:true}};
    throw new ApiError('invalid_input');
  }catch(error){return {evidence_id,observed_at:new Date().toISOString(),status:'error',...safeToolError(error)}}
}
