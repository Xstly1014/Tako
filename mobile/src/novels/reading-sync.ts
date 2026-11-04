import { ApiError } from "../api/client.ts";
import { id, integer } from "../drafts/model.ts";
import {
  checkedReadingPosition,
  ReadingPositionApi,
  type ReadingPosition,
  type ReadingState,
  type ReadingWrite,
} from "./reading-position-api.ts";
export type ReadingCandidate = Pick<
  ReadingWrite,
  "chapter_id" | "version" | "locator"
>;
export type ReadingRecord = {
  format: 1;
  owner: string;
  book: string;
  token: string;
  base: number | null;
  cloud: ReadingPosition | null;
  candidate: ReadingCandidate | null;
  pending: ReadingWrite | null;
  conflict: boolean;
  blocked: boolean;
};
export interface ReadingJournal {
  load(): Promise<ReadingRecord | null>;
  save(v: ReadingRecord, expectedToken: string | null): Promise<void>;
}
const shape = (v: unknown, keys: string[]): v is Record<string, unknown> =>
  !!v &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  Object.keys(v).sort().join(",") === [...keys].sort().join(",");
export function checkedCandidate(v: unknown): ReadingCandidate {
  if (
    !shape(v, ["chapter_id", "version", "locator"]) ||
    !id(v.chapter_id) ||
    !integer(v.version, 1) ||
    !shape(v.locator, ["algorithm", "paragraph", "offset"]) ||
    v.locator.algorithm !== 1 ||
    !integer(v.locator.paragraph) ||
    !integer(v.locator.offset)
  )
    throw new ApiError("storage");
  return v as ReadingCandidate;
}
export function checkedReadingRecord(
  v: unknown,
  owner: string,
  book: string,
): ReadingRecord | null {
  if (v === null) return null;
  if (
    !shape(v, [
      "format",
      "owner",
      "book",
      "token",
      "base",
      "cloud",
      "candidate",
      "pending",
      "conflict",
      "blocked",
    ]) ||
    v.format !== 1 ||
    v.owner !== owner ||
    v.book !== book ||
    !id(owner) ||
    !id(book) ||
    !id(v.token) ||
    !(v.base === null || integer(v.base)) ||
    typeof v.conflict !== "boolean" ||
    typeof v.blocked !== "boolean"
  )
    throw new ApiError("storage");
  if (v.cloud !== null) checkedReadingPosition(v.cloud, book);
  if (v.candidate !== null) checkedCandidate(v.candidate);
  if (v.pending !== null) {
    if (
      !shape(v.pending, [
        "mutation_id",
        "base_revision",
        "chapter_id",
        "version",
        "locator",
      ]) ||
      !id(v.pending.mutation_id) ||
      !integer(v.pending.base_revision) ||
      v.pending.base_revision === Number.MAX_SAFE_INTEGER ||
      v.pending.base_revision !== v.base ||
      v.candidate === null ||
      v.conflict ||
      v.blocked
    )
      throw new ApiError("storage");
    checkedCandidate({
      chapter_id: v.pending.chapter_id,
      version: v.pending.version,
      locator: v.pending.locator,
    });
  }
  if ((v.conflict || v.blocked) && v.candidate === null)
    throw new ApiError("storage");
  return v as ReadingRecord;
}
const same = (a: ReadingCandidate | null, b: ReadingCandidate | null) =>
  !!a &&
  !!b &&
  a.chapter_id === b.chapter_id &&
  a.version === b.version &&
  a.locator.algorithm === b.locator.algorithm &&
  a.locator.paragraph === b.locator.paragraph &&
  a.locator.offset === b.locator.offset;
