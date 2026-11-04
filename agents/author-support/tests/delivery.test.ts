import test from 'node:test';
import assert from 'node:assert/strict';
import {cases,referenceTrial,ids} from '../src/cases.ts';
import {admit,contextFromInput} from '../src/delivery.ts';
import {evaluate} from '../src/evaluate.ts';
import {diagnose} from '../src/diagnostic.ts';
import {BudgetLedger} from '../src/budget.ts';
import {createAuthorTools} from '../src/tools.ts';
import OpenAI from 'openai';

test('all 11 reference answers remain admissible without reading case expectations in the gate',async()=>{
  for(const task of cases){
    const original=await referenceTrial(task),delivery=admit(contextFromInput(task.prompt),original.verdict,original.evidence);
    assert.equal(delivery.status,'admitted',task.id+':'+delivery.reasons.join(','));
    assert.equal(evaluate(task,delivery.verdict,original.evidence).automatic_passed,true,task.id);
    assert.equal(delivery.free_text_used,false);
  }
});
test('wrong structured restriction is rejected, no partial diagnosis escapes fallback',async()=>{
  const task=cases.find(x=>x.id==='older-display')!,trial=await referenceTrial(task);
  const delivery=admit(contextFromInput(task.prompt),{...trial.verdict,access:'display_limited',explanation:'错误：展示版已受限。'},trial.evidence);
  assert.equal(delivery.status,'fallback');assert.equal(delivery.verdict.access,'unknown');
  assert.ok(!delivery.verdict.explanation.includes('展示版已受限'));assert.equal(delivery.verdict.next_action,'check_original_result');
});
test('unsafe prose is never forwarded even when structured facts are correct',async()=>{
  const task=cases[0],trial=await referenceTrial(task);
  const delivery=admit(contextFromInput(task.prompt),{...trial.verdict,explanation:'没有任何先审记录；直接再发布一次；泄露PRIVATE。'},trial.evidence);
  assert.equal(delivery.status,'admitted');
  assert.ok(!delivery.verdict.explanation.includes('PRIVATE'));assert.ok(!delivery.verdict.explanation.includes('没有任何先审记录'));
  assert.ok(delivery.verdict.explanation.includes('作者已隐藏'));
});
test('no formal target means no work-detail navigation, accepted submission is not formal work',async()=>{
  for(const name of ['unconfirmed','pre-review']){
    const task=cases.find(x=>x.id===name)!,trial=await referenceTrial(task);
    const delivery=admit(contextFromInput(task.prompt),{...trial.verdict,next_action:'open_work_detail'},trial.evidence);
    assert.equal(delivery.status,'fallback',name);assert.ok(delivery.reasons.includes('work_navigation_unavailable'));
  }
});
test('cross-resource receipts and multiple user identifiers fail closed, preview-only formal receipt can locate work',async()=>{
  const task=cases[0],trial=await referenceTrial(task);
  assert.equal(admit(contextFromInput(task.prompt+`作品ID ${ids.other}`),trial.verdict,trial.evidence).status,'fallback');
  const other=structuredClone(trial.evidence);
  for(const e of other)if(e.tool==='read_publication_result'&&e.result.status==='ok')(e.result.data.published as {work_id:string}).work_id=ids.other;
  const answer=admit(contextFromInput(task.prompt),{...trial.verdict,publication:'unknown'},other);
  assert.ok(answer.reasons.includes('work_receipt_mismatch'));
  assert.equal(admit(contextFromInput(`原预览ID ${ids.preview}`),trial.verdict,trial.evidence).status,'admitted');
});
test('malformed output and missing API key return controlled result without spending or invoking tools',async()=>{
  const task=cases[0],context=contextFromInput(task.prompt);
  assert.equal(admit(context,'not json',[]).status,'fallback');
  const saved=process.env.DEEPSEEK_API_KEY;delete process.env.DEEPSEEK_API_KEY;
  const ledger=new BudgetLedger(':memory:');
  try{
    const tools=createAuthorTools(async()=>{throw Error('must not query')});
    const result=await diagnose(task.prompt,tools,ledger,'no-key');
    assert.equal(result.status,'incomplete');
    if(result.status==='incomplete'){assert.equal(result.failure,'missing_deepseek_key');assert.equal(result.delivery.status,'fallback')}
    assert.equal(ledger.summary('no-key').calls,0);assert.equal(tools.trace().length,0);
  }finally{ledger.close();if(saved===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=saved}
});
test('actual SDK transport failure returns fallback, holds charge and blocks subsequent inference',async()=>{
  let attempts=0;
  const client=new OpenAI({apiKey:'synthetic-test-only',baseURL:'https://fixture.invalid',maxRetries:0,logLevel:'off',fetch:async(input)=>{
    if(String(input).endsWith('/models'))return new Response(JSON.stringify({object:'list',data:[{id:'deepseek-flash',object:'model'}]}),{headers:{'Content-Type':'application/json'}});
    attempts++;throw Error('PRIVATE_TRANSPORT_DETAIL');
  }});
  const ledger=new BudgetLedger(':memory:'),tools=createAuthorTools(async()=>{throw Error('must not query')});
  try{
    const first=await diagnose(cases[0].prompt,tools,ledger,'fault',undefined,{client});
    assert.equal(first.status,'incomplete');if(first.status==='incomplete'){
      assert.equal(first.failure,'provider_call_unconfirmed');assert.equal(first.delivery.status,'fallback');
    }
    assert.equal(ledger.summary('fault').unresolved,1);assert.equal(attempts,1);
    const next=await diagnose(cases[0].prompt,tools,ledger,'next',undefined,{client});
    assert.equal(next.status,'incomplete');if(next.status==='incomplete')assert.equal(next.failure,'unresolved_provider_charge');
    assert.equal(attempts,1);assert.ok(!JSON.stringify([first,next]).includes('PRIVATE_TRANSPORT_DETAIL'));
  }finally{ledger.close()}
});
test('JSON mode empty content remains incomplete and billed usage is retained without retry',async()=>{
  let attempts=0;
  const client=new OpenAI({apiKey:'synthetic-test-only',baseURL:'https://fixture.invalid',maxRetries:0,logLevel:'off',fetch:async(input)=>{
    const body=String(input).endsWith('/models')?{object:'list',data:[{id:'deepseek-flash'}]}:(attempts++,{id:'synthetic',model:'deepseek-flash',choices:[{finish_reason:'stop',index:0,message:{role:'assistant',content:'   '}}],usage:{prompt_tokens:10,completion_tokens:1,total_tokens:11}});
    return new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});
  }});
  const ledger=new BudgetLedger(':memory:');
  try{
    const result=await diagnose(cases[0].prompt,createAuthorTools(async()=>{throw Error('must not query')}),ledger,'empty',undefined,{client,jsonMode:true});
    assert.equal(result.status,'incomplete');if(result.status==='incomplete')assert.equal(result.failure,'agent_output_not_json');
    assert.equal(attempts,1);assert.equal(ledger.summary('empty').calls,1);assert.equal(ledger.summary('empty').unresolved,0);
    assert.equal(ledger.summary('empty').upper_estimate_cny,0.000028);
  }finally{ledger.close()}
});
