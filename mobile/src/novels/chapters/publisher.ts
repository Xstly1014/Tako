import { ApiError } from "../../api/client.ts";
import { id, integer } from "../../drafts/model.ts";
import {
  checkedChapterReceipt,
  checkedChapterPreview,
  type ChapterPrepare,
  type ChapterSubmit,
  type ChapterPreview,
  type ChapterReceipt,
  type ChapterPublicationApi,
} from "./publication-api.ts";
const rejectedCodes = [
  "novel_state_conflict",
  "chapter_publication_conflict",
  "novel_revision_conflict",
  "source_revision_unavailable",
  "novel_restricted",
  "chapter_preview_expired",
];
export type ChapterPublicationRecord = {
  format: 1;
  token: string;
  book: string;
  chapter: string | null;
  prepare: ChapterPrepare;
  prepared: ChapterReceipt | null;
  target: { ordinal: number; version: number } | null;
  submit: ChapterSubmit | null;
  result: ChapterReceipt | null;
  rejection: string | null;
};
export interface ChapterPublicationJournal {
  load(): Promise<ChapterPublicationRecord | null>;
  /** Atomic compare-and-set. null expected means there must be no pending record. */
  save(
    value: ChapterPublicationRecord | null,
    expectedToken: string | null,
  ): Promise<void>;
}
function shape(v: unknown, keys: string[]): v is Record<string, unknown> {
  return (
    !!v &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    Object.keys(v).length === keys.length &&
    keys.every((key) => Object.hasOwn(v, key))
  );
}
export function checkedPublicationRecord(
  value: unknown,
): ChapterPublicationRecord | null {
  if (value === null) return null;
  if (
    !shape(value, [
      "format",
      "token",
      "book",
      "chapter",
      "prepare",
      "prepared",
      "target",
      "submit",
      "result",
      "rejection",
    ])
  )
    throw new ApiError("storage");
  const v = value as unknown as ChapterPublicationRecord;
  if (
    v.format !== 1 ||
    !id(v.token) ||
    !id(v.book) ||
    !(v.chapter === null || id(v.chapter)) ||
    !shape(v.prepare, [
      "mutation_id",
      "draft_id",
      "source_revision",
      "book_revision",
    ]) ||
    !id(v.prepare.mutation_id) ||
    !id(v.prepare.draft_id) ||
    !integer(v.prepare.source_revision, 1) ||
    !integer(v.prepare.book_revision, 1)
  )
    throw new ApiError("storage");
  if ((v.prepared === null) !== (v.chapter === null))
    throw new ApiError("storage");
  const receiptKeys = [
    "mutation_id",
    "operation",
    "novel_id",
    "chapter_id",
    "preview_id",
    "submission_id",
    "ordinal",
    "state",
    "version",
    "accepted_at",
  ];
  if (v.prepared !== null) {
    if (!shape(v.prepared, receiptKeys)) throw new ApiError("storage");
    checkedChapterReceipt(v.prepared, {
      novel: v.book,
      mutation: v.prepare.mutation_id,
      operation: "prepare",
    });
    if (v.prepared.chapter_id !== v.chapter) throw new ApiError("storage");
  }
  if (
    v.target !== null &&
    (!v.prepared ||
      !shape(v.target, ["ordinal", "version"]) ||
      !integer(v.target.ordinal, 1) ||
      !integer(v.target.version, 1) ||
      v.target.ordinal !== v.prepared.ordinal)
  )
    throw new ApiError("storage");
  if (
    v.submit !== null &&
    (!v.prepared ||
      !v.target ||
      !shape(v.submit, ["mutation_id", "preview_id", "rights_confirmed"]) ||
      !id(v.submit.mutation_id) ||
      v.submit.mutation_id === v.prepare.mutation_id ||
      v.submit.preview_id !== v.prepared.preview_id ||
      v.submit.rights_confirmed !== true)
  )
    throw new ApiError("storage");
  if (v.result !== null) {
    if (!shape(v.result, receiptKeys)) throw new ApiError("storage");
    if (!v.submit || !v.target) throw new ApiError("storage");
    checkedChapterReceipt(v.result, {
      novel: v.book,
      mutation: v.submit.mutation_id,
      operation: "submit",
      preview: v.submit.preview_id,
    });
    if (
      v.result.chapter_id !== v.chapter ||
      v.result.ordinal !== v.target.ordinal ||
      (v.result.state === "published" && v.result.version !== v.target.version)
    )
      throw new ApiError("storage");
  }
  if (
    v.rejection !== null &&
    (!rejectedCodes.includes(v.rejection) || v.result)
  )
    throw new ApiError("storage");
  return v;
}
type Api = Pick<
  ChapterPublicationApi,
  "prepare" | "preview" | "submit" | "retrySubmit" | "receipt"
