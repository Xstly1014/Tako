import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {cases} from '../src/cases.ts';
import {contextFromInput,deliveryVersion,type Delivery} from '../src/delivery.ts';
import {deliver} from '../src/recovery.ts';
import {evaluate,digest,graderVersion} from '../src/evaluate.ts';
import {parseVerdict} from '../src/grade.ts';

try{
  const original=path.resolve(process.argv[2]);
  const source=JSON.parse(readFileSync(path.join(original,'manifest.json'),'utf8'));
  if(source.kind!=='real_model_controlled_transport_development_suite')throw Error('source_kind');
  const runId=randomUUID(),root=path.resolve('.runtime/author-agent/delivery-runs',runId);
  const files=['delivery.ts','grade.ts','evaluate.ts','diagnostic.ts','recovery.ts','follow-up.ts'];
  const hashes=Object.fromEntries(files.map(x=>[x,createHash('sha256').update(readFileSync(new URL('../src/'+x,import.meta.url))).digest('hex')]));
  hashes['scripts/delivery-replay.ts']=createHash('sha256').update(readFileSync(import.meta.filename)).digest('hex');
  const version={git_head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),source_hashes:hashes,grader_version:graderVersion,delivery_version:deliveryVersion};
  mkdirSync(root,{recursive:true});
  const save=(name:string,v:unknown)=>writeFileSync(path.join(root,name+'.json'),JSON.stringify(v,null,2),{flag:'wx',mode:0o600});
  const rows:{case_id:string;status:Delivery['status'];verification:Delivery['verification'];corrected_fields?:string[];reasons:string[];raw_automatic_passed:boolean;delivery_goal_passed:boolean}[]=[];
  for(const selected of source.selected){
    const task=cases.find(x=>x.id===selected.id);
    if(!task||selected.case_sha256!==digest(task))throw Error('source_case_changed');
    const artifact=JSON.parse(readFileSync(path.join(original,task.id+'.json'),'utf8'));
    if(artifact.status!=='completed'||artifact.synthetic_only!==true||!Array.isArray(artifact.evidence))throw Error('source_incomplete');
    const verdict=parseVerdict(JSON.stringify(artifact.verdict));
    if(artifact.review_binding!==digest({case:task,verdict,evidence:artifact.evidence,version:artifact.version}))throw Error('source_binding_changed');
    const delivery=deliver(contextFromInput(task.prompt),verdict,artifact.evidence);
    const grade=evaluate(task,delivery.verdict,artifact.evidence);
    save(task.id,{status:'completed',case_id:task.id,case_sha256:digest(task),synthetic_only:true,model_called:false,environment:'offline_delivery_replay_no_provider_or_database',source_run:source.run_id,source_review_binding:artifact.review_binding,raw_verdict:verdict,raw_grade:artifact.grade,delivery,verdict:delivery.verdict,evidence:artifact.evidence,grade,version,review_binding:digest({case:task,verdict:delivery.verdict,evidence:artifact.evidence,version}),human_review:{status:'pending'}});
    rows.push({case_id:task.id,status:delivery.status,verification:delivery.verification,corrected_fields:delivery.corrected_fields,reasons:delivery.reasons,raw_automatic_passed:artifact.grade.automatic_passed,delivery_goal_passed:grade.automatic_passed});
    console.log(`${task.id}: ${delivery.status} delivery_goal=${grade.automatic_passed}`);
  }
  save('manifest',{run_id:runId,kind:'offline_delivery_replay_of_real_model_outputs',source_run:source.run_id,source:'synthetic_tako_policy_tasks',held_out:false,model_called:false,version,selected:source.selected});
  save('summary',{run_id:runId,source_run:source.run_id,model_called:false,version,selected:rows.length,admitted:rows.filter(x=>x.status==='admitted').length,recovered:rows.filter(x=>x.status==='recovered').length,fallback:rows.filter(x=>x.status==='fallback').length,verification:Object.fromEntries(['facts_checked','needs_clarification','unable_to_check'].map(k=>[k,rows.filter(x=>x.verification===k).length])),raw_automatic_passed:rows.filter(x=>x.raw_automatic_passed).length,delivery_goal_passed:rows.filter(x=>x.delivery_goal_passed).length,human_reviewed:0,rows});
  console.log(`run=${runId} model_called=false`);
  if(rows.some(x=>!x.delivery_goal_passed))process.exitCode=1;
}catch{console.error('delivery_replay_invalid_or_incomplete');process.exitCode=1}
