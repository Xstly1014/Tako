import type { components, paths } from "./contract";
export type WorkCard = components["schemas"]["DiscoveryCard"];
export type PublicWork = components["schemas"]["PublicWork"];
export type DiscoveryPage =
  paths["/api/community"]["get"]["responses"][200]["content"]["application/json"];

export const API_BASE =
  process.env.EXPO_PUBLIC_API_URL ?? "http://127.0.0.1:3300/api";
export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ReaderError extends Error {
  kind: "network" | "unavailable" | "service" | "contract" | "environment";
  requestId: string;
  constructor(kind: ReaderError["kind"], requestId = "") {
    super(kind);
    this.kind = kind;
    this.requestId = requestId;
  }
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object";
const text = (value: unknown): value is string => typeof value === "string";
const tags = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(text);
const card = (value: unknown): value is WorkCard =>
  object(value) &&
  text(value.id) &&
  UUID.test(value.id) &&
  text(value.title) &&
  text(value.introduction) &&
  text(value.author_nickname) &&
  tags(value.tags) &&
  Number.isSafeInteger(value.version) &&
  Number(value.version) > 0 &&
  text(value.first_published_at);
export const isPage = (value: unknown): value is DiscoveryPage =>
  object(value) &&
  Array.isArray(value.items) &&
  value.items.every(card) &&
  Array.isArray(value.featured) &&
  value.featured.every(card) &&
  text(value.next_cursor) &&
  Array.isArray(value.tags) &&
  value.tags.every(
    (tag) =>
      object(tag) &&
      text(tag.name) &&
      Number.isSafeInteger(tag.count) &&
      Number(tag.count) >= 0,
  );
export const isWork = (value: unknown): value is PublicWork =>
  object(value) &&
  text(value.id) &&
  UUID.test(value.id) &&
  text(value.title) &&
  text(value.content) &&
  text(value.introduction) &&
  tags(value.tags) &&
  text(value.author_nickname) &&
  text(value.published_at) &&
  Number.isSafeInteger(value.version) &&
  Number(value.version) > 0;

export function mergeWorks(existing: WorkCard[], incoming: WorkCard[]) {
  const seen = new Set(existing.map((item) => item.id));
  return [
    ...existing,
    ...incoming.filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    }),
  ];
}

export async function read<T>(
  path: string,
  validate: (value: unknown) => value is T,
  signal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timeout = setTimeout(abort, 15000);
  try {
    const base = new URL(API_BASE);
    if (
      base.protocol !== "https:" &&
      !(
        base.protocol === "http:" &&
        ["127.0.0.1", "localhost"].includes(base.hostname)
      )
    ) {
      throw new ReaderError("environment");
    }
    const response = await fetch(`${API_BASE}${path}`, {
      signal: controller.signal,
      credentials: "omit",
      headers: { Accept: "application/json" },
    });
    const trace = response.headers.get("X-Request-ID") ?? "";
    const requestId = UUID.test(trace) ? trace : "";
    if (response.headers.get("X-Tako-Environment") !== "test")
      throw new ReaderError("environment", requestId);
    if (response.status === 404)
      throw new ReaderError("unavailable", requestId);
    if (!response.ok) throw new ReaderError("service", requestId);
    let value: unknown;
    try {
      value = await response.json();
    } catch (error) {
      if (error instanceof SyntaxError)
        throw new ReaderError("contract", requestId);
      throw error;
    }
    if (!validate(value)) throw new ReaderError("contract", requestId);
    return value;
  } catch (error) {
    if (error instanceof ReaderError) throw error;
    throw new ReaderError("network");
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

export function community(tag: string, cursor: string, signal?: AbortSignal) {
  const query = new URLSearchParams();
  if (tag) query.set("tag", tag);
  if (cursor) query.set("cursor", cursor);
  return read(`/community?${query}`, isPage, signal);
}
export function work(id: string, signal?: AbortSignal) {
  if (!UUID.test(id)) return Promise.reject(new ReaderError("unavailable"));
  return read(`/works/${encodeURIComponent(id)}`, isWork, signal);
}
export function errorMessage(error: unknown) {
  if (!(error instanceof ReaderError)) return "暂时无法加载，请重试。";
  if (error.kind === "unavailable")
    return "这篇作品暂不可读，可能已隐藏或被限制。";
  if (error.kind === "environment")
    return "未连接到测试环境，请检查 USB 连接与端口转发。";
  if (error.kind === "network")
    return "连接超时或已断开，请检查 USB 连接后重试。";
  return "暂时无法加载，请稍后重试。";
}
