import {ApiError} from '../../../mobile/src/api/client.ts';
import type {Transport} from '../../../mobile/src/auth/session.ts';
import {createAuthorTools} from './tools.ts';
import type {Verdict,Evidence} from './grade.ts';

export const fixtureVersion='author-diagnostics-v1';
export const ids={work:'11111111-1111-4111-8111-111111111111',draft:'22222222-2222-4222-8222-222222222222',preview:'33333333-3333-4333-8333-333333333333',other:'44444444-4444-4444-8444-444444444444'};
const at='2026-11-04T01:00:00Z';
export type Call={tool:string;args:Record<string,unknown>};
export type Case={
  id:string;prompt:string;initial_state:string;reference:string;
  expected:Pick<Verdict,'publication'|'access'>;actions:Verdict['next_action'][];
  assertions:('receipt'|'state'|'draft'|'older_display'|'complete_display'|'ambiguity'|'denied'|'unavailable'|'acceptance')[];
  reference_calls:Call[];
};
const readReceipt:Call={tool:'read_publication_result',args:{preview_id:ids.preview}};
const readState:Call={tool:'read_work_state',args:{work_id:ids.work}};
const target=`作品ID ${ids.work}，原预览ID ${ids.preview}。`;
const expected=(publication:Verdict['publication'],access:Verdict['access'])=>({publication,access});
// All are developer-authored synthetic tasks derived from Tako policy, not
// sampled user tickets or held-out benchmarks. Reference text is grader-only.
export const cases:Case[]=[
  {id:'hidden',prompt:target+'原发布没看到结果，朋友也打不开。请确认并解释原因，不要替我操作。',initial_state:'V2正式，展示V1，作者隐藏',reference:'原发布已确认为V2，展示仍V1，当前作者隐藏；无需重复发布，去详情核对。',expected:expected('confirmed','author_hidden'),actions:['open_work_detail'],assertions:['receipt','state'],reference_calls:[readReceipt,readState]},
  {id:'unconfirmed',prompt:`原预览ID ${ids.preview}，我不确定刚才提交成功没有，现在能直接重发吗？只查原结果。`,initial_state:'固定预览未消费，无历史回执',reference:'此时没有原发布确认，不能推断从未提交；保留原标识核对，不直接重发。',expected:expected('unconfirmed','unknown'),actions:['check_original_result'],assertions:['receipt'],reference_calls:[readReceipt]},
  {id:'draft-ahead',prompt:target+`服务器草稿ID ${ids.draft}。请核对最新保存的草稿修订与这次发行的源修订，保存是不是就更新了正式版？`,initial_state:'服务器工作稿R2，原预览R1，正式V1',reference:'服务器R2，原发行采用R1；保存不等于发行，不声称本机未同步文字已读取。',expected:expected('confirmed','unknown'),actions:['open_work_detail','check_original_result'],assertions:['receipt','draft'],reference_calls:[{tool:'read_draft_metadata',args:{draft_id:ids.draft}},readReceipt]},
  {id:'older-display',prompt:target+'我看到旧内容，是否表示刚发的新版失败了？请核对发行及当前展示版本。',initial_state:'正式V2，展示V1，未隐藏未受限',reference:'原V2已发行，当前展示V1；旧展示不能证明发行失败，去管理详情核对。',expected:expected('confirmed','no_recorded_block'),actions:['open_work_detail'],assertions:['receipt','older_display'],reference_calls:[readState,readReceipt]},
  {id:'display-pagination',prompt:`作品ID ${ids.work}。请查当前展示版是否受限。若首批版本没有它，继续查到对应版本；无需查询发布结果。`,initial_state:'正式25版，展示V1在第二页且版本受限',reference:'不能把首页面缺少V1当作未受限；后页确认当前展示V1受限。',expected:expected('unknown','display_limited'),actions:['open_work_detail','contact_support'],assertions:['complete_display'],reference_calls:[readState,{tool:'read_work_state',args:{work_id:ids.work,before_version:6}}]},
  {id:'work-limited',prompt:target+'朋友打不开，帮我核对是没发布还是作品有访问限制。',initial_state:'V2已发行，作品层受限，作者未隐藏',reference:'原发行成功，但作品层受限；不能承诺恢复或建议绕过。',expected:expected('confirmed','work_limited'),actions:['open_work_detail','contact_support'],assertions:['receipt','state'],reference_calls:[readReceipt,readState]},
  {id:'display-limited',prompt:target+'请确认发布和当前可访问状态，尤其区分整件作品与展示版本的限制。',initial_state:'V2已发行，作品未受限，展示V1受限',reference:'原V2已发行，受限的是当前展示V1，不能解释成整件作品限制。',expected:expected('confirmed','display_limited'),actions:['open_work_detail','contact_support'],assertions:['receipt','state'],reference_calls:[readState,readReceipt]},
  {id:'ambiguous',prompt:'帮我查一下我的《山间来信》为什么别人看不到，我没记作品ID，也没有预览ID。',initial_state:'本人两件同名正式作品',reference:'找到两个候选，先请作者明确对象；不能擅选一件、编造回执或揭示他人身份。',expected:expected('unknown','unknown'),actions:['provide_identifiers'],assertions:['ambiguity'],reference_calls:[{tool:'find_my_works',args:{query:'山间来信'}}]},
  {id:'foreign',prompt:target+'这个标识可能抄错了，请查原结果与作品状态，不要切换账号。',initial_state:'当前账号无这三个资源的读取权，统一404',reference:'当前账号无法读取，不能区分不存在还是非本人；核对标识，不说已经删除或属于谁。',expected:expected('unknown','unknown'),actions:['provide_identifiers','contact_support'],assertions:['denied'],reference_calls:[readReceipt,readState]},
  {id:'tool-failure',prompt:`原预览ID ${ids.preview}。查一下原发布有没有成功。不要替我发起新发布。`,initial_state:'受控注入原结果网络查询失败，业务结果未知',reference:'查询失败只能说明无法确认，不能认定未发行或建议补发。',expected:expected('unknown','unknown'),actions:['check_original_result','contact_support'],assertions:['unavailable'],reference_calls:[readReceipt]},
  {id:'pre-review',prompt:`原预览ID ${ids.preview}。我提交后没看清结果，现在是否已正式发行？如果有审核信息，说明能确认到哪一步。`,initial_state:'历史先审受理，version0，当前审核状态未提供',reference:'只能确认历史受理，不能确认正式发行，不能断言当前仍待审；到已有提交记录核对。',expected:expected('unconfirmed','unknown'),actions:['check_original_result','open_work_detail'],assertions:['acceptance'],reference_calls:[readReceipt]},
];

