import { ApiError, apiMessage } from "../api/client.ts";
import { DraftError, id, text, type LocalDraft } from "./model.ts";
import type { AuthorizedDrafts, LocalIdentity } from "./authorized.ts";
import type { DraftsApi } from "./api.ts";
import type { DraftSyncResult } from "./sync.ts";

export type DraftTools = {
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
  if (error instanceof ApiError && error.code === "nickname_required") return "请先在“我的”中设置笔名；本机文字仍保留。";
  return apiMessage(error);
}
export function automaticSyncAllowed(error: unknown) {
  return !error || (error instanceof ApiError &&
    ["network", "service_unavailable", "internal_error", "rate_limited"].includes(error.code));
}
export type EditorState = {
  record: LocalDraft | null; title: string; content: string;
  loading: boolean; saving: boolean; syncing: boolean; error: unknown;
};
export class DraftEditor {
  readonly owner: string;
  localId: string;
  private tools: DraftTools;
  private listeners = new Set<() => void>();
  private writing: Promise<void> | null = null;
  private state: EditorState = { record: null, title: "", content: "", loading: true, saving: false, syncing: false, error: null };
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
    const generation = this.capture();
    try {
      const record = await this.tools.local.load(this.localId);
      this.check(generation);
      if (!record) throw new ApiError("draft_not_found", "", 404);
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
    this.update({ title, content, error: null });
    // Coalesce edits while an encrypted transaction is in flight; a completed
    // save never overwrites the controlled inputs or confirms later keystrokes.
    void this.save().catch(() => undefined);
  }
  async save(): Promise<void> {
    if (this.writing) return this.writing;
    const generation = this.capture();
    const operation = (async () => {
      this.update({ saving: true });
      try {
        while (this.hasUnstored()) {
          this.check(generation);
          const { record, title, content } = this.state;
          if (!text(title, content)) throw new DraftError("invalid_input");
          let saved: LocalDraft;
          try { saved = await this.tools.local.edit(this.localId, record!.seq, title, content); }
          catch (error) {
            // A commit can succeed before its completion signal fails. Only an
            // exact read-back confirms THIS local write; never advance over a
            // different editor's text or guess success from an exception.
            const readBack = await this.tools.local.load(this.localId).catch(() => null);
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
    if (this.state.saving || this.state.syncing) throw new ApiError("session_busy");
    const generation = this.capture(), title = this.state.title, content = this.state.content;
    this.update({ saving: true });
    try {
      const record = await this.tools.local.create(this.tools.uuid(), title, content);
      this.check(generation);
      this.localId = record.id;
      this.update({ record, error: null });
      await this.save();
      return record.id;
    } catch (error) { this.update({ error }); throw error; }
    finally { this.update({ saving: false }); }
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
