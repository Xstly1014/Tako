import type { components } from "../api/contract";
import type { Transport } from "../auth/session.ts";
import { ApiError } from "../api/client.ts";
import { validMetadata } from "../api/novels.ts";
import { date, id, integer, text } from "../drafts/model.ts";

export type NovelFormalState = components["schemas"]["NovelFormalState"];
export type NovelChapterState = components["schemas"]["NovelChapterState"];
export type NovelVisibilityAction =
  components["schemas"]["NovelVisibilityAction"];
export type NovelVisibilityReceipt =
  components["schemas"]["NovelVisibilityReceipt"];
export type NovelMetadataReceipt =
  components["schemas"]["NovelMetadataReceipt"];
export type SubmitNovelMetadata = components["schemas"]["SubmitNovelMetadata"];
export type NovelMetadataSubmission =
  components["schemas"]["NovelMetadataSubmission"];
export type NovelChapterVersion = components["schemas"]["NovelChapterVersion"];
type MetadataPage = components["schemas"]["NovelMetadataPage"];
type VersionPage = components["schemas"]["NovelChapterVersionPage"];
const fail = (): never => {
  throw new ApiError("contract");
};
const nullableId = (v: unknown) => v === null || id(v);
const flags = (...v: unknown[]) => v.every((x) => typeof x === "boolean");
const validCursor = (v: unknown): v is string =>
  typeof v === "string" && v.length <= 512 && /^[A-Za-z0-9_-]*$/.test(v);

