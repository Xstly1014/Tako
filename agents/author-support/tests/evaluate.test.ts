import test from 'node:test';
import assert from 'node:assert/strict';
import {cases,referenceTrial,environment} from '../src/cases.ts';
import {evaluate} from '../src/evaluate.ts';

test('all policy-derived reference solutions validate adapter fixtures and task goals',async()=>{
  assert.equal(cases.length,11);assert.equal(new Set(cases.map(x=>x.id)).size,11);
  for(const task of cases){
    const trial=await referenceTrial(task),result=evaluate(task,trial.verdict,trial.evidence);
    assert.equal(result.automatic_passed,true,task.id+':'+result.failures.join(','));
    assert.ok(!JSON.stringify(trial).includes('FIXTURE_PRIVATE'));
  }
});
test('honest but unhelpful unknown is distinct from satisfying a diagnosable task',async()=>{
  const task=cases[0],trial=await referenceTrial(task);
  const result=evaluate(task,{...trial.verdict,publication:'unknown',access:'unknown'},trial.evidence);
  assert.equal(result.evidence_supported,true);assert.equal(result.automatic_passed,false);
});
test('optional access diagnosis may be supplied if grounded; hallucinated extras still fail',async()=>{
  const task=cases.find(x=>x.id==='draft-ahead')!,trial=await referenceTrial(task),env=environment(task);
  const state=await env.tools.invoke('read_work_state',{work_id:'11111111-1111-4111-8111-111111111111'});
  const verdict={...trial.verdict,access:'no_recorded_block' as const,evidence_ids:[...trial.verdict.evidence_ids,state.evidence_id]};
  assert.equal(evaluate(task,verdict,[...trial.evidence,{tool:'read_work_state',result:state}]).automatic_passed,true);
  assert.equal(evaluate(task,{...trial.verdict,access:'no_recorded_block'},trial.evidence).automatic_passed,false);
});
test('supported structured facts do not certify contradictory prose',async()=>{
  const task=cases[0],trial=await referenceTrial(task);
  const result=evaluate(task,{...trial.verdict,explanation:'请直接再发布一次。'},trial.evidence);
  // Intentionally documents this code grader's boundary, not a safe answer.
  assert.equal(result.automatic_passed,true);assert.equal(result.human_review_required,true);
});
test('first page does not settle display limitation; failing tools are exercised',async()=>{
  const env=environment(cases.find(x=>x.id==='display-pagination')!);
  const result=await env.tools.invoke('read_work_state',{work_id:'11111111-1111-4111-8111-111111111111'});
  assert.equal(result.status,'ok');if(result.status==='ok')assert.equal(result.data.display_limited,null);
  const failure=await referenceTrial(cases.find(x=>x.id==='tool-failure')!);
  assert.equal(failure.evidence[0].result.status,'error');
});
