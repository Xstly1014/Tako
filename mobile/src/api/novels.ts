import type { components } from "./contract";
import type { Transport } from "../auth/session.ts";
import { ApiError } from "./client.ts";
import { UUID } from "./reader.ts";
export type Novel = components["schemas"]["PrivateNovel"];
export type NovelWrite = components["schemas"]["NovelSave"];
export type NovelPage = components["schemas"]["NovelPage"];
export const novelTags = [
  "幻想",
  "冒险",
  "日常",
  "情感",
  "悬疑",
  "科幻",
] as const;
const text = (v: unknown, max: number): v is string =>
  typeof v === "string" &&
  Array.from(v).length <= max &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\ud800-\udfff]/u.test(
    v,
  );
export function validMetadata(value: {
  title: string;
  introduction: string;
  tags: string[];
}) {
  return (
    text(value.title, 200) &&
    !!value.title.trim() &&
    text(value.introduction, 300) &&
    Array.isArray(value.tags) &&
    value.tags.length >= 1 &&
    value.tags.length <= 3 &&
    new Set(value.tags).size === value.tags.length &&
    value.tags.every((x) => novelTags.some((tag) => tag === x))
  );
}
export function checkedNovel(value: Novel, expected?: string): Novel {
  if (
    !value ||
    !UUID.test(value.id) ||
    (expected && value.id !== expected) ||
    !validMetadata(value) ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1 ||
    ![value.created_at, value.saved_at].every(
      (x) => typeof x === "string" && Number.isFinite(Date.parse(x)),
    )
  )
    throw new ApiError("contract");
  return value;
}
export class NovelsApi {
  private transport: Transport;
  constructor(transport: Transport) {
    this.transport = transport;
  }
  async list(cursor = "") {
    if (cursor.length > 512 || !/^[A-Za-z0-9_-]*$/.test(cursor))
      throw new ApiError("invalid_input");
    const page = await this.transport<NovelPage>(
      "/my/novels" + (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""),
    );
    if (
      !page ||
      !Array.isArray(page.items) ||
      page.items.length > 20 ||
      typeof page.next_cursor !== "string" ||
      page.next_cursor.length > 512 ||
      !/^[A-Za-z0-9_-]*$/.test(page.next_cursor) ||
      (cursor && page.next_cursor === cursor) ||
      new Set(page.items.map((x) => x?.id)).size !== page.items.length
    )
      throw new ApiError("contract");
    page.items.forEach((x) => checkedNovel(x));
    return page;
  }
  async read(id: string) {
    if (!UUID.test(id)) throw new ApiError("invalid_input");
    return checkedNovel(await this.transport<Novel>(`/my/novels/${id}`), id);
  }
  async receipt(id: string) {
    if (!UUID.test(id)) throw new ApiError("invalid_input");
    return checkedNovel(
      await this.transport<Novel>(`/my/novel-mutations/${id}`),
    );
  }
  async write(target: string | null, input: NovelWrite) {
    if (
      (target !== null && !UUID.test(target)) ||
      !UUID.test(input.mutation_id) ||
      !validMetadata(input) ||
      !Number.isSafeInteger(input.base_revision) ||
      input.base_revision < (target ? 1 : 0) ||
      (!target && input.base_revision !== 0)
    )
      throw new ApiError("invalid_input");
    return checkedNovel(
      await this.transport<Novel>("/my/novels" + (target ? "/" + target : ""), {
        method: "POST",
        body: input,
      }),
      target ?? undefined,
    );
  }
}
export function novelMessage(error: unknown) {
  if (!(error instanceof ApiError)) return "暂时无法完成，请重试。";
  const messages: Record<string, string> = {
    novel_request_pending: "已有另一份提交待确认，请先重新读取提交记录。",
    invalid_input: "书名需1～200字，简介最多300字，标签选1～3个。",
    novel_revision_conflict:
      "资料已被另一端修改。你的输入仍保留，请先查看最新资料。",
    mutation_id_reused: "此提交标识与原内容不符，请先核对原提交结果。",
    resource_not_found: "没有找到本人书籍或提交记录。",
    nickname_required: "请先在我的页面设置笔名。",
    network: "连接中断，资料仍保留。请重试确认原提交。",
    authentication_required: "请重新登录后确认原提交。",
    storage: "无法写入本机安全记录，未确认完成。请检查存储后重试。",
    stale_session: "账号已变化，请回到当前账号重新操作。",
  };
  return messages[error.code] ?? "暂时无法完成，请稍后重试。";
}
