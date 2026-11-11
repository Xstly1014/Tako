import type { components, operations } from "../api/contract";
import { ApiError, apiMessage, type RequestOptions } from "../api/client.ts";
import { UUID } from "../api/reader.ts";

type Schemas = components["schemas"];
export type OwnerPage = Schemas["ShortPostOwnerPage"];
export type Managed = Schemas["ShortPostManaged"];
export type OwnedVersion = Schemas["OwnedShortPostVersion"];
export type Revision = Schemas["ShortPostRevisionSnapshot"];
export type Change = operations["changeMyShortPost"]["requestBody"]["content"]["application/json"];
type State = Schemas["ShortPostState"];
type Authorized = <T>(path: string, options?: Omit<RequestOptions, "token">) => Promise<T>;
const root = "/my/short-posts";
const version = (value: number) => Number.isSafeInteger(value) && value >= 0;

function checkedState(value: State, id?: string) {
  if (!value || !UUID.test(value.id) || (id && value.id !== id) ||
      !version(value.state_revision) || value.state_revision === 0 ||
      !["pending", "reviewed", "rejected", "superseded"].includes(value.review_status) ||
      typeof value.author_hidden !== "boolean" || typeof value.platform_limited !== "boolean" ||
      (value.published_at !== null && !Number.isFinite(Date.parse(value.published_at))))
    throw new ApiError("contract");
}

export function reviewLabel(state: State) {
  if (state.review_status === "rejected") return "已驳回";
  if (state.review_status === "superseded") return "原提交已替换";
  if (state.review_status === "pending") return state.published_at ? "已发布 · 待后审" : "待先审";
  return state.published_at ? "已通过审核" : "尚未公开";
}

export async function ownerPage(send: Authorized, cursor: string, signal?: AbortSignal) {
  if (cursor && !UUID.test(cursor)) throw new ApiError("invalid_input");
  const value = await send<OwnerPage>(root + (cursor ? "?cursor=" + cursor : ""), { signal });
  if (!value || !Array.isArray(value.items) || value.items.length > 12 ||
      typeof value.next_cursor !== "string" ||
      (value.next_cursor && (!UUID.test(value.next_cursor) || value.next_cursor === cursor)))
    throw new ApiError("contract");
  for (const item of value.items) {
    checkedState(item);
    if (typeof item.title !== "string" || !version(item.display_version))
      throw new ApiError("contract");
  }
  if (new Set(value.items.map((item) => item.id)).size !== value.items.length)
    throw new ApiError("contract");
  return value;
}

export async function managedPost(send: Authorized, id: string, signal?: AbortSignal) {
  if (!UUID.test(id)) throw new ApiError("resource_not_found");
  const value = await send<Managed>(root + "/" + id, { signal });
  checkedState(value, id);
  if (typeof value.title !== "string" || typeof value.content !== "string" ||
      typeof value.review_reason !== "string" || !version(value.display_version) ||
      typeof value.history_enabled !== "boolean" ||
      !Array.isArray(value.images) || value.images.length > 4 ||
      !value.images.every((image) => image && UUID.test(image.id)) ||
      (value.latest_submission_id !== null && !UUID.test(value.latest_submission_id)))
    throw new ApiError("contract");
  return value;
}

export async function ownerVersion(send: Authorized, id: string, number: number, signal?: AbortSignal) {
  if (!UUID.test(id) || !version(number) || number === 0) throw new ApiError("invalid_input");
  const value = await send<OwnedVersion>(root + "/" + id + "/versions/" + number, { signal });
  if (!value || value.id !== id || value.version !== number ||
      typeof value.platform_limited !== "boolean" || typeof value.review_reason !== "string")
    throw new ApiError("contract");
  return value;
}

export async function latestRevision(send: Authorized, id: string, revision: string, signal?: AbortSignal) {
  if (!UUID.test(id) || !UUID.test(revision)) throw new ApiError("invalid_input");
  const value = await send<Revision>(root + "/" + id + "/revisions/" + revision, { signal });
  if (!value || value.id !== revision || value.post_id !== id ||
      !["pending", "published", "rejected", "superseded"].includes(value.state) ||
      typeof value.post_review_pending !== "boolean" ||
      typeof value.title !== "string" || typeof value.content !== "string" ||
      typeof value.review_reason !== "string" || !Array.isArray(value.images) ||
      value.images.length > 4 || !value.images.every((image) => image && UUID.test(image.id)))
    throw new ApiError("contract");
  return value;
}

export async function changePost(send: Authorized, id: string, change: Change, signal?: AbortSignal) {
  if (!UUID.test(id)) throw new ApiError("resource_not_found");
  const value = await send<State>(root + "/" + id + "/actions", {
    method: "POST", body: change, signal,
  });
  checkedState(value, id);
}

export function readOwnerImage(send: Authorized, id: string, signal?: AbortSignal) {
  if (!UUID.test(id)) throw new ApiError("resource_not_found");
  return send<Blob>("/my/short-post-images/" + id, { receiveImage: true, signal });
}

export function isDefiniteChangeError(error: unknown) {
  return error instanceof ApiError && [400, 404, 409].includes(error.status);
}

export function managementMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.code === "publication_disabled") return "短帖管理尚未启用。";
    if (error.code === "work_state_conflict") return "状态已变化，请刷新后重新操作。";
    if (error.code === "work_restricted") return "短帖当前受限，请先处理平台限制。";
  }
  return apiMessage(error);
}
