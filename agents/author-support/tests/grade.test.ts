import test from "node:test";
import assert from "node:assert/strict";
import {grade,parseVerdict,type Evidence,type Verdict} from "../src/grade.ts";
const result=(id:string,data:Record<string,unknown>)=>({status:'ok' as const,evidence_id:id,observed_at:'2026-11-04T00:00:00Z',data});
const state:Evidence={tool:'read_work_state',result:result('state',{work_id:'w',state_revision:1,author_hidden:true,work_limited:false,display_limited:false})};
const receipt:Evidence={tool:'read_publication_result',result:result('receipt',{preview_id:'p',published:{work_id:'w',version:1,published_at:'2026-11-04T00:00:00Z'}})};
const verdict:Verdict={publication:'confirmed',access:'author_hidden',next_action:'open_work_detail',evidence_ids:['state','receipt'],explanation:'需要到详情核对隐藏状态。'};
test('supports meaningful alternative tool ordering, flags invented evidence and unsafe advice',()=>{
  assert.equal(grade(verdict,[receipt,state],'w','p').supported,true);
  assert.ok(grade({...verdict,evidence_ids:['fabricated']},[state,receipt],'w','p').failures.includes('invalid_evidence_reference'));
  assert.ok(grade({...verdict,next_action:'republish'},[state,receipt],'w','p').failures.includes('disallowed_advice'));
});
test('tool failure is not proof of no publication; honest unknown remains supported',()=>{
  const error:Evidence={tool:'read_publication_result',result:{status:'error',evidence_id:'error',observed_at:'2026-11-04T00:00:00Z',error:'tool_unavailable',guidance:'查询失败'}};
  const unknown:Verdict={publication:'unknown',access:'unknown',next_action:'contact_support',evidence_ids:['error'],explanation:'工具失败，无法确认。'};
  assert.equal(grade(unknown,[error],'w','p').supported,true);
  assert.ok(grade({...unknown,publication:'unconfirmed'},[error],'w','p').failures.includes('unsupported_unconfirmed_claim'));
});
test('other-resource and incomplete-page evidence cannot support access or release claims',()=>{
  assert.equal(grade(verdict,[state,receipt],'other','p').supported,false);
  const unknown:Evidence={tool:'read_work_state',result:result('state',{work_id:'w',author_hidden:false,work_limited:false,display_limited:null})};
  assert.ok(grade({...verdict,access:'no_recorded_block'},[unknown,receipt],'w','p').failures.includes('unsupported_access_claim'));
  assert.throws(()=>parseVerdict('I think it worked'),/not_json/);
  assert.throws(()=>parseVerdict(JSON.stringify({...verdict,owner_id:'injected'})),/schema/);
});
test('a different preview of the same work and an omitted newer state cannot support the answer',()=>{
  assert.ok(grade(verdict,[state,receipt],'w','another-preview').failures.includes('unsupported_publication_claim'));
  const unrelated:Evidence={tool:'read_publication_result',result:result('receipt',{preview_id:'other',published:null})};
  assert.ok(grade({...verdict,publication:'unconfirmed'},[state,unrelated],'w','p').failures.includes('unsupported_unconfirmed_claim'));
  const newer:Evidence={tool:'read_work_state',result:result('new',{work_id:'w',state_revision:2,author_hidden:false})};
  assert.ok(grade(verdict,[state,newer,receipt],'w','p').failures.includes('stale_state_evidence'));
});
test('accepted version zero never confirms a formal publication',()=>{
  const accepted:Evidence={tool:'read_publication_result',result:result('receipt',{preview_id:'p',published:{work_id:'w',version:0,published_at:null}})};
  assert.ok(grade(verdict,[state,accepted],'w','p').failures.includes('unsupported_publication_claim'));
});
