import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {cases,referenceTrial} from '../src/cases.ts';
import {digest} from '../src/evaluate.ts';

test('replay and review reject changed evidence, incomplete trials and stale human approvals',async()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'tako-eval-review-'));
  try{
    const task=cases[0],trial=await referenceTrial(task),version={grader_version:'test-original'};
    const binding=digest({case:task,verdict:trial.verdict,evidence:trial.evidence,version});
    const artifact={case_id:task.id,status:'completed',synthetic_only:true,case_sha256:digest(task),...trial,version,review_binding:binding};
    const save=(name:string,value:unknown)=>writeFileSync(path.join(directory,name+'.json'),JSON.stringify(value));
    const run=(script:string,args:string[])=>spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/'+script+'.ts',import.meta.url)),...args],{encoding:'utf8'});
    save('hidden',artifact);
    assert.equal(run('replay',[path.join(directory,'hidden.json')]).status,0);
    save('hidden',{...artifact,verdict:{...trial.verdict,explanation:'changed'}});
    assert.equal(run('replay',[path.join(directory,'hidden.json')]).status,1);
    save('hidden',{...artifact,status:'incomplete'});
    assert.equal(run('replay',[path.join(directory,'hidden.json')]).status,1);
    save('hidden',artifact);save('manifest',{run_id:'test',kind:'reference_fixture_validation',selected:[{id:'hidden'}]});
    const review={run_id:'test',reviewer:'test-only',items:[{case_id:'hidden',review_binding:'stale',criteria:{factual:true,answers_question:true,advice_safe:true,uncertainty:true},notes:'explicit review'}]};
    save('input',review);
    assert.equal(run('review',[directory,path.join(directory,'input.json')]).status,1);
    review.items[0].review_binding=binding;review.items[0].criteria.factual=false;save('input',review);
    assert.equal(run('review',[directory,path.join(directory,'input.json')]).status,1);
    const result=JSON.parse(readFileSync(path.join(directory,'human-review.json'),'utf8'));
    assert.equal(result.passed,0);assert.equal(result.reviewed,1);
    assert.equal(run('review',[directory,path.join(directory,'input.json')]).status,1);
  }finally{
    const relative=path.relative(path.resolve(tmpdir()),path.resolve(directory));
    assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));
    rmSync(directory,{recursive:true,force:true});
  }
});
