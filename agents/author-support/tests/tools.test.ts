import test from "node:test";
import assert from "node:assert/strict";
import { createAuthorTools } from "../src/tools.ts";
import { ApiError } from "../../../mobile/src/api/client.ts";
import type { Transport } from "../../../mobile/src/auth/session.ts";

const work="11111111-1111-4111-8111-111111111111",draft="22222222-2222-4222-8222-222222222222",preview="33333333-3333-4333-8333-333333333333";
const at="2026-11-04T01:00:00Z";
const state={id:work,draft_id:draft,state_revision:3,last_version:25,display_version:1,author_hidden:false,platform_limited:false,history_open:false};
const version=(n:number)=>({version:n,title:"SECRET_TITLE",platform_limited:false,review_status:"pending",published_at:at});
const fixed={id:preview,draft_id:draft,source_revision:1,expected_version:0,title:"SECRET_TITLE",content:"SECRET_BODY",introduction:"SECRET_INTRO",tags:["日常"],created_at:at,expires_at:at};
function fixture(resolve:(path:string)=>unknown){
  const calls:string[]=[];
  const transport=(async(path:string,options?:Parameters<Transport>[1])=>{
    assert.equal(options?.method,"GET");assert.equal(options?.body,undefined);
    calls.push(path);return resolve(path);
  }) as Transport;
  return {calls,tools:createAuthorTools(transport)};
}
test("unknown tools, injected identity/path and malformed arguments never reach HTTP",async()=>{
  const {calls,tools}=fixture(()=>{throw Error("must not call")});
  for(const [name,input] of [["publish",{}],["read_work_state",{work_id:work,owner_id:work}],["read_draft_metadata",{draft_id:draft,token:"SECRET"}],["find_my_works",{query:"x",path:"/ops"}],["read_work_state",{work_id:work,before_version:-1}],["read_work_state",{work_id:"bad"}],["read_publication_result",null]]){
    const r=await tools.invoke(name as string,input);assert.equal(r.status,"error");
    if(r.status==="error")assert.equal(r.error,"invalid_arguments");
  }
  assert.equal(calls.length,0);assert.ok(!JSON.stringify(tools.trace()).includes("SECRET"));
});
test("draft and fixed preview projections omit title, body, introduction and review inference",async()=>{
  const {tools}=fixture(path=>path.startsWith('/drafts/')?{id:draft,revision:2,title:"SECRET_TITLE",content:"SECRET_BODY",saved_at:at}:{...fixed,published:{work_id:work,version:1,published_at:at,review_status:"pending"}});
  const d=await tools.invoke("read_draft_metadata",{draft_id:draft});
  assert.equal(d.status,"ok");if(d.status==="ok")assert.equal(d.data.revision,2);
  const p=await tools.invoke("read_publication_result",{preview_id:preview});
  assert.equal(p.status,"ok");if(p.status==="ok")assert.equal((p.data.published as Record<string,unknown>).version,1);
  assert.ok(!JSON.stringify([d,p,tools.trace()]).includes("SECRET"));
  assert.ok(!JSON.stringify(p).includes("review_status"));
});
test("unconsumed preview is unconfirmed, not evidence that no submission ever happened",async()=>{
  const {tools}=fixture(()=>fixed);const p=await tools.invoke("read_publication_result",{preview_id:preview});
  assert.equal(p.status,"ok");if(p.status==="ok")assert.equal(p.data.published,null);
});
test('pre-review acceptance is distinct from formal publication and current submission status',async()=>{
  const {tools}=fixture(()=>({...fixed,review_required:true,published:{work_id:work,version:0,published_at:null,review_status:'pre_review',submission_id:draft,submitted_at:at}}));
  const p=await tools.invoke('read_publication_result',{preview_id:preview});
  assert.equal(p.status,'ok');if(p.status==='ok'){
    assert.equal(p.data.published,null);
    assert.equal((p.data.submission as Record<string,unknown>).submission_id,draft);
    assert.equal((p.data.submission as Record<string,unknown>).meaning,'historical_acceptance_not_publication_or_current_review_status');
  }
});
test("old display outside the returned page remains unknown; later metadata page can establish it",async()=>{
  const {tools}=fixture(path=>({state,versions:path.includes('before_version=2')?[version(1)]:[version(25)],events:[],next_version_before:path.includes('before_version=2')?0:25,next_event_before:0}));
  const first=await tools.invoke("read_work_state",{work_id:work});
  assert.equal(first.status,"ok");if(first.status==="ok")assert.equal(first.data.display_limited,null);
  const second=await tools.invoke("read_work_state",{work_id:work,before_version:2});
  assert.equal(second.status,"ok");if(second.status==="ok")assert.equal(second.data.display_limited,false);
  assert.ok(!JSON.stringify([first,second]).includes("SECRET_TITLE"));
});
test("search keeps owner API scope, meaningful candidates and pagination; trace omits query/title",async()=>{
  const {tools,calls}=fixture(()=>({items:[{...state,title:"SECRET_TITLE",latest_title:"SECRET_TITLE",display_limited:false,comment_count:0,favorite_count:0}],next_cursor:""}));
  const p=await tools.invoke("find_my_works",{query:"SECRET_QUERY"});assert.equal(p.status,"ok");
  assert.ok(calls[0].startsWith("/my/works?"));assert.ok(calls[0].includes("visibility=all"));
  if(p.status==="ok")assert.equal((p.data.items as Record<string,unknown>[])[0].title,"SECRET_TITLE");
  assert.ok(!JSON.stringify(tools.trace()).includes("SECRET"));
});
test("resource denial, transport failure and malformed data have distinct non-leaking meanings",async()=>{
  for(const [status,code,expected] of [[401,"authentication_required","authentication_required"],[403,"forbidden","forbidden"],[404,"resource_not_found","resource_unavailable"],[429,"rate_limited","rate_limited"],[503,"internal_error","tool_unavailable"],[0,"network","tool_unavailable"],[0,"contract","integration_error"],[0,"environment","integration_error"],[410,"preview_expired","unconfirmed"]] as const){
    const {tools}=fixture(()=>{throw new ApiError(code,"",status)});
    const r=await tools.invoke("read_publication_result",{preview_id:preview});assert.equal(r.status,"error");
    if(r.status==="error")assert.equal(r.error,expected);
  }
  const {tools}=fixture(()=>({id:draft,revision:2,title:"x",content:"SECRET_BODY",saved_at:"bad"}));
  const r=await tools.invoke("read_draft_metadata",{draft_id:draft});assert.equal(r.status,"error");
  if(r.status==="error")assert.equal(r.error,"integration_error");
});