export function checkedNovelState(v: NovelFormalState, book: string) {
  if (
    !v ||
    v.novel_id !== book ||
    !id(v.novel_id) ||
    !integer(v.state_revision, 1) ||
    !integer(v.last_position) ||
    !nullableId(v.metadata_submission_id) ||
    !flags(v.author_hidden, v.platform_limited, v.completed)
  )
    fail();
  if (
    v.formal !== null &&
    (!v.formal ||
      !validMetadata(v.formal) ||
      !integer(v.formal.revision, 1) ||
      !date(v.formal.first_published_at) ||
      !date(v.formal.updated_at))
  )
    fail();
  return v;
}
export function checkedNovelChapterState(
  v: NovelChapterState,
  book: string,
  chapter: string,
) {
  if (
    !v ||
    v.novel_id !== book ||
    v.chapter_id !== chapter ||
    !id(v.novel_id) ||
    !id(v.chapter_id) ||
    !integer(v.state_revision, 1) ||
    !(v.ordinal === null || integer(v.ordinal, 1)) ||
    !integer(v.last_version) ||
    !integer(v.display_version) ||
    v.display_version > v.last_version ||
    (v.last_version > 0 && (v.ordinal === null || v.display_version === 0)) ||
    !nullableId(v.current_submission_id) ||
    (v.current_submission_id !== null && v.ordinal === null) ||
    !flags(
      v.author_hidden,
      v.platform_limited,
      v.parent_hidden,
      v.parent_limited,
      v.completed,
    )
  )
    fail();
  return v;
}
export function checkedVisibilityReceipt(
  v: NovelVisibilityReceipt,
  book: string,
  chapter: string | null,
  request?: NovelVisibilityAction,
) {
  if (
    !v ||
    v.novel_id !== book ||
    v.chapter_id !== chapter ||
    !id(v.mutation_id) ||
    !integer(v.state_revision, 1) ||
    !integer(v.display_version) ||
    (chapter === null ? v.display_version !== 0 : v.display_version === 0) ||
    !["hide", "restore"].includes(v.action) ||
    !flags(v.author_hidden, v.platform_limited) ||
    (v.action === "hide"
      ? !v.author_hidden
      : v.author_hidden || v.platform_limited) ||
    (request &&
      (v.mutation_id !== request.mutation_id ||
        v.action !== request.action ||
        (v.state_revision !== request.expected_revision &&
          v.state_revision !== request.expected_revision + 1)))
  )
    fail();
  return v;
}
export function checkedMetadataReceipt(
  v: NovelMetadataReceipt,
  book: string,
  mutation: string,
  operation: NovelMetadataReceipt["operation"],
  submission?: string,
) {
  if (
    !v ||
    v.novel_id !== book ||
    v.mutation_id !== mutation ||
    v.operation !== operation ||
    !id(v.novel_id) ||
    !id(v.mutation_id) ||
    !id(v.submission_id) ||
    (submission !== undefined && v.submission_id !== submission) ||
    !integer(v.revision) ||
    !integer(v.candidate_revision, 2) ||
    !integer(v.source_revision, 1) ||
    !["pending", "published", "rejected", "withdrawn"].includes(v.state) ||
    (v.state === "published"
      ? v.revision !== v.candidate_revision
      : v.revision !== 0) ||
    (operation === "submit_metadata" &&
      v.state !== "pending" &&
      v.state !== "published") ||
    (operation === "review_metadata" &&
      v.state !== "published" &&
      v.state !== "rejected") ||
    (operation === "withdraw_metadata" && v.state !== "withdrawn")
  )
    fail();
  return v;
}
function checkedMetadata(v: NovelMetadataSubmission, book: string) {
  if (
    !v ||
    !id(v.id) ||
    v.novel_id !== book ||
    !validMetadata(v) ||
    !integer(v.source_revision, 1) ||
    !integer(v.expected_revision, 1) ||
    !integer(v.candidate_revision, 2) ||
    v.candidate_revision !== v.expected_revision + 1 ||
    !["pending", "published", "rejected", "withdrawn", "superseded"].includes(
      v.state,
    ) ||
    typeof v.current !== "boolean" ||
    (v.current && v.state !== "pending") ||
    typeof v.reason !== "string" ||
    Array.from(v.reason).length > 2000 ||
    !date(v.submitted_at) ||
    !(v.decided_at === null || date(v.decided_at)) ||
    !(v.post_reviewed_at === null || date(v.post_reviewed_at))
  )
    fail();
  return v;
}
export class NovelManagementApi {
  private transport: Transport;
  constructor(transport: Transport) {
    this.transport = transport;
  }
  private root(book: string) {
    if (!id(book)) throw new ApiError("invalid_input");
    return `/my/novels/${book}`;
  }
  async state(book: string, signal?: AbortSignal) {
    return checkedNovelState(
      await this.transport<NovelFormalState>(
        this.root(book) + "/formal-state",
        { signal },
      ),
      book,
    );
  }
  async chapterState(book: string, chapter: string, signal?: AbortSignal) {
    if (!id(chapter)) throw new ApiError("invalid_input");
    return checkedNovelChapterState(
      await this.transport<NovelChapterState>(
        this.root(book) + `/chapters/${chapter}/state`,
        { signal },
      ),
      book,
      chapter,
    );
  }
  async visibility(
    book: string,
    chapter: string | null,
    input: NovelVisibilityAction,
  ) {
    const root = this.root(book);
    if (
      !id(input.mutation_id) ||
      !integer(input.expected_revision, 1) ||
      !["hide", "restore"].includes(input.action) ||
      (chapter !== null && !id(chapter))
    )
      throw new ApiError("invalid_input");
    return checkedVisibilityReceipt(
      await this.transport<NovelVisibilityReceipt>(
        root + (chapter ? `/chapters/${chapter}` : "") + "/visibility",
        { method: "POST", body: input },
      ),
      book,
      chapter,
      input,
    );
  }
  async visibilityReceipt(
    book: string,
    chapter: string | null,
    input: NovelVisibilityAction,
  ) {
    if (!id(input.mutation_id)) throw new ApiError("invalid_input");
    return checkedVisibilityReceipt(
      await this.transport<NovelVisibilityReceipt>(
        this.root(book) + "/visibility-requests/" + input.mutation_id,
      ),
      book,
      chapter,
      input,
    );
  }
  async submitMetadata(book: string, input: SubmitNovelMetadata) {
    const root = this.root(book);
    if (
      !id(input.mutation_id) ||
      !integer(input.source_revision, 1) ||
      !integer(input.expected_revision, 1) ||
      input.rights_confirmed !== true
    )
      throw new ApiError("invalid_input");
    const v = checkedMetadataReceipt(
      await this.transport<NovelMetadataReceipt>(
        root + "/metadata-submissions",
        {
          method: "POST",
          body: input,
        },
      ),
      book,
      input.mutation_id,
      "submit_metadata",
    );
    if (
      v.source_revision !== input.source_revision ||
      v.candidate_revision !== input.expected_revision + 1
    )
      fail();
    return v;
  }
  async metadataReceipt(
    book: string,
    mutation: string,
    operation: NovelMetadataReceipt["operation"],
    submission?: string,
  ) {
    if (!id(mutation)) throw new ApiError("invalid_input");
    return checkedMetadataReceipt(
      await this.transport<NovelMetadataReceipt>(
        this.root(book) + "/metadata-requests/" + mutation,
      ),
      book,
      mutation,
      operation,
      submission,
    );
  }
  async confirmMetadata(book: string, input: SubmitNovelMetadata) {
    const v = await this.metadataReceipt(
      book,
      input.mutation_id,
      "submit_metadata",
    );
    if (
      v.source_revision !== input.source_revision ||
      v.candidate_revision !== input.expected_revision + 1
    )
      fail();
    return v;
  }
  async withdrawMetadata(book: string, submission: string, mutation: string) {
    if (!id(submission) || !id(mutation)) throw new ApiError("invalid_input");
    return checkedMetadataReceipt(
      await this.transport<NovelMetadataReceipt>(
        this.root(book) + `/metadata-submissions/${submission}/withdraw`,
        { method: "POST", body: { mutation_id: mutation } },
      ),
      book,
      mutation,
      "withdraw_metadata",
      submission,
    );
  }
  async metadata(book: string, submission: string, signal?: AbortSignal) {
    if (!id(submission)) throw new ApiError("invalid_input");
    const v = checkedMetadata(
      await this.transport<NovelMetadataSubmission>(
        this.root(book) + "/metadata-submissions/" + submission,
        { signal },
      ),
      book,
    );
    if (v.id !== submission) fail();
    return v;
  }
  async metadataList(book: string, cursor = "", signal?: AbortSignal) {
    if (!validCursor(cursor)) throw new ApiError("invalid_input");
    const page = await this.transport<MetadataPage>(
      this.root(book) +
        "/metadata-submissions" +
        (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""),
      { signal },
    );
    if (
      !page ||
      !Array.isArray(page.items) ||
      page.items.length > 20 ||
      !validCursor(page.next_cursor) ||
      (cursor && page.next_cursor === cursor) ||
      new Set(page.items.map((v) => v?.id)).size !== page.items.length
    )
      fail();
    page.items.forEach((v) => checkedMetadata(v, book));
    return page;
  }
  async version(
    book: string,
    chapter: string,
    version: number,
    signal?: AbortSignal,
  ) {
    if (!id(chapter) || !integer(version, 1))
      throw new ApiError("invalid_input");
    const v = await this.transport<NovelChapterVersion>(
      this.root(book) + `/chapters/${chapter}/versions/${version}`,
      { signal },
    );
    if (
      !v ||
      v.novel_id !== book ||
      v.chapter_id !== chapter ||
      v.version !== version ||
      !text(v.title, v.content) ||
      !v.title.trim() ||
      !v.content.trim() ||
      typeof v.platform_limited !== "boolean" ||
      !date(v.published_at)
    )
      fail();
    return v;
  }
  async versions(
    book: string,
    chapter: string,
    before = 0,
    signal?: AbortSignal,
  ) {
    if (!id(chapter) || !integer(before)) throw new ApiError("invalid_input");
    const page = await this.transport<VersionPage>(
      this.root(book) + `/chapters/${chapter}/versions?before=${before}`,
      { signal },
    );
    if (
      !page ||
      !Array.isArray(page.items) ||
      page.items.length > 50 ||
      !integer(page.next_before) ||
      (page.next_before !== 0 &&
        page.next_before !== page.items.at(-1)?.version)
    )
      fail();
    let last = before;
    for (const v of page.items) {
      if (
        !v ||
        !integer(v.version, 1) ||
        (last !== 0 && v.version >= last) ||
        typeof v.title !== "string" ||
        Array.from(v.title).length > 200 ||
        !v.title.trim() ||
        typeof v.platform_limited !== "boolean" ||
        !date(v.published_at)
      )
        fail();
      last = v.version;
    }
    return page;
  }
}
