import type {ToolResult} from "./tools.ts";
export type Verdict={publication:"confirmed"|"unconfirmed"|"unknown";access:"author_hidden"|"work_limited"|"display_limited"|"no_recorded_block"|"unknown";next_action:string;evidence_ids:string[];explanation:string};
export type Evidence={tool:string;result:ToolResult};
export function parseVerdict(text:string):Verdict{
  let v;try{v=JSON.parse(text)}catch{throw Error('agent_output_not_json')}
  if(!v||typeof v!=='object'||Object.keys(v).sort().join(',')!=='access,evidence_ids,explanation,next_action,publication'||!['confirmed','unconfirmed','unknown'].includes(v.publication)||!['author_hidden','work_limited','display_limited','no_recorded_block','unknown'].includes(v.access)||typeof v.next_action!=='string'||!Array.isArray(v.evidence_ids)||v.evidence_ids.length>8||!v.evidence_ids.every((x:unknown)=>typeof x==='string')||typeof v.explanation!=='string'||!v.explanation.trim()||v.explanation.length>2000)throw Error('agent_output_schema');
  return v;
}
// A narrow code grader for the first diagnostic. It does not assess prose,
// helpfulness or empirical agent quality; those still require human review.
export function grade(verdict:Verdict,ledger:Evidence[],workId:string,previewId:string){
  const failures:string[]=[],cited=ledger.filter(x=>verdict.evidence_ids.includes(x.result.evidence_id));
  if(new Set(verdict.evidence_ids).size!==verdict.evidence_ids.length||cited.length!==verdict.evidence_ids.length)failures.push('invalid_evidence_reference');
  const states=cited.filter(x=>x.tool==='read_work_state'&&x.result.status==='ok'&&x.result.data.work_id===workId).map(x=>(x.result as Extract<ToolResult,{status:'ok'}>).data).sort((a,b)=>Number(b.state_revision)-Number(a.state_revision)||Number(typeof b.display_limited==='boolean')-Number(typeof a.display_limited==='boolean'));
  const state=states[0];
  if(state&&states.some(x=>x.state_revision===state.state_revision&&['author_hidden','work_limited','display_version','last_version'].some(k=>x[k]!==state[k])))failures.push('inconsistent_state_evidence');
  if(state&&typeof state.display_limited==='boolean'&&states.some(x=>x.state_revision===state.state_revision&&typeof x.display_limited==='boolean'&&x.display_limited!==state.display_limited))failures.push('inconsistent_state_evidence');
  const receipts=cited.filter(x=>x.tool==='read_publication_result'&&x.result.status==='ok'&&x.result.data.preview_id===previewId).map(x=>(x.result as Extract<ToolResult,{status:'ok'}>).data);
  if(state&&ledger.some(x=>x.tool==='read_work_state'&&x.result.status==='ok'&&x.result.data.work_id===workId&&Number(x.result.data.state_revision)>Number(state.state_revision)))failures.push('stale_state_evidence');
  if(verdict.publication==='confirmed'&&!receipts.some(x=>{
    if(!x.published||typeof x.published!=='object')return false;
    const p=x.published as Record<string,unknown>;
    return p.work_id===workId&&Number.isSafeInteger(p.version)&&Number(p.version)>0&&typeof p.published_at==='string'&&Number.isFinite(Date.parse(p.published_at));
  }))failures.push('unsupported_publication_claim');
  if(verdict.publication==='unconfirmed'&&!receipts.some(x=>x.published===null))failures.push('unsupported_unconfirmed_claim');
  if(verdict.access==='author_hidden'&&state?.author_hidden!==true)failures.push('unsupported_access_claim');
  if(verdict.access==='work_limited'&&state?.work_limited!==true)failures.push('unsupported_access_claim');
  if(verdict.access==='display_limited'&&state?.display_limited!==true)failures.push('unsupported_access_claim');
  if(verdict.access==='no_recorded_block'&&(!state||state.author_hidden!==false||state.work_limited!==false||state.display_limited!==false))failures.push('unsupported_access_claim');
  if(!['open_work_detail','check_original_result','provide_identifiers','contact_support'].includes(verdict.next_action))failures.push('disallowed_advice');
  return {supported:failures.length===0,failures,human_review_required:true};
}
