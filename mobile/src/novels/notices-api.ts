import type { components } from "../api/contract";
import type { Transport } from "../auth/session.ts";
import { ApiError } from "../api/client.ts";
import { id, integer, date } from "../drafts/model.ts";
import { checkedPublicNovel } from "./reading-api.ts";
export type NovelNotice = components["schemas"]["NovelNotice"];
export type NoticePage = components["schemas"]["NovelNoticePage"];
export type NoticeDetail = components["schemas"]["NovelNoticeDetail"];
export type NoticeRead = components["schemas"]["NovelNoticeRead"];
const fail = (): never => {
  throw new ApiError("contract");
};
const shape = (v: unknown, keys: string[]) =>
  !!v &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  Object.keys(v).length === keys.length &&
  keys.every((k) => Object.hasOwn(v, k));
const cursor = (v: unknown): v is string =>
  typeof v === "string" && v.length <= 512 && /^[A-Za-z0-9_-]*$/.test(v);
export function checkedNotice(v: NovelNotice, expected?: string) {
  if (
    !shape(v, [
      "id",
      "novel_id",
      "created_at",
      "read_at",
      "book",
      "readable_chapters",
    ]) ||
    !id(v.id) ||
    !id(v.novel_id) ||
    (expected !== undefined && v.id !== expected) ||
    !date(v.created_at) ||
    (v.read_at !== null && !date(v.read_at)) ||
    !integer(v.readable_chapters, 0)
  )
    fail();
  if (v.book === null) {
    if (v.readable_chapters !== 0) fail();
  } else {
    if (
      !shape(v.book, [
        "id",
        "title",
        "introduction",
        "tags",
        "author",
        "completed",
        "chapter_count",
        "first_published_at",
        "latest_chapter_published_at",
      ])
    )
      fail();
    checkedPublicNovel(v.book, v.novel_id);
    if (v.readable_chapters > v.book.chapter_count) fail();
  }
  return v;
}
export class NovelNoticesApi {
  private transport: Transport;
  constructor(transport: Transport) {
    this.transport = transport;
  }
  async list(token = "", signal?: AbortSignal) {
    if (!cursor(token)) throw new ApiError("invalid_input");
    const v = await this.transport<NoticePage>(
      "/my/novel-notices" +
        (token ? "?cursor=" + encodeURIComponent(token) : ""),
      { signal },
    );
    if (
      !shape(v, ["items", "next_cursor"]) ||
      !Array.isArray(v.items) ||
      v.items.length > 12 ||
      !cursor(v.next_cursor) ||
      (token && v.next_cursor === token) ||
      new Set(v.items.map((i) => i?.id)).size !== v.items.length
    )
      fail();
    v.items.forEach((i) => checkedNotice(i));
    return v;
  }
  async detail(notice: string, token = "", signal?: AbortSignal) {
    if (!id(notice) || !cursor(token)) throw new ApiError("invalid_input");
    const v = await this.transport<NoticeDetail>(
      `/my/novel-notices/${notice}` +
        (token ? "?cursor=" + encodeURIComponent(token) : ""),
      { signal },
    );
    if (
      !shape(v, ["notice", "items", "next_cursor"]) ||
      !Array.isArray(v.items) ||
      v.items.length > 50 ||
      !cursor(v.next_cursor) ||
      (token && v.next_cursor === token)
    )
      fail();
    checkedNotice(v.notice, notice);
    if (
      v.notice.book === null &&
      (v.items.length !== 0 || v.next_cursor !== "")
    )
      fail();
    let ordinal = 0;
    const seen = new Set<string>();
    for (const i of v.items) {
      if (
        !shape(i, ["id", "ordinal", "readable", "title"]) ||
        !id(i.id) ||
        seen.has(i.id) ||
        !integer(i.ordinal, 1) ||
        i.ordinal <= ordinal ||
        typeof i.readable !== "boolean" ||
        (i.readable
          ? typeof i.title !== "string" ||
            !i.title.trim() ||
            Array.from(i.title).length > 200
          : i.title !== null)
      )
        fail();
      seen.add(i.id);
      ordinal = i.ordinal;
    }
    return v;
  }
  async read(notice: string, signal?: AbortSignal) {
    if (!id(notice)) throw new ApiError("invalid_input");
    const v = await this.transport<NoticeRead>(
      `/my/novel-notices/${notice}/read`,
      { method: "POST", body: {}, signal },
    );
    if (!shape(v, ["id", "read_at"]) || v.id !== notice || !date(v.read_at))
      fail();
    return v;
  }
}
