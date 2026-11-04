import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {cases,fixtureVersion,environment,referenceTrial} from '../src/cases.ts';
import {evaluate,digest,graderVersion} from '../src/evaluate.ts';
import {BudgetLedger} from '../src/budget.ts';
import {runAgent,type Progress} from '../src/agent.ts';

async function main(){
  const args=process.argv.slice(2);
  if(args.some((x,i)=>!['--model','--case','--json-mode'].includes(x)&&args[i-1]!=='--case'))throw Error('invalid_cli');
  const selected=args.includes('--case')?cases.filter(x=>x.id===args[args.indexOf('--case')+1]):cases;
  if(!selected.length)throw Error('invalid_case');
  const paid=args.includes('--model'),jsonMode=args.includes('--json-mode'),runId=randomUUID();
  const root=path.resolve('.runtime/author-agent/suites',runId);mkdirSync(root,{recursive:true});
  const files=['agent.ts','tools.ts','grade.ts','evaluate.ts','cases.ts','budget.ts','policy.md'];
  const hashes=Object.fromEntries(files.map(x=>[x,createHash('sha256').update(readFileSync(new URL('../src/'+x,import.meta.url))).digest('hex')]));
  hashes['package-lock.json']=createHash('sha256').update(readFileSync(new URL('../package-lock.json',import.meta.url))).digest('hex');
  hashes['scripts/suite.ts']=createHash('sha256').update(readFileSync(import.meta.filename)).digest('hex');
  const version={git_head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),source_hashes:hashes,fixture_version:fixtureVersion,grader_version:graderVersion,json_mode:jsonMode};
  const outcomes:{case_id:string;status:string;automatic_passed?:boolean}[]=[];
  const ledger=new BudgetLedger(path.resolve('.runtime/author-agent/budget.sqlite'));
  const save=(name:string,value:unknown)=>writeFileSync(path.join(root,name+'.json'),JSON.stringify(value,null,2),{mode:0o600});
  try{
    save('manifest',{run_id:runId,kind:paid?'real_model_controlled_transport_development_suite':'reference_fixture_validation',source:'synthetic_tako_policy_tasks',held_out:false,version,selected:selected.map(x=>({id:x.id,case_sha256:digest(x)}))});
    for(const task of selected){
      const events:Progress[]=[];
      const artifact:Record<string,unknown>={schema_version:1,run_id:runId,case_id:task.id,case_sha256:digest(task),synthetic_only:true,model_called:paid,environment:'controlled_transport_no_database',version,status:'running',events};
      save(task.id,artifact);
      try{
        const env=environment(task);
        const trial=paid?await runAgent(task.prompt,env.tools,ledger,runId,event=>{events.push(event);save(task.id,artifact)},{jsonMode}):await referenceTrial(task);
        const result=evaluate(task,trial.verdict,trial.evidence);
        Object.assign(artifact,{status:'completed',verdict:trial.verdict,evidence:trial.evidence,grade:result,budget:ledger.summary(runId),...('provider' in trial&&'usage' in trial?{provider:trial.provider,usage:trial.usage}:{}),human_review:{status:'pending'},review_binding:digest({case:task,verdict:trial.verdict,evidence:trial.evidence,version})});
        save(task.id,artifact);
        outcomes.push({case_id:task.id,status:'completed',automatic_passed:result.automatic_passed});
        console.log(`${task.id}: automatic=${result.automatic_passed?'pass':'fail'} human=pending`);
        if(!result.automatic_passed)process.exitCode=1;
      }catch(error){
        const known=['provider_call_unconfirmed','requested_model_unavailable','missing_deepseek_key','budget_exceeded','unresolved_provider_charge','request_size_budget','agent_output_incomplete','agent_output_not_json','agent_output_schema','tool_call_budget','model_turn_budget'];
        const code=error instanceof Error&&known.includes(error.message)?error.message:'trial_infrastructure_failure';
        Object.assign(artifact,{status:'incomplete',error:code,budget:ledger.summary(runId)});save(task.id,artifact);
        outcomes.push({case_id:task.id,status:'incomplete'});process.exitCode=1;
        console.log(`${task.id}: incomplete=${code}`);
        // Never hide a failed trial or start more paid requests after failure.
        break;
      }
    }
  }finally{
    save('summary',{run_id:runId,version,model_called:paid,selected:selected.length,completed:outcomes.filter(x=>x.status==='completed').length,automatic_passed:outcomes.filter(x=>x.automatic_passed).length,human_reviewed:0,outcomes,budget:ledger.summary(runId)});
    console.log(`run=${runId} model=${paid} completed=${outcomes.filter(x=>x.status==='completed').length}/${selected.length} upper_estimate_cny=${ledger.summary(runId).upper_estimate_cny}`);
    ledger.close();
  }
}
main().catch(()=>{console.error('suite_setup_failed');process.exitCode=1});
