import { ApiError } from "../api/client.ts";
import { id } from "../drafts/model.ts";
import {
  checkedShelfWrite,
  checkedShelfReceipt,
  type NovelShelfApi,
  type ShelfWrite,
  type ShelfReceipt,
} from "./shelf-api.ts";
export type ShelfRecord = {
  format: 1;
  token: string;
  owner: string;
  book: string;
  input: ShelfWrite;
  receipt: ShelfReceipt | null;
  rejection: string | null;
};
export interface ShelfJournal {
  load(): Promise<ShelfRecord | null>;
  save(value: ShelfRecord | null, expectedToken: string | null): Promise<void>;
}
const rejected = [
  "novel_shelf_conflict",
  "mutation_id_reused",
  "invalid_input",
  "resource_not_found",
];
export function checkedShelfRecord(
  v: unknown,
  owner: string,
): ShelfRecord | null {
  if (v === null) return null;
  try {
    if (
      !v ||
      typeof v !== "object" ||
      Array.isArray(v) ||
      Object.keys(v).length !== 7 ||
      ![
        "format",
        "token",
        "owner",
        "book",
        "input",
        "receipt",
        "rejection",
      ].every((k) => Object.hasOwn(v, k))
    )
      throw new Error();
    const r = v as ShelfRecord;
    if (
      r.format !== 1 ||
      r.owner !== owner ||
      !id(owner) ||
      !id(r.token) ||
      !id(r.book) ||
      (r.rejection !== null && !rejected.includes(r.rejection)) ||
      (r.receipt !== null && r.rejection !== null)
    )
      throw new Error();
    checkedShelfWrite(r.book, r.input);
    if (r.receipt !== null) checkedShelfReceipt(r.receipt, r.book, r.input);
    return r;
  } catch {
    throw new ApiError("storage");
  }
}
type ShelfView = {
  loaded: boolean;
  busy: boolean;
  record: ShelfRecord | null;
  error: unknown;
};
/** One account-scoped pending command. Mount/load never posts or forgets an unknown result. */
export class ShelfOperations {
  private value: ShelfView = {
    loaded: false,
    busy: false,
    record: null,
    error: undefined,
  };
  private listeners = new Set<() => void>();
  private loading: Promise<ShelfRecord | null> | null = null;
  private owner: string;
  private journal: ShelfJournal;
  private api: NovelShelfApi;
  private current: () => boolean;
  private uuid: () => string;
  constructor(
    owner: string,
    journal: ShelfJournal,
    api: NovelShelfApi,
    current: () => boolean,
    uuid: () => string,
  ) {
    if (!id(owner)) throw new ApiError("invalid_input");
    this.owner = owner;
    this.journal = journal;
    this.api = api;
    this.current = current;
    this.uuid = uuid;
  }
  snapshot = () => this.value;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private guard() {
    if (!this.current()) throw new ApiError("stale_session");
  }
  private update(partial: Partial<ShelfView>) {
    this.value = { ...this.value, ...partial };
    for (const f of this.listeners) f();
  }
  private async once<T>(f: () => Promise<T>) {
    this.guard();
    if (this.value.busy) throw new ApiError("novel_request_pending");
    this.update({ busy: true, error: undefined });
    try {
      return await f();
    } catch (e) {
      if (this.current()) this.update({ error: e });
      throw e;
    } finally {
      if (this.current()) this.update({ busy: false });
    }
  }
  private async save(r: ShelfRecord | null) {
    this.guard();
    checkedShelfRecord(r, this.owner);
    await this.journal.save(r, this.value.record?.token ?? null);
    this.guard();
    this.update({ record: r });
  }
  load() {
    if (this.loading) return this.loading;
    const task = this.once(async () => {
      const r = await this.journal.load();
      this.guard();
      this.update({ loaded: true, record: checkedShelfRecord(r, this.owner) });
      return this.value.record;
    });
    this.loading = task;
    void task.then(
      () => {
        this.loading = null;
      },
      () => {
        this.loading = null;
      },
    );
    return task;
  }
  async start(book: string, input: ShelfWrite) {
    return this.once(async () => {
      if (!this.value.loaded || this.value.record)
        throw new ApiError("novel_request_pending");
      checkedShelfWrite(book, input);
      await this.save({
        format: 1,
        token: this.uuid(),
        owner: this.owner,
        book,
        input: JSON.parse(JSON.stringify(input)),
        receipt: null,
        rejection: null,
      });
      return this.send(false);
    });
  }
  private async send(confirm: boolean) {
    const r = this.value.record;
    if (!r || r.receipt || r.rejection) throw new ApiError("invalid_input");
    try {
      const receipt = await (confirm
        ? this.api.receipt(r.book, r.input)
        : this.api.write(r.book, r.input));
      this.guard();
      await this.save({ ...r, token: this.uuid(), receipt });
      return receipt;
    } catch (e) {
      this.guard();
      if (
        !confirm &&
        e instanceof ApiError &&
        rejected.includes(e.code) &&
        ((e.status === 409 &&
          ["novel_shelf_conflict", "mutation_id_reused"].includes(e.code)) ||
          (e.status === 400 && e.code === "invalid_input") ||
          (e.status === 404 && e.code === "resource_not_found"))
      )
        await this.save({ ...r, token: this.uuid(), rejection: e.code });
      throw e;
    }
  }
  async confirm() {
    return this.once(() => this.send(true));
  }
  async retry() {
    return this.once(() => this.send(false));
  }
  async clear() {
    return this.once(async () => {
      if (
        !this.value.loaded ||
        !this.value.record ||
        (!this.value.record.receipt && !this.value.record.rejection)
      )
        throw new ApiError("novel_request_pending");
      await this.save(null);
    });
  }
}
