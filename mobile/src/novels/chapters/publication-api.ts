import type { components } from "../../api/contract";
import { ApiError } from "../../api/client.ts";
import type { Transport } from "../../auth/session.ts";
import { validMetadata } from "../../api/novels.ts";
import { date, id, integer, text } from "../../drafts/model.ts";

export type ChapterPreview = components["schemas"]["ChapterPublicationPreview"];
export type ChapterReceipt = components["schemas"]["ChapterPublicationReceipt"];
export type ChapterPrepare = components["schemas"]["PrepareChapter"];
export type ChapterSubmit = components["schemas"]["SubmitChapter"];
export type ChapterSubmission =
  components["schemas"]["ChapterSubmissionSummary"];
export type ChapterSubmissionDetail =
  components["schemas"]["ChapterSubmissionDetail"];
type SubmissionPage = components["schemas"]["ChapterSubmissionPage"];
export type ReceiptTarget = {
  novel: string;
  mutation: string;
  operation: ChapterReceipt["operation"];
  preview?: string;
  submission?: string;
};

export function checkedChapterReceipt(
  v: ChapterReceipt,
  expected: ReceiptTarget,
) {
  if (
    !v ||
    !id(v.mutation_id) ||
    !id(v.novel_id) ||
    !id(v.chapter_id) ||
    !id(v.preview_id) ||
    !integer(v.ordinal, 1) ||
    !integer(v.version) ||
    !date(v.accepted_at) ||
    v.novel_id !== expected.novel ||
    v.mutation_id !== expected.mutation ||
    v.operation !== expected.operation ||
    (expected.preview !== undefined && v.preview_id !== expected.preview) ||
    (expected.submission !== undefined &&
      v.submission_id !== expected.submission)
  )
    throw new ApiError("contract");
  const states = {
    prepare: ["prepared"],
    submit: ["pending", "published"],
    review: ["published", "rejected"],
    withdraw: ["withdrawn"],
  };
  if (
    !states[v.operation]?.includes(v.state) ||
    (v.operation === "prepare"
      ? v.submission_id !== null
      : !id(v.submission_id)) ||
    (v.state === "published" ? v.version < 1 : v.version !== 0)
  )
    throw new ApiError("contract");
  return v;
}

export function checkedChapterPreview(
  v: ChapterPreview,
  book: string,
  preview: string,
) {
  if (
    !v ||
    v.novel_id !== book ||
    v.id !== preview ||
    !id(v.id) ||
    !id(v.novel_id) ||
    !id(v.chapter_id) ||
    !id(v.draft_id) ||
    !integer(v.source_revision, 1) ||
    !integer(v.ordinal, 1) ||
    !integer(v.expected_last_position) ||
    !integer(v.expected_version) ||
    !integer(v.candidate_version, 1) ||
    v.candidate_version !== v.expected_version + 1 ||
    !text(v.title, v.content) ||
    !v.title.trim() ||
    !v.content.trim() ||
    !validMetadata({
      title: v.book_title,
      introduction: v.introduction,
      tags: v.tags,
    }) ||
    !date(v.expires_at) ||
    ![
      v.reserved,
      v.review_required,
      v.book_hidden,
      v.chapter_hidden,
      v.restricted,
    ].every((x) => typeof x === "boolean") ||
    (v.reserved
      ? v.ordinal > v.expected_last_position
      : v.ordinal !== v.expected_last_position + 1)
  )
    throw new ApiError("contract");
  return v;
}

function checkedSubmission(v: ChapterSubmission, book: string) {
  if (
    !v ||
    !id(v.id) ||
    !id(v.novel_id) ||
    v.novel_id !== book ||
    !id(v.chapter_id) ||
    !id(v.preview_id) ||
    !integer(v.ordinal, 1) ||
    !integer(v.candidate_version, 1) ||
    typeof v.title !== "string" ||
    Array.from(v.title).length > 200 ||
    !v.title.trim() ||
    !["pending", "published", "rejected", "withdrawn", "superseded"].includes(
      v.state,
    ) ||
    typeof v.current !== "boolean" ||
    (v.current && v.state !== "pending") ||
    typeof v.reason !== "string" ||
    Array.from(v.reason).length > 2000 ||
    !date(v.submitted_at) ||
    !(v.decided_at === null || date(v.decided_at))
  )
    throw new ApiError("contract");
  return v;
}
const cursor = (v: unknown): v is string =>
  typeof v === "string" && v.length <= 512 && /^[A-Za-z0-9_-]*$/.test(v);

