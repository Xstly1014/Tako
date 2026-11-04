import test from 'node:test';
import assert from 'node:assert/strict';
import {cases,referenceTrial,ids} from '../src/cases.ts';
import {contextFromInput} from '../src/delivery.ts';
import {deliver} from '../src/recovery.ts';
import {evaluate} from '../src/evaluate.ts';
import type {Evidence} from '../src/grade.ts';

test('reference answers retain their facts and gain precise read-only next steps',async()=>{
  for(const task of cases){
    const trial=await referenceTrial(task),result=deliver(contextFromInput(task.prompt),trial.verdict,trial.evidence);
    assert.equal(result.status,'admitted',task.id);assert.equal(evaluate(task,result.verdict,trial.evidence).automatic_passed,true,task.id);
    assert.ok(result.next_step,task.id);
    if(task.id==='pre-review')assert.deepEqual(result.next_step,{kind:'read_submission_record',submission_id:ids.other});
    if(task.id==='unconfirmed')assert.deepEqual(result.next_step,{kind:'read_original_result',preview_id:ids.preview});
    if(task.id==='ambiguous'||task.id==='foreign')assert.equal(result.verification,'needs_clarification');
    if(task.id==='tool-failure')assert.equal(result.verification,'unable_to_check');
  }
});
test('recorded restriction and navigation failures can be recovered from independent verified facts',async()=>{
  for(const name of ['older-display','unconfirmed','pre-review']){
    const task=cases.find(x=>x.id===name)!,trial=await referenceTrial(task);
    const raw={...trial.verdict,...(name==='older-display'?{access:'display_limited' as const}:{next_action:'open_work_detail'})};
    const before=JSON.stringify(raw),result=deliver(contextFromInput(task.prompt),raw,trial.evidence);
    assert.equal(result.status,'recovered',name);assert.ok(result.reasons.length);assert.ok(result.corrected_fields!.length);
    assert.equal(JSON.stringify(raw),before);assert.equal(evaluate(task,result.verdict,trial.evidence).automatic_passed,true,name);
    assert.equal(result.verification,'facts_checked');
  }
});
test('partial evidence does not turn a missing state or unavailable tool into an unrestricted work',async()=>{
  const task=cases.find(x=>x.id==='older-display')!,trial=await referenceTrial(task);
  const onlyReceipt=trial.evidence.filter(x=>x.tool==='read_publication_result');
  const raw={...trial.verdict,access:'display_limited' as const,evidence_ids:onlyReceipt.map(x=>x.result.evidence_id)};
  const result=deliver(contextFromInput(task.prompt),raw,onlyReceipt);
  assert.equal(result.status,'recovered');assert.equal(result.verdict.publication,'confirmed');assert.equal(result.verdict.access,'unknown');
  assert.equal(evaluate(task,result.verdict,onlyReceipt).automatic_passed,false);
  const failure=cases.find(x=>x.id==='tool-failure')!,f=await referenceTrial(failure);
  assert.equal(deliver(contextFromInput(failure.prompt),{...f.verdict,publication:'confirmed'},f.evidence).status,'fallback');
});
test('forged references, cross-resource receipts, contradictory snapshots and reauthentication are not recovered',async()=>{
  const task=cases[0],trial=await referenceTrial(task),context=contextFromInput(task.prompt);
  assert.equal(deliver(context,{...trial.verdict,evidence_ids:['invented']},trial.evidence).status,'fallback');
  const foreign=structuredClone(trial.evidence);
  for(const x of foreign)if(x.tool==='read_publication_result'&&x.result.status==='ok')(x.result.data.published as {work_id:string}).work_id=ids.other;
  assert.equal(deliver(context,trial.verdict,foreign).status,'fallback');
  const state=structuredClone(trial.evidence.find(x=>x.tool==='read_work_state')!);
  state.result.evidence_id='55555555-5555-4555-8555-555555555555';
  if(state.result.status==='ok')state.result.data.author_hidden=false;
  assert.equal(deliver(context,{...trial.verdict,evidence_ids:[...trial.verdict.evidence_ids,state.result.evidence_id]},[...trial.evidence,state]).status,'fallback');
  const auth:Evidence={tool:'read_work_state',result:{status:'error',evidence_id:ids.other,observed_at:new Date().toISOString(),error:'authentication_required',guidance:'need login'}};
  const result=deliver(context,trial.verdict,[...trial.evidence,auth]);
  assert.equal(result.status,'fallback');assert.equal(result.next_step?.kind,'reauthenticate');assert.equal(result.verdict.publication,'unknown');
  const denied:Evidence={tool:'read_work_state',result:{status:'error',evidence_id:ids.other,observed_at:new Date().toISOString(),error:'forbidden',guidance:'no access'}};
  const blocked=deliver(context,trial.verdict,[...trial.evidence,denied]);
  assert.equal(blocked.status,'fallback');assert.equal(blocked.next_step?.kind,'contact_support');assert.equal(blocked.verdict.publication,'unknown');
});
