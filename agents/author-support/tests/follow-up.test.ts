import test from 'node:test';
import assert from 'node:assert/strict';
import {followUp} from '../src/follow-up.ts';
import {ids} from '../src/cases.ts';
import {ApiError} from '../../../mobile/src/api/client.ts';
import type {Transport} from '../../../mobile/src/auth/session.ts';
import type {NextStep} from '../src/delivery.ts';
const at='2026-11-04T01:00:00Z';
const detail=(state='pending')=>({submission:{id:ids.other,work_id:ids.work,preview_id:ids.preview,candidate_version:2,title:'合成标题',state,reason:'PRIVATE_REASON',accepted_at:at,first_waiting_at:at,decided_at:state==='pending'?null:at},preview:{id:ids.preview,draft_id:ids.draft,source_revision:1,expected_version:1,title:'合成标题',content:'PRIVATE_BODY',introduction:'PRIVATE_INTRO',tags:['日常'],created_at:at,expires_at:at,published:{work_id:ids.work,version:0,published_at:null,review_status:'pre_review',submission_id:ids.other,submitted_at:at}}});
test('current submission state is read through the existing decoder and metadata projection',async()=>{
  for(const state of ['pending','withdrawn','published','rejected','superseded']){
    let calls=0;
    const transport=(async(p,o)=>{calls++;assert.equal(p,'/my/work-submissions/'+ids.other);assert.equal(o?.method,'GET');assert.equal(o?.body,undefined);return detail(state)}) as Transport;
    const result=await followUp({kind:'read_submission_record',submission_id:ids.other},transport);
    assert.equal(result.status,'ok');assert.equal(calls,1);
    if(result.status==='ok'){assert.equal(result.data.state,state);assert.equal(result.data.meaning,'current_submission_state_not_public_visibility')}
    assert.ok(!JSON.stringify(result).includes('PRIVATE'));assert.ok(!JSON.stringify(result).includes('candidate_version'));
  }
});
test('injected paths, identities and malformed targets fail before HTTP; local actions send nothing',async()=>{
  let calls=0;const transport=(async()=>{calls++;throw Error('must not query')}) as Transport;
  for(const step of [{kind:'read_submission_record',submission_id:'https://evil.invalid'},{kind:'read_submission_record',submission_id:ids.other,owner_id:ids.work},{kind:'read_original_result',preview_id:ids.preview,path:'/ops'},{kind:'write_publish',preview_id:ids.preview}]){
    const result=await followUp(step as NextStep,transport);assert.equal(result.status,'error');
  }
  for(const kind of ['provide_identifiers','reauthenticate','contact_support'] as const){
    const result=await followUp({kind},transport);assert.equal(result.status,'ok');if(result.status==='ok')assert.equal(result.data.no_request_sent,true);
  }
  assert.equal(calls,0);
});
test('owner denial, session expiry and malformed detail do not become business statuses',async()=>{
  for(const [code,status,error] of [['resource_not_found',404,'resource_unavailable'],['authentication_required',401,'authentication_required'],['network',0,'tool_unavailable']] as const){
    const result=await followUp({kind:'read_submission_record',submission_id:ids.other},async()=>{throw new ApiError(code,'',status)});
    assert.equal(result.status,'error');if(result.status==='error')assert.equal(result.error,error);
  }
  const result=await followUp({kind:'read_submission_record',submission_id:ids.other},(async()=>({...detail(),submission:{...detail().submission,id:ids.work}})) as Transport);
  assert.equal(result.status,'error');if(result.status==='error')assert.equal(result.error,'integration_error');
});
