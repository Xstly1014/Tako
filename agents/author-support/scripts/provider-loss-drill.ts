import OpenAI from 'openai';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {BudgetLedger,sha256} from '../src/budget.ts';
import {diagnose} from '../src/diagnostic.ts';
import {createAuthorTools} from '../src/tools.ts';
import {captureSources} from '../src/provenance.ts';

async function main(){
  if(!process.env.DEEPSEEK_API_KEY)throw Error('missing_key');
  const run=randomUUID(),root=path.resolve('.runtime/author-agent/accounting-runs',run);mkdirSync(root,{recursive:true});
  const sources=captureSources(root),file=path.resolve('.runtime/author-agent/budget.sqlite');
  if(!existsSync(file))throw Error('existing_ledger_required');
  let ledger=new BudgetLedger(file),charge='',requestHash='',capturedHash='',chatRequests=0;
  const report:Record<string,unknown>={run_id:run,kind:'real_provider_response_loss_controlled_drill',source_bundle:sources,status:'started',invoice_verified:false};
  const save=()=>writeFileSync(path.join(root,'report.json'),JSON.stringify(report,null,2),{mode:0o600});
  const noTools=createAuthorTools(async()=>{throw Error('drill_must_not_read_business')});
  const prompt='我暂时没有任何作品ID或原预览ID。不要查询工具，只告诉我需要补充标识。';
  try{
    assert.equal(ledger.pending().length,0,'unresolved charge must be reviewed first');
    await ledger.snapshot(path.join(root,'ledger-before.sqlite'));
    const balance=await fetch('https://api.deepseek.com/user/balance',{headers:{Authorization:'Bearer '+process.env.DEEPSEEK_API_KEY},signal:AbortSignal.timeout(15000)});
    if(!balance.ok||(await balance.json()).is_available!==true)throw Error('provider_unavailable');
    report.balance_preflight_available=true;save();
    const client=new OpenAI({apiKey:process.env.DEEPSEEK_API_KEY,baseURL:'https://api.deepseek.com',maxRetries:0,timeout:30000,logLevel:'off',fetch:async(input,init)=>{
      const url=new URL(String(input));
      if(url.origin!=='https://api.deepseek.com'||!['/models','/chat/completions'].includes(url.pathname))throw Error('unexpected_provider_path');
      if(url.pathname==='/models')return fetch(input,init);
      assert.equal(++chatRequests,1,'no retry after response loss');
      assert.ok(charge&&requestHash);
      assert.equal(typeof init?.body,'string');
      assert.equal(sha256(JSON.stringify(JSON.parse(init!.body as string))),requestHash);
      const response=await fetch(input,init);
      if(!response.ok)return response;
      const value=await response.clone().json();
      capturedHash=ledger.recordReceipt(charge,requestHash,{response_id:value.id,model:value.model,prompt_tokens:value.usage?.prompt_tokens,completion_tokens:value.usage?.completion_tokens,observed_at:new Date().toISOString(),source:'live_transport_capture'});
      // The provider completed; the SDK deliberately never receives its body.
      // Only whitelisted receipt metadata was saved, no answer/reasoning/body.
      throw Error('controlled_response_loss_after_receipt_capture');
    }});
    const failed=await diagnose(prompt,noTools,ledger,run,undefined,{client,jsonMode:true,onReserved:(id,hash)=>{charge=id;requestHash=hash}});
    assert.equal(failed.status,'incomplete');if(failed.status==='incomplete')assert.equal(failed.failure,'provider_call_unconfirmed');
    assert.ok(capturedHash);assert.equal(chatRequests,1);assert.equal(ledger.summary(run).unresolved,1);
    report.charge_id=charge;report.receipt_sha256=capturedHash;report.after_loss=ledger.summary(run);save();
    ledger.close();ledger=new BudgetLedger(file);
    assert.throws(()=>ledger.reserve(run+'-blocked'),/unresolved_provider_charge/);
    report.restart_blocked=true;save();
    report.reconciliation=ledger.reconcile(charge,capturedHash,'live_drill_runner');
    report.reconciliation_duplicate=ledger.reconcile(charge,capturedHash,'live_drill_runner').duplicate;
    assert.equal(ledger.summary(run).unresolved,0);save();
    const resumed=await diagnose(prompt,noTools,ledger,run,undefined,{jsonMode:true});
    report.resume_status=resumed.status;
    assert.equal(resumed.status,'completed');assert.equal(noTools.trace().length,0);
    report.status='passed';report.budget=ledger.summary(run);report.business_tools_called=0;save();
    await ledger.snapshot(path.join(root,'ledger-after.sqlite'));
    console.log(`PASS live provider loss/restart/receipt reconciliation/resume: run=${run} upper_estimate_cny=${ledger.summary(run).upper_estimate_cny}`);
  }catch{
    report.status='failed';report.budget=ledger.summary(run);report.pending=ledger.pending();save();
    console.error(`FAIL provider drill: run=${run}; inspect local metadata; do not clear ledger`);process.exitCode=1;
  }finally{ledger.close()}
}
main().catch(()=>{console.error('provider_drill_setup_failed');process.exitCode=1});
