import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import {mkdirSync,writeFileSync,readFileSync} from "node:fs";
import path from "node:path";

// Only this setup/cleanup script writes. The agent receives read-only transports.
async function main(){
  const base='http://127.0.0.1:3300/api';
  if(process.env.EXPO_PUBLIC_API_URL&&process.env.EXPO_PUBLIC_API_URL!==base)throw Error('local_api_required');
  process.env.EXPO_PUBLIC_API_URL=base;
  const preflight=await fetch(base+'/community',{signal:AbortSignal.timeout(10000)});
  if(!preflight.ok||preflight.headers.get('X-Tako-Environment')!=='test')throw Error('local_test_environment_required');
  const {Session}=await import('../../../mobile/src/auth/session.ts');
  const {request}=await import('../../../mobile/src/api/client.ts');
  const {AuthorWorksApi}=await import('../../../mobile/src/api/author-works.ts');
  const {PublicationsApi}=await import('../../../mobile/src/api/publications.ts');
  const {createAuthorTools}=await import('../src/tools.ts');
  const {grade}=await import('../src/grade.ts');
  const {BudgetLedger}=await import('../src/budget.ts');
  type Result=import('../src/tools.ts').ToolResult;
  const runId=randomUUID(),prefix='agent-probe-'+runId.slice(0,12),works:string[]=[],checks:string[]=[];
  const directory=path.resolve('.runtime/author-agent/runs',runId);mkdirSync(directory,{recursive:true});
  const session=()=>{let token:string|null=null;return new Session({get:async()=>token,set:async(v:string)=>{token=v},remove:async()=>{token=null}},request)};
  const author=session(),other=session(),operator=session();
  const pendingSubmissions:string[]=[];
  let policyStarted=false,policyContext='';
  const transport:import('../../../mobile/src/auth/session.ts').Transport=(p,o)=>author.authorized(p,o);
  const api=new AuthorWorksApi(transport),publisher=new PublicationsApi(transport);
  const tools=createAuthorTools(transport),foreign=createAuthorTools((p,o)=>other.authorized(p,o));
  const ok=(r:Result)=>{assert.equal(r.status,'ok');if(r.status!=='ok')throw Error('expected_tool_result');return r.data};
  let report:Record<string,unknown>={run_id:runId,kind:'live_tool_probe',source:'real_local_test_http_mysql',model_called:false};
  let setupComplete=false;
  let phase='core_fixture';
  try{
    await author.restore();await other.restore();
    await author.signIn('register',prefix+'@example.test',randomUUID());await author.setNickname('Agent合成作者');
    await other.signIn('register',prefix+'-other@example.test',randomUUID());await other.setNickname('Agent隔离合成账号');
    assert.deepEqual(ok(await tools.invoke('find_my_works',{query:prefix})).items,[]);checks.push('no_formal_work');
    const body1='PRIVATE_PROBE_BODY_'+randomUUID(),body2='PRIVATE_PROBE_REVISION_'+randomUUID();
    const draft=await author.authorized<{draft_id:string;revision:number}>('/drafts/create',{method:'POST',body:{mutation_id:randomUUID(),title:prefix+'作品',content:body1}});
    assert.equal(ok(await tools.invoke('read_draft_metadata',{draft_id:draft.draft_id})).revision,1);checks.push('server_draft_metadata');
    const p1=await publisher.prepare({mutation_id:randomUUID(),draft_id:draft.draft_id,source_revision:1,introduction:'',tags:['日常'],rights_confirmed:true});
    assert.equal(ok(await tools.invoke('read_publication_result',{preview_id:p1.id})).published,null);checks.push('preview_not_yet_confirmed');
    const r1=await publisher.publish({mutation_id:randomUUID(),preview_id:p1.id,expected_version:0});works.push(r1.work_id);
    assert.equal((ok(await tools.invoke('read_publication_result',{preview_id:p1.id})).published as Record<string,unknown>).version,1);checks.push('confirmed_original_receipt');
    await author.authorized('/drafts/save',{method:'POST',body:{mutation_id:randomUUID(),draft_id:draft.draft_id,base_revision:1,title:prefix+'修订作品',content:body2}});
    assert.equal(ok(await tools.invoke('read_draft_metadata',{draft_id:draft.draft_id})).revision,2);
    assert.equal(ok(await tools.invoke('read_publication_result',{preview_id:p1.id})).source_revision,1);checks.push('draft_ahead_of_published_snapshot');
    const p2=await publisher.prepare({mutation_id:randomUUID(),draft_id:draft.draft_id,source_revision:2,introduction:'',tags:['日常'],rights_confirmed:true});
    await publisher.publish({mutation_id:randomUUID(),preview_id:p2.id,expected_version:1});
    let state=await author.authorized<import('../../../mobile/src/api/author-works.ts').WorkState>('/my/works/'+r1.work_id);
    await api.change(r1.work_id,{mutation_id:randomUUID(),expected_state_revision:state.state_revision,action:'switch_display',version:1});
    const older=ok(await tools.invoke('read_work_state',{work_id:r1.work_id}));assert.equal(older.display_version,1);assert.equal(older.last_version,2);checks.push('older_display_is_not_failed_publication');
    state=await author.authorized('/my/works/'+r1.work_id);
    await api.change(r1.work_id,{mutation_id:randomUUID(),expected_state_revision:state.state_revision,action:'hide'});
    assert.equal(ok(await tools.invoke('read_work_state',{work_id:r1.work_id})).author_hidden,true);checks.push('hidden_work_with_confirmed_release');
    for(const [name,key,value] of [['read_work_state','work_id',r1.work_id],['read_draft_metadata','draft_id',draft.draft_id],['read_publication_result','preview_id',p2.id]]){
      const denied=await foreign.invoke(name,{[key]:value});assert.equal(denied.status,'error');if(denied.status==='error')assert.equal(denied.error,'resource_unavailable');checks.push('foreign_'+key+'_denied');
    }
    const second=await author.authorized<{draft_id:string}>('/drafts/create',{method:'POST',body:{mutation_id:randomUUID(),title:prefix+'作品',content:body1}});
    const sp=await publisher.prepare({mutation_id:randomUUID(),draft_id:second.draft_id,source_revision:1,introduction:'',tags:['日常'],rights_confirmed:true});
    const sr=await publisher.publish({mutation_id:randomUUID(),preview_id:sp.id,expected_version:0});works.push(sr.work_id);
    assert.equal((ok(await tools.invoke('find_my_works',{query:prefix})).items as unknown[]).length,2);checks.push('multiple_candidates_not_auto_selected');
    const raw=await author.authorized<{content:string;revision:number}>('/drafts/'+draft.draft_id);assert.equal(raw.content,body2);assert.equal(raw.revision,2);
    assert.ok(!JSON.stringify([tools.trace(),foreign.trace()]).includes('PRIVATE_PROBE'));checks.push('read_only_and_sanitized_trace');
    if(process.argv.includes('--pre-review')){
      phase='pre_review_operator_login';
      // Existing test operator only, scoped to this run's new synthetic author.
      // Do not print the file, password, token, or change shared policy defaults.
      const local=readFileSync(path.resolve('.runtime/local-test/.env'),'utf8');
      const line=local.split(/\r?\n/).find(x=>x.startsWith('TEST_OPERATOR_PASSWORD='));
      const password=process.env.TEST_OPERATOR_PASSWORD??line?.slice('TEST_OPERATOR_PASSWORD='.length);
      if(!password)throw Error('test_operator_required');
      await operator.restore();await operator.signIn('login','operator@tako-test.invalid',password);
      policyContext='/ops/works/'+r1.work_id+'/author-policy';
      phase='pre_review_policy_read';
      const policy=await operator.authorized<{policy:{revision:number}}>(policyContext);
      // Set cleanup obligation before POST, including unknown-response outcomes.
      policyStarted=true;
      phase='pre_review_policy_start';
      await operator.authorized(policyContext,{method:'POST',body:{mutation_id:randomUUID(),expected_revision:policy.policy.revision,action:'start',reason:'Agent评测合成账号先审验收'}});
      const third=await author.authorized<{draft_id:string}>('/drafts/create',{method:'POST',body:{mutation_id:randomUUID(),title:prefix+'先审',content:body1}});
      phase='pre_review_prepare';
      const pending=await publisher.prepare({mutation_id:randomUUID(),draft_id:third.draft_id,source_revision:1,introduction:'',tags:['日常'],rights_confirmed:true});
      phase='pre_review_submit';
      const accepted=await publisher.publish({mutation_id:randomUUID(),preview_id:pending.id,expected_version:0});
      assert.equal(accepted.review_status,'pre_review');assert.equal(accepted.version,0);
      assert.ok(accepted.submission_id);pendingSubmissions.push(accepted.submission_id);
      phase='pre_review_projection';
      const observed=await tools.invoke('read_publication_result',{preview_id:pending.id}),projection=ok(observed);
      assert.equal(projection.published,null);assert.equal((projection.submission as Record<string,unknown>).submission_id,accepted.submission_id);
      report.pre_review_evidence=observed;checks.push('real_pre_review_is_acceptance_not_formal_publication');
    }
    setupComplete=true;report.checks=checks;report.tool_trace=tools.trace();report.foreign_trace=foreign.trace();
    console.log(`PASS real author tool probe: ${checks.length} checks; no model score or external model call implied`);
    if(process.argv.includes('--model')){
      const {diagnose}=await import('../src/diagnostic.ts');
      const ledger=new BudgetLedger(path.resolve('.runtime/author-agent/budget.sqlite'));
      try{
        const live=createAuthorTools(transport);
        const prompt=`请确认这份原发布是否完成，并查明朋友为何打不开作品。作品ID：${r1.work_id}，原预览ID：${p2.id}。我当时没看到结果，现在不想重复发布，也不要替我修改内容。`;
        const outcome=await diagnose(prompt,live,ledger,runId,undefined,{jsonMode:true});
        if(outcome.status==='incomplete'){report.delivery=outcome.delivery;throw Error(outcome.failure)}
        const model=outcome.trial;
        const supported=grade(model.verdict,model.evidence,r1.work_id,p2.id);
        const coverage={publication_confirmed:model.verdict.publication==='confirmed',hidden_identified:model.verdict.access==='author_hidden'};
        const automaticPassed=supported.supported&&Object.values(coverage).every(Boolean);
        const deliverySupported=grade(model.delivery.verdict,model.evidence,r1.work_id,p2.id);
        const deliveryPassed=model.delivery.status==='admitted'&&deliverySupported.supported&&model.delivery.verdict.publication==='confirmed'&&model.delivery.verdict.access==='author_hidden';
        report={...report,model_called:true,kind:'single_agent_development_trial',provider:model.provider,usage:model.usage,budget:ledger.summary(runId),grade:{...supported,coverage,automatic_passed:automaticPassed},delivery:model.delivery,delivery_goal_passed:deliveryPassed,agent_trace:live.trace(),explanation_sha256:createHash('sha256').update(model.verdict.explanation).digest('hex')};
        // Human review artifact contains only this new synthetic user's question
        // and model explanation, never raw HTTP bodies, key, token or reasoning.
        writeFileSync(path.join(directory,'review.json'),JSON.stringify({synthetic_only:true,prompt,verdict:model.verdict,delivery:model.delivery,human_review_required:true},null,2),{mode:0o600});
        console.log(`MODEL trial: raw_checks=${automaticPassed?'passed':'failed'} delivery=${model.delivery.status} delivery_goal=${deliveryPassed} human_review=pending upper_estimate_cny=${ledger.summary(runId).upper_estimate_cny}`);
        if(!automaticPassed||!deliveryPassed)process.exitCode=1;
      }catch(e){report={...report,model_called:true,model_status:'incomplete',budget:ledger.summary(runId)};throw e;}
      finally{ledger.close();}
    }
  }catch(error){
    const {ApiError}=await import('../../../mobile/src/api/client.ts');
    report.failure={phase,http_status:error instanceof ApiError?error.status:null};
    throw error;
  }finally{
    let cleanup=true;
    for(const submission of pendingSubmissions)try{
      const result=await author.authorized<{state:string}>('/my/work-submissions/'+submission+'/withdraw',{method:'POST',body:{mutation_id:randomUUID()}});
      assert.equal(result.state,'withdrawn');
    }catch{cleanup=false}
    if(policyStarted)try{
      const policy=await operator.authorized<{policy:{revision:number}}>(policyContext);
      await operator.authorized(policyContext,{method:'POST',body:{mutation_id:randomUUID(),expected_revision:policy.policy.revision,action:'revoke',reason:'Agent评测合成账号验收结束'}});
    }catch{cleanup=false}
    for(const id of works){try{const state=await author.authorized<import('../../../mobile/src/api/author-works.ts').WorkState>('/my/works/'+id);if(!state.author_hidden)await api.change(id,{mutation_id:randomUUID(),expected_state_revision:state.state_revision,action:'hide'});}catch{cleanup=false}}
    for(const s of [author,other,operator])if(s.snapshot().phase==='ready')try{await s.logout()}catch{cleanup=false}
    report={...report,setup_complete:setupComplete,checks,cleanup:cleanup?'owned_works_hidden_sessions_revoked':'needs_review'};
    writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2),{mode:0o600});
    if(!cleanup)throw Error('fixture_cleanup_incomplete');
  }
}
main().catch(e=>{
  const known=['local_api_required','local_test_environment_required','missing_deepseek_key','provider_call_unconfirmed','requested_model_unavailable','request_size_budget','budget_exceeded','unresolved_provider_charge','agent_output_not_json','agent_output_schema','agent_output_incomplete','tool_call_budget','model_turn_budget','fixture_cleanup_incomplete'];
  const code=e instanceof Error&&known.includes(e.message)?e.message:'probe_failed';
  console.error('FAIL author agent probe: '+code);process.exitCode=1;
});
