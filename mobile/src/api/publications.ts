import type { components, paths } from "./contract";
import type { Transport } from "../auth/session.ts";
import { ApiError } from "./client.ts";
import { UUID } from "./reader.ts";
import { checkedWorkState, type WorkState } from "./author-works.ts";
export type Preview = components["schemas"]["PublicationPreview"];
export type Published = components["schemas"]["PublicationResult"];
export type Prepare = components["schemas"]["PreparePublication"];
export type Publish = components["schemas"]["PublishPreview"];
export type DraftPage =
  paths["/api/drafts"]["get"]["responses"][200]["content"]["application/json"];
export const publicationTags = ["幻想", "冒险", "日常", "情感", "悬疑", "科幻"];
export const positive = (v: unknown): v is number =>
  Number.isSafeInteger(v) && Number(v) > 0;
const date = (v: unknown) =>
  typeof v === "string" && Number.isFinite(Date.parse(v));
export function checkedResult(v: Published) {
  if (
    !v ||
    !UUID.test(v.work_id) ||
    !positive(v.version) ||
    !date(v.published_at) ||
    v.review_status !== "pending"
  )
    throw new ApiError("contract");
  return v;
}
export function checkedPreview(
  v: Preview,
  expected?: { draft_id: string; source_revision: number; id?: string },
) {
  if (
    !v ||
    !UUID.test(v.id) ||
    !UUID.test(v.draft_id) ||
    !positive(v.source_revision) ||
    !Number.isSafeInteger(v.expected_version) ||
    v.expected_version < 0 ||
    typeof v.title !== "string" ||
    !v.title.trim() ||
    typeof v.content !== "string" ||
    !v.content.trim() ||
    typeof v.introduction !== "string" ||
    Array.from(v.introduction).length > 300 ||
    !Array.isArray(v.tags) ||
    v.tags.length < 1 ||
    v.tags.length > 3 ||
    new Set(v.tags).size !== v.tags.length ||
    v.tags.some((tag) => !publicationTags.includes(tag)) ||
    !date(v.created_at) ||
    !date(v.expires_at) ||
    (expected &&
      (v.draft_id !== expected.draft_id ||
        v.source_revision !== expected.source_revision ||
        (expected.id && v.id !== expected.id)))
  )
    throw new ApiError("contract");
  if (v.published) {
    checkedResult(v.published);
    if (v.published.version !== v.expected_version + 1)
      throw new ApiError("contract");
  }
  return v;
}
export class PublicationsApi {
  private transport: Transport;
  constructor(transport: Transport) {
    this.transport = transport;
  }
  async drafts(cursor = "") {
    const value = await this.transport<DraftPage>(
      "/drafts" + (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""),
    );
    if (
      !value ||
      !Array.isArray(value.items) ||
      typeof value.next_cursor !== "string" ||
      (cursor && value.next_cursor === cursor) ||
      new Set(value.items.map((x) => x?.id)).size !== value.items.length
    )
      throw new ApiError("contract");
    for (const item of value.items)
      if (
        !item ||
        !UUID.test(item.id) ||
        !positive(item.revision) ||
        typeof item.title !== "string"
      )
        throw new ApiError("contract");
    return value;
  }
  async source(id: string) {
    if (!UUID.test(id)) throw new ApiError("invalid_input");
    const value = await this.transport<components["schemas"]["Draft"]>(
      `/drafts/${id}`,
    );
    if (
      !value ||
      value.id !== id ||
      !positive(value.revision) ||
      typeof value.title !== "string" ||
      typeof value.content !== "string"
    )
      throw new ApiError("contract");
    return value;
  }
  async prepare(body: Prepare) {
    return checkedPreview(
      await this.transport<Preview>("/publication-previews", {
        method: "POST",
        body,
      }),
      body,
    );
  }
  async read(id: string) {
    if (!UUID.test(id)) throw new ApiError("invalid_input");
    const result = checkedPreview(
      await this.transport<Preview>(`/publication-previews/${id}`),
    );
    if (result.id !== id) throw new ApiError("contract");
    return result;
  }
  async publish(body: Publish) {
    const result = checkedResult(
      await this.transport<Published>("/publications", {
        method: "POST",
        body,
      }),
    );
    if (result.version !== body.expected_version + 1)
      throw new ApiError("contract");
    return result;
  }
  async state(workId: string, draftId: string) {
    const state = checkedWorkState(
      await this.transport<WorkState>(`/my/works/${workId}`),
      workId,
    );
    if (state.draft_id !== draftId) throw new ApiError("contract");
    return state;
  }
}
export function publicationMessage(error: unknown) {
  const messages: Record<string, string> = {
    preview_expired: "预览已过期，请重新准备；草稿和已发布版本不会被删除。",
    source_revision_unavailable:
      "这份服务器修订已不再保留，请回草稿箱确认保存后重新选择。",
    publication_conflict:
      "其他发布已推进版本。请先检查作品管理，再明确准备新预览。",
    unsupported_publication_state: "当前作品或账号需要审核处理，不能直接发布。",
    nickname_required: "请先设置笔名，当前稿件不会自动发布。",
    authentication_required: "请重新登录同一账号后检查原发布。",
    stale_session: "账号已变化，原账号的内容和操作已隐藏。",
    network: "结果尚未确认，请检查原请求，勿重复新建发布。",
    storage: "无法保留发布标识，本次不会发出新的发布请求，请重试。",
    recovery_invalid: "发布记录损坏或账号不符，记录已保留，请先核对作品管理。",
    operation_pending: "请先检查当前发布结果。",
    another_publication_pending: "已有其他待确认发布，请先恢复并检查原记录。",
    invalid_input:
      "请选择 1～3 个标签、填写不超过 300 字简介，并确认发布授权。",
    publication_disabled: "发布尚未开放，草稿不会受影响。",
    rate_limited: "操作较频繁，请稍后沿原请求重试。",
  };
  return error instanceof ApiError
    ? (messages[error.code] ?? "暂时无法完成，请重试读取或检查原操作。")
    : "暂时无法完成，请重试。";
}
