import type { components } from "./contract";
import { ApiError } from "./client.ts";
import { UUID } from "./reader.ts";
import { checkedComments, type CommentPage } from "./comments.ts";
import type { Transport } from "../auth/session.ts";

export type FeedbackStatus = "all" | "awaiting_author";
export type FeedbackEntry = components["schemas"]["AuthorFeedbackEntry"];
export type FeedbackPage = components["schemas"]["AuthorFeedbackPage"];
const validId = (v: string) =>
  UUID.test(v) && v !== "00000000-0000-0000-0000-000000000000";
const sequence = (v: unknown): v is number =>
  Number.isSafeInteger(v) && Number(v) >= 0;
function checkedEntry(value: FeedbackEntry) {
  if (
    !value ||
    typeof value.work_title !== "string" ||
    !value.work_title.trim() ||
    [...value.work_title].length > 200 ||
    typeof value.awaiting_author !== "boolean"
  )
    throw new ApiError("contract");
  const item = checkedComments({ items: [value.comment], next: 0 }).items[0];
  if (
    !validId(item.id) ||
    !validId(item.work_id) ||
    item.root_id !== null ||
    item.reply_to !== null ||
    item.deleted ||
    item.blocked ||
    !item.can_delete ||
    item.reason !== "" ||
    item.sequence < 1 ||
    item.revision < 1
  )
    throw new ApiError("contract");
  return value;
}
export class AuthorFeedbackApi {
  private transport: Transport;
  constructor(transport: Transport) {
    this.transport = transport;
  }
  async page(status: FeedbackStatus, cursor = 0, signal?: AbortSignal) {
    if (!["all", "awaiting_author"].includes(status) || !sequence(cursor))
      throw new ApiError("invalid_input");
    const page = await this.transport<FeedbackPage>(
      `/my/work-feedback?status=${status}&cursor=${cursor}`,
      { signal },
    );
    if (
      !page ||
      !Array.isArray(page.items) ||
      page.items.length > 20 ||
      !sequence(page.next)
    )
      throw new ApiError("contract");
    const seen = new Set<string>();
    let before = cursor || Number.MAX_SAFE_INTEGER + 1;
    for (const raw of page.items) {
      const item = checkedEntry(raw);
      if (
        seen.has(item.comment.id) ||
        item.comment.sequence >= before ||
        (status === "awaiting_author" && !item.awaiting_author)
      )
        throw new ApiError("contract");
      seen.add(item.comment.id);
      before = item.comment.sequence;
    }
    if (
      page.next &&
      (page.items.length !== 20 ||
        page.next !== page.items.at(-1)?.comment.sequence)
    )
      throw new ApiError("contract");
    return page;
  }
  async thread(id: string, workId?: string, signal?: AbortSignal) {
    if (!validId(id) || (workId !== undefined && !validId(workId)))
      throw new ApiError("invalid_input");
    const entry = checkedEntry(
      await this.transport<FeedbackEntry>(`/my/work-feedback/${id}`, {
        signal,
      }),
    );
    if (entry.comment.id !== id || (workId && entry.comment.work_id !== workId))
      throw new ApiError("contract");
    return entry;
  }
  async threadPage(
    id: string,
    workId: string,
    signal?: AbortSignal,
  ): Promise<CommentPage> {
    try {
      return {
        items: [(await this.thread(id, workId, signal)).comment],
        next: 0,
      };
    } catch (e) {
      if (e instanceof ApiError && e.status === 404)
        return { items: [], next: 0 };
      throw e;
    }
  }
}
