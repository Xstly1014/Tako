import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {mkdirSync,writeFileSync,readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

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
  const {deliver}=await import('../src/recovery.ts');
  const {contextFromInput}=await import('../src/delivery.ts');
  const {followUp}=await import('../src/follow-up.ts');
  const {runFixedFlow}=await import('../src/fixed-flow.ts');
  const {checkModerationVisibility,checkPublication}=await import('../src/session-diagnostic.ts');
  const {submissionAnswer}=await import('../src/submission-answer.ts');
  type Result=import('../src/tools.ts').ToolResult;
  const runId=randomUUID(),prefix='agent-probe-'+runId.slice(0,12),works:string[]=[],checks:string[]=[];
  const authorEmail=prefix+'@example.test',authorPassword=randomUUID();
  const directory=path.resolve('.runtime/author-agent/runs',runId);mkdirSync(directory,{recursive:true});
  const session=()=>{let token:string|null=null;return new Session({get:async()=>token,set:async(v:string)=>{token=v},remove:async()=>{token=null}},request)};
  const author=session(),other=session(),operator=session();
  const pendingSubmissions:string[]=[];
  let policyStarted=false,policyContext='';
  const transport:import('../../../mobile/src/auth/session.ts').Transport=(p,o)=>author.authorized(p,o);
  const api=new AuthorWorksApi(transport),publisher=new PublicationsApi(transport);
  const tools=createAuthorTools(transport),foreign=createAuthorTools((p,o)=>other.authorized(p,o));
  const ok=(r:Result)=>{assert.equal(r.status,'ok');if(r.status!=='ok')throw Error('expected_tool_result');return r.data};
  const recoverNavigation=(preview:string,result:Result)=>deliver(contextFromInput('原预览ID '+preview),{publication:'unconfirmed',access:'unknown',next_action:'open_work_detail',evidence_ids:[result.evidence_id],explanation:'受控复现上一批错误的正式作品导航建议。'},[{tool:'read_publication_result',result}]);
  let report:Record<string,unknown>={run_id:runId,kind:'live_tool_probe',source:'real_local_test_http_mysql',model_called:false};
  let setupComplete=false;
  let phase='core_fixture';
  try{
    await author.restore();await other.restore();
    await author.signIn('register',authorEmail,authorPassword);await author.setNickname('Agent合成作者');
    await other.signIn('register',prefix+'-other@example.test',randomUUID());await other.setNickname('Agent隔离合成账号');
    assert.deepEqual(ok(await tools.invoke('find_my_works',{query:prefix})).items,[]);checks.push('no_formal_work');
    const body1='PRIVATE_PROBE_BODY_'+randomUUID(),body2='PRIVATE_PROBE_REVISION_'+randomUUID();
    const draft=await author.authorized<{draft_id:string;revision:number}>('/drafts/create',{method:'POST',body:{mutation_id:randomUUID(),title:prefix+'作品',content:body1}});
    assert.equal(ok(await tools.invoke('read_draft_metadata',{draft_id:draft.draft_id})).revision,1);checks.push('server_draft_metadata');
    const p1=await publisher.prepare({mutation_id:randomUUID(),draft_id:draft.draft_id,source_revision:1,introduction:'',tags:['日常'],rights_confirmed:true});
    const original=await tools.invoke('read_publication_result',{preview_id:p1.id});
    assert.equal(ok(original).published,null);checks.push('preview_not_yet_confirmed');
    const originalDelivery=recoverNavigation(p1.id,original);
    assert.equal(originalDelivery.status,'recovered');assert.equal(originalDelivery.next_step?.kind,'read_original_result');
    assert.equal(ok(await followUp(originalDelivery.next_step!,transport)).published,null);checks.push('offered_original_step_reads_actual_original');
    const r1=await publisher.publish({mutation_id:randomUUID(),preview_id:p1.id,expected_version:0});works.push(r1.work_id);
    assert.equal((ok(await tools.invoke('read_publication_result',{preview_id:p1.id})).published as Record<string,unknown>).version,1);checks.push('confirmed_original_receipt');
    assert.equal((ok(await followUp(originalDelivery.next_step!,transport)).published as Record<string,unknown>).version,1);checks.push('same_step_reads_later_original_confirmation');
    await author.authorized('/drafts/save',{method:'POST',body:{mutation_id:randomUUID(),draft_id:draft.draft_id,base_revision:1,title:prefix+'修订作品',content:body2}});
    assert.equal(ok(await tools.invoke('read_draft_metadata',{draft_id:draft.draft_id})).revision,2);
    assert.equal(ok(await tools.invoke('read_publication_result',{preview_id:p1.id})).source_revision,1);checks.push('draft_ahead_of_published_snapshot');
    const p2=await publisher.prepare({mutation_id:randomUUID(),draft_id:draft.draft_id,source_revision:2,introduction:'',tags:['日常'],rights_confirmed:true});
    await publisher.publish({mutation_id:randomUUID(),preview_id:p2.id,expected_version:1});
    let state=await author.authorized<import('../../../mobile/src/api/author-works.ts').WorkState>('/my/works/'+r1.work_id);
    await api.change(r1.work_id,{mutation_id:randomUUID(),expected_state_revision:state.state_revision,action:'switch_display',version:1});
    const older=ok(await tools.invoke('read_work_state',{work_id:r1.work_id}));assert.equal(older.display_version,1);assert.equal(older.last_version,2);checks.push('older_display_is_not_failed_publication');
    const readerView=await checkPublication(author,{workId:r1.work_id,previewId:p2.id});
    assert.ok(readerView);
    assert.deepEqual(await readerView.checkReaderVisibility(),{status:'visible',displayedVersion:1,releasedVersion:2});
    checks.push('anonymous_reader_sees_selected_older_version');
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
    phase='identifier_conflict';
    const pair=(work:string,preview:string)=>`作品ID ${work}，原预览ID ${preview}。请核对是否属于同一件作品。`;
    const conflict=await runFixedFlow(pair(sr.work_id,p2.id),tools);
    assert.equal(conflict.delivery.verdict.publication,'unknown');assert.equal(conflict.delivery.verdict.access,'unknown');
    assert.match(conflict.delivery.verdict.explanation,/对应不同作品/);
    assert.deepEqual(conflict.delivery.next_step,{kind:'provide_identifiers'});
    assert.equal(ok(await followUp(conflict.delivery.next_step!,transport)).no_request_sent,true);
    checks.push('owned_mismatch_requests_correction_without_read_or_write');
    for(const input of [pair(randomUUID(),p2.id),pair(sr.work_id,randomUUID())]){
      const result=await runFixedFlow(input,tools);
      assert.ok(result.evidence.some(x=>x.result.status==='ok'));
      assert.ok(result.evidence.some(x=>x.result.status==='error'&&x.result.error==='resource_unavailable'));
      assert.equal(result.delivery.verdict.publication,'unknown');assert.equal(result.delivery.verdict.access,'unknown');
      assert.match(result.delivery.verdict.explanation,/无法读取/);
      assert.doesNotMatch(result.delivery.verdict.explanation,/对应不同作品/);
      assert.deepEqual(result.delivery.next_step,{kind:'provide_identifiers'});
    }
    checks.push('one_unreadable_identifier_remains_indeterminate');
    const deniedPair=await runFixedFlow(pair(sr.work_id,p2.id),foreign);
    assert.equal(deniedPair.evidence.length,2);
    assert.ok(deniedPair.evidence.every(x=>x.result.status==='error'&&x.result.error==='resource_unavailable'));
    assert.match(deniedPair.delivery.verdict.explanation,/无法读取/);
    assert.doesNotMatch(deniedPair.delivery.verdict.explanation,/对应不同作品/);
    checks.push('another_account_cannot_infer_pair_relationship');
    const corrected=await runFixedFlow(pair(r1.work_id,p2.id),tools);
    assert.equal(corrected.delivery.verdict.publication,'confirmed');
    assert.equal(corrected.delivery.verdict.access,'author_hidden');
    assert.deepEqual(corrected.delivery.next_step,{kind:'read_work_state',work_id:r1.work_id});
    assert.equal(ok(await followUp(corrected.delivery.next_step!,transport)).work_id,r1.work_id);
    checks.push('corrected_pair_confirms_and_navigates_to_bound_work');
    phase='core_fixture';
    const raw=await author.authorized<{content:string;revision:number}>('/drafts/'+draft.draft_id);assert.equal(raw.content,body2);assert.equal(raw.revision,2);
    assert.ok(!JSON.stringify([tools.trace(),foreign.trace()]).includes('PRIVATE_PROBE'));checks.push('read_only_and_sanitized_trace');
    if(process.argv.includes('--pre-review')||process.argv.includes('--moderation-visibility')){
      phase='operator_login';
      // Existing test operator only, scoped to this run's new synthetic author.
      // Do not print the file, password, token, or change shared policy defaults.
      const local=readFileSync(path.resolve('.runtime/local-test/.env'),'utf8');
      const line=local.split(/\r?\n/).find(x=>x.startsWith('TEST_OPERATOR_PASSWORD='));
      const password=process.env.TEST_OPERATOR_PASSWORD??line?.slice('TEST_OPERATOR_PASSWORD='.length);
      if(!password)throw Error('test_operator_required');
      await operator.restore();await operator.signIn('login','operator@tako-test.invalid',password);
    }
    if(process.argv.includes('--moderation-visibility')){
      phase='moderation_visibility';
      const {AuthorAppealsApi}=await import('../../../mobile/src/api/author-appeals.ts');
      const reviewPath='/ops/reviews/'+sr.work_id+'/versions/1';
      const {task}=await operator.authorized<{task:{revision:number}}>(reviewPath);
      await operator.authorized(reviewPath,{method:'POST',body:{
        mutation_id:randomUUID(),expected_revision:task.revision,decision:'restrict_version',reason:'合成作品展示限制验收',
      }});
      const appeals=new AuthorAppealsApi(transport);
      const target=(await appeals.list()).items.find(item=>item.work_id===sr.work_id);
      assert.ok(target);
      const casePath='/my/moderation/'+target.id;
      await author.authorized(casePath,{method:'POST',body:{
        mutation_id:randomUUID(),expected_revision:target.revision,decision:'appeal',reason:'合成作品复核验收',
      }});
      const pending=await checkModerationVisibility(author,target.id);
      assert.deepEqual(pending,{
        status:'checked',moderation:{state:'active',scope:'version',version:1,latestAppeal:'pending'},
        visibility:{status:'not_visible',blocker:'display_limited'},
      });
      assert.deepEqual(await checkModerationVisibility(other,target.id),{status:'case_unavailable'});
      checks.push('moderation_pending_and_foreign_case_denied');
      const visibleState=await author.authorized<import('../../../mobile/src/api/author-works.ts').WorkState>('/my/works/'+sr.work_id);
      await api.change(sr.work_id,{mutation_id:randomUUID(),expected_state_revision:visibleState.state_revision,action:'hide'});
      const current=await appeals.detail(target.id);
      await operator.authorized('/ops/moderation/'+target.id,{method:'POST',body:{
        mutation_id:randomUUID(),expected_revision:current.case.revision,decision:'revoke',reason:'撤销合成作品的展示限制',
      }});
      assert.deepEqual(await checkModerationVisibility(author,target.id),{
        status:'checked',moderation:{state:'revoked',scope:'version',version:1,latestAppeal:'revoked'},
        visibility:{status:'not_visible',blocker:'author_hidden'},
      });
      checks.push('revoked_moderation_does_not_restore_author_hidden_work');
      const hiddenState=await author.authorized<import('../../../mobile/src/api/author-works.ts').WorkState>('/my/works/'+sr.work_id);
      await api.change(sr.work_id,{mutation_id:randomUUID(),expected_state_revision:hiddenState.state_revision,action:'restore',version:1});
      const restored=await checkModerationVisibility(author,target.id);
      assert.equal(restored?.status,'checked');
      if(restored?.status==='checked')assert.deepEqual(restored.visibility,{status:'visible',displayedVersion:1});
      checks.push('explicit_author_restore_confirms_reader_visibility');
    }
    if(process.argv.includes('--pre-review')){
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
      const recovered=recoverNavigation(pending.id,observed);
      assert.equal(recovered.status,'recovered');assert.equal(recovered.next_step?.kind,'read_submission_record');
      const current=ok(await followUp(recovered.next_step!,transport));assert.equal(current.state,'pending');
      assert.equal(current.meaning,'current_submission_state_not_public_visibility');
      assert.equal('content' in current,false);assert.equal('reason' in current,false);checks.push('offered_submission_step_reads_current_record_only');
      const checkCommand=(...args:string[])=>{
        const output=execFileSync(process.execPath,[
          '--no-warnings',fileURLToPath(new URL('./check-author.ts',import.meta.url)),...args,
        ],{encoding:'utf8',timeout:30000,env:{...process.env,TEST_AUTHOR_EMAIL:authorEmail,TEST_AUTHOR_PASSWORD:authorPassword}});
        return JSON.parse(output);
      };
      const listed=checkCommand('--submissions');
      assert.equal(listed.status,'listed');
      const original=listed.submissions.find((item:{submissionId:string})=>item.submissionId===accepted.submission_id);
      assert.equal(original?.previewId,pending.id);
      assert.equal(original?.state,'pending');
      const pendingAnswer=checkCommand('--preview',original.previewId,'--follow-up');
      assert.equal(pendingAnswer.publication,'unconfirmed');
      assert.match(pendingAnswer.explanation,/历史先审受理/);
      assert.equal(pendingAnswer.followUp.data.submission_id,accepted.submission_id);
      assert.equal(pendingAnswer.followUp.data.state,'pending');
      assert.match(pendingAnswer.answer,/当前仍在等待审核/);
      const denied=await followUp(recovered.next_step!,(p,o)=>other.authorized(p,o));
      assert.equal(denied.status,'error');if(denied.status==='error')assert.equal(denied.error,'resource_unavailable');checks.push('foreign_submission_step_denied');
      await author.authorized('/drafts/save',{method:'POST',body:{
        mutation_id:randomUUID(),draft_id:third.draft_id,base_revision:1,title:prefix+'先审修订',content:body2,
      }});
      const replacement=await publisher.prepare({mutation_id:randomUUID(),draft_id:third.draft_id,source_revision:2,introduction:'',tags:['日常'],rights_confirmed:true});
      const newer=await publisher.publish({mutation_id:randomUUID(),preview_id:replacement.id,expected_version:0});
      assert.equal(newer.review_status,'pre_review');
      assert.ok(newer.submission_id);
      pendingSubmissions.splice(pendingSubmissions.indexOf(accepted.submission_id),1);
      pendingSubmissions.push(newer.submission_id);
      const superseded=checkCommand('--preview',original.previewId,'--follow-up');
      assert.equal(superseded.explanation,pendingAnswer.explanation);
      assert.equal(superseded.followUp.data.submission_id,accepted.submission_id);
      assert.equal(superseded.followUp.data.state,'superseded');
      assert.match(superseded.answer,/已被替换.*有当前待审记录/);
      assert.equal(superseded.followUp.data.current_pending_for_work.submission_id,newer.submission_id);
      assert.equal(superseded.followUp.data.current_pending_for_work.preview_id,replacement.id);
      const initialSubmission=await author.authorized<{submission:{first_waiting_at:string}}>('/my/work-submissions/'+accepted.submission_id);
      assert.equal(superseded.followUp.data.current_pending_for_work.first_waiting_at,initialSubmission.submission.first_waiting_at);
      checks.push('superseded_receipt_keeps_original_and_identifies_current_pending_work');
      await author.authorized('/my/work-submissions/'+newer.submission_id+'/withdraw',{method:'POST',body:{mutation_id:randomUUID()}});
      pendingSubmissions.splice(pendingSubmissions.indexOf(newer.submission_id),1);
      const oldAfterWithdrawal=ok(await followUp(recovered.next_step!,transport));
      assert.deepEqual(oldAfterWithdrawal.current_pending_for_work,{status:'none_observed'});
      const historical=ok(await tools.invoke('read_publication_result',{preview_id:pending.id}));
      const withdrawnAnswer=checkCommand('--preview',replacement.id,'--follow-up');
      assert.equal(withdrawnAnswer.publication,pendingAnswer.publication);
      assert.equal(withdrawnAnswer.explanation,pendingAnswer.explanation);
      assert.equal(withdrawnAnswer.followUp.data.submission_id,newer.submission_id);
      assert.equal(withdrawnAnswer.followUp.data.state,'withdrawn');
      assert.match(withdrawnAnswer.answer,/已撤回/);
      checks.push('preview_cli_follows_withdrawn_submission_without_rewriting_old_receipt');
      assert.equal(historical.published,null);assert.ok(historical.submission);checks.push('current_withdrawn_does_not_rewrite_original_acceptance');
      phase='pre_review_terminal_decisions';
      async function submitRevision(revision:number){
        await author.authorized('/drafts/save',{method:'POST',body:{
          mutation_id:randomUUID(),draft_id:third.draft_id,base_revision:revision-1,title:prefix+'先审修订'+revision,content:body2,
        }});
        const preview=await publisher.prepare({mutation_id:randomUUID(),draft_id:third.draft_id,source_revision:revision,introduction:'',tags:['日常'],rights_confirmed:true});
        const receipt=await publisher.publish({mutation_id:randomUUID(),preview_id:preview.id,expected_version:0});
        assert.equal(receipt.review_status,'pre_review');
        pendingSubmissions.push(receipt.submission_id);
        return {previewId:preview.id,receipt};
      }
      async function review(submissionId:string,decision:'approve'|'reject'){
        await operator.authorized('/ops/work-submissions/'+submissionId+'/review',{method:'POST',body:{
          mutation_id:randomUUID(),decision,reason:'合成作品终态验收',
        }});
        pendingSubmissions.splice(pendingSubmissions.indexOf(submissionId),1);
      }
      const rejected=await submitRevision(3);
      await review(rejected.receipt.submission_id,'reject');
      const rejectedCheck=await checkPublication(author,{previewId:rejected.previewId});
      assert.ok(rejectedCheck);
      assert.match(rejectedCheck.getDelivery()?.verdict.explanation??'',/历史先审受理/);
      const rejectedResult=await rejectedCheck.followUp();
      assert.ok(rejectedResult);
      const rejectedData=ok(rejectedResult);
      assert.equal(rejectedData.state,'rejected');
      assert.match(submissionAnswer(rejectedCheck.getDelivery()!,rejectedResult),/已驳回/);
      assert.equal('published_version' in rejectedData,false);
      assert.equal('reader_visibility' in rejectedData,false);
      checks.push('rejected_submission_preserves_acceptance_and_does_not_claim_a_release');
      const approved=await submitRevision(4);
      works.push(approved.receipt.work_id);
      await review(approved.receipt.submission_id,'approve');
      const approvedAnswer=checkCommand('--preview',approved.previewId,'--follow-up');
      assert.match(approvedAnswer.explanation,/历史先审受理/);
      assert.equal(approvedAnswer.followUp.data.state,'published');
      assert.equal(approvedAnswer.followUp.data.published_version,1);
      assert.deepEqual(approvedAnswer.followUp.data.reader_visibility,{status:'visible',displayedVersion:1});
      assert.match(approvedAnswer.answer,/已通过并发行 V1.*看到的是 V1/);
      const approvedWork=await author.authorized<import('../../../mobile/src/api/author-works.ts').WorkState>('/my/works/'+approved.receipt.work_id);
      await api.change(approved.receipt.work_id,{mutation_id:randomUUID(),expected_state_revision:approvedWork.state_revision,action:'hide'});
      const approvedCheck=await checkPublication(author,{previewId:approved.previewId});
      assert.ok(approvedCheck);
      const hiddenResult=await approvedCheck.followUp();
      assert.ok(hiddenResult);
      const hiddenData=ok(hiddenResult);
      assert.equal(hiddenData.published_version,1);
      assert.deepEqual(hiddenData.reader_visibility,{status:'not_visible',blocker:'author_hidden'});
      assert.match(submissionAnswer(approvedCheck.getDelivery()!,hiddenResult),/已通过并发行 V1.*作者隐藏仍然生效/);
      checks.push('approved_submission_confirms_version_separately_from_reader_visibility');
      report.follow_up={source:'real_http_with_controlled_candidate_not_new_model_trial',pending_read:true,foreign_denied:true,withdrawn_read:true,original_acceptance_unchanged:true};
    }
    setupComplete=true;report.checks=checks;report.tool_trace=tools.trace();report.foreign_trace=foreign.trace();
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
        const deliveryPassed=model.delivery.status!=='fallback'&&deliverySupported.supported&&model.delivery.verdict.publication==='confirmed'&&model.delivery.verdict.access==='author_hidden';
        report={...report,model_called:true,kind:'single_agent_development_trial',provider:model.provider,usage:model.usage,budget:ledger.summary(runId),grade:{...supported,coverage,automatic_passed:automaticPassed},delivery:model.delivery,delivery_goal_passed:deliveryPassed,agent_trace:live.trace(),explanation_sha256:createHash('sha256').update(model.verdict.explanation).digest('hex')};
        // Human review artifact contains only this new synthetic user's question
        // and model explanation, never raw HTTP bodies, key, token or reasoning.
        writeFileSync(path.join(directory,'review.json'),JSON.stringify({synthetic_only:true,prompt,verdict:model.verdict,delivery:model.delivery,human_review_required:true},null,2),{mode:0o600});
        console.log(`MODEL trial: raw_checks=${automaticPassed?'passed':'failed'} delivery=${model.delivery.status} delivery_goal=${deliveryPassed} human_review=pending upper_estimate_cny=${ledger.summary(runId).upper_estimate_cny}`);
        if(!automaticPassed||!deliveryPassed)process.exitCode=1;
      }catch(e){report={...report,model_called:true,model_status:'incomplete',budget:ledger.summary(runId)};throw e;}
      finally{ledger.close();}
    }
    phase='session_bound_delivery';
    const guarded=await checkPublication(author,{workId:r1.work_id,previewId:p2.id});
    assert.ok(guarded);
    assert.equal(guarded.getDelivery()?.verdict.publication,'confirmed');
    assert.deepEqual(await guarded.checkReaderVisibility(),{status:'not_visible',blocker:'author_hidden',releasedVersion:2});
    checks.push('anonymous_reader_cannot_open_hidden_work');
    const followed=await guarded.followUp();
    assert.ok(followed);
    assert.equal(ok(followed).work_id,r1.work_id);
    let release!:()=>void;
    let start!:()=>void;
    const received=new Promise<void>(resolve=>{start=resolve});
    const waiting=new Promise<void>(resolve=>{release=resolve});
    const delayed=checkPublication({
      snapshot:author.snapshot,
      authorized:async<T>(p:string,o?:Parameters<typeof author.authorized>[1])=>{
        const value=await author.authorized<T>(p,o);
        start();
        await waiting;
        return value;
      },
    },{previewId:p2.id});
    await Promise.race([received,delayed.then(()=>{throw Error('diagnosis_not_read')})]);
    try{await author.restore()}finally{release()}
    assert.equal(author.snapshot().phase,'ready');
    assert.equal(await delayed,null);
    assert.equal(guarded.getDelivery(),null);
    assert.equal(await guarded.followUp(),null);
    assert.equal(await guarded.checkReaderVisibility(),null);
    checks.push('session_generation_invalidates_pending_and_delivered_diagnostics');
    console.log(`PASS real author tool probe: ${checks.length} checks; no model score or external model call implied`);
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