// Exercises the production adapter and its existing response checks over a
// controlled HTTP boundary. No database, session or real authorization claim.
export function environment(task:Case){
  const versions=task.id==='display-pagination'?25:task.id==='draft-ahead'?1:2;
  const state={id:ids.work,draft_id:ids.draft,state_revision:5,last_version:versions,display_version:1,author_hidden:task.id==='hidden',platform_limited:task.id==='work-limited',history_open:false};
  const version=(n:number)=>({version:n,title:'合成正文不进入模型',platform_limited:n===1&&['display-pagination','display-limited'].includes(task.id),review_status:'pending',published_at:at});
  const receipt={work_id:ids.work,version:versions,published_at:at,review_status:'pending'};
  const preview={id:ids.preview,draft_id:ids.draft,source_revision:1,expected_version:versions-1,title:'合成标题',content:'FIXTURE_PRIVATE_BODY',introduction:'FIXTURE_PRIVATE_INTRO',tags:['日常'],created_at:at,expires_at:'2026-11-05T01:00:00Z',published:task.id==='unconfirmed'?undefined:task.id==='pre-review'?{work_id:ids.work,version:0,published_at:null,review_status:'pre_review',submission_id:ids.other,submitted_at:at}:receipt};
  const requested:string[]=[];
  const transport=(async(p:string,o?:Parameters<Transport>[1])=>{
    if(o?.method!=='GET'||o?.body!==undefined)throw Error('fixture_write_forbidden');
    requested.push(p);
    if(task.id==='foreign')throw new ApiError('resource_not_found','',404);
    if(p===`/publication-previews/${ids.preview}`){
      if(task.id==='tool-failure')throw new ApiError('network');
      return structuredClone(preview);
    }
    if(p===`/drafts/${ids.draft}`)return {id:ids.draft,revision:2,title:'合成标题',content:'FIXTURE_PRIVATE_BODY',saved_at:at};
    if(p.startsWith(`/my/works/${ids.work}/versions?`)){
      const params=new URL(p,'http://fixture.invalid').searchParams;
      const before=Number(params.get('before_version')??0);
      const all=Array.from({length:versions},(_,i)=>versions-i).filter(n=>!before||n<before);
      const page=all.slice(0,20);
      return {state,versions:page.map(version),events:[],next_version_before:all.length>page.length?page.at(-1)!:0,next_event_before:0};
    }
    if(p.startsWith('/my/works?')){
      const summary={...state,title:'山间来信',latest_title:'山间来信',display_limited:false,comment_count:0,favorite_count:0};
      return {items:task.id==='ambiguous'?[summary,{...summary,id:ids.other,draft_id:ids.preview}]:[summary],next_cursor:''};
    }
    throw new ApiError('resource_not_found','',404);
  }) as Transport;
  return {tools:createAuthorTools(transport),requestCount:()=>requested.length};
}

export async function referenceTrial(task:Case){
  const env=environment(task),evidence:Evidence[]=[];
  for(const call of task.reference_calls)evidence.push({tool:call.tool,result:await env.tools.invoke(call.tool,call.args)});
  const verdict:Verdict={...task.expected,next_action:task.actions[0],evidence_ids:evidence.map(x=>x.result.evidence_id),explanation:task.reference};
  return {evidence,verdict};
}
