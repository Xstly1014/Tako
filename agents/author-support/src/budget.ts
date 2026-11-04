import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

// Peak CNY rates checked against official pricing on 2026-11-04. Treat every
// prompt token as a cache miss and every period as peak: an upper estimate, not
// an invoice. This ledger only covers this runner, not other uses of the API key.
export const pricing={checked_at:"2026-11-04",input_micros_per_token:2,output_micros_per_token:8};
export const limits={project_micros:200_000_000,run_micros:2_000_000,max_request_bytes:48_000,max_output_tokens:768,max_model_calls:9,max_tool_calls:8};
export const reserveMicros=(limits.max_request_bytes+4096)*pricing.input_micros_per_token+limits.max_output_tokens*pricing.output_micros_per_token;
export class BudgetLedger {
  private db:DatabaseSync;
  constructor(file:string){
    this.db=new DatabaseSync(file);
    this.db.exec("PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS charges(id TEXT PRIMARY KEY, run_id TEXT NOT NULL, reserved INTEGER NOT NULL, settled INTEGER, state TEXT NOT NULL CHECK(state IN ('reserved','settled','unknown')))");
  }
  reserve(run:string){
    this.db.exec("BEGIN IMMEDIATE");
    try{
      const unresolved=this.db.prepare("SELECT COUNT(*) AS n FROM charges WHERE state<>'settled'").get()!;
      if(Number(unresolved.n)>0)throw Error("unresolved_provider_charge");
      const used=Number(this.db.prepare("SELECT COALESCE(SUM(COALESCE(settled,reserved)),0) AS n FROM charges").get()!.n);
      const runUsed=Number(this.db.prepare("SELECT COALESCE(SUM(COALESCE(settled,reserved)),0) AS n FROM charges WHERE run_id=?").get(run)!.n);
      if(used+reserveMicros>limits.project_micros||runUsed+reserveMicros>limits.run_micros)throw Error("budget_exceeded");
      const id=randomUUID();this.db.prepare("INSERT INTO charges(id,run_id,reserved,state) VALUES(?,?,?,'reserved')").run(id,run,reserveMicros);
      this.db.exec("COMMIT");return id;
    }catch(e){this.db.exec("ROLLBACK");throw e;}
  }
  settle(id:string,prompt:number,completion:number){
    if(!Number.isSafeInteger(prompt)||prompt<0||!Number.isSafeInteger(completion)||completion<0)throw Error("invalid_usage");
    const cost=prompt*pricing.input_micros_per_token+completion*pricing.output_micros_per_token;
    if(cost>reserveMicros)throw Error("usage_exceeded_reservation");
    const updated=this.db.prepare("UPDATE charges SET settled=?,state='settled' WHERE id=? AND state='reserved'").run(cost,id);
    if(updated.changes!==1)throw Error("invalid_charge_state");
    return cost;
  }
  unknown(id:string){this.db.prepare("UPDATE charges SET state='unknown' WHERE id=? AND state='reserved'").run(id);}
  summary(run:string){
    const row=this.db.prepare("SELECT COUNT(*) AS calls,COALESCE(SUM(COALESCE(settled,reserved)),0) AS micros,COALESCE(SUM(state<>'settled'),0) AS unresolved FROM charges WHERE run_id=?").get(run)!;
    return {calls:Number(row.calls),upper_estimate_cny:Number(row.micros)/1_000_000,unresolved:Number(row.unresolved)};
  }
  close(){this.db.close();}
}
