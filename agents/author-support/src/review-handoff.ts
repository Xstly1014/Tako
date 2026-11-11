import {ApiError} from '../../../mobile/src/api/client.ts';
import type {Transport} from '../../../mobile/src/auth/session.ts';
import {WorkSubmissionsApi} from '../../../mobile/src/publication/submissions.ts';
import type {ReviewHandoffItem} from './review-monitor.ts';
import type {components} from '../../../mobile/src/api/contract.d.ts';
import {currentPendingSubmission} from './follow-up.ts';

export async function reviewHandoff(read:Transport,items:ReviewHandoffItem[],offset=0){
  const page=items.slice(offset,offset+20);
  const rows=[];
  let blocked=false;
  const get:Transport=(path,options)=>read(path,{...options,method:'GET'});
  for(const item of page){
    if(!item.target){
      rows.push({...item,status:'rescan_required' as const});
      continue;
    }
    if(blocked){
      rows.push({...item,status:'unavailable' as const});
      continue;
    }
    try{
      const result=await inspect(get,item);
      rows.push({...item,...result});
    }catch(error){
      const httpStatus=error instanceof ApiError?error.status:null;
      blocked=[401,403,429].includes(httpStatus??0);
      rows.push({...item,status:'unavailable' as const,httpStatus});
    }
  }
  return {
    checkedAt:new Date().toISOString(),total:items.length,
    nextOffset:offset+page.length<items.length?offset+page.length:null,rows,
  };
}

async function inspect(read:Transport,item:ReviewHandoffItem){
  const target=item.target!;
  if(target.queue==='pre_review'){
    const api=new WorkSubmissionsApi((path,options)=>read(path.replace('/my/work-submissions','/ops/work-submissions'),options));
    const {submission}=await api.detail(target.submissionId);
    if(submission.id!==item.id)throw new ApiError('contract');
    return {
      status:submission.state==='pending'?'pending' as const:'decided' as const,decision:submission.state,
      detailPath:'/ops/work-submissions/'+submission.id,
      workbenchPath:'/ops/work-submissions',
      ...(submission.state==='superseded'?{currentPending:await currentPendingSubmission(api,submission.work_id)}:{}),
    };
  }
  if(target.queue==='post_review'){
    const path='/ops/reviews/'+target.workId+'/versions/'+target.version;
    const detail=await read<components['schemas']['ModerationDetail']>(path);
    const task=detail?.task;
    if(!task||task.id!==item.id||task.work_id!==target.workId||task.version!==target.version||
      !['pending','approved','restricted'].includes(task.state))throw new ApiError('contract');
    return {status:task.state==='pending'?'pending' as const:'decided' as const,
      decision:task.state,detailPath:path,workbenchPath:'/ops/reviews'};
  }
  const path='/ops/moderation/'+target.caseId;
  let before=0;
  for(let page=0;page<8;page++){
    const detail=await read<components['schemas']['ModerationCaseDetail']>(path+(before?'?before='+before:''));
    if(detail?.case?.id!==target.caseId||!Array.isArray(detail.appeals?.items))throw new ApiError('contract');
    const appeal=detail.appeals.items.find(appeal=>appeal.id===item.id);
    if(appeal){
      if(appeal.case_id!==target.caseId||!['pending','upheld','revoked'].includes(appeal.state))throw new ApiError('contract');
      return {status:appeal.state==='pending'?'pending' as const:'decided' as const,
        decision:appeal.state,detailPath:path,workbenchPath:'/ops/appeals'};
    }
    const next=detail.appeals.next;
    if(!next)break;
    if(!Number.isSafeInteger(next)||next<0||(before&&next>=before))throw new ApiError('contract');
    before=next;
  }
  return {status:'unavailable' as const,detailPath:path,workbenchPath:'/ops/appeals'};
}
