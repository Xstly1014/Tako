import path from 'node:path';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {BudgetLedger} from '../src/budget.ts';
// No key/network; only a matching durable usage receipt can resolve a hold.
let ledger:BudgetLedger|undefined;
try{
  const root=fileURLToPath(new URL('../../../',import.meta.url)),file=path.join(root,'.runtime/author-agent/budget.sqlite');
  if(!existsSync(file))throw Error('ledger_missing');
  ledger=new BudgetLedger(file);
  const [action,id,hash,actor,...extra]=process.argv.slice(2);
  if(action==='pending'&&!id)console.log(JSON.stringify(ledger.pending(),null,2));
  else if(action==='inspect'&&id&&!hash)console.log(JSON.stringify(ledger.inspect(id),null,2));
  else if(action==='reconcile'&&id&&hash&&actor&&!extra.length)console.log(JSON.stringify(ledger.reconcile(id,hash,actor)));
  else throw Error('invalid_cli');
}catch{console.error('budget_action_rejected');process.exitCode=1}finally{ledger?.close()}
