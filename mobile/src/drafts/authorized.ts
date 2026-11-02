import { DraftError, id, text } from "./model.ts";
import type { LocalDraft } from "./model.ts";
import type { DraftRepository } from "./storage.ts";
import type { DraftAccess } from "./access.ts";

export type LocalIdentity = { drafts: DraftAccess; generation: number; busy: boolean };
// UI receives this facade, never an owner argument or the raw repository. A
// finished encrypted write may remain under its original owner after logout,
// but its plaintext/result must never escape into another identity's view.
export class AuthorizedDrafts {
  constructor(
    privateOpen: () => Promise<DraftRepository>,
    current: () => LocalIdentity,
  ) { this.open = privateOpen; this.current = current; }
  private open: () => Promise<DraftRepository>;
  private current: () => LocalIdentity;
  private capture() {
    const value = this.current();
    if (value.busy || !id(value.drafts.owner) ||
        !["online", "offline"].includes(value.drafts.phase)) throw new DraftError("account_mismatch");
    return { owner: value.drafts.owner, generation: value.generation };
  }
  private check(captured: { owner: string; generation: number }) {
    const now = this.capture();
    if (now.owner !== captured.owner || now.generation !== captured.generation)
      throw new DraftError("account_mismatch");
  }
  private async run<T>(action: (repo: DraftRepository, owner: string, check: () => void) => Promise<T>) {
    const captured = this.capture();
    const repo = await this.open();
    this.check(captured);
    const result = await action(repo, captured.owner, () => this.check(captured));
    this.check(captured);
    return result;
  }
  list() { return this.run((repo, owner) => repo.list(owner)); }
  load(localId: string) { return this.run((repo, owner) => repo.load(owner, localId)); }
  create(localId: string, title = "", content = "") {
    return this.run((repo, owner) => repo.create(owner, localId, title, content));
  }
  edit(localId: string, seq: number, title: string, content: string) {
    if (!text(title, content)) return Promise.reject(new DraftError("invalid_input"));
    return this.run((repo, owner, check) => repo.change(owner, localId, (current) => {
      check();
      if (!current || current.seq !== seq) throw new DraftError("local_conflict");
      return { ...current, seq: current.seq + 1, title, content, dirty: true } as LocalDraft;
    }));
  }
}
