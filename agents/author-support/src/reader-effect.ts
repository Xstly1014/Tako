import {isDeepStrictEqual} from 'node:util';
import {ApiError} from '../../../mobile/src/api/client.ts';
import {ReaderError,UUID,work} from '../../../mobile/src/api/reader.ts';
import {readVersion} from '../../../mobile/src/api/versions.ts';
import {WorkSubmissionsApi} from '../../../mobile/src/publication/submissions.ts';
import type {Transport} from '../../../mobile/src/auth/session.ts';
import type {components} from '../../../mobile/src/api/contract.d.ts';
import type {ReviewMonitor,ReviewHandoffItem} from './review-monitor.ts';
import {shiftItems} from './operator-shift.ts';

export type EffectSource={kind:'shifts'|'reconciliations'|'outcomes';id:number;queue:ReviewHandoffItem['queue'];itemId:string};
export type EffectInput={source:EffectSource;item:ReviewHandoffItem};
type Context={workId:string;version:number;state:string;scope:'version'|'work';caseState?:'active'|'revoked';caseRevision?:number};
type PublicResult={state:'readable';version:number}|{state:'not_readable'};
export type ReaderEffect={startedAt:string;finishedAt:string;source:EffectSource;
  status:'complete'|'awaiting_decision'|'not_released'|'changed'|'incomplete';
  operation:Context|null;display:PublicResult|null;target:PublicResult|null;error?:string;httpStatus?:number|null};
type PublicReader=(workId:string,version:number|undefined,signal?:AbortSignal)=>Promise<{id:string;version:number}|null>;

export function effectInput(monitor:ReviewMonitor,source:EffectSource):EffectInput{
  let items:ReviewHandoffItem[];
  if(source.kind==='shifts')items=shiftItems(monitor.shift(source.id).run);
  else if(source.kind==='reconciliations'){
    const {run}=monitor.reconciliation(source.id);items=[...run.retained,...run.entered,...run.departed];
  }else if(source.kind==='outcomes'){
    const {report}=monitor.outcomeReport(source.id);
    const outcomes=report.period?.outcomes??('outcomes' in report?report.outcomes:undefined)??[];
    items=outcomes.map(row=>({queue:'appeal',id:row.appealId,waitingSince:row.requestedAt,target:{queue:'appeal',caseId:row.caseId}}));
  }else throw Error('invalid_request');
  const item=items.find(item=>item.queue===source.queue&&String(item.id)===source.itemId);
  if(!item)throw Error('effect_source_not_found');
  if(!item.target)throw Error('effect_locator_required');
  return {source:structuredClone(source),item:structuredClone(item)};
}

const publicReader:PublicReader=async(id,version,signal)=>{
  try{return version===undefined?await work(id,signal):await readVersion(id,version,signal)}
  catch(error){if(error instanceof ReaderError&&error.kind==='unavailable')return null;throw error}
};

export async function checkReaderEffect(input:EffectInput,read:Transport,signal?:AbortSignal,anonymous:PublicReader=publicReader):Promise<ReaderEffect>{
  const report:ReaderEffect={startedAt:new Date().toISOString(),finishedAt:'',source:input.source,
    status:'incomplete',operation:null,display:null,target:null};
  try{
    if(signal?.aborted)throw Error('effect_cancelled');
    const get:Transport=(path,options)=>read(path,{...options,method:'GET',signal});
    const before=await context(input.item,get);
    report.operation=before;
    if(before.state==='pending'){report.status='awaiting_decision';return report}
    if(input.item.queue==='pre_review'&&before.state!=='published'){report.status='not_released';return report}
    const observe=async()=>{
      const checked=async(version:number|undefined):Promise<PublicResult>=>{
        const value=await anonymous(before.workId,version,signal);
        if(value&&(value.id!==before.workId||!Number.isSafeInteger(value.version)||value.version<1||version!==undefined&&value.version!==version))throw new ApiError('contract');
        return value?{state:'readable',version:value.version}:{state:'not_readable'};
      };
      return {display:await checked(undefined),target:await checked(before.version)};
    };
    const first=await observe(),second=await observe();
    const after=await context(input.item,get);
    // No database snapshot spans operator and anonymous requests: report observations, never causal success.
    if(!isDeepStrictEqual(before,after)||!isDeepStrictEqual(first,second)){report.status='changed';return report}
    report.display=second.display;report.target=second.target;report.status='complete';
  }catch(error){report.error='effect_read_failed';report.httpStatus=error instanceof ApiError?error.status:null}
  finally{report.finishedAt=new Date().toISOString()}
  return report;
}

async function context(item:ReviewHandoffItem,read:Transport):Promise<Context>{
  const target=item.target;
  if(!target)throw new ApiError('contract');
  if(target.queue==='pre_review'){
    const api=new WorkSubmissionsApi((path,options)=>read(path.replace('/my/work-submissions','/ops/work-submissions'),options));
    const {submission}=await api.detail(target.submissionId);
    if(submission.id!==item.id||!UUID.test(submission.work_id)||!Number.isSafeInteger(submission.candidate_version)||submission.candidate_version<1)throw new ApiError('contract');
    return {workId:submission.work_id,version:submission.candidate_version,state:submission.state,scope:'version'};
  }
  if(target.queue==='post_review'){
    const {task}=await read<components['schemas']['ModerationDetail']>(`/ops/reviews/${target.workId}/versions/${target.version}`);
    if(!task||task.id!==item.id||task.work_id!==target.workId||!UUID.test(task.work_id)||task.version!==target.version||
      !Number.isSafeInteger(task.version)||task.version<1||!['pending','approved','restricted'].includes(task.state))throw new ApiError('contract');
    return {workId:task.work_id,version:task.version,state:task.state,scope:'version'};
  }
  let before=0;
  for(let page=0;page<8;page++){
    const detail=await read<components['schemas']['ModerationCaseDetail']>(`/ops/moderation/${target.caseId}${before?'?before='+before:''}`);
    const record=detail?.case;
    if(!record||record.id!==target.caseId||!UUID.test(record.work_id)||!Number.isSafeInteger(record.version)||record.version<1||
      !['work','version'].includes(record.scope)||!['active','revoked'].includes(record.state)||
      !Number.isSafeInteger(record.revision)||record.revision<1||!Array.isArray(detail.appeals?.items))throw new ApiError('contract');
    const appeal=detail.appeals.items.find(appeal=>appeal.id===item.id);
    if(appeal){
      if(appeal.case_id!==record.id||!['pending','upheld','revoked'].includes(appeal.state))throw new ApiError('contract');
      return {workId:record.work_id,version:record.version,state:appeal.state,scope:record.scope,caseState:record.state,caseRevision:record.revision};
    }
    const next=detail.appeals.next;
    if(!next||!Number.isSafeInteger(next)||next<0||before&&next>=before)break;
    before=next;
  }
  throw new ApiError('contract');
}
