import { ApiError } from "../api/client.ts";
import { checkedDraftReceipt, type DraftSyncApi } from "./api.ts";
import { DraftError, id, type DraftPending, type LocalDraft } from "./model.ts";
import type { DraftRepository } from "./storage.ts";

export type DraftIdentity = { owner: string | null; generation: number; online: boolean };
export type DraftSyncResult = {
  state: "saved" | "pending" | "recovered" | "login-required" | "account-mismatch" | "rejected" | "busy";
  record?: LocalDraft;
  errorCode?: string;
  requestId?: string;
};
export class DraftSynchronizer {
  private busy = new Set<string>();
  private repo: DraftRepository;
  private api: DraftSyncApi;
  private identity: () => DraftIdentity;
  private uuid: () => string;
  constructor(repo: DraftRepository, api: DraftSyncApi, identity: () => DraftIdentity, uuid: () => string) {
    this.repo = repo; this.api = api; this.identity = identity; this.uuid = uuid;
  }

  async sync(owner: string, localId: string): Promise<DraftSyncResult> {
    const key = `${owner}/${localId}`;
    if (this.busy.has(key)) return { state: "busy" };
    const identity = this.identity();
    const current = () => {
      const value = this.identity();
      if (!value.online || value.owner !== owner || value.generation !== identity.generation)
        throw new ApiError("stale_session");
    };
    if (identity.owner !== owner) return { state: "account-mismatch" };
    if (!identity.online) return { state: "login-required" };
    this.busy.add(key);
    try {
      let record = await this.repo.load(owner, localId);
      current();
      if (!record) throw new DraftError("local_conflict");
      const me = await this.api.me();
      current();
      if (me.id !== owner) return { state: "account-mismatch" };
      if (!record.dirty && !record.pending) return { state: "saved", record };
      if (!record.pending) {
        const readServerId = record.serverId, readBaseRevision = record.baseRevision;
        const server = record.serverId ? await this.api.read(record.serverId) : null;
        current();
        if (server && server.content === record.content && server.title === record.title) {
          const readSeq = record.seq;
          record = await this.repo.change(owner, localId, (latest) => {
            if (!latest) throw new DraftError("local_conflict");
            if (latest.seq !== readSeq || latest.pending || latest.serverId !== readServerId ||
                latest.baseRevision !== readBaseRevision) return latest;
            return { ...latest, dirty: false, baseRevision: server.revision, savedAt: server.saved_at };
          });
          current();
          return { state: record.dirty || record.pending ? "pending" : "saved", record };
        }
        const mutation = this.uuid();
        if (!id(mutation)) throw new DraftError("invalid_input");
        // Freeze and durably commit the exact HTTP operation before its first send.
        record = await this.repo.change(owner, localId, (latest) => {
          if (!latest) throw new DraftError("local_conflict");
          if (latest.pending) return latest;
          // Another synchronizer may have acknowledged or recovered this record
          // while our HTTP read was in flight. Never interpret that OLD read
          // as a new conflict against the latest server identity/revision.
          if (!latest.dirty || latest.serverId !== readServerId || latest.baseRevision !== readBaseRevision) return latest;
          const kind = !latest.serverId ? "create" : server?.revision === latest.baseRevision ? "save" : "recover";
          return { ...latest, pending: { kind, seq: latest.seq, body: {
            mutation_id: mutation, title: latest.title, content: latest.content,
            ...(latest.serverId ? { draft_id: latest.serverId, base_revision: latest.baseRevision } : {}),
          } } };
        });
      }
      current();
      if (!record.pending) return { state: record.dirty ? "pending" : "saved", record };
      let pending = record.pending;
      let ack;
      try { ack = checkedDraftReceipt(await this.api.write(pending), pending); }
      catch (e) {
        if (e instanceof ApiError && e.status === 401) throw e;
        current();
        if (!(e instanceof ApiError) || e.status !== 409 || e.code !== "revision_conflict" || pending.kind !== "save") throw e;
        const replacement: DraftPending = { ...pending, kind: "recover", body: { ...pending.body, mutation_id: this.uuid() } };
        record = await this.repo.change(owner, localId, (latest) => {
          if (!latest || latest.pending?.body.mutation_id !== pending.body.mutation_id) throw new DraftError("local_conflict");
          return { ...latest, pending: replacement };
        });
        current();
        pending = record.pending!;
        ack = checkedDraftReceipt(await this.api.write(pending), pending);
      }
      current();
      record = await this.repo.change(owner, localId, (latest) => {
        if (!latest || latest.pending?.body.mutation_id !== pending.body.mutation_id) throw new DraftError("local_conflict");
        return { ...latest, serverId: ack.draft_id, baseRevision: ack.revision, savedAt: ack.saved_at,
          pending: null, dirty: latest.seq !== pending.seq,
          recoveredFrom: pending.kind === "recover" ? pending.body.draft_id! : latest.recoveredFrom };
      });
      current();
      return { state: pending.kind === "recover" ? "recovered" : record.dirty ? "pending" : "saved", record };
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      if (e.status === 401) return { state: "login-required", errorCode: e.code, requestId: e.requestId };
      if (e.code === "stale_session") return { state: "account-mismatch", errorCode: e.code };
      const value = this.identity();
      if (value.owner !== owner || value.generation !== identity.generation) return { state: "account-mismatch" };
      const record = await this.repo.load(owner, localId) ?? undefined;
      // Deterministic input rejection can be edited; uncertain results retain their request.
      if (["invalid_input", "payload_too_large"].includes(e.code) && e.status >= 400 && e.status < 500 && record?.pending) {
        const mutation = record.pending.body.mutation_id;
        await this.repo.change(owner, localId, (latest) => {
          if (!latest) throw new DraftError("local_conflict");
          return latest.pending?.body.mutation_id === mutation ? { ...latest, pending: null, dirty: true } : latest;
        });
      }
      return { state: e.status === 401 ? "login-required" : e.status === 0 || e.status >= 500 || e.status === 429 ? "pending" : "rejected",
        errorCode: e.code, requestId: e.requestId };
    } finally { this.busy.delete(key); }
  }
}
