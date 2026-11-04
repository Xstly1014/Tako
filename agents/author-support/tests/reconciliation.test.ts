import test from 'node:test';
import assert from 'node:assert/strict';
import {BudgetLedger,sha256,type UsageReceipt} from '../src/budget.ts';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
const hash=sha256('synthetic request');
const receipt:UsageReceipt={response_id:'synthetic-response-1',model:'deepseek-flash',prompt_tokens:100,completion_tokens:10,observed_at:'2026-11-05T00:00:00Z',source:'controlled_test'};
test('lost-response usage receipt survives restart, reconciles atomically, retains charge and rejects duplicate replacement',()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'tako-reconcile-'));
  let ledger=new BudgetLedger(path.join(directory,'budget.sqlite'));
  try{
    const id=ledger.reserve('lost',hash),proof=ledger.recordReceipt(id,hash,receipt);
    assert.equal(ledger.recordReceipt(id,hash,{...receipt,observed_at:'2026-11-05T00:00:01Z'}),proof);
    assert.throws(()=>ledger.recordReceipt(id,hash,{...receipt,prompt_tokens:101}),/receipt_conflict/);
    ledger.unknown(id);
    ledger.close();ledger=new BudgetLedger(path.join(directory,'budget.sqlite'));
    assert.throws(()=>ledger.reserve('another'),/unresolved/);
    assert.throws(()=>ledger.reconcile(id,sha256('wrong'),'test_actor'),/receipt_required/);
    assert.equal(ledger.summary('lost').unresolved,1);
    const result=ledger.reconcile(id,proof,'test_actor');assert.equal(result.upper_estimate_cny,.00028);
    const detail=ledger.inspect(id);assert.equal(detail.audit!.prior_state,'unknown');assert.equal(detail.invoice_verified,false);
    assert.equal(ledger.summary('lost').unresolved,0);assert.equal(ledger.summary('lost').calls,1);
    assert.equal(ledger.reconcile(id,proof,'test_actor').duplicate,true);
    assert.throws(()=>ledger.reconcile(id,sha256('replacement'),'test_actor'),/conflict/);
    const next=ledger.reserve('new',sha256('next'));
    assert.throws(()=>ledger.recordReceipt(next,sha256('bad'),receipt),/correlation/);
    assert.throws(()=>ledger.recordReceipt(next,sha256('next'),receipt)); // response ID cannot pay for two calls
    ledger.settle(next,1,1);
  }finally{ledger.close();assert.equal(path.dirname(directory),path.resolve(tmpdir()));assert.ok(path.basename(directory).startsWith('tako-reconcile-'));rmSync(directory,{recursive:true})}
});
test('no receipt means no release; exact pending receipt is required for old reserved calls too',()=>{
  const ledger=new BudgetLedger(':memory:');
  try{
    const id=ledger.reserve('crashed',hash);
    assert.throws(()=>ledger.reconcile(id,hash,'actor'),/receipt_required/);
    assert.throws(()=>ledger.reserve('new'),/unresolved/);
    const proof=ledger.recordReceipt(id,hash,receipt);
    assert.throws(()=>ledger.settle(id,1,1),/usage_receipt_mismatch/);
    assert.equal(ledger.reconcile(id,proof,'actor').duplicate,false);
    assert.equal(ledger.pending().length,0);
    assert.throws(()=>ledger.recordReceipt(id,hash,receipt),/correlation/);
    const legacy=ledger.reserve('legacy');ledger.unknown(legacy);
    assert.throws(()=>ledger.recordReceipt(legacy,hash,receipt),/correlation/);
    assert.throws(()=>ledger.reconcile(legacy,proof,'actor'),/receipt_required/);
    assert.equal(ledger.summary('legacy').unresolved,1);
  }finally{ledger.close()}
});
