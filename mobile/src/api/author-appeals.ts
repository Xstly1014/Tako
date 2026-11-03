import type { components } from "./contract";
import type { Transport } from "../auth/session.ts";
import { ApiError } from "./client.ts";
import { UUID, isWork } from "./reader.ts";
export type AuthorCase = components["schemas"]["ModerationCase"];
export type CasePage = components["schemas"]["ModerationCases"];
export type CaseDetail = components["schemas"]["ModerationCaseDetail"];
export type AppealPage = components["schemas"]["ModerationAppeals"];
export type AppealInput = Readonly<{
  mutation_id: string;
  expected_revision: number;
  decision: "appeal";
  reason: string;
}>;
const positive = (x: unknown): x is number =>
  Number.isSafeInteger(x) && Number(x) > 0;
const date = (x: unknown) =>
  typeof x === "string" && Number.isFinite(Date.parse(x));
const text = (x: unknown): x is string => typeof x === "string" && !!x.trim();
const fail = (): never => {
  throw new ApiError("contract");
};
export function checkedCase(x: AuthorCase) {
  if (
    !x ||
    !positive(x.id) ||
    !UUID.test(x.work_id) ||
    !positive(x.version) ||
    !positive(x.revision) ||
    !["work", "version"].includes(x.scope) ||
    !["active", "revoked"].includes(x.state) ||
    !text(x.reason) ||
    !date(x.created_at) ||
    (x.next_appeal_at !== null && !date(x.next_appeal_at))
  )
    fail();
  return x;
}
function checkedPage<T extends { id: number }>(
  page: { items: T[]; next: number },
  before: number,
  check: (item: T) => void,
) {
  if (
    !page ||
    !Array.isArray(page.items) ||
    page.items.length > 20 ||
    !Number.isSafeInteger(page.next) ||
    page.next < 0
  )
    fail();
  let previous = before || Infinity;
  for (const item of page.items) {
    check(item);
    if (item.id >= previous) fail();
    previous = item.id;
  }
  if (
    page.next &&
    (page.items.length !== 20 || page.next !== page.items.at(-1)?.id)
  )
    fail();
  return page;
}
export class AuthorAppealsApi {
  private transport: Transport;
  constructor(transport: Transport) {
    this.transport = transport;
  }
  async list(before = 0, signal?: AbortSignal) {
    if (!Number.isSafeInteger(before) || before < 0)
      throw new ApiError("invalid_input");
    return checkedPage(
      await this.transport<CasePage>(`/my/moderation?before=${before}`, {
        signal,
      }),
      before,
      checkedCase,
    );
  }
  async detail(id: number, before = 0, signal?: AbortSignal) {
    if (!positive(id) || !Number.isSafeInteger(before) || before < 0)
      throw new ApiError("invalid_input");
    const value = await this.transport<CaseDetail>(
      `/my/moderation/${id}?before=${before}`,
      { signal },
    );
    if (!value) fail();
    checkedCase(value.case);
    if (
      value.case.id !== id ||
      !isWork(value.work) ||
      value.work.id !== value.case.work_id ||
      value.work.version !== value.case.version
    )
      fail();
    checkedPage(value.appeals, before, (item) => {
      if (
        !item ||
        !positive(item.id) ||
        item.case_id !== id ||
        !text(item.reason) ||
        !["pending", "upheld", "revoked"].includes(item.state) ||
        !date(item.created_at) ||
        typeof item.decision_reason !== "string" ||
        (item.state === "pending"
          ? item.decided_at !== null
          : !date(item.decided_at) || !text(item.decision_reason))
      )
        fail();
    });
    if (
      value.case.state === "revoked"
        ? !value.revocation ||
          !text(value.revocation.reason) ||
          !date(value.revocation.created_at)
        : value.revocation !== null
    )
      fail();
    return value;
  }
  async appeal(id: number, input: AppealInput) {
    if (
      !positive(id) ||
      !UUID.test(input.mutation_id) ||
      !positive(input.expected_revision) ||
      input.decision !== "appeal" ||
      !text(input.reason) ||
      [...input.reason].length > 2000 ||
      /\p{Cs}/u.test(input.reason)
    )
      throw new ApiError("invalid_appeal_reason");
    const value = await this.transport<
      components["schemas"]["ModerationResult"]
    >(`/my/moderation/${id}`, { method: "POST", body: input });
    if (
      !value ||
      !positive(value.id) ||
      value.state !== "pending" ||
      value.revision !== input.expected_revision
    )
      fail();
    return value;
  }
}
export function appealMessage(error: unknown) {
  const messages: Record<string, string> = {
    invalid_appeal_reason: "请填写1～2000字的复核理由。",
    review_conflict: "处置已有新结论，本次申请未受理。请重新读取后再决定。",
    appeal_pending: "已有复核正在处理，请读取最新记录。",
    appeal_cooldown: "仍处于服务端24小时冷静期，请查看可再次申请时间。",
    operation_pending: "请先确认或明确放弃原申请的结果检查。",
    resource_not_found: "处置不存在或当前账号无权查看。",
    authentication_required: "请重新登录后查看本人处置。",
    stale_session: "账号已变化，请重新进入本人处置。",
    invalid_input: "请求未被受理，请重新读取处置后再申请。",
    contract: "返回数据未通过校验，请重试原请求或重新读取。",
    network: "连接未确认。读取可重试；申请仅检查原请求。",
    rate_limited: "操作较频繁，请稍后检查原请求。",
  };
  return error instanceof ApiError
    ? (messages[error.code] ?? "暂时无法完成，请稍后重试。")
    : "暂时无法完成，请稍后重试。";
}
