import assert from 'node:assert/strict';
import test from 'node:test';
import {ReviewMonitor,type Observation} from '../src/review-monitor.ts';

const at=(minute:number)=>new Date(Date.UTC(2026,10,10,0,minute)).toISOString();
const complete=(minute:number,ids:number[]):Observation=>({
  status:'complete',scannedAt:at(minute),totalOverdue:ids.length,
  queues:[{queue:'post_review',pending:ids.length,oldestWaitingAt:null,
    overdue:ids.map(id=>({id,waitingSince:'2026-11-07T00:00:00Z'}))}],
});
const failed=(minute:number):Observation=>({
  status:'incomplete',scannedAt:at(minute),queues:[],failedQueue:'post_review',
  error:'request_failed',httpStatus:503,totalOverdue:null,
});

test('deduplicates alerts and preserves the last complete backlog through failures',()=>{
  const monitor=new ReviewMonitor(':memory:');
  try{
    assert.deepEqual(monitor.record(complete(1,[1])).events,[
      {id:1,kind:'overdue_changed',queue:'post_review',added:[1],noLongerObserved:[],total:1},
    ]);
    assert.deepEqual(monitor.record(complete(2,[1])).events,[]);
    assert.equal(monitor.record(failed(3)).events[0]?.kind,'scan_failed');
    assert.deepEqual(monitor.record(failed(4)).events,[]);
    assert.deepEqual(monitor.record(complete(2,[])),{accepted:false,events:[]});
    assert.deepEqual(monitor.record(complete(5,[2])).events,[
      {id:3,kind:'scan_restored'},
      {id:4,kind:'overdue_changed',queue:'post_review',added:[2],noLongerObserved:[1],total:1},
    ]);
    assert.deepEqual(monitor.record(complete(6,[])).events,[
      {id:5,kind:'overdue_changed',queue:'post_review',added:[],noLongerObserved:[2],total:0},
    ]);
    assert.equal(monitor.recentEvents().length,5);
  }finally{monitor.close()}
});

test('pending events paginate and repeat acknowledgments preserve the first operator',()=>{
  const monitor=new ReviewMonitor(':memory:');
  try{
    for(let id=1;id<=21;id++)monitor.record(complete(id,[id]));
    const first=monitor.pendingEvents();
    assert.equal(first.events.length,20);
    assert.equal(first.nextAfter,20);
    assert.deepEqual(monitor.pendingEvents(20).events.map(event=>event.id),[21]);
    const receipt=monitor.acknowledge(1,'shift-a');
    assert.equal(receipt.alreadyAcknowledged,false);
    assert.deepEqual(monitor.acknowledge(1,'shift-b'),{...receipt,alreadyAcknowledged:true});
    assert.equal(monitor.pendingEvents().events[0].id,2);
    assert.equal(monitor.recentEvents().at(-1)?.id,2);
    const final=monitor.acknowledge(21,'shift-a');
    assert.deepEqual(monitor.recentEvents()[0].acknowledgment,{
      operatorLabel:final.operatorLabel,acknowledgedAt:final.acknowledgedAt,
    });
    assert.throws(()=>monitor.acknowledge(22,'shift-a'),/review_event_not_found/);
  }finally{monitor.close()}
});
