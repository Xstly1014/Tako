import type { components } from "../api/contract";
import type { Transport } from "../auth/session.ts";
import { request, ApiError } from "../api/client.ts";
import { id, integer, date } from "../drafts/model.ts";
export type ChapterComment = components["schemas"]["ChapterComment"];
export type ChapterCommentPage = components["schemas"]["ChapterCommentPage"];
export type ChapterCommentCreate =
  components["schemas"]["ChapterCommentCreate"];
export type ChapterCommentAction =
  components["schemas"]["ChapterCommentAction"];
export type ChapterCommentResult =
  components["schemas"]["ChapterCommentResult"];
const fail = (): never => {
  throw new ApiError("contract");
};
const shape = (v: unknown, keys: string[]): v is Record<string, unknown> =>
  !!v &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  Object.keys(v).length === keys.length &&
  Object.keys(v).every((k) => keys.includes(k));
const keys = [
  "id",
  "novel_id",
  "chapter_id",
  "author_id",
  "nickname",
  "root_id",
  "reply_to",
  "reply_name",
  "content",
  "sequence",
  "revision",
  "replies",
  "can_delete",
  "created_at",
  "deleted",
  "blocked",
  "reason",
];
const optionalId = (v: unknown) => v === null || id(v);
export function checkedChapterComments(
  value: unknown,
  scope?: { book: string; chapter?: string; root?: string },
  managed = false,
): ChapterCommentPage {
  if (
    !shape(value, ["items", "next"]) ||
    !Array.isArray(value.items) ||
    value.items.length > 20 ||
    !integer(value.next)
  )
    return fail();
  const seen = new Set<string>();
  for (const v of value.items) {
    if (
      !shape(v, keys) ||
      ![v.id, v.novel_id, v.chapter_id, v.author_id].every(id) ||
      !optionalId(v.root_id) ||
      !optionalId(v.reply_to) ||
      !integer(v.sequence, 1) ||
      !integer(v.revision, 1) ||
      !integer(v.replies) ||
      !date(v.created_at) ||
      ![v.nickname, v.reply_name, v.content, v.reason].every(
        (x) => typeof x === "string",
      ) ||
      ![v.can_delete, v.deleted, v.blocked].every(
        (x) => typeof x === "boolean",
      ) ||
      seen.has(v.id as string)
    )
      return fail();
    if (
      (v.root_id === null) !== (v.reply_to === null) ||
      (v.root_id !== null && v.replies !== 0) ||
      (v.deleted && v.content !== "")
    )
      return fail();
    if (
      scope &&
      (v.novel_id !== scope.book ||
        (scope.chapter !== undefined && v.chapter_id !== scope.chapter) ||
        (scope.chapter !== undefined && v.root_id !== (scope.root ?? null)))
    )
      return fail();
    if (!managed && (v.deleted || v.blocked || v.reason !== "")) return fail();
    seen.add(v.id as string);
  }
  return value as ChapterCommentPage;
}
function checkedResult(v: unknown, expected?: string): ChapterCommentResult {
  if (
    !shape(v, ["id", "revision", "state"]) ||
    !id(v.id) ||
    (expected !== undefined && v.id !== expected) ||
    !integer(v.revision, 1) ||
    !["published", "deleted", "blocked"].includes(v.state as string)
  )
    return fail();
  return v as ChapterCommentResult;
}
function target(book: string, chapter: string) {
  if (!id(book) || !id(chapter)) throw new ApiError("invalid_input");
  return `/novels/${book}/chapters/${chapter}/comments`;
}
export class ChapterCommentsApi {
  private transport: Transport;
  constructor(transport: Transport = request) {
    this.transport = transport;
  }
  async list(
    book: string,
    chapter: string,
    cursor = 0,
    root?: string,
    signal?: AbortSignal,
  ) {
    if (!integer(cursor) || (root !== undefined && !id(root)))
      throw new ApiError("invalid_input");
    const page = checkedChapterComments(
      await this.transport(
        target(book, chapter) +
          `?cursor=${cursor}` +
          (root ? `&root=${root}` : ""),
        { signal },
      ),
      { book, chapter, root },
    );
    let previous = cursor;
    for (const item of page.items) {
      if (
        root
          ? item.sequence <= previous
          : previous !== 0 && item.sequence >= previous
      )
        return fail();
      previous = item.sequence;
    }
    if (
      page.next !== 0 &&
      (page.items.length !== 20 ||
        page.next !== previous ||
        page.next === cursor)
    )
      return fail();
    return page;
  }
  async create(
    book: string,
    chapter: string,
    input: Readonly<ChapterCommentCreate>,
    signal?: AbortSignal,
  ) {
    const result = checkedResult(
      await this.transport(target(book, chapter), {
        method: "POST",
        body: input,
        signal,
      }),
    );
    if (result.state !== "published") return fail();
    return result;
  }
  async act(
    comment: string,
    input: Readonly<ChapterCommentAction>,
    signal?: AbortSignal,
  ) {
    if (!id(comment) || input.action !== "delete")
      throw new ApiError("invalid_input");
    const result = checkedResult(
      await this.transport(`/chapter-comments/${comment}/actions`, {
        method: "POST",
        body: input,
        signal,
      }),
      comment,
    );
    if (result.state !== "deleted") return fail();
    return result;
  }
  async mine(cursor = 0, signal?: AbortSignal) {
    if (!integer(cursor)) throw new ApiError("invalid_input");
    return checkedChapterComments(
      await this.transport(`/my/chapter-comments?cursor=${cursor}`, { signal }),
      undefined,
      true,
    );
  }
  async forAuthor(book: string, cursor = 0, signal?: AbortSignal) {
    if (!id(book) || !integer(cursor)) throw new ApiError("invalid_input");
    return checkedChapterComments(
      await this.transport(
        `/my/novels/${book}/chapter-comments?cursor=${cursor}`,
        { signal },
      ),
      { book },
      true,
    );
  }
}
