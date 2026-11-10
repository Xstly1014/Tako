import test from 'node:test';
import assert from 'node:assert/strict';
import {cases,environment,ids} from '../src/cases.ts';
import {developmentScenarios,runScenario} from '../src/comparison.ts';
import {contextFromInput} from '../src/delivery.ts';
import {runFixedFlow} from '../src/fixed-flow.ts';
import {deliver} from '../src/recovery.ts';

test('catalog and timeline agree on display restriction, including a paged display',async()=>{
  for(const id of ['display-limited','display-pagination']){
    const env=environment(cases.find(task=>task.id===id)!);
    const catalog=await env.tools.invoke('find_my_works',{query:'山间来信'});
    const page=await env.tools.invoke('read_work_state',{work_id:ids.work,before_version:id==='display-pagination'?6:0});
    assert.equal(catalog.status,'ok');
    assert.equal(page.status,'ok');
    assert.equal((catalog.data.items as {display_limited:boolean}[])[0].display_limited,true);
    assert.equal(page.data.display_limited,true);
  }
});

test('fixed workflow runs the same development cases and both clarification paths',async()=>{
  for(const scenario of developmentScenarios){
    const result=await runScenario(scenario,runFixedFlow);
    assert.equal(result.automatic_passed,true,scenario.id+':'+JSON.stringify(result.turns.map(x=>x.delivered.failures)));
    assert.equal(result.human_review,'pending');
    if(scenario.reply){
      assert.equal(result.turns[0].delivery.next_step?.kind,'provide_identifiers');
      assert.deepEqual(result.turns[0].evidence.map(x=>x.tool),['find_my_works']);
      assert.equal(result.turns[1].delivery.next_step?.kind,scenario.afterReply?'read_work_state':'provide_identifiers');
      assert.ok(result.turns[1].evidence.every(x=>x.tool!=='read_publication_result'));
    }
  }
});

test('fixed workflow only checks the original receipt when requested',async()=>{
  const task=cases.find(task=>task.id==='unconfirmed')!;
  const result=await runFixedFlow(task.prompt+` 作品ID ${ids.work}。`,environment(task).tools);
  assert.deepEqual(result.evidence.map(x=>x.tool),['read_publication_result']);
  assert.equal(result.delivery.next_step?.kind,'read_original_result');
});

test('delivery does not describe a selected work as ambiguous when the proposal also cites catalog results',async()=>{
  const task=cases.find(task=>task.id==='ambiguous')!;
  const env=environment(task);
  const input=task.prompt+` 我选择作品ID ${ids.work}。`;
  const fixed=await runFixedFlow(input,env.tools);
  const catalog=await env.tools.invoke('find_my_works',{query:'山间来信'});
  const result=deliver(contextFromInput(input),{
    ...fixed.verdict,next_action:'check_original_result',
    evidence_ids:[...fixed.verdict.evidence_ids,catalog.evidence_id],
  },[...fixed.evidence,{tool:'find_my_works',result:catalog}]);
  assert.equal(result.status,'recovered');
  assert.deepEqual(result.next_step,{kind:'read_work_state',work_id:ids.work});
  assert.match(result.verdict.explanation,/当前展示版本1/);
  assert.doesNotMatch(result.verdict.explanation,/尚未明确具体作品/);
});
