import { DatabaseSync } from "node:sqlite";
import { randomBytes, randomUUID, webcrypto } from "node:crypto";
import { mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SqliteCipherRows, type SqlConnection, type SqlDatabase } from "../../src/drafts/sqlite.ts";
import { DraftRepository, type DraftCipher } from "../../src/drafts/storage.ts";
import { DraftError, type DraftAck, type DraftPending, type ServerDraft } from "../../src/drafts/model.ts";
import { ApiError } from "../../src/api/client.ts";
import type { DraftSyncApi } from "../../src/drafts/api.ts";

export class TestDatabase implements SqlDatabase {
  raw: DatabaseSync;
  failBeforeCommit = false;
  failAfterCommit = false;
  private queue: Promise<unknown> = Promise.resolve();
  path: string;
  constructor(path: string) { this.path = path; this.raw = new DatabaseSync(path); }
  async execAsync(sql: string) { this.raw.exec(sql); }
  async getFirstAsync<T>(sql: string, ...params: (string | number)[]) { return (this.raw.prepare(sql).get(...params) ?? null) as T | null; }
  async getAllAsync<T>(sql: string, ...params: (string | number)[]) { return this.raw.prepare(sql).all(...params) as T[]; }
  async runAsync(sql: string, ...params: (string | number)[]) { return this.raw.prepare(sql).run(...params); }
  async withExclusiveTransactionAsync(fn: (connection: SqlConnection) => Promise<void>) {
    const operation = this.queue.then(async () => {
      this.raw.exec("BEGIN IMMEDIATE");
      try {
        await fn(this);
        if (this.failBeforeCommit) { this.failBeforeCommit = false; throw new Error("injected_before_commit"); }
        this.raw.exec("COMMIT");
      } catch (e) { this.raw.exec("ROLLBACK"); throw e; }
      if (this.failAfterCommit) { this.failAfterCommit = false; throw new Error("injected_after_commit"); }
    });
    this.queue = operation.catch(() => undefined);
    await operation;
  }
}
export class TestCipher implements DraftCipher {
  keys = new Map<string, Uint8Array<ArrayBuffer>>();
  private async key(owner: string, allowNew: boolean) {
    let raw = this.keys.get(owner);
    if (!raw) {
      if (!allowNew) throw new DraftError("unreadable");
      raw = new Uint8Array(randomBytes(32));
      this.keys.set(owner, raw);
    }
    return webcrypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  }
  async seal(owner: string, context: string, plaintext: string, allowNew: boolean) {
    const nonce = randomBytes(12), key = await this.key(owner, allowNew);
    const encrypted = await webcrypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: new TextEncoder().encode(context) }, key, new TextEncoder().encode(plaintext));
    return Buffer.concat([nonce, Buffer.from(encrypted)]).toString("base64");
  }
  async open(owner: string, context: string, ciphertext: string) {
    const bytes = Buffer.from(ciphertext, "base64"), key = await this.key(owner, false);
    const plain = await webcrypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.subarray(0, 12), additionalData: new TextEncoder().encode(context) }, key, bytes.subarray(12));
    return new TextDecoder("utf-8", { fatal: true }).decode(plain);
  }
}
export async function fixture() {
  const path = fileURLToPath(new URL(`../../../.runtime/mobile/qa/drafts-${randomUUID()}.db`, import.meta.url));
  mkdirSync(dirname(path), { recursive: true });
  const db = new TestDatabase(path), rows = new SqliteCipherRows(db), cipher = new TestCipher();
  await rows.initialize();
  return { db, rows, cipher, repo: new DraftRepository(rows, cipher),
    close() {
      db.raw.close();
      for (const suffix of ["", "-wal", "-shm"]) {
        try { unlinkSync(path + suffix); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
      }
    },
  };
}
export class TestApi implements DraftSyncApi {
  owner: string;
  receipts = new Map<string, DraftAck>();
  drafts = new Map<string, ServerDraft>();
  calls: DraftPending[] = [];
  dropNext = false;
  fail: ApiError | null = null;
  beforeReceipt: (() => Promise<void>) | null = null;
  constructor(owner: string) { this.owner = owner; }
  async me() { return { id: this.owner, nickname: "合成作者" }; }
  async read(id: string) {
    const draft = this.drafts.get(id);
    if (!draft) throw new ApiError("draft_not_found", "", 404);
    return { ...draft };
  }
  async write(pending: DraftPending) {
    this.calls.push(structuredClone(pending));
    if (this.fail) throw this.fail;
    const body = pending.body;
    let ack = this.receipts.get(body.mutation_id);
    if (!ack) {
      const old = body.draft_id ? this.drafts.get(body.draft_id) : null;
      if (pending.kind === "save" && old?.revision !== body.base_revision) throw new ApiError("revision_conflict", "", 409);
      const id = pending.kind === "save" ? body.draft_id! : randomUUID();
      ack = { draft_id: id, revision: pending.kind === "save" ? old!.revision + 1 : 1, saved_at: "2026-11-02T00:00:00Z" };
      this.drafts.set(id, { id, revision: ack.revision, saved_at: ack.saved_at, title: body.title, content: body.content });
      this.receipts.set(body.mutation_id, ack);
    }
    if (this.beforeReceipt) await this.beforeReceipt();
    if (this.dropNext) { this.dropNext = false; throw new ApiError("network"); }
    return { ...ack };
  }
}
