import assert from 'node:assert/strict';
import test from 'node:test';
import {reviewOutcomes} from '../src/review-outcomes.ts';
import {ids} from '../src/cases.ts';
import {ApiError} from '../../../mobile/src/api/client.ts';
import type {Transport} from '../../../mobile/src/auth/session.ts';

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
