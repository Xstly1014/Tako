import {ApiError} from '../../../mobile/src/api/client.ts';
import {UUID} from '../../../mobile/src/api/reader.ts';
import type {Session,Transport} from '../../../mobile/src/auth/session.ts';
import {runFixedFlow} from './fixed-flow.ts';
import {followUp} from './follow-up.ts';
import {createAuthorTools} from './tools.ts';

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
  const {delivery}=await runFixedFlow(input,createAuthorTools(read));
  if(!isCurrent())return null;
  return {
    getDelivery:()=>isCurrent()?structuredClone(delivery):null,
    followUp:async()=>{
      if(!isCurrent()||!delivery.next_step)return null;
      const result=await followUp(delivery.next_step,read);
      return isCurrent()?result:null;
    },
  };
}
