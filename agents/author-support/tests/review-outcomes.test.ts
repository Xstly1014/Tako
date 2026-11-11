import assert from 'node:assert/strict';
import test from 'node:test';
import {outcomePeriod,reviewOutcomes,summarizeOutcomePeriod,type Outcome} from '../src/review-outcomes.ts';
import {ids} from '../src/cases.ts';
import {ApiError} from '../../../mobile/src/api/client.ts';
import type {Transport} from '../../../mobile/src/auth/session.ts';
import {ReviewMonitor} from '../src/review-monitor.ts';

const at='2026-11-01T00:00:00Z',later='2026-11-01T01:00:00Z';
const restriction={id:1,work_id:ids.work,version:1,scope:'version',state:'revoked',revision:2,
  reason:'PRIVATE_REASON',created_at:at,next_appeal_at:null};
const detail={
  case:restriction,
  work:{id:ids.work,title:'PRIVATE_TITLE',content:'PRIVATE_BODY',introduction:'',tags:['日常'],
    author_nickname:'PRIVATE_AUTHOR',published_at:at,version:1},
  revocation:{reason:'PRIVATE_REASON',created_at:later},
  appeals:{items:[
    {id:2,case_id:1,reason:'PRIVATE',decision_reason:'PRIVATE',state:'revoked',created_at:at,decided_at:later},
    {id:1,case_id:1,reason:'PRIVATE',decision_reason:'PRIVATE',state:'upheld',created_at:at,decided_at:later},
  ],next:0},
};

test('counts distinct requests and projects only outcome metadata',async()=>{
  const report=await reviewOutcomes((async(path,options)=>{
    assert.equal(options?.method,'GET');
    if(path==='/ops/moderation?before=0')return {items:[restriction],next:0};
    assert.equal(path,'/ops/moderation/1?before=0');
    return detail;
  }) as Transport);
  assert.equal(report.status,'complete');
  assert.deepEqual(report.counts,{pending:0,upheld:1,revoked:1});
  assert.deepEqual(report.outcomes.map(item=>item.processingMinutes),[60,60]);
  assert.doesNotMatch(JSON.stringify(report),/PRIVATE/);
});

test('failed or inconsistent detail cannot produce a complete outcome count',async()=>{
  for(const forbidden of [true,false]){
    const report=await reviewOutcomes((async(path)=>{
      if(path==='/ops/moderation?before=0')return {items:[restriction],next:0};
      if(forbidden)throw new ApiError('operator_required','',403);
      return {...detail,appeals:{items:[{...detail.appeals.items[0],decided_at:'2026-10-01T00:00:00Z'}],next:0}};
    }) as Transport);
    assert.equal(report.status,'incomplete');
    assert.equal(report.counts,null);
    assert.equal(report.outcomes.length,0);
  }
});

test('period reporting separates older decisions from new requests and reconstructs pending at cutoff',()=>{
  const row=(id:number,requestedAt:string,decidedAt:string):Outcome=>({
    appealId:id,caseId:1,scope:'version',state:'upheld',requestedAt,decidedAt,
    processingMinutes:(Date.parse(decidedAt)-Date.parse(requestedAt))/60000,detailPath:'/ops/moderation/1',
  });
  const rows=[
    row(1,'2026-10-30T00:00:00+08:00','2026-11-01T00:01:00+08:00'),
    row(2,'2026-11-01T00:00:00+08:00','2026-11-03T00:00:00+08:00'),
    row(3,'2026-11-01T12:00:00+08:00','2026-11-02T00:00:00+08:00'),
    row(4,'2026-11-02T00:00:00+08:00','2026-11-02T01:00:00+08:00'),
  ];
  const summary=summarizeOutcomePeriod(rows,outcomePeriod('2026-11-01','2026-11-02'),'2026-11-04T00:00:00Z');
  assert.deepEqual(summary.incoming,{total:2,pendingAtCutoff:2,upheldBeforeCutoff:0,revokedBeforeCutoff:0});
  assert.deepEqual(summary.decisions,{total:1,upheld:1,revoked:0,over48Hours:1,medianProcessingMinutes:2881});
  assert.deepEqual(summary.outcomes.map(item=>item.appealId),[1,2,3]);
  assert.throws(()=>outcomePeriod('2026-02-30','2026-03-03'),/invalid_period/);
  assert.throws(()=>outcomePeriod('2026-11-02','2026-11-01'),/invalid_period/);
});

test('saved period comparisons preserve snapshots and reject partial or overlapping reports',()=>{
  const monitor=new ReviewMonitor(':memory:');
  try{
    const startedAt='2026-11-11T00:00:00Z';
    const report=(from:string,until:string)=>({
      status:'complete' as const,startedAt,cases:0,
      period:summarizeOutcomePeriod([],outcomePeriod(from,until),startedAt),
    });
    const first=monitor.saveOutcomeReport(report('2026-11-01','2026-11-06'));
    const second=monitor.saveOutcomeReport(report('2026-11-06','2026-11-11'));
    const original=monitor.outcomeReport(first);
    assert.deepEqual(monitor.compareOutcomes(first,second).incoming,{previous:0,current:0,change:0});
    assert.equal(monitor.compareOutcomes(first,second).medianProcessingMinutes.change,null);
    assert.deepEqual(monitor.outcomeReport(first),original);
    assert.throws(()=>monitor.compareOutcomes(first,first),/periods_not_comparable/);
    const incomplete=monitor.saveOutcomeReport({
      status:'incomplete',startedAt,cases:0,counts:null,outcomes:[],error:'request_failed',httpStatus:503,
    });
    assert.throws(()=>monitor.compareOutcomes(first,incomplete),/report_not_comparable/);
    const open=monitor.saveOutcomeReport(report('2026-11-11','2026-11-16'));
    assert.throws(()=>monitor.compareOutcomes(second,open),/period_still_open/);
  }finally{monitor.close()}
});

test('period flow includes old pending requests and decisions at exact start and end boundaries',()=>{
  const request=(id:number,requestedAt:string,decidedAt:string|null):Outcome=>({
    appealId:id,caseId:1,scope:'work',state:decidedAt?'upheld':'pending',
    requestedAt,decidedAt,processingMinutes:decidedAt?(Date.parse(decidedAt)-Date.parse(requestedAt))/60000:null,
    detailPath:'/ops/moderation/1',
  });
  const report=summarizeOutcomePeriod([
    request(1,'2026-10-28T00:00:00+08:00',null),
    request(2,'2026-10-30T00:00:00+08:00','2026-11-01T00:00:00+08:00'),
    request(3,'2026-11-01T00:00:00+08:00','2026-11-02T00:00:00+08:00'),
    request(4,'2026-11-02T00:00:00+08:00',null),
  ],outcomePeriod('2026-11-01','2026-11-02'),'2026-11-03T00:00:00Z');
  assert.deepEqual(report.flow,{
    openingPending:2,incoming:1,decisions:1,closingPending:2,closingOver48Hours:1,balanceDifference:0,
  });
  assert.equal(report.incoming.pendingAtCutoff,1);
  assert.equal(report.outcomes.find(row=>row.appealId===1)?.stateAtCutoff,'pending');
});
