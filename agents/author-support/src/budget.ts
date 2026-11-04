import { DatabaseSync,backup } from "node:sqlite";
import {existsSync} from 'node:fs';
import { randomUUID,createHash } from "node:crypto";

// Peak CNY rates checked against official pricing on pricing.checked_at. Treat every
// prompt token as a cache miss and every period as peak: an upper estimate, not
// an invoice. This ledger only covers this runner, not other uses of the API key.
export const pricing={checked_at:"2026-11-05",input_micros_per_token:2,output_micros_per_token:8};
export const limits={project_micros:200_000_000,run_micros:2_000_000,max_request_bytes:48_000,max_output_tokens:768,max_model_calls:9,max_tool_calls:8};
export const reserveMicros=(limits.max_request_bytes+4096)*pricing.input_micros_per_token+limits.max_output_tokens*pricing.output_micros_per_token;
export const sha256=(v:string)=>createHash('sha256').update(v).digest('hex');
export type UsageReceipt={response_id:string;model:string;prompt_tokens:number;completion_tokens:number;observed_at:string;source:'sdk_response'|'live_transport_capture'|'controlled_test'};
const hashPattern=/^[0-9a-f]{64}$/;
function tokens(prompt:number,completion:number){if(!Number.isSafeInteger(prompt)||prompt<0||!Number.isSafeInteger(completion)||completion<0)throw Error('invalid_usage');}
export class BudgetLedger {
  private db:DatabaseSync;
  constructor(file:string){
    this.db=new DatabaseSync(file);
    this.db.exec("PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS charges(id TEXT PRIMARY KEY, run_id TEXT NOT NULL, reserved INTEGER NOT NULL, settled INTEGER, state TEXT NOT NULL CHECK(state IN ('reserved','settled','unknown')))");
    this.db.exec(`CREATE TABLE IF NOT EXISTS prepared_calls(charge_id TEXT PRIMARY KEY,request_sha256 TEXT NOT NULL,pricing_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS usage_receipts(charge_id TEXT PRIMARY KEY,response_id TEXT NOT NULL UNIQUE,request_sha256 TEXT NOT NULL,receipt_json TEXT NOT NULL,receipt_sha256 TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reconciliations(charge_id TEXT PRIMARY KEY,receipt_sha256 TEXT NOT NULL,cost_micros INTEGER NOT NULL,actor TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL,prior_state TEXT NOT NULL);`);
  }
  reserve(run:string,requestHash?:string){
    if(requestHash!==undefined&&!hashPattern.test(requestHash))throw Error('invalid_request_hash');
    this.db.exec("BEGIN IMMEDIATE");
    try{
      const unresolved=this.db.prepare("SELECT COUNT(*) AS n FROM charges WHERE state<>'settled'").get()!;
      if(Number(unresolved.n)>0)throw Error("unresolved_provider_charge");
      const used=Number(this.db.prepare("SELECT COALESCE(SUM(COALESCE(settled,reserved)),0) AS n FROM charges").get()!.n);
      const runUsed=Number(this.db.prepare("SELECT COALESCE(SUM(COALESCE(settled,reserved)),0) AS n FROM charges WHERE run_id=?").get(run)!.n);
      if(used+reserveMicros>limits.project_micros||runUsed+reserveMicros>limits.run_micros)throw Error("budget_exceeded");
      const id=randomUUID();this.db.prepare("INSERT INTO charges(id,run_id,reserved,state) VALUES(?,?,?,'reserved')").run(id,run,reserveMicros);
      if(requestHash)this.db.prepare('INSERT INTO prepared_calls VALUES(?,?,?)').run(id,requestHash,JSON.stringify(pricing));
      this.db.exec("COMMIT");return id;
    }catch(e){this.db.exec("ROLLBACK");throw e;}
  }
  settle(id:string,prompt:number,completion:number){
    const recorded=this.db.prepare('SELECT receipt_json FROM usage_receipts WHERE charge_id=?').get(id);
    if(recorded){const receipt=JSON.parse(String(recorded.receipt_json));if(receipt.prompt_tokens!==prompt||receipt.completion_tokens!==completion)throw Error('usage_receipt_mismatch');}
    const cost=this.cost(id,prompt,completion);
    if(cost>reserveMicros)throw Error("usage_exceeded_reservation");
    const updated=this.db.prepare("UPDATE charges SET settled=?,state='settled' WHERE id=? AND state='reserved'").run(cost,id);
    if(updated.changes!==1)throw Error("invalid_charge_state");
    return cost;
  }
  unknown(id:string){this.db.prepare("UPDATE charges SET state='unknown' WHERE id=? AND state='reserved'").run(id);}
  private cost(id:string,prompt:number,completion:number){
    tokens(prompt,completion);
    const prepared=this.db.prepare('SELECT pricing_json FROM prepared_calls WHERE charge_id=?').get(id);
    const rates=prepared?JSON.parse(String(prepared.pricing_json)):pricing;
    return prompt*rates.input_micros_per_token+completion*rates.output_micros_per_token;
  }
  recordReceipt(id:string,requestHash:string,receipt:UsageReceipt){
    if(!receipt)throw Error('invalid_provider_receipt');
    tokens(receipt.prompt_tokens,receipt.completion_tokens);
    if(!hashPattern.test(requestHash)||!receipt||!/^[A-Za-z0-9_-]{1,128}$/.test(receipt.response_id)||receipt.model!=='deepseek-flash'||!Number.isFinite(Date.parse(receipt.observed_at))||!['sdk_response','live_transport_capture','controlled_test'].includes(receipt.source))throw Error('invalid_provider_receipt');
    const prepared=this.db.prepare("SELECT p.request_sha256,c.state,c.reserved FROM prepared_calls p JOIN charges c ON c.id=p.charge_id WHERE c.id=?").get(id);
    if(!prepared||prepared.request_sha256!==requestHash||!['reserved','unknown'].includes(String(prepared.state)))throw Error('receipt_correlation_failed');
    if(this.cost(id,receipt.prompt_tokens,receipt.completion_tokens)>Number(prepared.reserved))throw Error('usage_exceeded_reservation');
    // Only whitelisted metadata is durable; no response text, headers or body.
    const safe:UsageReceipt={response_id:receipt.response_id,model:receipt.model,prompt_tokens:receipt.prompt_tokens,completion_tokens:receipt.completion_tokens,observed_at:receipt.observed_at,source:receipt.source};
    const json=JSON.stringify(safe),digest=sha256(json);
    const prior=this.db.prepare('SELECT receipt_sha256,receipt_json FROM usage_receipts WHERE charge_id=?').get(id);
    if(prior){
      const stored=JSON.parse(String(prior.receipt_json));
      if(['response_id','model','prompt_tokens','completion_tokens'].some(k=>stored[k]!==safe[k as keyof UsageReceipt]))throw Error('receipt_conflict');
      return String(prior.receipt_sha256); // Keep the first observation/source, don't replace it.
    }
    this.db.prepare('INSERT INTO usage_receipts VALUES(?,?,?,?,?)').run(id,safe.response_id,requestHash,json,digest);return digest;
  }
  pending(){return this.db.prepare("SELECT c.id,c.run_id,c.state,c.reserved,r.receipt_sha256,p.request_sha256 FROM charges c LEFT JOIN usage_receipts r ON r.charge_id=c.id LEFT JOIN prepared_calls p ON p.charge_id=c.id WHERE c.state<>'settled' ORDER BY c.rowid LIMIT 100").all();}
  inspect(id:string){
    const charge=this.db.prepare('SELECT * FROM charges WHERE id=?').get(id);if(!charge)throw Error('charge_not_found');
    const prepared=this.db.prepare('SELECT * FROM prepared_calls WHERE charge_id=?').get(id),receipt=this.db.prepare('SELECT * FROM usage_receipts WHERE charge_id=?').get(id),audit=this.db.prepare('SELECT * FROM reconciliations WHERE charge_id=?').get(id);
    return {charge,request_sha256:prepared?.request_sha256??null,pricing:prepared?JSON.parse(String(prepared.pricing_json)):null,receipt:receipt?JSON.parse(String(receipt.receipt_json)):null,receipt_sha256:receipt?.receipt_sha256??null,audit:audit??null,invoice_verified:false};
  }
  reconcile(id:string,expectedHash:string,actor:string){
    if(!hashPattern.test(expectedHash)||!/^[A-Za-z0-9_-]{1,48}$/.test(actor))throw Error('invalid_reconciliation');
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const old=this.db.prepare('SELECT * FROM reconciliations WHERE charge_id=?').get(id);
      if(old){if(old.receipt_sha256!==expectedHash)throw Error('reconciliation_conflict');this.db.exec('COMMIT');return {charge_id:id,upper_estimate_cny:Number(old.cost_micros)/1_000_000,duplicate:true};}
      const record=this.db.prepare('SELECT * FROM usage_receipts WHERE charge_id=?').get(id);
      if(!record||record.receipt_sha256!==expectedHash||sha256(String(record.receipt_json))!==expectedHash)throw Error('provider_receipt_required');
      const receipt=JSON.parse(String(record.receipt_json)) as UsageReceipt;
      const charge=this.db.prepare('SELECT state FROM charges WHERE id=?').get(id);
      if(!charge||!['reserved','unknown'].includes(String(charge.state)))throw Error('invalid_charge_state');
      // This temporary state change is inside the same transaction as settlement.
      this.db.prepare("UPDATE charges SET state='reserved' WHERE id=? AND state='unknown'").run(id);
      const cost=this.settle(id,receipt.prompt_tokens,receipt.completion_tokens);
      this.db.prepare('INSERT INTO reconciliations VALUES(?,?,?,?,?,?,?)').run(id,expectedHash,cost,actor,'matched_provider_usage_receipt',new Date().toISOString(),String(charge.state));
      this.db.exec('COMMIT');return {charge_id:id,upper_estimate_cny:cost/1_000_000,duplicate:false};
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  summary(run:string){
    const row=this.db.prepare("SELECT COUNT(*) AS calls,COALESCE(SUM(COALESCE(settled,reserved)),0) AS micros,COALESCE(SUM(state<>'settled'),0) AS unresolved FROM charges WHERE run_id=?").get(run)!;
    return {calls:Number(row.calls),upper_estimate_cny:Number(row.micros)/1_000_000,unresolved:Number(row.unresolved)};
  }
  async snapshot(file:string){if(existsSync(file))throw Error('snapshot_exists');return backup(this.db,file);}
  close(){this.db.close();}
}
