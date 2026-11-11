import {ApiError} from '../../../mobile/src/api/client.ts';
import type {Transport} from '../../../mobile/src/auth/session.ts';
import {AuthorPolicyApi} from '../../../mobile/src/novels/author-policy-api.ts';
import {WorkSubmissionsApi} from '../../../mobile/src/publication/submissions.ts';

type PendingObservation={
  submissionId:string;workId:string;firstWaitingAt:string;detailPath:string;
} & (
  {status:'awaiting_review';observationActive:boolean;observationUntil:string|null;policyRevision:number}
  | {status:'submission_changed';currentState:string}
);

export async function policyPending(read:Transport){
  const startedAt=new Date().toISOString(),rows:PendingObservation[]=[];
  const submissions=new WorkSubmissionsApi((path,options)=>read(
    path.replace('/my/work-submissions','/ops/work-submissions'),{...options,method:'GET'},
  ));
  const policies=new AuthorPolicyApi((path,options)=>read(
    path.replace('/my/novels/','/ops/works/'),{...options,method:'GET'},
  ));
  const policyCache=new Map<string,Awaited<ReturnType<typeof policies.read>>['policy']>();
  const seen=new Set<string>(),cursors=new Set<string>();
  let cursor='';
  try{
    for(let page=0;page<200;page++){
      const listed=await submissions.list('',cursor);
      for(const original of listed.items){
        if(seen.has(original.id))continue;
        seen.add(original.id);
        if(original.state!=='pending')throw Error('queue_changed');
        let policy=policyCache.get(original.work_id);
        if(!policy){
          policy=(await policies.read(original.work_id)).policy;
          policyCache.set(original.work_id,policy);
        }
        const {submission}=await submissions.detail(original.id);
        if(submission.work_id!==original.work_id)throw Error('submission_mismatch');
        const common={submissionId:original.id,workId:original.work_id,
          firstWaitingAt:original.first_waiting_at,detailPath:'/ops/work-submissions/'+original.id};
        if(submission.state!=='pending'){
          rows.push({...common,status:'submission_changed',currentState:submission.state});
        }else{
          rows.push({...common,status:'awaiting_review',observationActive:policy.active,
            observationUntil:policy.observation_until,policyRevision:policy.revision});
        }
      }
      cursor=listed.next_cursor;
      if(!cursor){
        return {
          status:'complete' as const,startedAt,
          counts:{
            observationActive:rows.filter(row=>row.status==='awaiting_review'&&row.observationActive).length,
            observationInactive:rows.filter(row=>row.status==='awaiting_review'&&!row.observationActive).length,
            submissionChanged:rows.filter(row=>row.status==='submission_changed').length,
          },
          rows:rows.sort((a,b)=>a.firstWaitingAt.localeCompare(b.firstWaitingAt)||a.submissionId.localeCompare(b.submissionId)),
        };
      }
      if(cursors.has(cursor))throw Error('cursor_cycle');
      cursors.add(cursor);
    }
    throw Error('page_limit');
  }catch(error){
    const known=['queue_changed','submission_mismatch','cursor_cycle','page_limit'];
    return {
      status:'incomplete' as const,startedAt,counts:null,rows,
      error:error instanceof Error&&known.includes(error.message)?error.message:'request_failed',
      httpStatus:error instanceof ApiError?error.status:null,
    };
  }
}
