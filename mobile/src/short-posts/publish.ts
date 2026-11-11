import type { components } from "../api/contract";
import { ApiError, apiMessage, type RequestOptions } from "../api/client.ts";
import { UUID } from "../api/reader.ts";
import type { JournalStore } from "../publication/flow.ts";

type Schemas = components["schemas"];
export type Preview = Schemas["ShortPostPreview"];
export type Receipt = Schemas["ShortPostSubmissionReceipt"];
export type PreviewInput = {
  title: string;
  content: string;
  novel_id: string | null;
  image_ids: string[];
};
type Authorized = <T>(path: string, options?: Omit<RequestOptions, "token">) => Promise<T>;
export type RevisionTarget = { post: string; expectedRevision: number };
type Pending = { owner: string; id: string; preview: string; target?: RevisionTarget };
function validTarget(target: RevisionTarget) {
  return !!target && UUID.test(target.post) && Number.isSafeInteger(target.expectedRevision) &&
    target.expectedRevision > 0 && target.expectedRevision < Number.MAX_SAFE_INTEGER;
}
const submission = "/my/short-post-submissions/";
const active = new Set<string>();
function submissionPath(pending: Pending) {
  return pending.target
    ? "/my/short-posts/" + pending.target.post + "/revisions/" + pending.id
    : submission + pending.id;
}

export function postInput(input: PreviewInput) {
  const title = input.title.trim();
  const content = input.content.replace(/\r\n/g, "\n").trim();
  const controls = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\ud800-\udfff]/u;
  if (!title || !content || Array.from(title).length > 80 ||
      Array.from(content).length > 2000 || /[\t\n]/.test(title) ||
      controls.test(title) || controls.test(content)) {
    throw new ApiError("short_post_input");
  }
  return { ...input, title, content };
}

export async function preparePost(send: Authorized, id: string, input: PreviewInput, signal?: AbortSignal) {
  const body = postInput(input);
  const preview = await send<Preview>("/my/short-post-previews/" + id, { method: "PUT", body, signal });
  if (!preview || preview.id !== id || preview.title !== body.title ||
      preview.content !== body.content || preview.novel_id !== body.novel_id ||
      !Array.isArray(preview.images) || preview.images.length !== body.image_ids.length ||
      !preview.images.every((image, index) => image?.id === body.image_ids[index]) ||
      !Number.isFinite(Date.parse(preview.expires_at))) throw new ApiError("contract");
  return preview;
}

export class ShortPostSubmission {
  private owner: string;
  private send: Authorized;
  private journal: JournalStore;

  constructor(owner: string, send: Authorized, journal: JournalStore) {
    this.owner = owner;
    this.send = send;
    this.journal = journal;
  }

  private async pending(): Promise<Pending | null> {
    let value: Pending;
    const raw = await this.journal.get();
    if (raw === null) return null;
    try { value = JSON.parse(raw); } catch { throw new ApiError("storage"); }
    if (!value || value.owner !== this.owner || !UUID.test(value.id) ||
        !UUID.test(value.preview) || (value.target !== undefined && !validTarget(value.target))) throw new ApiError("storage");
    return value;
  }

  private async exclusive<T>(task: () => Promise<T>) {
    if (active.has(this.owner)) throw new ApiError("session_busy");
    active.add(this.owner);
    try { return await task(); } finally { active.delete(this.owner); }
  }

  private checked(out: Receipt, pending: Pending) {
    if (!out || out.id !== pending.id || out.preview_id !== pending.preview ||
        !UUID.test(out.post_id) || (pending.target && pending.target.post !== out.post_id) || !["published", "pre_review"].includes(out.status) ||
        !Number.isFinite(Date.parse(out.submitted_at))) throw new ApiError("contract");
    return out;
  }

  async recover(signal?: AbortSignal) {
    const pending = await this.pending();
    if (!pending) return { pending: false as const };
    try {
      const receipt = this.checked(await this.send<Receipt>(submissionPath(pending), { signal }), pending);
      return { pending: true as const, receipt };
    } catch (error) {
      if (error instanceof ApiError && error.status === 404)
        return { pending: true as const };
      throw error;
    }
  }

  async confirm(id: string, preview: string, signal?: AbortSignal, target?: RevisionTarget) {
    if (!UUID.test(id) || !UUID.test(preview) || (target && !validTarget(target))) throw new ApiError("short_post_input");
    return this.exclusive(async () => {
      if (await this.pending()) throw new ApiError("short_post_pending");
      const pending: Pending = { owner: this.owner, id, preview, ...(target ? { target } : {}) };
      await this.journal.set(JSON.stringify(pending));
      return this.submit(pending, signal);
    });
  }

  async retry(signal?: AbortSignal) {
    return this.exclusive(async () => {
      const pending = await this.pending();
      if (!pending) throw new ApiError("short_post_pending");
      return this.submit(pending, signal);
    });
  }

  private async submit(pending: Pending, signal?: AbortSignal) {
    try {
      return this.checked(await this.send<Receipt>(submissionPath(pending), {
        method: "PUT",
        body: {
          preview_id: pending.preview,
          rights_confirmed: true,
          ...(pending.target ? { expected_revision: pending.target.expectedRevision } : {}),
        },
        signal,
      }), pending);
    } catch (error) {
      // These responses follow the receipt lookup and definitively reject this attempt.
      if (error instanceof ApiError &&
          (error.code === "preview_expired" || error.code === "short_post_novel_unavailable" ||
            (pending.target && error.code === "work_state_conflict")))
        await this.journal.remove();
      throw error;
    }
  }

  async acknowledge(receipt: Receipt) {
    return this.exclusive(async () => {
      const pending = await this.pending();
      if (!pending) return;
      this.checked(receipt, pending);
      await this.journal.remove();
    });
  }
}

export function composeMessage(error: unknown) {
  if (!(error instanceof ApiError)) return "暂时无法完成，请重试。";
  const messages: Record<string, string> = {
    short_post_input: "请填写标题和正文。标题最多 80 字，正文最多 2000 字。",
    work_state_conflict: "短帖状态已变化。请核对最新状态，再决定是否继续提交。",
    short_post_pending: "还有一次发布结果待确认，请先查询回执。",
    short_post_image_unavailable: "有图片已失效。请重新上传后再预览。",
    short_post_novel_unavailable: "关联长文已不可读，请移除或重新选择。",
    preview_expired: "预览已过期，请重新预览。",
    invalid_image: "图片无法读取，请重新选择 JPEG 或 PNG。",
    image_type_unsupported: "请选择 JPEG 或 PNG 图片。",
    image_too_large: "图片尺寸过大，请缩小后重选。",
    payload_too_large: "每张图片最多 8 MiB，请缩小后重选。",
    image_upload_busy: "图片上传繁忙，请稍后重试。",
    image_quota_reached: "暂存图片额度已用完，请稍后再上传。",
    short_post_preview_quota_reached: "待提交预览过多，请稍后再试。",
  };
  return messages[error.code] ?? apiMessage(error);
}
