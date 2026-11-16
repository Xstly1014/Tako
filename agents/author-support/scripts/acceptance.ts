import {randomUUID} from 'node:crypto';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {loadAcceptanceRun,reviewTemplate,assessAcceptance,type AcceptanceReview} from '../src/acceptance.ts';

// Offline only: no provider client, sessions, server writes or release operation.
try{
  const args=process.argv.slice(2),values=new Map<string,string>();
  for(let i=0;i<args.length;i+=2){
    if(!['--run','--baseline','--review','--variant'].includes(args[i])||!args[i+1]||values.has(args[i]))throw Error('invalid_cli');
    values.set(args[i],args[i+1]);
  }
  const resolveRun=(value:string|undefined)=>{
    if(!value||!/^[0-9a-f-]{36}$/.test(value))throw Error('invalid_cli');
    return loadAcceptanceRun(path.resolve('.runtime/author-agent/comparisons',value));
  };
  const run=resolveRun(values.get('--run')),baseline=values.has('--baseline')?resolveRun(values.get('--baseline')):undefined;
  const variant=values.get('--variant')??'fixed';
  if(variant!=='fixed'&&variant!=='agent')throw Error('invalid_cli');
  const review=values.has('--review')?JSON.parse(readFileSync(values.get('--review')!,'utf8')) as AcceptanceReview:undefined;
  const assessment=assessAcceptance(run,variant,review,baseline);
  const output=path.resolve('.runtime/author-agent/acceptance',randomUUID());mkdirSync(output,{recursive:true});
  const save=(name:string,value:unknown)=>writeFileSync(path.join(output,name+'.json'),JSON.stringify(value,null,2),{flag:'wx',mode:0o600});
  save('intake',run);save('review-template',reviewTemplate(run));save('assessment',assessment);
  if(review)save('submitted-review',review);
  save('regressions',{version:1,source_run:run.run_id,environment:run.environment,items:assessment.failures});
  console.log(JSON.stringify({decision:assessment.decision,variant,completed:assessment.completed,expected:assessment.expected,
    automatic_passed:assessment.automatic_passed,pending_review:assessment.pending_review,failures:assessment.failures.length,output}));
  if(assessment.decision!=='accepted_regression_gate')process.exitCode=2;
}catch(error){
  const allowed=['invalid_cli','acceptance_artifact_invalid','acceptance_protocol_unsupported','acceptance_task_set_mismatch',
    'acceptance_source_changed','acceptance_protocol_source_changed','acceptance_saved_score_mismatch',
    'acceptance_comparison_protocol_mismatch','acceptance_review_invalid','acceptance_review_stale_or_duplicate'];
  console.error(error instanceof Error&&allowed.includes(error.message)?error.message:'acceptance_input_or_output_failed');process.exitCode=1;
}
