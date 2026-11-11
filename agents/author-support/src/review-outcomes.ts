import {AuthorAppealsApi} from '../../../mobile/src/api/author-appeals.ts';
import {ApiError} from '../../../mobile/src/api/client.ts';
import type {Transport} from '../../../mobile/src/auth/session.ts';

export type Outcome={
  appealId:number;caseId:number;scope:'work'|'version';state:'pending'|'upheld'|'revoked';
  requestedAt:string;decidedAt:string|null;processingMinutes:number|null;
  detailPath:string;
};
export type OutcomePeriod={from:string;until:string;start:number;end:number};
export const outcomeReportVersion='appeal-period-v1';
export type OutcomeReport=Awaited<ReturnType<typeof reviewOutcomes>>;

function comparablePeriod(report:OutcomeReport){
  if(report.status!=='complete'||!report.period)throw Error('report_not_comparable');
  const bounds=outcomePeriod(report.period.from,report.period.untilExclusive);
  if(Date.parse(report.period.observedThrough)!==bounds.end)throw Error('period_still_open');
  return {period:report.period,bounds};
}

export function compareOutcomeReports(previous:OutcomeReport,current:OutcomeReport){
  const left=comparablePeriod(previous),right=comparablePeriod(current);
  if(left.bounds.end-left.bounds.start!==right.bounds.end-right.bounds.start||
    left.bounds.end>right.bounds.start)throw Error('periods_not_comparable');
  const metric=(before:number,after:number)=>({previous:before,current:after,change:after-before});
  const leftMedian=left.period.decisions.medianProcessingMinutes;
  const rightMedian=right.period.decisions.medianProcessingMinutes;
  return {
    previousPeriod:{from:left.period.from,untilExclusive:left.period.untilExclusive},
    currentPeriod:{from:right.period.from,untilExclusive:right.period.untilExclusive},
    incoming:metric(left.period.incoming.total,right.period.incoming.total),
    decisions:metric(left.period.decisions.total,right.period.decisions.total),
    pendingAtCutoff:metric(left.period.incoming.pendingAtCutoff,right.period.incoming.pendingAtCutoff),
    decisionsOver48Hours:metric(left.period.decisions.over48Hours,right.period.decisions.over48Hours),
    medianProcessingMinutes:{previous:leftMedian,current:rightMedian,
      change:leftMedian===null||rightMedian===null?null:rightMedian-leftMedian},
  };
}

export function outcomePeriod(from:string,until:string):OutcomePeriod{
  const start=Date.parse(from+'T00:00:00+08:00'),end=Date.parse(until+'T00:00:00+08:00');
  const valid=(text:string,at:number)=>/^\d{4}-\d{2}-\d{2}$/.test(text)&&Number.isFinite(at)&&
    new Date(at+8*3600000).toISOString().slice(0,10)===text;
  if(!valid(from,start)||!valid(until,end)||start>=end)throw Error('invalid_period');
  return {from,until,start,end};
}

export function summarizeOutcomePeriod(outcomes:Outcome[],period:OutcomePeriod,observedAt:string){
  const cutoff=Math.min(period.end,Date.parse(observedAt));
  if(cutoff<=period.start)throw Error('period_not_started');
  const inside=(at:string)=>Date.parse(at)>=period.start&&Date.parse(at)<cutoff;
  const incoming=outcomes.filter(row=>inside(row.requestedAt));
  const decisions=outcomes.filter(row=>row.decidedAt!==null&&inside(row.decidedAt));
  const counts={total:incoming.length,pendingAtCutoff:0,upheldBeforeCutoff:0,revokedBeforeCutoff:0};
  for(const row of incoming){
    if(row.decidedAt===null||Date.parse(row.decidedAt)>=cutoff)counts.pendingAtCutoff++;
    else if(row.state==='upheld')counts.upheldBeforeCutoff++;
    else if(row.state==='revoked')counts.revokedBeforeCutoff++;
  }
  const durations=decisions.map(row=>row.processingMinutes!).sort((a,b)=>a-b);
  const middle=Math.floor(durations.length/2);
  const median=durations.length===0?null:durations.length%2?durations[middle]:(durations[middle-1]+durations[middle])/2;
  const included=new Set([...incoming,...decisions]);
  return {
    from:period.from,untilExclusive:period.until,timeZone:'Asia/Shanghai',observedThrough:new Date(cutoff).toISOString(),
    incoming:counts,
    decisions:{total:decisions.length,upheld:decisions.filter(row=>row.state==='upheld').length,
      revoked:decisions.filter(row=>row.state==='revoked').length,
      over48Hours:durations.filter(minutes=>minutes>48*60).length,medianProcessingMinutes:median},
    outcomes:outcomes.filter(row=>included.has(row)).map(row=>({
      ...row,stateAtCutoff:row.decidedAt===null||Date.parse(row.decidedAt)>=cutoff?'pending' as const:row.state,
    })),
  };
}

// Request outcomes describe observed decisions. A revoked restriction can
// also be an operator correction while a request is pending.
export async function reviewOutcomes(read:Transport,period?:OutcomePeriod){
  const startedAt=new Date().toISOString();
  if(period&&Date.parse(startedAt)<=period.start)throw Error('period_not_started');
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
        outcomes.sort((a,b)=>a.requestedAt.localeCompare(b.requestedAt)||a.appealId-b.appealId);
        if(period){
          return {status:'complete' as const,startedAt,cases,period:summarizeOutcomePeriod(outcomes,period,startedAt)};
        }
        return {status:'complete' as const,startedAt,cases,counts,outcomes};
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
