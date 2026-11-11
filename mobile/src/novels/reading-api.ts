import type { components } from "../api/contract";
import type { Transport } from "../auth/session.ts";
import { request, ApiError } from "../api/client.ts";
import { searchQuery } from "../api/search.ts";
import { validMetadata } from "../api/novels.ts";
import { date, id, integer, text } from "../drafts/model.ts";
export type PublicNovel = components["schemas"]["PublicNovel"];
export type PublicNovelPage = components["schemas"]["PublicNovelPage"];
export type DirectoryChapter = components["schemas"]["NovelDirectoryChapter"];
export type NovelDirectory = components["schemas"]["NovelDirectoryPage"];
export type PublicNovelChapter = components["schemas"]["PublicNovelChapter"];
const fail = (): never => {
  throw new ApiError("contract");
};
const cursor = (v: unknown): v is string =>
  typeof v === "string" && v.length <= 512 && /^[A-Za-z0-9_-]*$/.test(v);
export function checkedPublicNovel(v: PublicNovel, expected?: string) {
  if (
    !v ||
    !id(v.id) ||
    (expected !== undefined && v.id !== expected) ||
    !validMetadata(v) ||
    typeof v.author !== "string" ||
    Array.from(v.author).length > 64 ||
    typeof v.completed !== "boolean" ||
    !integer(v.chapter_count, 1) ||
    !date(v.first_published_at) ||
    !date(v.latest_chapter_published_at)
  )
    fail();
  return v;
}
export class NovelReadingApi {
  private transport: Transport;
  constructor(transport: Transport = request) {
    this.transport = transport;
  }
  async list(token = "", signal?: AbortSignal) {
    return this.page("/novels", token, signal);
  }
  async shortPostOptions(token = "", signal?: AbortSignal) {
    return this.page("/my/short-post-novel-options", token, signal);
  }
  async search(query: string, token = "", signal?: AbortSignal) {
    const q = searchQuery(query);
    if (q === null) throw new ApiError("invalid_input");
    return this.page(
      "/novels/search?q=" + encodeURIComponent(q),
      token,
      signal,
    );
  }
  private async page(path: string, token: string, signal?: AbortSignal) {
    if (!cursor(token)) throw new ApiError("invalid_input");
    const separator = path.includes("?") ? "&" : "?";
    const page = await this.transport<PublicNovelPage>(
      path + (token ? separator + "cursor=" + encodeURIComponent(token) : ""),
      { signal },
    );
    if (
      !page ||
      !Array.isArray(page.items) ||
      page.items.length > 12 ||
      !cursor(page.next_cursor) ||
      (token && page.next_cursor === token) ||
      new Set(page.items.map((v) => v?.id)).size !== page.items.length
    )
      fail();
    page.items.forEach((v) => checkedPublicNovel(v));
    return page;
  }
  async book(book: string, signal?: AbortSignal) {
    if (!id(book)) throw new ApiError("invalid_input");
    return checkedPublicNovel(
      await this.transport<PublicNovel>(`/novels/${book}`, { signal }),
      book,
    );
  }
  async directory(book: string, token = "", signal?: AbortSignal) {
    if (!id(book) || !cursor(token)) throw new ApiError("invalid_input");
    const page = await this.transport<NovelDirectory>(
      `/novels/${book}/directory` +
        (token ? "?cursor=" + encodeURIComponent(token) : ""),
      { signal },
    );
    if (
      !page ||
      !Array.isArray(page.items) ||
      page.items.length > 50 ||
      !cursor(page.next_cursor) ||
      (token && token === page.next_cursor)
    )
      fail();
    let last = 0;
    const seen = new Set<string>();
    for (const v of page.items) {
      if (
        !v ||
        !id(v.id) ||
        !integer(v.ordinal, 1) ||
        v.ordinal <= last ||
        seen.has(v.id) ||
        typeof v.readable !== "boolean" ||
        (v.readable
          ? typeof v.title !== "string" ||
            !v.title.trim() ||
            Array.from(v.title).length > 200
          : v.title !== null)
      )
        fail();
      last = v.ordinal;
      seen.add(v.id);
    }
    return page;
  }
  async chapter(book: string, chapter: string, signal?: AbortSignal) {
    if (!id(book) || !id(chapter)) throw new ApiError("invalid_input");
    const v = await this.transport<PublicNovelChapter>(
      `/novels/${book}/chapters/${chapter}`,
      { signal },
    );
    if (
      !v ||
      v.novel_id !== book ||
      v.chapter_id !== chapter ||
      !integer(v.ordinal, 1) ||
      !integer(v.version, 1) ||
      !text(v.title, v.content) ||
      !v.title.trim() ||
      !v.content.trim() ||
      !date(v.published_at)
    )
      fail();
    return v;
  }
}
export function novelReadingMessage(e: unknown) {
  if (e instanceof ApiError) {
    if (e.code === "resource_not_found")
      return "作品或章节暂时不可读。请返回目录或长文频道。";
    if (e.code === "invalid_input")
      return "阅读地址或分页信息无效，请重新打开作品。";
  }
  return "暂时无法读取，请重试。已加载的列表会保留。";
}
