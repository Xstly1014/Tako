import assert from 'node:assert/strict';
import test from 'node:test';
import {policyPending} from '../src/policy-pending.ts';
import {ApiError} from '../../../mobile/src/api/client.ts';
import type {Transport} from '../../../mobile/src/auth/session.ts';
import {ids} from '../src/cases.ts';

const at='2026-11-01T00:00:00Z';
const submission={id:ids.other,work_id:ids.work,preview_id:ids.preview,candidate_version:1,
  title:'PRIVATE_TITLE',reason:'PRIVATE_REASON',state:'pending',accepted_at:at,first_waiting_at:at,decided_at:null};
const preview={id:ids.preview,draft_id:ids.draft,source_revision:1,expected_version:0,title:'PRIVATE_TITLE',
  content:'PRIVATE_BODY',introduction:'',tags:['日常'],created_at:at,expires_at:at,
  published:{work_id:ids.work,version:0,published_at:null,review_status:'pre_review',submission_id:ids.other,submitted_at:at}};

test('an inactive policy does not classify a concurrently withdrawn submission as pending',async()=>{
  const report=await policyPending((async(path,options)=>{
    assert.equal(options?.method,'GET');
    if(path==='/ops/work-submissions')return {items:[submission],next_cursor:''};
    if(path===`/ops/works/${ids.work}/author-policy`){
      return {policy:{revision:2,active:false,observation_until:null,reason:'PRIVATE_POLICY'},items:[],next:0};
    }
    assert.equal(path,`/ops/work-submissions/${ids.other}`);
    return {submission:{...submission,state:'withdrawn',decided_at:at},preview};
  }) as Transport);
  assert.equal(report.status,'complete');
  assert.deepEqual(report.counts,{observationActive:0,observationInactive:0,submissionChanged:1});
  assert.doesNotMatch(JSON.stringify(report),/PRIVATE/);
});

test('policy read failures preserve unknown totals',async()=>{
  const report=await policyPending((async(path)=>{
    if(path==='/ops/work-submissions')return {items:[submission],next_cursor:''};
    throw new ApiError('operator_required','',403);
  }) as Transport);
  assert.equal(report.status,'incomplete');
  assert.equal(report.counts,null);
  assert.equal(report.rows.length,0);
});
