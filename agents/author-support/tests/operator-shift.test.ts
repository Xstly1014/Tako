import assert from 'node:assert/strict';
import test from 'node:test';
import {runOperatorShift,shiftSummary} from '../src/operator-shift.ts';
import {ReviewMonitor} from '../src/review-monitor.ts';
import {outcomePeriod} from '../src/review-outcomes.ts';
import {ApiError} from '../../../mobile/src/api/client.ts';
import type {Transport} from '../../../mobile/src/auth/session.ts';
import {ids} from '../src/cases.ts';

const period=outcomePeriod('2026-11-01','2026-11-06');
const task={id:1,work_id:ids.work,version:1,state:'pending',first_waiting_at:'2026-11-01T00:00:00Z'};

test('a shift checkpoints failed checks and resumes only unfinished work',async()=>{
  const monitor=new ReviewMonitor(':memory:');
  let failed=true;
  const paths:string[]=[];
  const read=(async(path,options)=>{
    paths.push(path);
    assert.equal(options?.method,'GET');
    if(path==='/ops/work-submissions')return {items:[],next_cursor:''};
    if(path==='/ops/reviews')return {items:[task],next:0};
    if(path==='/ops/appeals')return {items:[],next:0};
    if(path==='/ops/moderation?before=0')return {items:[],next:0};
    assert.equal(path,`/ops/reviews/${ids.work}/versions/1`);
    if(failed)throw new ApiError('service_unavailable','',503);
    return {task:{...task,state:'approved'}};
  }) as Transport;
  try{
    const first=await runOperatorShift(read,monitor,period);
    assert.equal(first.status,'incomplete');
    assert.equal(first.handoff.unavailable,1);
    assert.equal(first.outcomeStatus,'complete');
    assert.throws(()=>monitor.acknowledgeShift(first.shiftId,'shift-a'),/shift_incomplete/);
    const stored=monitor.shift(first.shiftId);
    paths.length=0;
    failed=false;
    const resumed=await runOperatorShift(read,monitor,period,first.shiftId);
    assert.equal(resumed.status,'complete');
    assert.equal(resumed.handoff.decided,1);
    assert.deepEqual(paths,[`/ops/reviews/${ids.work}/versions/1`]);
    assert.equal(resumed.outcomeReportId,first.outcomeReportId);
    assert.throws(()=>monitor.saveShift(stored.id,stored.revision,stored.run),/shift_changed/);
    paths.length=0;
    assert.deepEqual(await runOperatorShift(read,monitor,period,first.shiftId),resumed);
    assert.deepEqual(paths,[]);
    assert.deepEqual(shiftSummary(first.shiftId,monitor.shift(first.shiftId).run),resumed);
    const acknowledgment=monitor.acknowledgeShift(first.shiftId,'shift-a');
    assert.deepEqual(monitor.acknowledgeShift(first.shiftId,'shift-b'),acknowledgment);
    assert.equal(monitor.shiftAcknowledgment(first.shiftId)?.operatorLabel,'shift-a');
  }finally{monitor.close()}
});

test('permission failure checkpoints progress and prevents unrelated phases from running',async()=>{
  const monitor=new ReviewMonitor(':memory:');
  const paths:string[]=[];
  const read=(async(path)=>{
    paths.push(path);
    if(path==='/ops/work-submissions')return {items:[],next_cursor:''};
    if(path==='/ops/reviews')return {items:[task],next:0};
    if(path==='/ops/appeals')return {items:[],next:0};
    throw new ApiError('operator_required','',403);
  }) as Transport;
  try{
    const report=await runOperatorShift(read,monitor,period);
    assert.equal(report.status,'incomplete');
    assert.equal(report.policyStatus,'not_run');
    assert.equal(report.outcomeStatus,'not_run');
    assert.equal(paths.length,4);
    assert.equal(monitor.shift(report.shiftId).run.checks[0].status,'unavailable');
  }finally{monitor.close()}
});

test('an incomplete period report is retained and resumed without rescanning the completed queues',async()=>{
  const monitor=new ReviewMonitor(':memory:');
  let fail=true;
  const paths:string[]=[];
  const read=(async(path)=>{
    paths.push(path);
    if(path==='/ops/work-submissions')return {items:[],next_cursor:''};
    if(path==='/ops/reviews'||path==='/ops/appeals')return {items:[],next:0};
    assert.equal(path,'/ops/moderation?before=0');
    if(fail)throw new ApiError('service_unavailable','',503);
    return {items:[],next:0};
  }) as Transport;
  try{
    const failed=await runOperatorShift(read,monitor,period);
    assert.equal(failed.status,'incomplete');
    assert.equal(failed.outcomeStatus,'incomplete');
    assert.equal(monitor.outcomeReport(failed.outcomeReportId!).report.status,'incomplete');
    fail=false;
    paths.length=0;
    const resumed=await runOperatorShift(read,monitor,period,failed.shiftId);
    assert.equal(resumed.status,'complete');
    assert.deepEqual(paths,['/ops/moderation?before=0']);
    assert.notEqual(resumed.outcomeReportId,failed.outcomeReportId);
    assert.equal(monitor.outcomeReport(failed.outcomeReportId!).report.status,'incomplete');
  }finally{monitor.close()}
});
