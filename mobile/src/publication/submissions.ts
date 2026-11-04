import type { components } from "../api/contract";
import { ApiError } from "../api/client.ts";
import type { Transport } from "../auth/session.ts";
import { id, integer, date } from "../drafts/model.ts";
import { checkedPreview } from "../api/publications.ts";
import type { JournalStore } from "./flow.ts";
export type WorkSubmission = components["schemas"]["WorkSubmission"];
export type WorkSubmissionPage = components["schemas"]["WorkSubmissionPage"];
export type WorkSubmissionDetail =
  components["schemas"]["WorkSubmissionDetail"];
export type WorkSubmissionReceipt =
  components["schemas"]["WorkSubmissionReceipt"];
const fail = () => {
  throw new ApiError("contract");
};
export function checkedWorkSubmission(s: WorkSubmission) {
  if (
    !s ||
    !id(s.id) ||
    !id(s.work_id) ||
    !id(s.preview_id) ||
    !integer(s.candidate_version, 1) ||
    !["pending", "published", "rejected", "withdrawn", "superseded"].includes(
      s.state,
    ) ||
    typeof s.title !== "string" ||
    !s.title.trim() ||
    Array.from(s.title).length > 200 ||
    typeof s.reason !== "string" ||
    Array.from(s.reason).length > 2000 ||
    !date(s.accepted_at) ||
    !date(s.first_waiting_at) ||
    (s.state === "pending" ? s.decided_at !== null : !date(s.decided_at))
  )
    fail();
  return s;
}
export class WorkSubmissionsApi {
  private transport: Transport;
  constructor(transport: Transport) {
    this.transport = transport;
  }
  async list(work = "", cursor = "") {
    if (
      (work && !id(work)) ||
      typeof cursor !== "string" ||
      cursor.length > 512
    )
      throw new ApiError("invalid_input");
    const q = new URLSearchParams();
    if (work) q.set("work", work);
    if (cursor) q.set("cursor", cursor);
    const p = await this.transport<WorkSubmissionPage>(
      "/my/work-submissions" + (q.size ? "?" + q : ""),
    );
    if (
      !p ||
      !Array.isArray(p.items) ||
      p.items.length > 20 ||
      typeof p.next_cursor !== "string" ||
      p.next_cursor.length > 512 ||
      (cursor && p.next_cursor === cursor) ||
      new Set(p.items.map((s) => s?.id)).size !== p.items.length
    )
      fail();
    for (const item of p.items) {
      checkedWorkSubmission(item);
      if (work && item.work_id !== work) fail();
    }
    return p;
  }
  async detail(target: string) {
    if (!id(target)) throw new ApiError("invalid_input");
    const d = await this.transport<WorkSubmissionDetail>(
      `/my/work-submissions/${target}`,
    );
    const s = checkedWorkSubmission(d?.submission);
    if (s.id !== target) fail();
    const p = checkedPreview(d.preview);
    if (
      p.id !== s.preview_id ||
      p.title !== s.title ||
      p.expected_version + 1 !== s.candidate_version
    )
      fail();
    return d;
  }
  async withdraw(
    submission: string,
    work: string,
    mutation: string,
    query = false,
  ) {
    if (!id(submission) || !id(work) || !id(mutation))
      throw new ApiError("invalid_input");
    const r = await this.transport<WorkSubmissionReceipt>(
      query
        ? `/work-submission-requests/${mutation}`
        : `/my/work-submissions/${submission}/withdraw`,
      query ? undefined : { method: "POST", body: { mutation_id: mutation } },
    );
    if (
      !r ||
      r.work_id !== work ||
      r.submission_id !== submission ||
      r.mutation_id !== mutation ||
      r.state !== "withdrawn" ||
      r.version !== 0
    )
      fail();
    return r;
  }
}
export type WithdrawRecord = {
  v: 1;
  owner: string;
  submission: string;
  work: string;
  mutation: string;
  state: "unknown" | "done" | "rejected";
};
const locks = new Set<string>();
export class WorkSubmissionWithdrawal {
  record: WithdrawRecord | null = null;
  private owner: string;
  private store: JournalStore;
  private api: WorkSubmissionsApi;
  private current: () => boolean;
  private uuid: () => string;
  constructor(
    owner: string,
    store: JournalStore,
    api: WorkSubmissionsApi,
    current: () => boolean,
    uuid: () => string,
  ) {
    this.owner = owner;
    this.store = store;
    this.api = api;
    this.current = current;
    this.uuid = uuid;
  }
  private guard() {
    if (!this.current()) throw new ApiError("stale_session");
  }
  private parse(raw: string | null) {
    if (!raw) return null;
    let r: WithdrawRecord;
    try {
      r = JSON.parse(raw);
    } catch {
      throw new ApiError("storage");
    }
    if (
      !r ||
      Object.keys(r).sort().join() !==
        ["v", "owner", "submission", "work", "mutation", "state"]
          .sort()
          .join() ||
      r.v !== 1 ||
      r.owner !== this.owner ||
      !id(r.submission) ||
      !id(r.work) ||
      !id(r.mutation) ||
      !["unknown", "done", "rejected"].includes(r.state)
    )
      throw new ApiError("storage");
    return r;
  }
  private async locked<T>(f: () => Promise<T>) {
    this.guard();
    if (locks.has(this.owner)) throw new ApiError("operation_pending");
    locks.add(this.owner);
    try {
      return await f();
    } finally {
      locks.delete(this.owner);
    }
  }
  async restore() {
    return this.locked(async () => {
      const r = this.parse(await this.store.get());
      this.guard();
      this.record = r;
      return r;
    });
  }
  async start(s: WorkSubmission) {
    return this.locked(async () => {
      if (this.parse(await this.store.get()))
        throw new ApiError("operation_pending");
      this.guard();
      const r: WithdrawRecord = {
        v: 1,
        owner: this.owner,
        submission: s.id,
        work: s.work_id,
        mutation: this.uuid(),
        state: "unknown",
      };
      this.parse(JSON.stringify(r));
      await this.store.set(JSON.stringify(r));
      this.guard();
      this.record = r;
      await this.send(false);
    });
  }
  private async send(query: boolean) {
    const r = this.record;
    if (!r) return;
    try {
      await this.api.withdraw(r.submission, r.work, r.mutation, query);
      this.guard();
      const done: WithdrawRecord = { ...r, state: "done" };
      await this.store.set(JSON.stringify(done));
      this.guard();
      this.record = done;
    } catch (e) {
      this.guard();
      if (
        !query &&
        e instanceof ApiError &&
        e.status === 409 &&
        e.code === "review_conflict"
      ) {
        const rejected: WithdrawRecord = { ...r, state: "rejected" };
        await this.store.set(JSON.stringify(rejected));
        this.guard();
        this.record = rejected;
      }
      throw e;
    }
  }
  async confirm() {
    return this.locked(async () => {
      this.record = this.parse(await this.store.get());
      this.guard();
      await this.send(true);
    });
  }
  async retry() {
    return this.locked(async () => {
      this.record = this.parse(await this.store.get());
      this.guard();
      if (this.record?.state !== "unknown")
        throw new ApiError("operation_pending");
      await this.send(false);
    });
  }
  async clear() {
    return this.locked(async () => {
      const r = this.parse(await this.store.get());
      this.guard();
      if (!r || r.state === "unknown") throw new ApiError("operation_pending");
      await this.store.remove();
      this.guard();
      this.record = null;
    });
  }
}
