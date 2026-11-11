import test from 'node:test';
import assert from 'node:assert/strict';
import {checkReaderEffect,effectInput,type EffectInput} from '../src/reader-effect.ts';
import {ReviewMonitor} from '../src/review-monitor.ts';
import {ApiError} from '../../../mobile/src/api/client.ts';
import type {Transport} from '../../../mobile/src/auth/session.ts';
import {ids} from '../src/cases.ts';
import {outcomePeriod} from '../src/review-outcomes.ts';

const input:EffectInput={source:{kind:'shifts',id:1,queue:'post_review',itemId:'7'},item:{queue:'post_review',id:7,waitingSince:null,
  target:{queue:'post_review',workId:ids.work,version:1}}};
const post=(state='approved')=>(async(_path,options)=>{
  assert.equal(options?.method,'GET');return {task:{id:7,work_id:ids.work,version:1,state},work:{body:'PRIVATE_BODY'}};
}) as Transport;

test('a decided target can be unreadable while another display version is readable; persist metadata only',async()=>{
  const report=await checkReaderEffect(input,post(),undefined,async(id,version)=>version?null:{id,version:2});
  assert.equal(report.status,'complete');
  assert.deepEqual(report.display,{state:'readable',version:2});assert.deepEqual(report.target,{state:'not_readable'});
  assert.equal(report.operation?.state,'approved');assert.ok(!JSON.stringify(report).includes('PRIVATE_BODY'));
  const monitor=new ReviewMonitor(':memory:');
  try{const id=monitor.saveReaderEffect(report);assert.deepEqual(monitor.readerEffect(id),{reportId:id,...report});
    assert.equal(monitor.history('effects').items[0].status,'complete');
  }finally{monitor.close()}
});

test('pending decisions never send anonymous reads and privilege errors remain incomplete',async()=>{
  const anonymous=async()=>{throw Error('must not send')};
  const pending=await checkReaderEffect(input,post('pending'),undefined,anonymous);
  assert.equal(pending.status,'awaiting_decision');assert.equal(pending.display,null);assert.ok(pending.finishedAt);
  const denied=await checkReaderEffect(input,(async()=>{throw new ApiError('operator_required','',403)}) as Transport,undefined,anonymous);
  assert.equal(denied.status,'incomplete');assert.equal(denied.httpStatus,403);assert.equal(denied.operation,null);
  const stop=new AbortController();stop.abort();let calls=0;
  const cancelled=await checkReaderEffect(input,(async()=>{calls++;throw Error('must not query')}) as Transport,stop.signal,anonymous);
  assert.equal(calls,0);assert.equal(cancelled.status,'incomplete');assert.ok(cancelled.finishedAt);
});

test('public network errors and wrong resources are unknown, not not-readable or successful',async()=>{
  const failed=await checkReaderEffect(input,post(),undefined,async()=>{throw Error('network')});
  assert.equal(failed.status,'incomplete');assert.equal(failed.display,null);assert.equal(failed.target,null);
  const wrong=await checkReaderEffect(input,post(),undefined,async id=>({id,version:3}));
  assert.equal(wrong.status,'incomplete');
});

test('changing operator decisions or anonymous display results invalidates the combined observation',async()=>{
  let reads=0;
  const operator=(async()=>({task:{id:7,work_id:ids.work,version:1,state:++reads===1?'approved':'restricted'}})) as Transport;
  const changed=await checkReaderEffect(input,operator,undefined,async id=>({id,version:1}));
  assert.equal(changed.status,'changed');assert.equal(changed.display,null);
  reads=0;
  const publicChanged=await checkReaderEffect(input,post(),undefined,async(id,version)=>({id,version:version??(++reads===1?1:2)}));
  assert.equal(publicChanged.status,'changed');assert.equal(publicChanged.target,null);
});

test('an upheld appeal and a later revoked restriction are distinct facts; bracket the case revision',async()=>{
  const appeal:EffectInput={source:{kind:'outcomes',id:1,queue:'appeal',itemId:'4'},item:{queue:'appeal',id:4,waitingSince:null,target:{queue:'appeal',caseId:9}}};
  const read=(async()=>({case:{id:9,work_id:ids.work,version:1,scope:'work',state:'revoked',revision:2},
    appeals:{items:[{id:4,case_id:9,state:'upheld',reason:'PRIVATE_REASON'}],next:0}})) as Transport;
  const result=await checkReaderEffect(appeal,read,undefined,async()=>null);
  assert.equal(result.status,'complete');assert.equal(result.operation?.state,'upheld');assert.equal(result.operation?.caseState,'revoked');
  assert.equal(result.display?.state,'not_readable');assert.ok(!JSON.stringify(result).includes('PRIVATE_REASON'));
});

test('task lookup is bound to a saved source and never trusts a client work id',()=>{
  const monitor=new ReviewMonitor(':memory:');
  try{
    const run=monitor.createShift({startedAt:new Date().toISOString(),period:outcomePeriod('2026-11-01','2026-11-06'),
      scan:{status:'complete',scannedAt:new Date().toISOString(),queues:[{queue:'post_review',pending:1,oldestWaitingAt:null,
        overdue:[{id:7,waitingSince:'2026-10-01T00:00:00Z',target:input.item.target!}]}],totalOverdue:1},checks:[],policy:null,outcomeReportId:null,outcomeStatus:'not_run'});
    const source={...input.source,id:run.id};
    assert.deepEqual(effectInput(monitor,source).item.target,input.item.target);
    assert.throws(()=>effectInput(monitor,{...source,itemId:'8'}),/effect_source_not_found/);
    assert.throws(()=>effectInput(monitor,{...source,queue:'appeal'}),/effect_source_not_found/);
  }finally{monitor.close()}
});

test('an unpublished submission never turns its candidate into a released version',async()=>{
  const at='2026-11-04T01:00:00Z';
  const source:EffectInput={source:{kind:'shifts',id:1,queue:'pre_review',itemId:ids.other},
    item:{queue:'pre_review',id:ids.other,waitingSince:at,target:{queue:'pre_review',submissionId:ids.other}}};
  for(const state of ['rejected','withdrawn','superseded','published']){
    const read=(async()=>({submission:{id:ids.other,work_id:ids.work,preview_id:ids.preview,candidate_version:2,
      title:'PRIVATE_TITLE',state,reason:'PRIVATE_REASON',accepted_at:at,first_waiting_at:at,decided_at:at},
      preview:{id:ids.preview,draft_id:ids.draft,source_revision:1,expected_version:1,title:'PRIVATE_TITLE',content:'PRIVATE_BODY',introduction:'',
        tags:['日常'],created_at:at,expires_at:at,published:{work_id:ids.work,version:0,published_at:null,review_status:'pre_review',submission_id:ids.other,submitted_at:at}}})) as Transport;
    let calls=0;
    const result=await checkReaderEffect(source,read,undefined,async(id,version)=>{calls++;return {id,version:version??1}});
    assert.equal(result.status,state==='published'?'complete':'not_released');
    assert.equal(calls,state==='published'?4:0);assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  }
});
