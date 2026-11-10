import assert from 'node:assert/strict';
import test from 'node:test';
import {ApiError} from '../../../mobile/src/api/client.ts';
import type {Transport} from '../../../mobile/src/auth/session.ts';
import {ids} from '../src/cases.ts';
import {scanReviewBacklog} from '../src/review-backlog.ts';

const now=Date.parse('2026-11-10T00:00:00Z');
const overdue='2026-11-07T23:59:59Z',atTarget='2026-11-08T00:00:00Z';

test('uses first waiting time, follows both cursor types and deduplicates overlapping rows',async()=>{
  const pending={id:ids.work,state:'pending',first_waiting_at:overdue,accepted_at:'2026-11-09T12:00:00Z',title:'private title'};
  const pages:Record<string,unknown>={
    '/ops/work-submissions':{items:[pending],next_cursor:'page+'},
    '/ops/work-submissions?cursor=page%2B':{items:[pending,{...pending,id:ids.other,first_waiting_at:atTarget}],next_cursor:''},
    '/ops/reviews':{items:[{id:1,state:'pending',first_waiting_at:atTarget}],next:1},
    '/ops/reviews?after=1':{items:[{id:2,state:'pending',first_waiting_at:overdue}],next:0},
    '/ops/appeals':{items:[{id:3,state:'pending',created_at:overdue,reason:'private reason'}],next:0},
  };
  const report=await scanReviewBacklog(async<T>(path:string,options?:Parameters<Transport>[1])=>{
    assert.deepEqual(options,{method:'GET'});
    return pages[path] as T;
  },now);
  assert.equal(report.status,'complete');
  assert.equal(report.totalOverdue,3);
  assert.deepEqual(report.queues.map(q=>[q.pending,q.overdue.map(item=>item.id)]),[[2,[ids.work]],[2,[2]],[1,[3]]]);
  assert.doesNotMatch(JSON.stringify(report),/private/);
});

test('a failed page or repeated cursor leaves the total unknown',async()=>{
  for(const failRequest of [true,false]){
    const paths:string[]=[];
    const report=await scanReviewBacklog(async<T>(path:string)=>{
      paths.push(path);
      if(failRequest&&paths.length===2)throw new ApiError('service_unavailable','',503);
      return {items:[{id:ids.work,state:'pending',first_waiting_at:overdue}],next_cursor:'repeat'} as T;
    },now);
    assert.equal(report.status,'incomplete');
    if(report.status!=='incomplete')continue;
    assert.equal(report.error,failRequest?'request_failed':'invalid_queue_cursor');
    assert.equal(report.totalOverdue,null);
    assert.equal(report.failedQueue,'pre_review');
    assert.deepEqual(paths,['/ops/work-submissions','/ops/work-submissions?cursor=repeat']);
  }
});
