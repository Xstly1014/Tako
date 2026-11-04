import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {cases} from '../src/cases.ts';
import {digest,evaluate} from '../src/evaluate.ts';
import {parseVerdict} from '../src/grade.ts';

// Explicit review input, no default pass and no edits to original run artifacts.
try{
  const directory=path.resolve(process.argv[2]);
  const review=JSON.parse(readFileSync(process.argv[3],'utf8'));
  const manifest=JSON.parse(readFileSync(path.join(directory,'manifest.json'),'utf8'));
  if(review.run_id!==manifest.run_id||typeof review.reviewer!=='string'||!review.reviewer.trim()||!Array.isArray(review.items)||new Set(review.items.map((x:{case_id:string})=>x.case_id)).size!==review.items.length)throw Error('review_schema');
  const rows=[];
  for(const item of review.items){
    const task=cases.find(x=>x.id===item.case_id);
    if(!task||!manifest.selected.some((x:{id:string})=>x.id===task.id))throw Error('review_case');
    const artifact=JSON.parse(readFileSync(path.join(directory,task.id+'.json'),'utf8'));
    if(artifact.status!=='completed'||artifact.synthetic_only!==true||artifact.case_sha256!==digest(task))throw Error('review_incomplete');
    const verdict=parseVerdict(JSON.stringify(artifact.verdict));
    const binding=digest({case:task,verdict,evidence:artifact.evidence,version:artifact.version});
    if(item.review_binding!==binding||artifact.review_binding!==binding)throw Error('review_stale');
    if(typeof item.notes!=='string'||!item.notes.trim()||!item.criteria||Object.keys(item.criteria).sort().join(',')!=='advice_safe,answers_question,factual,uncertainty'||Object.values(item.criteria).some(x=>typeof x!=='boolean'))throw Error('review_criteria');
    const automatic=evaluate(task,verdict,artifact.evidence);
    const human=Object.values(item.criteria).every(x=>x===true);
    rows.push({case_id:task.id,review_binding:binding,automatic,human_passed:human,passed:automatic.automatic_passed&&human,criteria:item.criteria,notes:item.notes});
  }
  const result={run_id:manifest.run_id,reviewer:review.reviewer,reviewed_at:new Date().toISOString(),selected:manifest.selected.length,reviewed:rows.length,passed:rows.filter(x=>x.passed).length,unreviewed:manifest.selected.length-rows.length,rows};
  writeFileSync(path.join(directory,'human-review.json'),JSON.stringify(result,null,2),{flag:'wx',mode:0o600});
  console.log(JSON.stringify({reviewed:result.reviewed,passed:result.passed,unreviewed:result.unreviewed}));
  if(result.rows.some(x=>!x.passed))process.exitCode=1;
}catch{console.error('review_invalid_stale_or_already_exists');process.exitCode=1}
