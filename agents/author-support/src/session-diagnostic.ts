import {ApiError} from '../../../mobile/src/api/client.ts';
import {ReaderError,UUID,work} from '../../../mobile/src/api/reader.ts';
import type {Session,Transport} from '../../../mobile/src/auth/session.ts';
import {runFixedFlow} from './fixed-flow.ts';
import {followUp} from './follow-up.ts';
import {createAuthorTools} from './tools.ts';
import {checkReaderVisibility} from './reader-visibility.ts';

type Identifiers={workId?:string;previewId?:string};

// The consumer owns the session. Keep this handle scoped to its current
// account and generation, including after an answer has been produced.
export async function checkPublication(session:Pick<Session,'snapshot'|'authorized'>,ids:Identifiers){
  const initial=session.snapshot();
  if(initial.phase!=='ready'||initial.busy||!initial.account)return null;
  if((!ids.workId&&!ids.previewId)||[ids.workId,ids.previewId].some(id=>id!==undefined&&!UUID.test(id))){
    throw new ApiError('invalid_input');
  }
  const owner=initial.account.id;
  const isCurrent=()=>{
    const now=session.snapshot();
    return now.phase==='ready'&&!now.busy&&now.generation===initial.generation&&now.account?.id===owner;
  };
  const read:Transport=async<T>(path:string,options?:Parameters<Transport>[1])=>{
    if(!isCurrent())throw new ApiError('authentication_required','',401);
    const result=await session.authorized<T>(path,options);
    if(!isCurrent())throw new ApiError('authentication_required','',401);
    return result;
  };
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
      return isCurrent()?result:null;
    },
    checkReaderVisibility:async()=>{
      if(!isCurrent()||!workId)return null;
      const result=await checkReaderVisibility(workId,createAuthorTools(read),async id=>{
        try{return await work(id)}
        catch(error){
          if(error instanceof ReaderError&&error.kind==='unavailable')return null;
          throw error;
        }
      });
      return isCurrent()?{...result,releasedVersion}:null;
    },
  };
}