>;
export class ChapterPublisher {
  private record: ChapterPublicationRecord | null = null;
  private loaded = false;
  private busy = false;
  private api: Api;
  private journal: ChapterPublicationJournal;
  private current: () => boolean;
  private uuid: () => string;
  constructor(
    api: Api,
    journal: ChapterPublicationJournal,
    current: () => boolean,
    uuid: () => string,
  ) {
    this.api = api;
    this.journal = journal;
    this.current = current;
    this.uuid = uuid;
  }
  snapshot() {
    this.guard();
    return this.record
      ? (JSON.parse(JSON.stringify(this.record)) as ChapterPublicationRecord)
      : null;
  }
  private guard() {
    if (!this.current()) throw new ApiError("stale_session");
  }
  private async exclusive<T>(run: () => Promise<T>) {
    this.guard();
    if (this.busy) throw new ApiError("novel_request_pending");
    this.busy = true;
    try {
      return await run();
    } finally {
      this.busy = false;
    }
  }
  private async persist(next: ChapterPublicationRecord | null) {
    this.guard();
    checkedPublicationRecord(next);
    await this.journal.save(next, this.record?.token ?? null);
    this.guard();
    this.record = next;
  }
  async load() {
    return this.exclusive(async () => {
      const value = await this.journal.load();
      this.guard();
      this.record = checkedPublicationRecord(value);
      this.loaded = true;
      return this.snapshot(); // Loading never POSTs or silently retries.
    });
  }
  async begin(
    book: string,
    source: { draft: string; revision: number; bookRevision: number },
  ) {
    return this.exclusive(async () => {
      if (!this.loaded || this.record)
        throw new ApiError("novel_request_pending");
      if (
        !id(book) ||
        !id(source.draft) ||
        !integer(source.revision, 1) ||
        !integer(source.bookRevision, 1)
      )
        throw new ApiError("invalid_input");
      await this.persist({
        format: 1,
        token: this.uuid(),
        book,
        chapter: null,
        prepare: {
          mutation_id: this.uuid(),
          draft_id: source.draft,
          source_revision: source.revision,
          book_revision: source.bookRevision,
        },
        prepared: null,
        target: null,
        submit: null,
        result: null,
        rejection: null,
      });
      return this.sendOriginal();
    });
  }
  private async accept(receipt: ChapterReceipt) {
    this.guard();
    const record = this.record;
    if (
      !record ||
      (record.chapter !== null && receipt.chapter_id !== record.chapter)
    )
      throw new ApiError("contract");
    const next = { ...record, chapter: receipt.chapter_id, token: this.uuid() };
    if (record.submit)
      next.result = checkedChapterReceipt(receipt, {
        novel: record.book,
        mutation: record.submit.mutation_id,
        operation: "submit",
        preview: record.submit.preview_id,
      });
    else
      next.prepared = checkedChapterReceipt(receipt, {
        novel: record.book,
        mutation: record.prepare.mutation_id,
        operation: "prepare",
      });
    await this.persist(next);
    return this.snapshot();
  }
  private async sendOriginal() {
    const r = this.record;
    if (!r) throw new ApiError("invalid_input");
    try {
      const receipt = r.submit
        ? await this.api.retrySubmit(r.book, r.submit, {
            chapter: r.chapter!,
            ordinal: r.target!.ordinal,
            version: r.target!.version,
          })
        : await this.api.prepare(r.book, r.prepare);
      return await this.accept(receipt);
    } catch (e) {
      this.guard();
      if (
        e instanceof ApiError &&
        ((e.status === 409 &&
          rejectedCodes.includes(e.code) &&
          e.code !== "chapter_preview_expired") ||
          (e.status === 410 && e.code === "chapter_preview_expired"))
      )
        await this.persist({ ...r, token: this.uuid(), rejection: e.code });
      throw e;
    }
  }
  async retryOriginal() {
    return this.exclusive(async () => {
      if (
        !this.loaded ||
        !this.record ||
        this.record.rejection ||
        this.record.result ||
        (!this.record.submit && this.record.prepared)
      )
        throw new ApiError("invalid_input");
      return this.sendOriginal();
    });
  }
  async confirmOriginal() {
    return this.exclusive(async () => {
      const r = this.record;
      if (!this.loaded || !r) throw new ApiError("invalid_input");
      if (r.rejection || r.result || (!r.submit && r.prepared))
        return this.snapshot();
      const receipt = await this.api.receipt({
        novel: r.book,
        mutation: r.submit?.mutation_id ?? r.prepare.mutation_id,
        operation: r.submit ? "submit" : "prepare",
        ...(r.submit ? { preview: r.submit.preview_id } : {}),
      });
      return this.accept(receipt);
    });
  }
  async readPreview() {
    return this.exclusive(async () => {
      const r = this.record;
      if (!this.loaded || !r?.prepared || r.rejection || r.submit)
        throw new ApiError("invalid_input");
      const value = await this.api.preview(r.book, r.prepared.preview_id, {
        draft: r.prepare.draft_id,
        revision: r.prepare.source_revision,
      });
      this.guard();
      checkedChapterPreview(value, r.book, r.prepared.preview_id);
      if (
        value.chapter_id !== r.chapter ||
        value.ordinal !== r.prepared.ordinal
      )
        throw new ApiError("contract");
      await this.persist({
        ...r,
        token: this.uuid(),
        target: { ordinal: value.ordinal, version: value.candidate_version },
      });
      return value; // Plaintext is intentionally absent from the encrypted journal.
    });
  }
  async submit(snapshot: ChapterPreview, rightsConfirmed: boolean) {
    return this.exclusive(async () => {
      const r = this.record;
      if (
        !this.loaded ||
        !r?.prepared ||
        !r.target ||
        r.rejection ||
        r.submit ||
        !rightsConfirmed
      )
        throw new ApiError("invalid_input");
      checkedChapterPreview(snapshot, r.book, r.prepared.preview_id);
      if (
        snapshot.chapter_id !== r.chapter ||
        snapshot.draft_id !== r.prepare.draft_id ||
        snapshot.source_revision !== r.prepare.source_revision ||
        snapshot.ordinal !== r.target.ordinal ||
        snapshot.candidate_version !== r.target.version
      )
        throw new ApiError("contract");
      const submit: ChapterSubmit = {
        mutation_id: this.uuid(),
        preview_id: r.prepared.preview_id,
        rights_confirmed: true,
      };
      await this.persist({ ...r, token: this.uuid(), submit });
      // Use the durable original body even if the result was accepted but its response is lost.
      return this.sendOriginal();
    });
  }
  async clear() {
    return this.exclusive(async () => {
      if (
        !this.loaded ||
        !this.record ||
        (!this.record.result &&
          !this.record.rejection &&
          (this.record.submit || !this.record.prepared))
      )
        throw new ApiError("novel_request_pending");
      await this.persist(null);
    });
  }
}
