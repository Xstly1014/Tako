import type {Delivery} from './delivery.ts';
import type {ToolResult} from './tools.ts';

// Only summarize the record selected by the original receipt.
export function submissionAnswer(delivery:Delivery,result:ToolResult|null|undefined):string{
  const step=delivery.next_step;
  if(step?.kind!=='read_submission_record'||!result)return delivery.verdict.explanation;
  if(result.status==='error')return delivery.verdict.explanation+'本次未能读取该提交的当前状态。';
  const data=result.data;
  if(data.submission_id!==step.submission_id)return delivery.verdict.explanation;

  const accepted='原提交已受理。';
  switch(data.state){
    case 'pending':
      return accepted+'当前仍在等待审核，可在原提交记录查看后续结果。';
    case 'withdrawn':
      return accepted+'该提交已撤回。可返回工作稿核对后续改动。';
    case 'rejected':
      return accepted+'该提交已驳回，可打开原提交记录查看原因。';
    case 'superseded':{
      const pending=data.current_pending_for_work as {status?:string}|undefined;
      const replaced=accepted+'该提交已被替换。';
      if(pending?.status==='found')return replaced+'同一作品有当前待审记录，可用返回的预览编号继续查看。';
      if(pending?.status==='none_observed')return replaced+'本次查询未发现该作品还有待审记录。';
      return replaced+'本次未能确认该作品是否还有待审记录。';
    }
    case 'published':{
      const version=data.published_version;
      if(typeof version!=='number'||!Number.isSafeInteger(version)||version<=0)return delivery.verdict.explanation;
      const published=accepted+`该提交已通过并发行 V${version}。`;
      const reader=data.reader_visibility as {status?:string;displayedVersion?:number;blocker?:string}|undefined;
      if(reader?.status==='visible'&&Number.isSafeInteger(reader.displayedVersion)){
        return published+`匿名读者当前能打开作品，看到的是 V${reader.displayedVersion}。`;
      }
      if(reader?.status==='not_visible'){
        const blocked='匿名读者当前无法打开作品。';
        if(reader.blocker==='author_hidden')return published+blocked+'作者隐藏仍然生效，可在作品详情核对。';
        if(reader.blocker==='work_limited'||reader.blocker==='display_limited'){
          const scope=reader.blocker==='work_limited'?'作品':'当前展示版';
          return published+blocked+`${scope}存在访问限制，可在处置记录查看。`;
        }
        return published+blocked+'可在作品详情核对当前状态。';
      }
      if(reader?.status==='changed')return published+'核验期间作品状态发生变化，请重新查询读者结果。';
      return published+'本次未能确认读者当前看到的内容，可重新查询。';
    }
    default:
      return delivery.verdict.explanation;
  }
}
