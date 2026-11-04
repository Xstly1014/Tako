import type { components } from "../api/contract";
import type { Transport } from "../auth/session.ts";
import { ApiError } from "../api/client.ts";
import { id, date } from "../drafts/model.ts";
import { checkedNovelChapterState } from "./management-api.ts";
export type ManagedChapter = components["schemas"]["ManagedChapter"];
export type ManagedChapterPage = components["schemas"]["ManagedChapterPage"];
const cursor = (v: unknown): v is string =>
  typeof v === "string" && v.length <= 512 && /^[A-Za-z0-9_-]*$/.test(v);
export class NovelChapterCatalogApi {
  private transport: Transport;
  constructor(transport: Transport) {
    this.transport = transport;
  }
  async list(book: string, token = "", signal?: AbortSignal) {
    if (!id(book) || !cursor(token)) throw new ApiError("invalid_input");
    const page = await this.transport<ManagedChapterPage>(
      `/my/novels/${book}/publication-chapters` +
        (token ? "?cursor=" + encodeURIComponent(token) : ""),
      { signal },
    );
    if (
      !page ||
      !Array.isArray(page.items) ||
      page.items.length > 20 ||
      !cursor(page.next_cursor) ||
      (token && page.next_cursor === token) ||
      new Set(page.items.map((v) => v?.chapter_id)).size !== page.items.length
    )
      throw new ApiError("contract");
    let last = 0;
    for (const item of page.items) {
      checkedNovelChapterState(item, book, item.chapter_id);
      if (
        typeof item.title !== "string" ||
        Array.from(item.title).length > 200 ||
        !date(item.created_at) ||
        !(item.draft_id === null || id(item.draft_id)) ||
        typeof item.version_limited !== "boolean" ||
        !(
          item.pending_title === null ||
          (typeof item.pending_title === "string" &&
            Array.from(item.pending_title).length <= 200)
        ) ||
        (item.display_version > 0
          ? item.title_source !== "formal"
          : item.current_submission_id
            ? item.title_source !== "pending"
            : item.title_source !== "private") ||
        (item.current_submission_id === null) !==
          (item.pending_title === null) ||
        (item.title_source !== "private" && !item.title.trim())
      )
        throw new ApiError("contract");
      const position = item.ordinal ?? Number.MAX_SAFE_INTEGER;
      if (position < last) throw new ApiError("contract");
      last = position;
    }
    return page;
  }
}
export function chapterManagementStatus(v: ManagedChapter) {
  const labels: string[] = [];
  if (v.display_version > 0) labels.push("已发布");
  else labels.push(v.current_submission_id ? "待审核" : "私稿");
  if (v.display_version > 0 && v.current_submission_id) labels.push("修订待审");
  if (v.author_hidden) labels.push("已隐藏");
  if (v.platform_limited || v.version_limited) labels.push("受限");
  if (v.parent_hidden) labels.push("整书隐藏");
  if (v.parent_limited) labels.push("整书受限");
  return labels.join(" · ");
}
