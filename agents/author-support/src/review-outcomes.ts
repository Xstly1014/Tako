import {AuthorAppealsApi} from '../../../mobile/src/api/author-appeals.ts';
import {ApiError} from '../../../mobile/src/api/client.ts';
import type {Transport} from '../../../mobile/src/auth/session.ts';

type Outcome={
  appealId:number;caseId:number;scope:'work'|'version';state:'pending'|'upheld'|'revoked';
  requestedAt:string;decidedAt:string|null;processingMinutes:number|null;
  detailPath:string;
};

// Request outcomes describe observed decisions. A revoked restriction can
// also be an operator correction while a request is pending.
export async function reviewOutcomes(read:Transport){
  const startedAt=new Date().toISOString();
  const api=new AuthorAppealsApi((path,options)=>read(
    path.replace('/my/moderation','/ops/moderation'),{...options,method:'GET'},
  ));
  const outcomes:Outcome[]=[];
  let before=0,cases=0;
  try{
    for(let page=0;page<100;page++){
      const listed=await api.list(before);
      for(const entry of listed.items){
        const rows:Outcome[]=[];
        const seen=new Set<number>();
        let cursor=0,revision:number|undefined,complete=false;
        for(let part=0;part<8;part++){
          const detail=await api.detail(entry.id,cursor);
          if(revision!==undefined&&revision!==detail.case.revision)throw Error('case_changed');
          revision=detail.case.revision;
          for(const appeal of detail.appeals.items){
            if(seen.has(appeal.id))throw Error('duplicate_appeal');
            seen.add(appeal.id);
            const elapsed=appeal.decided_at?Date.parse(appeal.decided_at)-Date.parse(appeal.created_at):null;
            if(elapsed!==null&&elapsed<0)throw Error('invalid_decision_time');
            rows.push({
              appealId:appeal.id,caseId:entry.id,scope:detail.case.scope,state:appeal.state,
              requestedAt:appeal.created_at,decidedAt:appeal.decided_at,
              processingMinutes:elapsed===null?null:elapsed/60000,
              detailPath:'/ops/moderation/'+entry.id,
            });
          }
          cursor=detail.appeals.next;
          if(!cursor){complete=true;break}
        }
        if(!complete)throw Error('appeal_page_limit');
        outcomes.push(...rows);
        cases++;
      }
      before=listed.next;
      if(!before){
        const counts={pending:0,upheld:0,revoked:0};
        for(const row of outcomes)counts[row.state]++;
        return {status:'complete' as const,startedAt,cases,counts,
          outcomes:outcomes.sort((a,b)=>a.requestedAt.localeCompare(b.requestedAt)||a.appealId-b.appealId)};
      }
    }
    throw Error('case_page_limit');
  }catch(error){
    const known=['case_changed','duplicate_appeal','invalid_decision_time','appeal_page_limit','case_page_limit'];
    return {
      status:'incomplete' as const,startedAt,cases,counts:null,outcomes,
      error:error instanceof Error&&known.includes(error.message)?error.message:'request_failed',
      httpStatus:error instanceof ApiError?error.status:null,
    };
  }
}
