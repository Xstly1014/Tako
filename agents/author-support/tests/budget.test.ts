import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {BudgetLedger,reserveMicros} from "../src/budget.ts";
test("budget reservation survives reopen, uncertain charges block further spending, duplicate settlement rejected",()=>{
  const directory=mkdtempSync(path.join(tmpdir(),"tako-agent-budget-"));
  let ledger=new BudgetLedger(path.join(directory,"ledger.sqlite"));
  try{
    const first=ledger.reserve('run');ledger.settle(first,1000,100);
    assert.throws(()=>ledger.settle(first,1000,100),/invalid_charge_state/);
    assert.equal(ledger.summary('run').upper_estimate_cny,.0028);
    const second=ledger.reserve('run');ledger.close();ledger=new BudgetLedger(path.join(directory,"ledger.sqlite"));
    assert.throws(()=>ledger.reserve('new-run'),/unresolved_provider_charge/);
    ledger.unknown(second);assert.equal(ledger.summary('run').unresolved,1);
    assert.equal(ledger.summary('run').upper_estimate_cny,(2800+reserveMicros)/1_000_000);
  }finally{
    ledger.close();assert.equal(path.dirname(directory),path.resolve(tmpdir()));assert.ok(path.basename(directory).startsWith('tako-agent-budget-'));rmSync(directory,{recursive:true});
  }
});
test("per-run limit stops reservations and invalid usage does not release a reservation",()=>{
  const ledger=new BudgetLedger(':memory:');
  try{
    for(let n=0;n<18;n++){const id=ledger.reserve('run');ledger.settle(id,50000,768);}
    assert.throws(()=>ledger.reserve('run'),/budget_exceeded/);
    const id=ledger.reserve('other');assert.throws(()=>ledger.settle(id,-1,2),/invalid_usage/);
    assert.throws(()=>ledger.reserve('other'),/unresolved_provider_charge/);
  }finally{ledger.close();}
});