// Novel requests use a separate domain; a chapter must never be handed to the
// middle-form publication API. The session-bound transport supplies identity.
export class ChapterPublicationApi {
  private transport: Transport;
  constructor(transport: Transport) {
    this.transport = transport;
  }
  private root(book: string) {
    if (!id(book)) throw new ApiError("invalid_input");
    return `/my/novels/${book}`;
  }
  async prepare(book: string, input: ChapterPrepare) {
    const root = this.root(book);
    if (
      !id(input.mutation_id) ||
      !id(input.draft_id) ||
      !integer(input.source_revision, 1) ||
      !integer(input.book_revision, 1)
    )
      throw new ApiError("invalid_input");
    return checkedChapterReceipt(
      await this.transport<ChapterReceipt>(root + "/chapter-previews", {
        method: "POST",
        body: input,
      }),
      { novel: book, mutation: input.mutation_id, operation: "prepare" },
    );
  }
  async preview(
    book: string,
    preview: string,
    source?: { draft: string; revision: number },
    signal?: AbortSignal,
  ) {
    const root = this.root(book);
    if (!id(preview)) throw new ApiError("invalid_input");
    const value = checkedChapterPreview(
      await this.transport<ChapterPreview>(
        root + "/chapter-previews/" + preview,
        { signal },
      ),
      book,
      preview,
    );
    if (
      source &&
      (value.draft_id !== source.draft ||
        value.source_revision !== source.revision)
    )
      throw new ApiError("contract");
    return value;
  }
  async submit(book: string, input: ChapterSubmit, snapshot: ChapterPreview) {
    const root = this.root(book);
    checkedChapterPreview(snapshot, book, input.preview_id);
    if (!id(input.mutation_id) || input.rights_confirmed !== true)
      throw new ApiError("invalid_input");
    const receipt = checkedChapterReceipt(
      await this.transport<ChapterReceipt>(root + "/chapter-submissions", {
        method: "POST",
        body: input,
      }),
      {
        novel: book,
        mutation: input.mutation_id,
        operation: "submit",
        preview: input.preview_id,
      },
    );
    if (
      receipt.chapter_id !== snapshot.chapter_id ||
      receipt.ordinal !== snapshot.ordinal ||
      (receipt.state === "published" &&
        receipt.version !== snapshot.candidate_version)
    )
      throw new ApiError("contract");
    return receipt;
  }
  // Recovery must not depend on re-fetching a possibly expired preview body.
  async retrySubmit(
    book: string,
    input: ChapterSubmit,
    target: { chapter: string; ordinal: number; version: number },
  ) {
    const root = this.root(book);
    if (
      !id(input.mutation_id) ||
      !id(input.preview_id) ||
      input.rights_confirmed !== true ||
      !id(target.chapter) ||
      !integer(target.ordinal, 1) ||
      !integer(target.version, 1)
    )
      throw new ApiError("invalid_input");
    const receipt = checkedChapterReceipt(
      await this.transport<ChapterReceipt>(root + "/chapter-submissions", {
        method: "POST",
        body: input,
      }),
      {
        novel: book,
        mutation: input.mutation_id,
        operation: "submit",
        preview: input.preview_id,
      },
    );
    if (
      receipt.chapter_id !== target.chapter ||
      receipt.ordinal !== target.ordinal ||
      (receipt.state === "published" && receipt.version !== target.version)
    )
      throw new ApiError("contract");
    return receipt;
  }
  async receipt(expected: ReceiptTarget) {
    const root = this.root(expected.novel);
    if (!id(expected.mutation)) throw new ApiError("invalid_input");
    return checkedChapterReceipt(
      await this.transport<ChapterReceipt>(
        root + "/publication-requests/" + expected.mutation,
      ),
      expected,
    );
  }
  async list(book: string, token = "", signal?: AbortSignal) {
    const root = this.root(book);
    if (!cursor(token)) throw new ApiError("invalid_input");
    const page = await this.transport<SubmissionPage>(
      root +
        "/chapter-submissions" +
        (token ? "?cursor=" + encodeURIComponent(token) : ""),
      { signal },
    );
    if (
      !page ||
      !Array.isArray(page.items) ||
      page.items.length > 20 ||
      !cursor(page.next_cursor) ||
      (token && page.next_cursor === token) ||
      new Set(page.items.map((x) => x?.id)).size !== page.items.length
    )
      throw new ApiError("contract");
    page.items.forEach((item) => checkedSubmission(item, book));
    return page;
  }
  async chapterHistory(
    book: string,
    chapter: string,
    token = "",
    signal?: AbortSignal,
  ) {
    const root = this.root(book);
    if (!id(chapter) || !cursor(token)) throw new ApiError("invalid_input");
    const page = await this.transport<SubmissionPage>(
      root +
        `/chapters/${chapter}/submissions` +
        (token ? "?cursor=" + encodeURIComponent(token) : ""),
      { signal },
    );
    if (
      !page ||
      !Array.isArray(page.items) ||
      page.items.length > 20 ||
      !cursor(page.next_cursor) ||
      (token && token === page.next_cursor) ||
      new Set(page.items.map((x) => x?.id)).size !== page.items.length
    )
      throw new ApiError("contract");
    for (const item of page.items) {
      checkedSubmission(item, book);
      if (item.chapter_id !== chapter) throw new ApiError("contract");
    }
    return page;
  }
  async detail(book: string, submission: string, signal?: AbortSignal) {
    const root = this.root(book);
    if (!id(submission)) throw new ApiError("invalid_input");
    const detail = await this.transport<ChapterSubmissionDetail>(
      root + "/chapter-submissions/" + submission,
      { signal },
    );
    if (!detail) throw new ApiError("contract");
    const item = checkedSubmission(detail.submission, book);
    const p = checkedChapterPreview(detail.preview, book, item.preview_id);
    if (
      item.id !== submission ||
      item.chapter_id !== p.chapter_id ||
      item.title !== p.title ||
      item.ordinal !== p.ordinal ||
      item.candidate_version !== p.candidate_version
    )
      throw new ApiError("contract");
    return detail;
  }
  async withdraw(book: string, submission: string, mutation: string) {
    const root = this.root(book);
    if (!id(submission) || !id(mutation)) throw new ApiError("invalid_input");
    return checkedChapterReceipt(
      await this.transport<ChapterReceipt>(
        root + "/chapter-submissions/" + submission + "/withdraw",
        {
          method: "POST",
          body: { mutation_id: mutation },
        },
      ),
      { novel: book, mutation, operation: "withdraw", submission },
    );
  }
}
