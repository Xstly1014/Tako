import { ApiError, apiMessage } from "../api/client.ts";
import { DraftError, id, text, integer, date, type LocalDraft } from "./model.ts";
import type { AuthorizedDrafts, LocalIdentity } from "./authorized.ts";
import type { DraftsApi } from "./api.ts";
import type { DraftSyncResult } from "./sync.ts";

export type DraftTools = {
  channel?: "chapter";
  local: AuthorizedDrafts;
  api: DraftsApi;
  current(): LocalIdentity;
  online(): Promise<boolean>;
  sync(localId: string): Promise<DraftSyncResult>;
  uuid(): string;
};
export function localAllowed(value: LocalIdentity, owner = value.drafts.owner) {
  return !value.busy && id(owner) && owner === value.drafts.owner &&
    ["online", "offline"].includes(value.drafts.phase);
}
export function draftMessage(error: unknown) {
  if (error instanceof DraftError) return {
    storage: "本机暂存失败，请重试；先不要关闭页面。",
    unreadable: "本机草稿无法解密，原记录已保留。请勿清除 App 数据。",
    local_conflict: "本机草稿已变化，当前输入仍保留，请返回后重新打开核对。",
    invalid_input: "标题最多 200 字符，正文最多 1 MiB；超出内容仍保留在输入框。",
    account_mismatch: "草稿已锁定，请用原账号登录并恢复。",
  }[error.code];
  if (error instanceof ApiError && error.code === "chapter_publication_unavailable") return "章节发布尚未开放，私密草稿仍保留。";
  if (error instanceof ApiError && error.code === "draft_handoff_unconfirmed") return "请先同步当前输入，再准备发布。";
  if (error instanceof ApiError && error.code === "draft_handoff_changed") return "内容或账号已变化，请核对并同步后重新准备发布。";
  if (error instanceof ApiError && error.code === "nickname_required") return "请先在“我的”中设置笔名；本机文字仍保留。";
  return apiMessage(error);
}
export function automaticSyncAllowed(error: unknown) {
  return !error || (error instanceof ApiError &&
    ["network", "service_unavailable", "internal_error", "rate_limited"].includes(error.code));
}
export type EditorState = {
  record: LocalDraft | null; title: string; content: string;
  loading: boolean; saving: boolean; syncing: boolean; preparing: boolean; error: unknown;
};
export type PublicationTicket = Readonly<{ draftId: string; revision: number; localId: string; seq: number; generation: number }>;
export class DraftEditor {
  readonly owner: string;
  localId: string;
  private tools: DraftTools;
  private listeners = new Set<() => void>();
  private writing: Promise<void> | null = null;
  private copying: Promise<string> | null = null;
  private publicationTicket: PublicationTicket | null = null;
  private handedOff = false;
  private state: EditorState = { record: null, title: "", content: "", loading: true, saving: false, syncing: false, preparing: false, error: null };
  constructor(owner: string, localId: string, tools: DraftTools) { this.owner = owner; this.localId = localId; this.tools = tools; }
  snapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private update(patch: Partial<EditorState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(fn => fn()); }
  private capture() {
    const current = this.tools.current();
    if (!localAllowed(current, this.owner)) throw new DraftError("account_mismatch");
    return current.generation;
  }
  private check(generation: number) {
    if (this.capture() !== generation) throw new DraftError("account_mismatch");
  }
  hasUnstored() {
    const s = this.state;
    return !!s.record && (s.title !== s.record.title || s.content !== s.record.content);
  }
  async load() {
    const generation = this.capture(), localId = this.localId, before = this.state.record;
    this.publicationTicket = null;
    this.handedOff = false;
    try {
      const record = await this.tools.local.load(localId);
      this.check(generation);
      if (localId !== this.localId) throw new DraftError("local_conflict");
      if (!record) throw new ApiError("draft_not_found", "", 404);
      // A focus read can finish after a newer encrypted save/sync. Keep that
      // newer state; even already-persisted input must not roll back in the UI.
      if (this.state.record !== before) return;
      // A retry or return cannot advance the CAS base under unpersisted input.
      if (this.hasUnstored() && this.state.record?.seq !== record.seq &&
          (record.title !== this.state.title || record.content !== this.state.content)) throw new DraftError("local_conflict");
      this.update(this.hasUnstored() ? { record, error: null, loading: false } :
        { record, title: record.title, content: record.content, loading: false, error: null });
    } catch (error) { this.update({ loading: false, error }); throw error; }
  }
  input(title: string, content: string) {
    try { this.capture(); } catch (error) { this.update({ error }); return; }
    if (!this.state.record) return;
    this.publicationTicket = null;
    this.update({ title, content, error: null });
    // Coalesce edits while an encrypted transaction is in flight; a completed
    // save never overwrites the controlled inputs or confirms later keystrokes.
    void this.save().catch(() => undefined);
  }
  async save(): Promise<void> {
    // During copy creation all input joins the copy operation, never the old
    // CAS target. Retry after it settles to include any last queued keystroke.
    if (this.copying) { await this.copying; return this.save(); }
    return this.saveInputs();
  }
  private async saveInputs(): Promise<void> {
    if (this.writing) return this.writing;
    const generation = this.capture();
    const operation = (async () => {
      this.update({ saving: true });
      try {
        while (this.hasUnstored()) {
          this.check(generation);
          const { record, title, content } = this.state, localId = this.localId;
          if (!text(title, content)) throw new DraftError("invalid_input");
          let saved: LocalDraft;
          try { saved = await this.tools.local.edit(localId, record!.seq, title, content); }
          catch (error) {
            // A commit can succeed before its completion signal fails. Only an
            // exact read-back confirms THIS local write; never advance over a
            // different editor's text or guess success from an exception.
            const readBack = await this.tools.local.load(localId).catch(() => null);
            this.check(generation);
            if (!readBack || readBack.seq !== record!.seq + 1 || readBack.title !== title || readBack.content !== content) throw error;
            saved = readBack;
          }
          this.check(generation);
          this.update({ record: saved, error: null });
        }
      } catch (error) { this.update({ error }); throw error; }
      finally { this.update({ saving: false }); }
    })();
    this.writing = operation;
    try { await operation; } finally { if (this.writing === operation) this.writing = null; }
  }
  async saveAsCopy() {
    if (this.copying || this.state.saving || this.state.syncing) throw new ApiError("session_busy");
    const generation = this.capture(), title = this.state.title, content = this.state.content;
    // Install the barrier before notifying listeners or creating the row.
    // Input remains editable; its save joins this operation until the new
    // target exists and all currently buffered text has been persisted there.
    const operation = Promise.resolve().then(async () => {
      try {
        const record = await this.tools.local.create(this.tools.uuid(), title, content);
        this.check(generation);
        this.localId = record.id;
        this.update({ record, error: null });
        await this.saveInputs();
        return record.id;
      } catch (error) { this.update({ error }); throw error; }
      finally { this.update({ saving: false }); }
    });
    this.copying = operation;
    this.update({ saving: true });
    try { return await operation; }
    finally { if (this.copying === operation) this.copying = null; }
  }
  canPreparePublication() {
    return !this.handedOff && !this.state.preparing && this.publicationReady();
  }
  private publicationReady() {
    const { record, title, content, loading, saving, syncing } = this.state;
    const identity = this.tools.current();
    return this.tools.channel !== "chapter" && localAllowed(identity, this.owner) && identity.drafts.phase === "online" &&
      !loading && !saving && !syncing && !this.writing && !!record && record.owner === this.owner &&
      record.id === this.localId && !record.dirty && record.pending === null &&
      record.title === title && record.content === content && id(record.serverId) &&
      integer(record.baseRevision, 1) && date(record.savedAt);
  }
  private handoffError(code: "draft_handoff_unconfirmed" | "draft_handoff_changed" | "chapter_publication_unavailable"): never {
    const error = new ApiError(code); this.update({ error }); throw error;
  }
  private matchesTicket(ticket: PublicationTicket, record: LocalDraft | null) {
    this.check(ticket.generation);
    return this.publicationReady() && ticket.localId === this.localId && !!record &&
      record.owner === this.owner && record.id === ticket.localId && record.seq === ticket.seq &&
      record.serverId === ticket.draftId && record.baseRevision === ticket.revision &&
      !record.dirty && record.pending === null && date(record.savedAt) &&
      record.title === this.state.title && record.content === this.state.content &&
      this.state.record?.seq === ticket.seq && this.state.record.serverId === ticket.draftId &&
      this.state.record.baseRevision === ticket.revision;
  }
  async preparePublication(): Promise<PublicationTicket> {
    if (this.tools.channel === "chapter") this.handoffError("chapter_publication_unavailable");
    if (!this.canPreparePublication()) this.handoffError("draft_handoff_unconfirmed");
    const generation = this.capture(), record = this.state.record!;
    const ticket = Object.freeze({ draftId: record.serverId!, revision: record.baseRevision,
      localId: this.localId, seq: record.seq, generation });
    this.publicationTicket = null;
    this.update({ preparing: true, error: null });
    try {
      if (!await this.tools.online()) throw new ApiError("network");
      if (!this.matchesTicket(ticket, await this.tools.local.load(ticket.localId))) this.handoffError("draft_handoff_changed");
      // R2 does not invalidate already-confirmed R1: C2 explicitly offers the
      // choice. Do not import the new body or raise the local revision here.
      const server = await this.tools.api.read(ticket.draftId);
      this.check(generation);
      if (server.revision < ticket.revision) throw new ApiError("contract");
      const latest = await this.tools.local.load(ticket.localId);
      if (!this.matchesTicket(ticket, latest)) this.handoffError("draft_handoff_changed");
      this.publicationTicket = ticket;
      return ticket;
    } catch (error) { this.publicationTicket = null; this.update({ error }); throw error; }
    finally { this.update({ preparing: false }); }
  }
  publicationPath(ticket: PublicationTicket) {
    if (this.publicationTicket !== ticket || this.handedOff || !this.matchesTicket(ticket, this.state.record))
      this.handoffError("draft_handoff_changed");
    this.publicationTicket = null; this.handedOff = true;
    this.update({});
    return `/publish?draft_id=${ticket.draftId}&source_revision=${ticket.revision}`;
  }
  async resume() {
    try {
      await this.load();
      const generation = this.capture(), localId = this.localId, serverId = this.state.record?.serverId;
      if (!serverId) return;
      if (!await this.tools.online()) throw new ApiError("network");
      this.check(generation);
      await this.tools.api.read(serverId);
      this.check(generation);
      if (this.localId !== localId) throw new DraftError("local_conflict");
      // Reading server metadata on return never replaces inputs, advances the
      // local base revision, confirms a pending write, or publishes anything.
    } catch (error) { this.update({ error }); throw error; }
  }
  async synchronize() {
    if (this.state.syncing) return;
    const generation = this.capture();
    this.update({ syncing: true });
    try {
      await this.save(); this.check(generation);
      if (!await this.tools.online()) throw new ApiError("network");
      this.check(generation);
      const result = await this.tools.sync(this.localId);
      this.check(generation);
      const record = await this.tools.local.load(this.localId);
      this.check(generation);
      if (record) this.update({ record });
      if (result.errorCode) throw new ApiError(result.errorCode, result.requestId);
      if (["login-required", "account-mismatch", "rejected"].includes(result.state)) throw new ApiError("authentication_required");
      this.update({ error: null });
    } catch (error) { this.update({ error }); throw error; }
    finally { this.update({ syncing: false }); }
  }
}
export function editorStatus(s: EditorState) {
  if (!s.record) return s.loading ? "正在打开草稿" : "草稿未打开";
  if (s.title !== s.record.title || s.content !== s.record.content) return s.saving ? "正在暂存本机" : "尚未暂存";
  if (s.syncing) return "正在同步";
  if (s.record.pending) return "已暂存本机，服务器结果待确认";
  if (s.record.dirty) return "已暂存本机，待同步";
  return "已保存到服务器";
}
