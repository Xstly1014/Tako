import {UUID} from '../../../mobile/src/api/reader.ts';
import {grade,parseVerdict,workSnapshot,type Evidence,type Verdict} from './grade.ts';

export const deliveryVersion='evidence-delivery-v1';
export type Context={work_id?:string;preview_id?:string;draft_id?:string;original_result_only:boolean;ambiguous_identifiers:boolean};
export type Delivery={version:string;status:'admitted'|'fallback';verdict:Verdict;reasons:string[];free_text_used:false};
export function contextFromInput(input:string):Context{
  let ambiguous=false;
  const one=(label:string)=>{
    const values=[...input.matchAll(new RegExp(label+'[：:\\s]*([a-fA-F0-9-]{36})','g'))].map(x=>x[1].toLowerCase()).filter(x=>UUID.test(x));
    const distinct=[...new Set(values)];if(distinct.length>1)ambiguous=true;
    return distinct.length===1?distinct[0]:undefined;
  };
  const work_id=one('作品ID'),preview_id=one('(?:原)?预览ID'),draft_id=one('(?:服务器)?草稿ID');
  return {work_id,preview_id,draft_id,ambiguous_identifiers:ambiguous,original_result_only:/只(?:查|查询|核对)原(?:发布)?结果/.test(input)};
}
export function fallback(context:Context,reasons:string[]):Delivery{
  const next=context.preview_id?'check_original_result':'provide_identifiers';
  return {version:deliveryVersion,status:'fallback',free_text_used:false,reasons:[...new Set(reasons)],verdict:{publication:'unknown',access:'unknown',next_action:next,evidence_ids:[],explanation:context.preview_id?'本次诊断未取得可交付的核对结果，暂不能确认原发布或访问状态。请保留原预览标识，稍后只核对原结果；不要据此重复提交。':'本次无法可靠确定诊断对象或结果。请核对作品或原预览标识后重新查询；不会替你修改或发布。'}};
}

// No Case/expected/reference imports: admission consumes request context and
// observed adapter evidence, never hidden task answers or model-written prose.
export function admit(context:Context,proposed:unknown,evidence:Evidence[]):Delivery{
  try{
    if(context.ambiguous_identifiers)return fallback(context,['ambiguous_request_identifiers']);
    const verdict=parseVerdict(JSON.stringify(proposed));
    if(new Set(evidence.map(x=>x.result.evidence_id)).size!==evidence.length)return fallback(context,['duplicate_evidence_id']);
    const cited=evidence.filter(x=>verdict.evidence_ids.includes(x.result.evidence_id));
    const receipts=cited.filter(x=>x.tool==='read_publication_result'&&x.result.status==='ok'&&x.result.data.preview_id===context.preview_id).map(x=>(x.result as Extract<Evidence['result'],{status:'ok'}>).data);
    const receipt=receipts.at(-1);
    const published=receipt?.published as {work_id?:string;version?:number}|null|undefined;
    const work=context.work_id??(typeof published?.work_id==='string'&&UUID.test(published.work_id)?published.work_id:'');
    const checked=grade(verdict,evidence,work,context.preview_id??'');
    const reasons=[...checked.failures];
    if(context.work_id&&published&&published.work_id!==context.work_id)reasons.push('work_receipt_mismatch');
    if(verdict.publication==='unconfirmed'&&receipt?.published!==null)reasons.push('latest_receipt_not_unconfirmed');
    if(context.draft_id&&receipt&&receipt.draft_id!==context.draft_id)reasons.push('draft_receipt_mismatch');
    const snapshot=workSnapshot(cited,work).state;
    if(context.draft_id&&snapshot&&snapshot.draft_id!==context.draft_id)reasons.push('draft_work_mismatch');
    if(snapshot&&receipt&&snapshot.draft_id!==receipt.draft_id)reasons.push('work_receipt_draft_mismatch');
    const formal=published?.work_id===work&&Number.isSafeInteger(published.version)&&Number(published.version)>0;
    if(verdict.next_action==='open_work_detail'&&(!work||(!snapshot&&!formal)))reasons.push('work_navigation_unavailable');
    if(verdict.next_action==='check_original_result'&&!context.preview_id)reasons.push('original_identifier_missing');
    if(context.original_result_only&&verdict.next_action==='open_work_detail')reasons.push('original_result_scope');
    if(reasons.length)return fallback(context,reasons);
    const text:string[]=[];
    if(verdict.publication==='confirmed')text.push(`原预览回执确认正式版本${published!.version}曾发布；历史回执不代表当前审核或公开状态。`);
    else if(verdict.publication==='unconfirmed')text.push(receipt?.submission?'原预览有历史先审受理回执，尚不能确认正式发行；不能据此判断现在仍待审、已通过或已撤回。':'本次查询没有原发布确认；不能据此推断从未提交，也不要直接补发。');
    else text.push('本次尚不能确认原发布结果。');
    const errors=cited.filter(x=>x.result.status==='error').map(x=>(x.result as Extract<Evidence['result'],{status:'error'}>).error);
    if(errors.includes('resource_unavailable'))text.push('当前账号无法读取该资源，不能区分不存在或不属于本人。');
    if(errors.includes('tool_unavailable'))text.push('查询工具暂未取得可靠结果，查询失败不代表未发布。');
    if(errors.includes('authentication_required'))text.push('当前会话需要重新确认身份。');
    const catalog=cited.find(x=>x.tool==='find_my_works'&&x.result.status==='ok')?.result;
    if(catalog?.status==='ok'&&Array.isArray(catalog.data.items)&&catalog.data.items.length>1)text.push(`标题查询有${catalog.data.items.length}个候选，尚未明确具体作品。`);
    if(verdict.access!=='unknown'&&snapshot){
      if(!Number.isSafeInteger(snapshot.state_revision)||!Number.isSafeInteger(snapshot.display_version)||!Number.isSafeInteger(snapshot.last_version))return fallback(context,['invalid_snapshot_metadata']);
      const access={author_hidden:'作者已隐藏',work_limited:'作品层受限',display_limited:'当前展示版本受限',no_recorded_block:'未记录作者隐藏、作品限制或展示版本限制'};
      text.push(`状态修订${snapshot.state_revision}：${access[verdict.access]}；当前展示版本${snapshot.display_version}，最新正式版本${snapshot.last_version}。这是查询时点的状态。`);
    }else text.push('访问状态本次未确认。');
    const draft=cited.find(x=>x.tool==='read_draft_metadata'&&x.result.status==='ok'&&x.result.data.draft_id===context.draft_id)?.result;
    if(draft?.status==='ok'&&Number.isSafeInteger(draft.data.revision))text.push(`服务器工作稿修订${draft.data.revision}${receipt?`，原预览源修订${receipt.source_revision}`:''}；保存工作稿不等于更新正式版本。`);
    const actions:Record<string,string>={open_work_detail:'可到该作品详情核对。',check_original_result:'请保留原预览标识，核对原结果或已有提交记录。',provide_identifiers:'请补充或核对作品、原预览标识以明确对象。',contact_support:'请联系人工并提供原操作标识，不要重复提交。'};
    text.push(actions[verdict.next_action]);
    return {version:deliveryVersion,status:'admitted',free_text_used:false,reasons:[],verdict:{...verdict,explanation:text.join('')}};
  }catch{return fallback(context,['invalid_diagnostic_output']);}
}
