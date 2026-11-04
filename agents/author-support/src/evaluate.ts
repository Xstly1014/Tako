import {createHash} from 'node:crypto';
import {grade,type Verdict,type Evidence} from './grade.ts';
import {ids,type Case} from './cases.ts';

export const graderVersion='business-evidence-v3';
export const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function evaluate(task:Case,verdict:Verdict,evidence:Evidence[]){
  const facts=grade(verdict,evidence,ids.work,ids.preview);
  const failures=[...facts.failures];
  if(verdict.publication!==task.expected.publication)failures.push('publication_goal_not_met');
  // Unknown is the minimum expectation when access is outside task scope;
  // additional claims remain subject to the evidence grader, not exact labels.
  if(task.expected.access!=='unknown'&&verdict.access!==task.expected.access)failures.push('access_goal_not_met');
  if(!task.actions.includes(verdict.next_action))failures.push('next_action_goal_not_met');
  const cited=evidence.filter(x=>verdict.evidence_ids.includes(x.result.evidence_id));
  const data=(tool:string)=>cited.filter(x=>x.tool===tool&&x.result.status==='ok').map(x=>(x.result as Extract<Evidence['result'],{status:'ok'}>).data);
  const receipts=data('read_publication_result').filter(x=>x.preview_id===ids.preview);
  const states=data('read_work_state').filter(x=>x.work_id===ids.work);
  const assertions:Record<Case['assertions'][number],()=>boolean>={
    receipt:()=>receipts.length>0,
    state:()=>states.length>0,
    draft:()=>data('read_draft_metadata').some(x=>x.draft_id===ids.draft&&x.revision===2)&&receipts.some(x=>x.source_revision===1),
    older_display:()=>states.some(x=>x.display_version===1&&x.last_version===2),
    complete_display:()=>states.some(x=>x.display_version===1&&x.display_limited===true),
    ambiguity:()=>data('find_my_works').some(x=>Array.isArray(x.items)&&x.items.length>1),
    denied:()=>cited.some(x=>x.result.status==='error'&&x.result.error==='resource_unavailable'),
    unavailable:()=>cited.some(x=>x.tool==='read_publication_result'&&x.result.status==='error'&&x.result.error==='tool_unavailable'),
    acceptance:()=>receipts.some(x=>x.published===null&&x.submission!==null&&typeof x.submission==='object'),
  };
  for(const name of task.assertions)if(!assertions[name]())failures.push('missing_goal_evidence:'+name);
  return {grader_version:graderVersion,evidence_supported:facts.supported,automatic_passed:failures.length===0,failures,human_review_required:true};
}
