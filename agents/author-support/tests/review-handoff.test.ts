import assert from 'node:assert/strict';
import test from 'node:test';
import {ReviewMonitor} from '../src/review-monitor.ts';
import {reviewHandoff} from '../src/review-handoff.ts';
import type {ReviewHandoffItem} from '../src/review-monitor.ts';
import {ApiError} from '../../../mobile/src/api/client.ts';
import type {Transport} from '../../../mobile/src/auth/session.ts';
import {ids} from '../src/cases.ts';

test('legacy events require rescan; unchanged tasks acquire locators without rewriting the event',async()=>{
  const monitor=new ReviewMonitor(':memory:');
  try{
    const base={status:'complete' as const,totalOverdue:1,queues:[{
      queue:'post_review' as const,pending:1,oldestWaitingAt:null,
      overdue:[{id:1,waitingSince:'2026-11-01T00:00:00Z'}],
    }]};
    monitor.record({...base,scannedAt:'2026-11-10T00:00:00Z'});
    let calls=0;
    const legacy=await reviewHandoff(async()=>{calls++;throw Error('must not read')},monitor.handoffItems(1));
    assert.equal(legacy.rows[0].status,'rescan_required');
    assert.equal(calls,0);
    monitor.record({...base,scannedAt:'2026-11-11T00:00:00Z',queues:[{
      ...base.queues[0],overdue:[{...base.queues[0].overdue[0],target:{queue:'post_review',workId:ids.work,version:2}}],
    }]});
    assert.equal(monitor.recentEvents().length,1);
    assert.deepEqual(monitor.handoffItems(1)[0].target,{queue:'post_review',workId:ids.work,version:2});
  }finally{monitor.close()}
});

test('retains unknown results on access failure and binds original IDs while paginating handoff',async()=>{
  const items:ReviewHandoffItem[]=Array.from({length:21},(_,i)=>({
    id:i+1,queue:'post_review',waitingSince:null,target:{queue:'post_review',workId:ids.work,version:i+1},
  }));
  let calls=0;
  const blocked=await reviewHandoff(async()=>{calls++;throw new ApiError('operator_required','',403)},items);
  assert.equal(calls,1);
  assert.equal(blocked.rows.length,20);
  assert.ok(blocked.rows.every(row=>row.status==='unavailable'));
  assert.equal(blocked.nextOffset,20);
  const wrong=await reviewHandoff((async()=>({
    task:{id:999,work_id:ids.work,version:21,state:'approved'},
  })) as Transport,items,20);
  assert.equal(wrong.rows[0].status,'unavailable');
  assert.equal(wrong.nextOffset,null);
});

test('stored handoff distinguishes unchecked tasks and rejects older or unrelated page results',async()=>{
  const monitor=new ReviewMonitor(':memory:');
  try{
    monitor.record({
      status:'complete',scannedAt:'2026-11-11T00:00:00Z',totalOverdue:2,queues:[{
        queue:'post_review',pending:2,oldestWaitingAt:null,
        overdue:[1,2].map(id=>({id,waitingSince:'2026-11-01T00:00:00Z',
          target:{queue:'post_review',workId:ids.work,version:id}})),
      }],
    });
    const items=monitor.handoffItems(1);
    const read=(async()=>({task:{id:1,work_id:ids.work,version:1,state:'approved'}})) as Transport;
    const report=await reviewHandoff(read,items.slice(0,1));
    monitor.saveHandoff(1,{...report,checkedAt:'2026-11-11T02:00:00Z'});
    const summary=monitor.handoffSummary(1);
    assert.equal(summary.counts.decided,1);
    assert.equal(summary.counts.unchecked,1);
    monitor.saveHandoff(1,{
      ...report,checkedAt:'2026-11-11T01:00:00Z',
      rows:[{...report.rows[0],status:'unavailable'}],
    });
    assert.equal(monitor.handoffSummary(1).counts.decided,1);
    const unrelated={...report.rows[0],id:999};
    assert.throws(()=>monitor.saveHandoff(1,{...report,rows:[unrelated]}),/handoff_target_changed/);
    assert.deepEqual(monitor.handoffSummary(1),summary);
  }finally{monitor.close()}
});
