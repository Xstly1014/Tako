import type { CipherRow, CipherRows } from "./storage.ts";

export const DRAFT_SCHEMA = `CREATE TABLE IF NOT EXISTS private_drafts_v1 (
 owner TEXT NOT NULL, local_id TEXT NOT NULL, revision INTEGER NOT NULL,
 ciphertext TEXT NOT NULL, PRIMARY KEY(owner,local_id))`;
export interface SqlConnection {
  execAsync(sql: string): Promise<void>;
  getFirstAsync<T>(sql: string, ...params: (string | number)[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...params: (string | number)[]): Promise<T[]>;
  runAsync(sql: string, ...params: (string | number)[]): Promise<unknown>;
}
export interface SqlDatabase extends SqlConnection {
  withExclusiveTransactionAsync(fn: (connection: SqlConnection) => Promise<void>): Promise<void>;
}
export class SqliteCipherRows implements CipherRows {
  private db: SqlDatabase;
  constructor(db: SqlDatabase) { this.db = db; }
  async initialize() {
    await this.db.execAsync("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;");
    await this.db.execAsync(DRAFT_SCHEMA);
  }
  read(owner: string, localId: string) {
    return this.db.getFirstAsync<CipherRow>("SELECT revision,ciphertext FROM private_drafts_v1 WHERE owner=? AND local_id=?", owner, localId);
  }
  async ids(owner: string) {
    return (await this.db.getAllAsync<{ local_id: string }>("SELECT local_id FROM private_drafts_v1 WHERE owner=? ORDER BY local_id", owner)).map((v) => v.local_id);
  }
  async update(owner: string, localId: string, transform: (row: CipherRow | null) => Promise<CipherRow>) {
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      const old = await tx.getFirstAsync<CipherRow>("SELECT revision,ciphertext FROM private_drafts_v1 WHERE owner=? AND local_id=?", owner, localId);
      const next = await transform(old);
      await tx.runAsync("INSERT INTO private_drafts_v1(owner,local_id,revision,ciphertext) VALUES(?,?,?,?) ON CONFLICT(owner,local_id) DO UPDATE SET revision=excluded.revision,ciphertext=excluded.ciphertext",
        owner, localId, next.revision, next.ciphertext);
    });
  }
}
