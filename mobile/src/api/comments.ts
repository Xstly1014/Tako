import type { components } from "./contract";
import type { Transport } from "../auth/session.ts";
import { ApiError } from "./client.ts";
import { UUID } from "./reader.ts";
export type Comment = components["schemas"]["Comment"];
export type CommentPage = components["schemas"]["CommentPage"];
export type CommentCreate = components["schemas"]["CommentCreate"];
export type CommentResult = components["schemas"]["CommentResult"];
export type CommentAction = components["schemas"]["CommentAction"];
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object";
const integer = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;
const optionalId = (v: unknown) =>
  v === null || (typeof v === "string" && UUID.test(v));
function validComment(v: unknown): v is Comment {
  if (!object(v)) return false;
  return (
    ["id", "work_id", "author_id"].every(
      (k) => typeof v[k] === "string" && UUID.test(v[k] as string),
    ) &&
    ["nickname", "reply_name", "content", "created_at", "reason"].every(
      (k) => typeof v[k] === "string",
    ) &&
    ["sequence", "revision", "replies"].every((k) => integer(v[k])) &&
    ["can_delete", "deleted", "blocked"].every(
      (k) => typeof v[k] === "boolean",
    ) &&
    optionalId(v.root_id) &&
    optionalId(v.reply_to)
  );
}
export function checkedComments(v: unknown): CommentPage {
  if (
    !object(v) ||
    !Array.isArray(v.items) ||
    v.items.length > 20 ||
    !v.items.every(validComment) ||
    !integer(v.next)
  )
    throw new ApiError("contract");
  return v as CommentPage;
}
export function checkedCommentResult(v: unknown): CommentResult {
  if (
    !object(v) ||
    typeof v.id !== "string" ||
    !UUID.test(v.id) ||
    !integer(v.revision) ||
    !["published", "deleted", "blocked"].includes(v.state as string)
  )
    throw new ApiError("contract");
  return v as CommentResult;
}
function id(value: string) {
  if (!UUID.test(value)) throw new ApiError("invalid_input");
  return value;
}
export class CommentsApi {
  private transport: Transport;
  constructor(transport: Transport) {
    this.transport = transport;
  }
  async list(work: string, cursor = 0, root?: string, signal?: AbortSignal) {
    if (!integer(cursor)) throw new ApiError("invalid_input");
    const page = checkedComments(
      await this.transport(
        `/works/${id(work)}/comments?cursor=${cursor}${root ? `&root=${id(root)}` : ""}`,
        { signal },
      ),
    );
    if (
      page.items.some(
        (item) => item.work_id !== work || item.root_id !== (root ?? null),
      )
    )
      throw new ApiError("contract");
    return page;
  }
  async mine(cursor = 0, signal?: AbortSignal) {
    if (!integer(cursor)) throw new ApiError("invalid_input");
    return checkedComments(
      await this.transport(`/my/comments?cursor=${cursor}`, { signal }),
    );
  }
  async create(work: string, body: CommentCreate) {
    return checkedCommentResult(
      await this.transport(`/works/${id(work)}/comments`, {
        method: "POST",
        body,
      }),
    );
  }
  async remove(comment: string, body: CommentAction) {
    if (body.action !== "delete" || body.reason !== "")
      throw new ApiError("invalid_input");
    return checkedCommentResult(
      await this.transport(`/comments/${id(comment)}/actions`, {
        method: "POST",
        body,
      }),
    );
  }
}
