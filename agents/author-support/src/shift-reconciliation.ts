import type {Transport} from '../../../mobile/src/auth/session.ts';
import {isDeepStrictEqual} from 'node:util';
import type {ReviewMonitor,ReviewHandoffItem} from './review-monitor.ts';
import {shiftItems} from './operator-shift.ts';
import {reviewHandoff} from './review-handoff.ts';

type Check=Awaited<ReturnType<typeof reviewHandoff>>['rows'][number]&{checkedAt:string};
type Source={shiftId:number;revision:number;scannedAt:string};
export type ShiftReconciliation={
  startedAt:string;previous:Source;current:Source;
  retained:ReviewHandoffItem[];entered:ReviewHandoffItem[];departed:ReviewHandoffItem[];checks:Check[];
};
const key=(item:ReviewHandoffItem)=>item.queue+':'+item.id;
const unresolved=(row:Check)=>['unavailable','rescan_required'].includes(row.status)||
  ('currentPending' in row&&row.currentPending?.status==='unavailable');

/** A missing queue item is an observation, not a moderation outcome. */
export function prepareReconciliation(monitor:ReviewMonitor,previousId:number,currentId:number):ShiftReconciliation{
  const previous=monitor.shift(previousId),current=monitor.shift(currentId);
  if(previous.run.scan?.status!=='complete'||current.run.scan?.status!=='complete')throw Error('shift_scan_incomplete');
  if(previousId===currentId||previous.run.scan.scannedAt>=current.run.scan.scannedAt)throw Error('shifts_not_comparable');
  const before=new Map(shiftItems(previous.run).map(item=>[key(item),item]));
  const after=new Map(shiftItems(current.run).map(item=>[key(item),item]));
  const retained:ReviewHandoffItem[]=[],entered:ReviewHandoffItem[]=[],departed:ReviewHandoffItem[]=[];
  for(const [id,item] of after){
    const old=before.get(id);
    if(!old){entered.push(item);continue}
    if(old.target&&item.target&&!isDeepStrictEqual(old.target,item.target))throw Error('reconciliation_target_changed');
    retained.push(item);
  }
  for(const [id,item] of before)if(!after.has(id))departed.push(item);
  return {startedAt:new Date().toISOString(),
    previous:{shiftId:previousId,revision:previous.revision,scannedAt:previous.run.scan.scannedAt},
    current:{shiftId:currentId,revision:current.revision,scannedAt:current.run.scan.scannedAt},
    retained,entered,departed,checks:[]};
}

export function reconciliationSummary(reportId:number,run:ShiftReconciliation){
  const checked=new Map(run.checks.map(row=>[key(row),row]));
  const counts={decided:0,stillPending:0,unconfirmed:0};
  for(const item of run.departed){
    const row=checked.get(key(item));
    if(!row||unresolved(row))counts.unconfirmed++;
    else if(row.status==='decided')counts.decided++;
    else counts.stillPending++;
  }
  const queues=(['pre_review','post_review','appeal'] as const).map(queue=>{
    const count=(items:ReviewHandoffItem[])=>items.filter(item=>item.queue===queue).length;
    return {queue,previous:count(run.retained)+count(run.departed),entered:count(run.entered),
      departed:count(run.departed),current:count(run.retained)+count(run.entered)};
  });
  return {reportId,version:'shift-reconciliation-v1' as const,
    status:counts.unconfirmed?'incomplete' as const:'complete' as const,startedAt:run.startedAt,
    previous:run.previous,current:run.current,retained:run.retained.length,entered:run.entered.length,
    departed:run.departed.length,departureChecks:counts,queues};
}

export async function runReconciliation(read:Transport,monitor:ReviewMonitor,reportId:number,signal?:AbortSignal){
  let stored=monitor.reconciliation(reportId);
  const run=stored.run;
  const checked=new Map(run.checks.map(row=>[key(row),row]));
  const pending=run.departed.filter(item=>!checked.has(key(item))||unresolved(checked.get(key(item))!));
  for(let offset=0;offset<pending.length&&!signal?.aborted;offset+=20){
    const report=await reviewHandoff(read,pending,offset);
    for(const row of report.rows)checked.set(key(row),{...row,checkedAt:report.checkedAt});
    run.checks=[...checked.values()];
    stored=monitor.saveReconciliation(stored.id,stored.revision,run);
    if(report.rows.some(row=>'httpStatus' in row&&[401,403,429].includes(row.httpStatus??0)))break;
  }
  return reconciliationSummary(reportId,run);
}
