import {UUID} from '../../../mobile/src/api/reader.ts';
import {admit,fallback,type Context,type Delivery} from './delivery.ts';
import {parseVerdict,workSnapshot,type Evidence,type Verdict} from './grade.ts';

const data=(items:Evidence[],tool:string)=>items.filter(x=>x.tool===tool&&x.result.status==='ok').map(x=>({id:x.result.evidence_id,data:(x.result as Extract<Evidence['result'],{status:'ok'}>).data}));
function enrich(result:Delivery,context:Context,evidence:Evidence[]):Delivery{
  const cited=evidence.filter(x=>result.verdict.evidence_ids.includes(x.result.evidence_id));
  const receipt=data(cited,'read_publication_result').filter(x=>x.data.preview_id===context.preview_id).at(-1)?.data;
  const submission=receipt?.submission as {submission_id?:string}|null|undefined;
  const published=receipt?.published as {work_id?:string}|null|undefined;
  const work=context.work_id??published?.work_id;
  if(evidence.some(x=>x.result.status==='error'&&x.result.error==='authentication_required')){
    return {...result,verification:'unable_to_check',next_step:{kind:'reauthenticate'},verdict:{...result.verdict,explanation:'当前会话需要重新确认身份，完成后才能继续读取。'+result.verdict.explanation}};
  }
  let next_step:Delivery['next_step'];
  if(context.ambiguous_identifiers||result.verdict.next_action==='provide_identifiers')next_step={kind:'provide_identifiers'};
  else if(result.verdict.next_action==='contact_support')next_step={kind:'contact_support'};
  else if(result.verdict.next_action==='open_work_detail'&&work&&UUID.test(work))next_step={kind:'read_work_state',work_id:work};
  else if(result.verdict.next_action==='check_original_result'){
    next_step=submission?.submission_id&&UUID.test(submission.submission_id)?{kind:'read_submission_record',submission_id:submission.submission_id}:context.preview_id?{kind:'read_original_result',preview_id:context.preview_id}:{kind:'provide_identifiers'};
  }
  const verification=result.status==='fallback'?'unable_to_check':result.verdict.publication!=='unknown'||result.verdict.access!=='unknown'?'facts_checked':result.verdict.next_action==='provide_identifiers'?'needs_clarification':'unable_to_check';
  const verdict=next_step?.kind==='read_submission_record'?{...result.verdict,explanation:result.verdict.explanation+'可读取该次提交记录核对当前处理状态；原受理回执不会因此改写。'}:result.verdict;
  return {...result,verdict,verification,next_step};
}

// Narrow recovery for invalid claims/actions using only already-cited facts.
// No Case, answer key, extra reads, provider call, or business writes here.
export function deliver(context:Context,proposed:unknown,evidence:Evidence[]):Delivery{
  const original=admit(context,proposed,evidence);
  if(evidence.some(x=>x.result.status==='error'&&x.result.error==='authentication_required'))return enrich(fallback(context,['authentication_required']),context,evidence);
  if(evidence.some(x=>x.result.status==='error'&&x.result.error==='forbidden')){
    const blocked=fallback(context,['forbidden']);
    return {...blocked,verification:'unable_to_check',next_step:{kind:'contact_support'},verdict:{...blocked.verdict,next_action:'contact_support',explanation:'当前账号没有读取权限，暂不能继续核对。请联系人工，不要绕过权限或重复提交。'}};
  }
  if(original.status!=='fallback')return enrich(original,context,evidence);
  const recoverable=['unsupported_access_claim','unsupported_publication_claim','work_navigation_unavailable','original_result_scope','original_identifier_missing','disallowed_advice','latest_receipt_not_unconfirmed'];
  if(!original.reasons.length||original.reasons.some(x=>!recoverable.includes(x)))return enrich(original,context,evidence);
  try{
    const raw=parseVerdict(JSON.stringify(proposed));
    const cited=evidence.filter(x=>raw.evidence_ids.includes(x.result.evidence_id));
    const receipts=data(cited,'read_publication_result').filter(x=>x.data.preview_id===context.preview_id);
    const receipt=receipts.at(-1);
    const published=receipt?.data.published as {work_id?:string;version?:number}|null|undefined;
    const work=context.work_id??published?.work_id??'';
    // Preserve the validator's cross-resource and snapshot consistency rules.
    const snapshot=workSnapshot(cited,work);
    if(snapshot.failures.length)return enrich(original,context,evidence);
    const state=context.original_result_only?undefined:snapshot.state;
    const publication:Verdict['publication']=receipt?.data.published===null?'unconfirmed':published&&published.work_id===work&&Number.isSafeInteger(published.version)&&Number(published.version)>0?'confirmed':'unknown';
    let access:Verdict['access']='unknown';
    if(state){
      if(state.author_hidden===true)access='author_hidden';
      else if(state.work_limited===true)access='work_limited';
      else if(state.display_limited===true)access='display_limited';
      else if(state.author_hidden===false&&state.work_limited===false&&state.display_limited===false)access='no_recorded_block';
    }
    if(publication==='unknown'&&access==='unknown')return enrich(original,context,evidence);
    const next_action:Verdict['next_action']=context.original_result_only||receipt?.data.submission?'check_original_result':work&&(state||publication==='confirmed')?'open_work_detail':context.preview_id?'check_original_result':'provide_identifiers';
    const candidate:Verdict={...raw,publication,access,next_action,explanation:'已核实事实，不使用原模型自由解释。'};
    const checked=admit(context,candidate,evidence);
    if(checked.status!=='admitted')return enrich(original,context,evidence);
    const corrected_fields=(['publication','access','next_action'] as const).filter(k=>raw[k]!==candidate[k]);
    return enrich({...checked,status:'recovered',reasons:original.reasons,corrected_fields},context,evidence);
  }catch{return enrich(original,context,evidence)}
}
