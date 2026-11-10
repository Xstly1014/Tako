import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {BudgetLedger} from '../src/budget.ts';
import {fixtureVersion} from '../src/cases.ts';
import {developmentScenarios,runScenario} from '../src/comparison.ts';
import {deliveryVersion} from '../src/delivery.ts';
import {diagnose} from '../src/diagnostic.ts';
import {digest,graderVersion} from '../src/evaluate.ts';
import {runFixedFlow} from '../src/fixed-flow.ts';
import type {Evidence} from '../src/grade.ts';
import {holdoutScenarios} from '../src/holdout.ts';
import {captureSources} from '../src/provenance.ts';

async function main(){
  const args=process.argv.slice(2);
  if(new Set(args).size!==args.length||args.some(arg=>!['--model','--holdout'].includes(arg)))throw Error('invalid_cli');
  const paid=args.includes('--model'),runId=randomUUID();
  const holdout=args.includes('--holdout');
  const scenarios=holdout?holdoutScenarios:developmentScenarios;
  const repetitions=holdout?3:1;
  const trials=Array.from({length:repetitions},(_,i)=>scenarios.map(scenario=>({
    scenario,repeat:i+1,key:holdout?`${scenario.id}-${i+1}`:scenario.id,
  }))).flat();
  const root=path.resolve('.runtime/author-agent/comparisons',runId);
  mkdirSync(root,{recursive:true});
  const save=(name:string,value:unknown)=>writeFileSync(path.join(root,name+'.json'),JSON.stringify(value,null,2),{mode:0o600});
  const manifest={
    run_id:runId,paid,environment:'controlled_transport_no_database',split:holdout?'holdout':'development',json_mode:true,repetitions,
    git_head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
    fixture_version:fixtureVersion,grader_version:graderVersion,delivery_version:deliveryVersion,
    source_bundle:captureSources(root),
    scenarios:scenarios.map(scenario=>({id:scenario.id,sha256:digest(scenario)})),
  };
  save('manifest',manifest);
  const ledger=paid?new BudgetLedger(path.resolve('.runtime/author-agent/budget.sqlite')):null;
  const completed:string[]=[];
  try{
    for(const {scenario,repeat,key} of trials){
      const fixed=await runScenario(scenario,runFixedFlow);
      save(key,{scenario:scenario.id,repeat,fixed,agent:null});
      const agent=ledger?await runScenario(scenario,async(input,tools)=>{
        const evidence:Evidence[]=[];
        const result=await diagnose(input,tools,ledger,runId,event=>{
          if(event.kind==='tool')evidence.push(event.evidence);
        },{jsonMode:true});
        if(result.status==='incomplete')return {failure:result.failure,evidence,delivery:result.delivery};
        return result.trial;
      }):null;
      save(key,{scenario:scenario.id,repeat,fixed,agent});
      completed.push(key);
      console.log(`${key} fixed=${fixed.automatic_passed} agent=${agent?.automatic_passed??'not_run'} human=pending`);
      const failure=agent?.turns.find(turn=>turn.failure)?.failure;
      if(failure){console.log(`paid_batch_stopped=${failure}`);process.exitCode=1;break}
    }
  }finally{
    const budget=ledger?.summary(runId)??null;
    save('summary',{run_id:runId,completed,not_run:trials.map(x=>x.key).filter(id=>!completed.includes(id)),budget});
    ledger?.close();
    console.log(`run=${runId} completed=${completed.length}/${trials.length} estimated_cny=${budget?.upper_estimate_cny??0}`);
  }
}
main().catch(()=>{console.error('comparison_setup_or_artifact_failed');process.exitCode=1});
