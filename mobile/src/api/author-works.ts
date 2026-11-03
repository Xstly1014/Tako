import type { components } from "./contract";
import type { Transport } from "../auth/session.ts";
import { ApiError } from "./client.ts";
import { UUID, isWork } from "./reader.ts";
import {
  normalizeCatalogQuery,
  type CatalogQuery,
} from "../author-works/catalog.ts";
export type WorkState = components["schemas"]["WorkState"];
export type WorkChange = components["schemas"]["WorkChange"];
export type WorkPage = components["schemas"]["AuthorWorkPage"];
export type CatalogPage = {
  items: (WorkPage["items"][number] & {
    latest_title: string;
    display_limited: boolean;
  })[];
  next_cursor: string;
};
export type AuthorTimeline = components["schemas"]["AuthorTimeline"];
const positive = (v: unknown): v is number =>
  Number.isSafeInteger(v) && Number(v) > 0;
const date = (v: unknown) =>
  typeof v === "string" && Number.isFinite(Date.parse(v));
const fail = (): never => {
  throw new ApiError("contract");
};
export function checkedWorkState(value: WorkState, id = value?.id) {
  if (
    !value ||
    !UUID.test(value.id) ||
    value.id !== id ||
    !UUID.test(value.draft_id) ||
    !positive(value.last_version) ||
    !positive(value.display_version) ||
    value.display_version > value.last_version ||
    !positive(value.state_revision) ||
    [value.author_hidden, value.history_open, value.platform_limited].some(
      (x) => typeof x !== "boolean",
    )
  )
    fail();
  return value;
}
function checkedSummaries(value: WorkPage) {
  for (const x of value.items) {
    if (
      !x ||
      !UUID.test(x.id) ||
      !UUID.test(x.draft_id) ||
      typeof x.title !== "string" ||
      !x.title.trim() ||
      !positive(x.last_version) ||
      !positive(x.display_version) ||
      x.display_version > x.last_version ||
      typeof x.author_hidden !== "boolean" ||
      typeof x.platform_limited !== "boolean"
    )
      fail();
  }
}
export class AuthorWorksApi {
  private transport: Transport;
  constructor(transport: Transport) {
    this.transport = transport;
  }
  async catalog(
    input: CatalogQuery,
    cursor = "",
    signal?: AbortSignal,
  ): Promise<CatalogPage> {
    const query = normalizeCatalogQuery(input);
    if (cursor.length > 512 || (cursor && !/^[A-Za-z0-9_-]+$/.test(cursor)))
      throw new ApiError("invalid_input");
    const params = new URLSearchParams({
      ...query,
      ...(cursor ? { cursor } : {}),
    });
    const value = await this.transport<CatalogPage>(
      "/my/works?" + params.toString(),
      { signal },
    );
    if (
      !value ||
      !Array.isArray(value.items) ||
      value.items.length > 20 ||
      new Set(value.items.map((x) => x?.id)).size !== value.items.length
    )
      fail();
    checkedSummaries(value);
    if (
      typeof value.next_cursor !== "string" ||
      value.next_cursor.length > 512 ||
      (value.next_cursor &&
        (!/^[A-Za-z0-9_-]+$/.test(value.next_cursor) ||
          value.next_cursor === cursor)) ||
      value.items.some(
        (x) =>
          typeof x.latest_title !== "string" ||
          !x.latest_title.trim() ||
          typeof x.display_limited !== "boolean",
      )
    )
      fail();
    return value;
  }
  async list(cursor = "") {
    if (cursor && !UUID.test(cursor)) throw new ApiError("invalid_input");
    const value = await this.transport<WorkPage>(
      "/my/works" + (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""),
    );
    if (
      !value ||
      !Array.isArray(value.items) ||
      value.items.length > 20 ||
      typeof value.next_cursor !== "string" ||
      (value.next_cursor &&
        (!UUID.test(value.next_cursor) || value.next_cursor === cursor)) ||
      new Set(value.items.map((x) => x?.id)).size !== value.items.length
    )
      fail();
    checkedSummaries(value);
    return value;
  }
  async timeline(
    id: string,
    beforeVersion = 0,
    beforeEvent = 0,
    signal?: AbortSignal,
  ) {
    if (
      !UUID.test(id) ||
      [beforeVersion, beforeEvent].some(
        (x) => !Number.isSafeInteger(x) || x < 0,
      )
    )
      throw new ApiError("invalid_input");
    const value = await this.transport<AuthorTimeline>(
      `/my/works/${id}/versions?before_version=${beforeVersion}&before_event=${beforeEvent}`,
      { signal },
    );
    if (!value) fail();
    checkedWorkState(value.state, id);
    if (
      !Array.isArray(value.versions) ||
      !Array.isArray(value.events) ||
      value.versions.length > 20 ||
      value.events.length > 20 ||
      !Number.isSafeInteger(value.next_version_before) ||
      value.next_version_before < 0 ||
      !Number.isSafeInteger(value.next_event_before) ||
      value.next_event_before < 0 ||
      (beforeVersion > 0 && value.next_version_before >= beforeVersion) ||
      (beforeEvent > 0 && value.next_event_before >= beforeEvent) ||
      new Set(value.versions.map((x) => x?.version)).size !==
        value.versions.length ||
      new Set(value.events.map((x) => x?.sequence)).size !== value.events.length
    )
      fail();
    for (const x of value.versions) {
      if (
        !x ||
        !positive(x.version) ||
        x.version > value.state.last_version ||
        (beforeVersion && x.version >= beforeVersion) ||
        typeof x.title !== "string" ||
        !x.title.trim() ||
        !date(x.published_at) ||
        typeof x.platform_limited !== "boolean" ||
        typeof x.review_status !== "string"
      )
        fail();
    }
    const kinds = [
      "hidden",
      "restored",
      "display_changed",
      "history_opened",
      "history_closed",
    ];
    for (const x of value.events) {
      if (
        !x ||
        !positive(x.sequence) ||
        !positive(x.version) ||
        x.version > value.state.last_version ||
        (beforeEvent && x.sequence >= beforeEvent) ||
        !date(x.created_at) ||
        !kinds.includes(x.kind)
      )
        fail();
    }
    return value;
  }
  async version(id: string, version: number, signal?: AbortSignal) {
    if (!UUID.test(id) || !positive(version))
      throw new ApiError("invalid_input");
    const value = await this.transport<components["schemas"]["PublicWork"]>(
      `/my/works/${id}/versions/${version}`,
      { signal },
    );
    if (!isWork(value) || value.id !== id || value.version !== version) fail();
    return value;
  }
  async change(id: string, body: WorkChange) {
    if (!UUID.test(id)) throw new ApiError("invalid_input");
    return checkedWorkState(
      await this.transport<WorkState>(`/my/works/${id}/actions`, {
        method: "POST",
        body,
      }),
      id,
    );
  }
}
// One explicitly confirmed operation per work. Receipts are never current-state reads.
export class WorkAction {
  pending: Readonly<WorkChange> | null = null;
  busy = false;
  private disposed = false;
  private id: string;
  private authorized: () => boolean;
  private uuid: () => string;
  constructor(id: string, authorized: () => boolean, uuid: () => string) {
    this.id = id;
    this.authorized = authorized;
    this.uuid = uuid;
  }
  prepare(
    state: WorkState,
    action: WorkChange["action"],
    version?: number,
    history?: boolean,
  ) {
    this.check();
    if (this.busy || this.pending) throw new ApiError("operation_pending");
    checkedWorkState(state, this.id);
    const body: WorkChange = {
      mutation_id: this.uuid(),
      expected_state_revision: state.state_revision,
      action,
    };
    if (!UUID.test(body.mutation_id)) throw new ApiError("invalid_input");
    if (action === "set_history") {
      if (typeof history !== "boolean") throw new ApiError("invalid_input");
      body.history_open = history;
    } else if (action === "restore" || action === "switch_display") {
      if (state.platform_limited) throw new ApiError("work_restricted");
      if (action === "switch_display" || version !== undefined) {
        if (!positive(version) || version > state.last_version)
          throw new ApiError("invalid_input");
        body.version = version;
      }
    } else if (action !== "hide") throw new ApiError("invalid_input");
    return Object.freeze(body);
  }
  async send(body: Readonly<WorkChange>, api: AuthorWorksApi) {
    this.check();
    if (this.busy) throw new ApiError("operation_pending");
    if (this.pending && this.pending !== body)
      throw new ApiError("operation_pending");
    this.pending = body;
    this.busy = true;
    try {
      const receipt = await api.change(this.id, body);
      this.check();
      this.pending = null;
      return receipt;
    } catch (error) {
      if (
        error instanceof ApiError &&
        [400, 401, 403, 404, 409].includes(error.status)
      )
        this.pending = null;
      throw error;
    } finally {
      this.busy = false;
    }
  }
  dispose() {
    this.disposed = true;
    this.pending = null;
  }
  private check() {
    if (this.disposed || !this.authorized())
      throw new ApiError("stale_session");
  }
}
export function authorWorkMessage(error: unknown) {
  const messages: Record<string, string> = {
    invalid_catalog_query:
      "标题关键词最多64字且不能含换行或控制字符，请修改后查找。",
    work_state_conflict: "作品状态已变化，本次操作未执行。刷新后重新确认。",
    version_unavailable:
      "所选版本不可展示。若最新版受限，请明确选择正常旧版恢复。",
    work_restricted: "作品整体受限，作者操作不能解除平台限制。",
    resource_not_found: "作品不存在或当前账号无权访问。",
    authentication_required: "请重新登录后进入作品管理。",
    stale_session: "账号已变化，请重新进入作品管理。",
    contract: "返回数据未通过校验，请重试读取或检查原操作。",
    operation_pending: "请先确认当前操作的结果。",
    invalid_input: "当前状态不允许此操作，请刷新状态并重新选择。",
    network: "连接未确认，请保持页面并检查原操作。",
  };
  return error instanceof ApiError
    ? (messages[error.code] ?? "暂时无法完成，请重试读取或检查原操作。")
    : "暂时无法完成，请重试。";
}
