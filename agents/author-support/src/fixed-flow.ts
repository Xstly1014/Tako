import {limits} from './budget.ts';
import {contextFromInput} from './delivery.ts';
import {workSnapshot,type Evidence,type Verdict} from './grade.ts';
import {deliver} from './recovery.ts';
import type {createAuthorTools} from './tools.ts';

// A bounded lookup with the same request context and delivery checks as the Agent.
// It consumes only the request and observed tool results.
export async function runFixedFlow(input:string,tools:Pick<ReturnType<typeof createAuthorTools>,'invoke'>){
  const context=contextFromInput(input);
  const evidence:Evidence[]=[];
  let cited=evidence;
  let blocked=false;
  async function read(tool:string,args:Record<string,unknown>){
    if(blocked||evidence.length>=limits.max_tool_calls)return;
    const result=await tools.invoke(tool,args);
    evidence.push({tool,result});
    if(result.status==='ok')return result.data;
    blocked=['authentication_required','forbidden','rate_limited'].includes(result.error);
  }

  const verdict:Verdict={
    publication:'unknown',access:'unknown',next_action:'provide_identifiers',
    evidence_ids:[],explanation:'按原标识和本人作品状态核对。',
  };
  if(!context.ambiguous_identifiers){
    const {preview_id,draft_id}=context;
    const receipt=preview_id?await read('read_publication_result',{preview_id}):undefined;
    const published=receipt?.published as {work_id:string}|null|undefined;
    const work_id=context.work_id??published?.work_id;
    if(preview_id)verdict.next_action='check_original_result';
    if(receipt?.published===null)verdict.publication='unconfirmed';
    if(published)verdict.publication='confirmed';

    if(!context.original_result_only){
      if(draft_id)await read('read_draft_metadata',{draft_id});
      if(work_id){
        let page=await read('read_work_state',{work_id});
        let before=Infinity;
        while(page?.display_limited===null){
          const cursor=Number(page.next_version_before);
          if(!Number.isSafeInteger(cursor)||cursor<=0||cursor>=before)break;
          before=cursor;
          page=await read('read_work_state',{work_id,before_version:cursor});
        }
        const {state}=workSnapshot(evidence,work_id);
        if(state?.author_hidden===true)verdict.access='author_hidden';
        else if(state?.work_limited===true)verdict.access='work_limited';
        else if(state?.display_limited===true)verdict.access='display_limited';
        else if(state?.display_limited===false)verdict.access='no_recorded_block';
        if((state||published)&&!receipt?.submission)verdict.next_action='open_work_detail';
      }else if(!preview_id&&!draft_id){
        const title=input.match(/《([^》]+)》/)?.[1];
        if(title)await read('find_my_works',{query:title});
      }
    }
    const unavailable=evidence.filter(x=>x.result.status==='error'&&x.result.error==='resource_unavailable');
    const pairUnreadable=!context.original_result_only&&context.work_id&&preview_id&&
      unavailable.some(x=>x.tool==='read_publication_result'||x.tool==='read_work_state');
    if(pairUnreadable)cited=unavailable;
    if(pairUnreadable||(unavailable.length>0&&unavailable.length===evidence.length)){
      verdict.publication='unknown';
      verdict.access='unknown';
      verdict.next_action='provide_identifiers';
    }
  }
  verdict.evidence_ids=cited.map(x=>x.result.evidence_id);
  const delivery=deliver(context,verdict,evidence);
  return {verdict,evidence,delivery};
}
