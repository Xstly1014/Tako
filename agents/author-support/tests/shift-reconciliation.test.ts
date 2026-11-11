import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ReviewMonitor} from '../src/review-monitor.ts';
import {prepareReconciliation,reconciliationSummary,runReconciliation} from '../src/shift-reconciliation.ts';
import {outcomePeriod} from '../src/review-outcomes.ts';
import {ApiError} from '../../../mobile/src/api/client.ts';
import type {Transport} from '../../../mobile/src/auth/session.ts';
import type {OperatorShift} from '../src/operator-shift.ts';
import {ids} from '../src/cases.ts';

function shift(monitor:ReviewMonitor,tasks:number[],at='2026-11-02T00:00:00Z'){
  const run:OperatorShift={startedAt:at,period:outcomePeriod('2026-11-01','2026-11-06'),
    scan:{status:'complete',scannedAt:at,totalOverdue:tasks.length,queues:[{queue:'post_review',pending:tasks.length,
      oldestWaitingAt:tasks.length?'2026-10-01T00:00:00Z':null,overdue:tasks.map(id=>({id,waitingSince:'2026-10-01T00:00:00Z',
        target:{queue:'post_review',workId:ids.work,version:id}}))}]},
    checks:[],policy:null,outcomeReportId:null,outcomeStatus:'not_run'};
  return monitor.createShift(run);
}
function prepared(monitor:ReviewMonitor,before:number[],after:number[]){
  const previous=shift(monitor,before),current=shift(monitor,after,'2026-11-03T00:00:00Z');
  return monitor.createReconciliation(prepareReconciliation(monitor,previous.id,current.id));
}

test('equal queue totals still expose identity changes; departed pending is never counted as decided',async()=>{
  const monitor=new ReviewMonitor(':memory:');
  try{
    const stored=prepared(monitor,[1,2],[2,3]);let calls=0;
    const read=(async(route,options)=>{
      calls++;assert.equal(route,`/ops/reviews/${ids.work}/versions/1`);assert.equal(options?.method,'GET');
      return {task:{id:1,work_id:ids.work,version:1,state:'pending'}};
    }) as Transport;
    const result=await runReconciliation(read,monitor,stored.id);
    assert.equal(result.retained,1);assert.equal(result.entered,1);assert.equal(result.departed,1);
    assert.deepEqual(result.departureChecks,{decided:0,stillPending:1,unconfirmed:0});
    assert.equal(result.status,'complete');
    for(const row of result.queues)assert.equal(row.previous+row.entered-row.departed,row.current);
    assert.equal(calls,1);await runReconciliation(read,monitor,stored.id);assert.equal(calls,1);
    // Later source revisions cannot rewrite the frozen comparison.
    const source=monitor.shift(stored.run.previous.shiftId);source.run.scan=null;
    monitor.saveShift(source.id,source.revision,source.run);
    assert.equal(monitor.reconciliation(stored.id).run.departed.length,1);
  }finally{monitor.close()}
});

test('failed departure check is retained and only that check is retried; reports survive restart',async()=>{
  const directory=mkdtempSync(path.join(os.tmpdir(),'tako-reconcile-'));const file=path.join(directory,'monitor.sqlite');
  let monitor=new ReviewMonitor(file),fail=true;const calls:number[]=[];
  const read=(async(route)=>{
    const version=Number(route.split('/').at(-1));calls.push(version);
    if(version===2&&fail)throw new ApiError('service_unavailable','',503);
    return {task:{id:version,work_id:ids.work,version,state:'approved'}};
  }) as Transport;
  try{
    const stored=prepared(monitor,[1,2],[]);
    const first=await runReconciliation(read,monitor,stored.id);assert.equal(first.status,'incomplete');
    assert.deepEqual(first.departureChecks,{decided:1,stillPending:0,unconfirmed:1});
    monitor.close();monitor=new ReviewMonitor(file);calls.length=0;fail=false;
    const stale=monitor.reconciliation(stored.id);
    const result=await runReconciliation(read,monitor,stored.id);
    assert.deepEqual(calls,[2]);assert.equal(result.status,'complete');
    assert.equal(result.departureChecks.decided,2);
    assert.throws(()=>monitor.saveReconciliation(stored.id,stale.revision,stale.run),/reconciliation_changed/);
    assert.equal(monitor.history('reconciliations').items.length,1);
  }finally{monitor.close();rmSync(directory,{recursive:true,force:true})}
});

test('permission denial stops further batches and cancellation retains resumable progress',async()=>{
  const monitor=new ReviewMonitor(':memory:');
  try{
    const stored=prepared(monitor,Array.from({length:22},(_,i)=>i+1),[]);let calls=0;
    const blocked=(async()=>{calls++;throw new ApiError('operator_required','',403)}) as Transport;
    const first=await runReconciliation(blocked,monitor,stored.id);assert.equal(calls,1);
    assert.equal(first.departureChecks.unconfirmed,22);assert.equal(monitor.reconciliation(stored.id).run.checks.length,20);
    const stop=new AbortController();stop.abort();
    await runReconciliation(blocked,monitor,stored.id,stop.signal);assert.equal(calls,1);
  }finally{monitor.close()}
});

test('incomplete or reversed scans and conflicting identities cannot produce a reconciliation',()=>{
  const monitor=new ReviewMonitor(':memory:');
  try{
    const left=shift(monitor,[1]),right=shift(monitor,[1],'2026-11-03T00:00:00Z');
    assert.throws(()=>prepareReconciliation(monitor,right.id,left.id),/shifts_not_comparable/);
    assert.throws(()=>prepareReconciliation(monitor,left.id,left.id),/shifts_not_comparable/);
    right.run.scan!.queues[0].overdue[0].target={queue:'post_review',workId:ids.work,version:9};
    const changed=monitor.saveShift(right.id,right.revision,right.run);
    assert.throws(()=>prepareReconciliation(monitor,left.id,right.id),/reconciliation_target_changed/);
    changed.run.scan=null;monitor.saveShift(right.id,changed.revision,changed.run);
    assert.throws(()=>prepareReconciliation(monitor,left.id,right.id),/shift_scan_incomplete/);
  }finally{monitor.close()}
});

test('legacy missing locators remain explicitly unconfirmed and never send a guessed request',async()=>{
  const monitor=new ReviewMonitor(':memory:');
  try{
    const left=shift(monitor,[1]),right=shift(monitor,[],'2026-11-03T00:00:00Z');
    delete left.run.scan!.queues[0].overdue[0].target;
    monitor.saveShift(left.id,left.revision,left.run);
    const stored=monitor.createReconciliation(prepareReconciliation(monitor,left.id,right.id));
    const report=await runReconciliation((async()=>{throw Error('must_not_read')}) as Transport,monitor,stored.id);
    assert.equal(report.status,'incomplete');assert.equal(report.departureChecks.unconfirmed,1);
    assert.equal(monitor.reconciliation(stored.id).run.checks[0].status,'rescan_required');
    assert.deepEqual(reconciliationSummary(stored.id,monitor.reconciliation(stored.id).run),report);
  }finally{monitor.close()}
});
