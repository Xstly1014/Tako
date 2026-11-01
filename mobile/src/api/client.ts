import { API_BASE, UUID } from "./reader.ts";
export class ApiError extends Error {
  code: string;
  requestId: string;
  status: number;
  constructor(code: string, requestId = "", status = 0) {
    super(code);
    this.code = code;
    this.requestId = requestId;
    this.status = status;
  }
}
export async function request<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    token?: string;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  const base = new URL(API_BASE);
  if (
    base.protocol !== "https:" &&
    !(
      base.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(base.hostname)
    )
  )
    throw new ApiError("environment");
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timer = setTimeout(abort, 15000);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method: options.method ?? "GET",
      credentials: "omit",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(options.body === undefined
          ? {}
          : { "Content-Type": "application/json" }),
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
    });
    const trace = response.headers.get("X-Request-ID") ?? "";
    const requestId = UUID.test(trace) ? trace : "";
    if (response.headers.get("X-Tako-Environment") !== "test")
      throw new ApiError("environment", requestId);
    if (response.status === 204 && response.ok) return undefined as T;
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new ApiError("contract", requestId);
    }
    if (!response.ok) {
      const code =
        typeof value === "object" &&
        value &&
        "error" in value &&
        typeof value.error === "string"
          ? value.error
          : "service_unavailable";
      throw new ApiError(code, requestId, response.status);
    }
    return value as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError("network");
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}
export function apiMessage(error: unknown) {
  if (!(error instanceof ApiError)) return "暂时无法完成，请重试。";
  const messages: Record<string, string> = {
    invalid_login: "邮箱或密码不正确。",
    account_exists: "该邮箱已注册，请切换到登录。",
    invalid_password: "密码至少 8 个字符，且 UTF-8 不超过 72 字节。",
    invalid_input: "请检查邮箱及输入内容。",
    rate_limited: "操作较频繁，请稍后重试。",
    authentication_required: "登录已过期，请重新登录。",
    network: "连接超时或已断开，请检查 USB 连接后重试。",
    environment: "未连接到测试环境，请检查服务和 USB 转发。",
    storage: "无法保存安全凭据，请检查手机存储后重试。",
    favorite_conflict: "收藏状态已变化，请刷新后操作。",
    work_restricted: "作品暂不可收藏。",
    resource_not_found: "作品暂不可用。",
    stale_session: "账号状态已变化，请重新操作。",
    session_busy: "正在处理账号操作，请稍候。",
  };
  return messages[error.code] ?? "暂时无法完成，请稍后重试。";
}
