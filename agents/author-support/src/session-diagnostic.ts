import {ApiError} from '../../../mobile/src/api/client.ts';
import {ReaderError,UUID,work} from '../../../mobile/src/api/reader.ts';
import {AuthorAppealsApi} from '../../../mobile/src/api/author-appeals.ts';
import type {Session,Transport} from '../../../mobile/src/auth/session.ts';
import {WorkSubmissionsApi} from '../../../mobile/src/publication/submissions.ts';
import {runFixedFlow} from './fixed-flow.ts';
import {followUp} from './follow-up.ts';
import {createAuthorTools} from './tools.ts';
import {checkReaderVisibility} from './reader-visibility.ts';

type Identifiers={workId?:string;previewId?:string};
type DiagnosticSession=Pick<Session,'snapshot'|'authorized'>;

function bindDiagnosticSession(session:DiagnosticSession){
  const initial=session.snapshot();
  if(initial.phase!=='ready'||initial.busy||!initial.account)return null;
  const owner=initial.account.id;
  const isCurrent=()=>{
    const now=session.snapshot();
    return now.phase==='ready'&&!now.busy&&now.generation===initial.generation&&now.account?.id===owner;
  };
  const read:Transport=async<T>(path:string,options?:Parameters<Transport>[1])=>{
    if(!isCurrent())throw new ApiError('authentication_required','',401);
    const result=await session.authorized<T>(path,{...options,method:'GET'});
    if(!isCurrent())throw new ApiError('authentication_required','',401);
    return result;
  };
  return {isCurrent,read};
}

async function readPublicWork(id:string){
  try{return await work(id)}
  catch(error){
    if(error instanceof ReaderError&&error.kind==='unavailable')return null;
    throw error;
  }
}

// Keep each handle scoped to the session that produced it.
export async function checkPublication(session:DiagnosticSession,ids:Identifiers){
  const bound=bindDiagnosticSession(session);
  if(!bound)return null;
  const {isCurrent,read}=bound;
  if((!ids.workId&&!ids.previewId)||[ids.workId,ids.previewId].some(id=>id!==undefined&&!UUID.test(id))){
    throw new ApiError('invalid_input');
  }
  const input=[ids.workId&&`作品ID ${ids.workId}`,ids.previewId&&`原预览ID ${ids.previewId}`].filter(Boolean).join('，');
  const tools=createAuthorTools(read);
  const {delivery,evidence}=await runFixedFlow(input,tools);
  if(!isCurrent())return null;
  const cited=evidence.filter(item=>delivery.verdict.evidence_ids.includes(item.result.evidence_id));
  const state=cited.find(item=>item.tool==='read_work_state'&&item.result.status==='ok')?.result;
  const workId=delivery.status!=='fallback'&&state?.status==='ok'?String(state.data.work_id):null;
  const receipt=cited.find(item=>item.tool==='read_publication_result'&&item.result.status==='ok')?.result;
  const released=receipt?.status==='ok'?receipt.data.published as {work_id:string;version:number}|null:undefined;
  const releasedVersion=delivery.verdict.publication==='confirmed'&&released&&released.work_id===workId?released.version:null;
  return {
    getDelivery:()=>isCurrent()?structuredClone(delivery):null,
    followUp:async()=>{
      if(!isCurrent()||!delivery.next_step)return null;
      const result=await followUp(delivery.next_step,read);
      if(isCurrent()&&delivery.next_step.kind==='read_submission_record'&&result.status==='ok'&&
        result.data.state==='published'&&typeof result.data.work_id==='string'){
        const visibility=await checkReaderVisibility(result.data.work_id,createAuthorTools(read),readPublicWork);
        return isCurrent()?{...result,data:{...result.data,reader_visibility:visibility}}:null;
      }
      return isCurrent()?result:null;
    },
    checkReaderVisibility:async()=>{
      if(!isCurrent()||!workId)return null;
      const result=await checkReaderVisibility(workId,createAuthorTools(read),readPublicWork);
      return isCurrent()?{...result,releasedVersion}:null;
    },
  };
}

export async function checkModerationVisibility(session:DiagnosticSession,caseId:number){
  const bound=bindDiagnosticSession(session);
  if(!bound)return null;
  if(!Number.isSafeInteger(caseId)||caseId<=0)throw new ApiError('invalid_input');
  const {isCurrent,read}=bound;
  const appeals=new AuthorAppealsApi(read);
  try{
    const before=await appeals.detail(caseId);
    const visibility=await checkReaderVisibility(before.case.work_id,createAuthorTools(read),readPublicWork);
    if(!isCurrent())return null;
    const after=await appeals.detail(caseId);
    if(!isCurrent())return null;
    const latest=after.appeals.items[0];
    const previous=before.appeals.items[0];
    if(before.case.revision!==after.case.revision||before.case.state!==after.case.state||
      previous?.id!==latest?.id||previous?.state!==latest?.state){
      return {status:'changed' as const};
    }
    return {
      status:'checked' as const,
      moderation:{state:after.case.state,scope:after.case.scope,version:after.case.version,latestAppeal:latest?.state??null},
      visibility,
    };
  }catch(error){
    if(!isCurrent())return null;
    return {status:error instanceof ApiError&&error.status===404?'case_unavailable' as const:'unavailable' as const};
  }
}

export async function listPublicationSubmissions(session:DiagnosticSession,workId?:string,cursor=''){
  const bound=bindDiagnosticSession(session);
  if(!bound)return null;
  try{
    const page=await new WorkSubmissionsApi(bound.read).list(workId?.toLowerCase(),cursor);
    if(!bound.isCurrent())return null;
    return {
      status:'listed' as const,nextCursor:page.next_cursor,
      submissions:page.items.map(item=>({
        submissionId:item.id,workId:item.work_id,previewId:item.preview_id,
        state:item.state,acceptedAt:item.accepted_at,decidedAt:item.decided_at,
      })),
    };
  }catch(error){
    if(!bound.isCurrent())return null;
    return {status:error instanceof ApiError&&error.status===400?'invalid_cursor' as const:'unavailable' as const};
  }
}
