import type {Transport} from '../../../mobile/src/auth/session.ts';
import {scanReviewBacklog} from './review-backlog.ts';
import {reviewHandoff} from './review-handoff.ts';
import {policyPending} from './policy-pending.ts';
import {reviewOutcomes,type OutcomePeriod} from './review-outcomes.ts';
import type {ReviewMonitor,ReviewHandoffItem} from './review-monitor.ts';

type HandoffRow=Awaited<ReturnType<typeof reviewHandoff>>['rows'][number];
export type OperatorShift={
  startedAt:string;period:OutcomePeriod;
  scan:Awaited<ReturnType<typeof scanReviewBacklog>>|null;
  checks:(HandoffRow&{checkedAt:string})[];
  policy:Awaited<ReturnType<typeof policyPending>>|null;
  outcomeReportId:number|null;
  outcomeStatus:'not_run'|'incomplete'|'complete';
};

const unresolved=(row:HandoffRow)=>row.status==='unavailable'||row.status==='rescan_required'||
  ('currentPending' in row&&row.currentPending?.status==='unavailable');
const taskKey=(item:{queue:string;id:string|number})=>item.queue+':'+item.id;

export function shiftItems(run:OperatorShift):ReviewHandoffItem[]{
  if(run.scan?.status!=='complete')return [];
  return run.scan.queues.flatMap(queue=>queue.overdue.map(item=>({
    queue:queue.queue,id:item.id,waitingSince:item.waitingSince,target:item.target??null,
  }))).sort((a,b)=>a.waitingSince.localeCompare(b.waitingSince)||taskKey(a).localeCompare(taskKey(b)));
}

export function shiftSummary(id:number,run:OperatorShift){
  const counts={pending:0,decided:0,unavailable:0,rescan_required:0,unchecked:0};
  for(const row of run.checks)counts[row.status]++;
  counts.unchecked=shiftItems(run).length-run.checks.length;
  const complete=run.scan?.status==='complete'&&run.policy?.status==='complete'&&run.outcomeStatus==='complete'&&
    counts.unchecked===0&&!run.checks.some(unresolved);
  return {shiftId:id,status:complete?'complete' as const:'incomplete' as const,
    startedAt:run.startedAt,period:{from:run.period.from,untilExclusive:run.period.until},
    scanStatus:run.scan?.status??'not_run',handoff:counts,unresolvedItems:run.checks.filter(unresolved).length,
    policyStatus:run.policy?.status??'not_run',
    policyCounts:run.policy?.counts??null,outcomeReportId:run.outcomeReportId,outcomeStatus:run.outcomeStatus};
}

export async function runOperatorShift(read:Transport,monitor:ReviewMonitor,period:OutcomePeriod,id?:number,signal?:AbortSignal){
  let stored=id===undefined?monitor.createShift({
    startedAt:new Date().toISOString(),period,scan:null,checks:[],policy:null,outcomeReportId:null,outcomeStatus:'not_run',
  }):monitor.shift(id);
  const run=stored.run;
  const checkpoint=()=>{
    stored=monitor.saveShift(stored.id,stored.revision,run);
  };
  if(signal?.aborted)return shiftSummary(stored.id,run);
  if(run.scan?.status!=='complete'){
    run.scan=await scanReviewBacklog(read);
    checkpoint();
    if(run.scan.status!=='complete'||signal?.aborted)return shiftSummary(stored.id,run);
  }
  monitor.record(run.scan);
  const previous=new Map(run.checks.map(row=>[taskKey(row),row]));
  const pending=shiftItems(run).filter(item=>{
    const row=previous.get(taskKey(item));
    return !row||unresolved(row);
  });
  for(let offset=0;offset<pending.length;offset+=20){
    const page=await reviewHandoff(read,pending,offset);
    for(const row of page.rows)previous.set(taskKey(row),{...row,checkedAt:page.checkedAt});
    run.checks=[...previous.values()];
    checkpoint();
    if(signal?.aborted||page.rows.some(row=>'httpStatus' in row&&[401,403,429].includes(row.httpStatus??0))){
      return shiftSummary(stored.id,run);
    }
  }
  if(run.policy?.status!=='complete'){
    run.policy=await policyPending(read);
    checkpoint();
    if(run.policy.status!=='complete'||signal?.aborted)return shiftSummary(stored.id,run);
  }
  if(run.outcomeStatus!=='complete'){
    const report=await reviewOutcomes(read,run.period);
    stored=monitor.saveShiftOutcome(stored.id,stored.revision,run,report);
  }
  return shiftSummary(stored.id,run);
}
