import { ApiError } from "../api/client.ts";
import {
  checkedNovel,
  validMetadata,
  type Novel,
  type NovelWrite,
} from "../api/novels.ts";
import { UUID } from "../api/reader.ts";
export type PendingBook = { target: string | null; input: NovelWrite };
export interface BookJournal {
  load(): Promise<PendingBook | null>;
  save(value: PendingBook | null, expectedId?: string): Promise<void>;
}
export function checkedPending(value: unknown): PendingBook | null {
  if (value === null) return null;
  const p = value as PendingBook;
  if (
    !p ||
    (p.target !== null &&
      (typeof p.target !== "string" || !UUID.test(p.target))) ||
    !p.input ||
    !UUID.test(p.input.mutation_id) ||
    !validMetadata(p.input) ||
    !Number.isSafeInteger(p.input.base_revision) ||
    p.input.base_revision < (p.target ? 1 : 0) ||
    (!p.target && p.input.base_revision !== 0)
  )
    throw new ApiError("storage");
  return p;
}
type Remote = {
  write(target: string | null, input: NovelWrite): Promise<Novel>;
  receipt(id: string): Promise<Novel>;
};
export type WriterState = {
  phase: "loading" | "idle" | "saving" | "unknown" | "confirmed" | "rejected";
  pending: PendingBook | null;
  result: Novel | null;
  error: unknown;
};
export class BookWriter {
  private journal: BookJournal;
  private api: Remote;
  private current: () => boolean;
  private state: WriterState = {
    phase: "loading",
    pending: null,
    result: null,
    error: null,
  };
  private listeners = new Set<() => void>();
  private busy = false;
  private alive = true;
  constructor(journal: BookJournal, api: Remote, current: () => boolean) {
    this.journal = journal;
    this.api = api;
    this.current = current;
  }
  snapshot = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private valid() {
    return this.alive && this.current();
  }
  private update(patch: Partial<WriterState>) {
    if (this.valid()) {
      this.state = { ...this.state, ...patch };
      this.listeners.forEach((fn) => fn());
    }
  }
  reset() {
    if (!this.busy && !this.state.pending)
      this.update({ phase: "idle", result: null, error: null });
  }
  dispose() {
    this.alive = false;
    this.listeners.clear();
  }
  async restore() {
    if (this.busy || !this.valid()) return;
    this.busy = true;
    this.update({ phase: "loading", error: null });
    try {
      const pending = checkedPending(await this.journal.load());
      this.update({
        pending,
        phase: pending ? "unknown" : "idle",
        error: null,
      });
    } catch (e) {
      this.update({ phase: "loading", error: e });
    } finally {
      this.busy = false;
    }
  }
  async submit(pending: PendingBook) {
    if (
      this.busy ||
      !this.valid() ||
      this.state.phase === "loading" ||
      this.state.pending
    )
      return;
    checkedPending(pending);
    this.busy = true;
    this.update({ phase: "saving", result: null, error: null });
    try {
      await this.journal.save(pending);
      if (!this.valid()) return;
      this.update({ pending, phase: "saving", result: null, error: null });
      await this.send(pending, false);
    } catch (e) {
      this.update({ phase: this.state.pending ? "unknown" : "idle", error: e });
    } finally {
      this.busy = false;
    }
  }
  async retry() {
    if (this.busy || !this.valid() || !this.state.pending) return;
    this.busy = true;
    const pending = this.state.pending;
    try {
      if (this.state.result) {
        await this.journal.save(null, pending.input.mutation_id);
        this.update({ pending: null, error: null });
      } else {
        this.update({ phase: "saving", error: null });
        await this.send(pending, true);
      }
    } catch (e) {
      this.update({
        phase: this.state.result ? "confirmed" : "unknown",
        error: e,
      });
    } finally {
      this.busy = false;
    }
  }
  private async send(pending: PendingBook, lookup: boolean) {
    let result: Novel;
    try {
      if (lookup) {
        try {
          result = await this.api.receipt(pending.input.mutation_id);
        } catch (e) {
          if (!(e instanceof ApiError) || e.status !== 404) throw e;
          if (!this.valid()) return;
          result = await this.api.write(pending.target, pending.input);
        }
      } else result = await this.api.write(pending.target, pending.input);
      checkedNovel(result, pending.target ?? undefined);
      if (
        result.revision !== pending.input.base_revision + 1 ||
        result.title !== pending.input.title ||
        result.introduction !== pending.input.introduction ||
        JSON.stringify(result.tags) !== JSON.stringify(pending.input.tags)
      )
        throw new ApiError("contract");
    } catch (e) {
      if (!this.valid()) return;
      if (e instanceof ApiError && [400, 404, 409, 429].includes(e.status)) {
        // Known rejection leaves the form untouched; don't spin retries against CAS.
        this.update({ phase: "rejected", error: e });
        try {
          await this.journal.save(null, pending.input.mutation_id);
          this.update({ pending: null });
        } catch (storeError) {
          this.update({ error: storeError, phase: "unknown" });
        }
      } else this.update({ phase: "unknown", error: e });
      return;
    }
    if (!this.valid()) return;
    this.update({ phase: "confirmed", result, error: null });
    try {
      await this.journal.save(null, pending.input.mutation_id);
      this.update({ pending: null });
    } catch (e) {
      this.update({ error: e });
    }
  }
}