export type ReadingSyncState = {
  ready: boolean;
  busy: boolean;
  error: string;
  record: ReadingRecord | null;
  cloud: ReadingState | null;
};
/** All local replacements are serialized and persisted before any new HTTP write. */
export class ReadingSynchronizer {
  private owner: string;
  private book: string;
  private journal: ReadingJournal;
  private api: ReadingPositionApi;
  private current: () => boolean;
  private online: () => boolean;
  private uuid: () => string;
  private tail: Promise<unknown> = Promise.resolve();
  private remote = false;
  private state: ReadingSyncState = {
    ready: false,
    busy: false,
    error: "",
    record: null,
    cloud: null,
  };
  private listeners = new Set<() => void>();
  constructor(
    owner: string,
    book: string,
    journal: ReadingJournal,
    api: ReadingPositionApi,
    current: () => boolean,
    online: () => boolean,
    uuid: () => string,
  ) {
    if (!id(owner) || !id(book)) throw new ApiError("invalid_input");
    this.owner = owner;
    this.book = book;
    this.journal = journal;
    this.api = api;
    this.current = current;
    this.online = online;
    this.uuid = uuid;
  }
  snapshot = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private guard() {
    if (!this.current()) throw new ApiError("stale_session");
  }
  private emit(p: Partial<ReadingSyncState>) {
    this.state = { ...this.state, ...p };
    this.listeners.forEach((f) => f());
  }
  private empty(): ReadingRecord {
    return {
      format: 1,
      owner: this.owner,
      book: this.book,
      token: this.uuid(),
      base: null,
      cloud: null,
      candidate: null,
      pending: null,
      conflict: false,
      blocked: false,
    };
  }
  private change(fn: (r: ReadingRecord) => ReadingRecord) {
    const task = this.tail.then(async () => {
      this.guard();
      const old = this.state.record;
      const next = checkedReadingRecord(
        { ...fn(old ?? this.empty()), token: this.uuid() },
        this.owner,
        this.book,
      )!;
      await this.journal.save(next, old?.token ?? null);
      this.guard();
      this.emit({ record: next });
    });
    this.tail = task.catch(() => undefined);
    return task;
  }
  private restoring: Promise<void> | null = null;
  restore(force = false): Promise<void> {
    if (this.restoring) return this.restoring;
    if (this.remote) return Promise.resolve();
    const task = (async () => {
      this.guard();
      if (force || !this.state.ready) {
        this.emit({ ready: false });
        await this.tail;
        const record = checkedReadingRecord(
          await this.journal.load(),
          this.owner,
          this.book,
        );
        this.guard();
        this.emit({ record, ready: true, error: "" });
      }
      if (this.online()) await this.refresh();
    })();
    this.restoring = task;
    void task
      .finally(() => {
        if (this.restoring === task) this.restoring = null;
      })
      .catch(() => undefined);
    return task;
  }
  async capture(value: ReadingCandidate) {
    checkedCandidate(value);
    if (!this.state.ready) throw new ApiError("storage");
    if (same(this.state.record?.candidate ?? null, value)) return;
    await this.change((r) =>
      same(r.candidate, value) ? r : { ...r, candidate: value },
    );
  }
  private async acknowledge(p: ReadingPosition, input: ReadingWrite) {
    await this.change((r) => {
      if (r.pending?.mutation_id !== input.mutation_id)
        throw new ApiError("reading_local_conflict");
      return {
        ...r,
        base: p.revision,
        cloud: p,
        pending: null,
        candidate: same(r.candidate, input) ? null : r.candidate,
        conflict: false,
        blocked: false,
      };
    });
  }
  private async failure(e: unknown, input: ReadingWrite) {
    if (
      e instanceof ApiError &&
      e.status === 409 &&
      e.code === "reading_position_conflict"
    ) {
      this.emit({ cloud: null });
      await this.change((r) =>
        r.pending?.mutation_id === input.mutation_id
          ? { ...r, pending: null, conflict: true }
          : r,
      );
      try {
        await this.readCloud();
      } catch {
        /* Keep the local candidate; choice requires a fresh read. */
      }
    } else if (e instanceof ApiError && e.status === 404)
      await this.change((r) =>
        r.pending?.mutation_id === input.mutation_id
          ? { ...r, pending: null, blocked: true }
          : r,
      );
    // 401, transport/contract/storage failures keep the original command intact.
    if (this.current())
      this.emit({ error: "续读同步未完成，本机位置已保留。" });
  }
  private async readCloud() {
    const cloud = await this.api.read(this.book);
    this.guard();
    this.emit({ cloud });
    await this.change((r) => {
      if (r.pending) return r;
      const revision = cloud.position?.revision ?? 0;
      if (r.candidate) {
        return {
          ...r,
          cloud: cloud.position,
          conflict:
            r.conflict ||
            (r.base === null ? cloud.position !== null : r.base !== revision),
          base: r.base === null && cloud.position === null ? 0 : r.base,
        };
      }
      return {
        ...r,
        base: revision,
        cloud: cloud.position,
        conflict: false,
        blocked: false,
      };
    });
  }
  /** A restored unknown operation is only queried; restore never POSTs. */
  async refresh() {
    if (this.remote || !this.online()) return;
    this.remote = true;
    this.emit({ busy: true, error: "" });
    try {
      await this.tail;
      this.guard();
      const input = this.state.record?.pending;
      if (input) {
        try {
          await this.acknowledge(
            await this.api.receipt(this.book, input.mutation_id, input),
            input,
          );
        } catch (e) {
          if (!this.current()) throw e;
          this.emit({ error: "原续读请求尚未确认，请查询或重试原请求。" });
        }
      }
      await this.readCloud();
    } catch {
      if (this.current())
        this.emit({ error: "暂时无法读取云端位置，本机记录保留。" });
    } finally {
      this.remote = false;
      if (this.current()) this.emit({ busy: false });
    }
  }
  /** Explicit retry keeps the identical mutation and input, even after receipt expiry. */
  async sync(retryOriginal = false) {
    if (this.remote || !this.online()) return;
    this.remote = true;
    this.emit({ busy: true, error: "" });
    try {
      await this.tail;
      this.guard();
      let record = this.state.record;
      if (record?.pending) {
        if (!retryOriginal) return;
      } else {
        if (!record?.candidate || record.conflict || record.blocked) return;
        if (record.base === null) {
          await this.readCloud();
          record = this.state.record;
          if (!record || record.base === null || record.conflict) return;
        }
        await this.change((r) => ({
          ...r,
          pending: {
            ...r.candidate!,
            base_revision: r.base!,
            mutation_id: this.uuid(),
          },
        }));
      }
      const input = this.state.record!.pending!;
      try {
        await this.acknowledge(await this.api.save(this.book, input), input);
      } catch (e) {
        await this.failure(e, input);
      }
    } finally {
      this.remote = false;
      if (this.current()) this.emit({ busy: false });
    }
  }
  async chooseCloud() {
    if (!this.online() || this.remote || this.state.record?.pending)
      throw new ApiError("reading_request_pending");
    await this.refresh();
    if (!this.state.cloud || this.state.error) throw new ApiError("network");
    await this.change((r) => ({
      ...r,
      base: this.state.cloud!.position?.revision ?? 0,
      cloud: this.state.cloud!.position,
      candidate: null,
      conflict: false,
      blocked: false,
    }));
    return this.state.cloud;
  }
  async chooseLocal() {
    if (!this.online() || this.remote || this.state.record?.pending)
      throw new ApiError("reading_request_pending");
    await this.refresh();
    if (!this.state.cloud || this.state.error) throw new ApiError("network");
    await this.change((r) => ({
      ...r,
      base: this.state.cloud!.position?.revision ?? 0,
      cloud: this.state.cloud!.position,
      conflict: false,
      blocked: false,
    }));
    await this.sync();
  }
}
