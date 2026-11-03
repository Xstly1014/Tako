import type { components } from "../api/contract";
import type { Transport } from "../auth/session.ts";
import { ApiError } from "../api/client.ts";
import { date, id, integer } from "../drafts/model.ts";

export type NovelCase = components["schemas"]["NovelCase"];
export type NovelAppeal = components["schemas"]["NovelAppeal"];
export type NovelCaseResult = components["schemas"]["NovelCaseResult"];
export type NovelCaseDetail = components["schemas"]["NovelCaseDetail"];
export type NovelAppealInput = components["schemas"]["NovelCaseAppealInput"];
type CasePage = components["schemas"]["NovelCasePage"];
const fail = (): never => {
  throw new ApiError("contract");
};
const reason = (v: unknown): v is string =>
  typeof v === "string" && Array.from(v).length <= 2000;

export function checkedNovelCase(v: NovelCase, book: string) {
  if (
    !v ||
    !integer(v.id, 1) ||
    v.novel_id !== book ||
    !id(v.novel_id) ||
    !id(v.target_id) ||
    !integer(v.revision, 1) ||
    !integer(v.version) ||
    !reason(v.reason) ||
    !reason(v.decision_reason) ||
    !["book", "chapter", "version"].includes(v.scope) ||
    (v.scope === "version" ? v.version === 0 : v.version !== 0) ||
    (v.scope === "book" && v.target_id !== book) ||
    !["active", "revoked"].includes(v.state) ||
    !date(v.created_at) ||
    !(v.next_appeal_at === null || date(v.next_appeal_at))
  )
    fail();
  return v;
}
function checkedAppeal(v: NovelAppeal, book: string, caseId: number) {
  if (
    !v ||
    v.novel_id !== book ||
    v.case_id !== caseId ||
    !integer(v.id, 1) ||
    !reason(v.reason) ||
    !reason(v.decision_reason) ||
    !["pending", "upheld", "revoked"].includes(v.state) ||
    !date(v.created_at) ||
    !(v.decided_at === null || date(v.decided_at)) ||
    (v.state === "pending" ? v.decided_at !== null : v.decided_at === null)
  )
    fail();
  return v;
}
export function checkedAppealResult(
  v: NovelCaseResult,
  book: string,
  caseId: number,
  input: NovelAppealInput,
) {
  if (
    !v ||
    v.novel_id !== book ||
    v.case_id !== caseId ||
    !integer(v.id, 1) ||
    v.operation !== "appeal" ||
    v.state !== "pending" ||
    v.revision !== input.expected_revision
  )
    fail();
  return v;
}
function checkInput(caseId: number, input: NovelAppealInput) {
  if (
    !integer(caseId, 1) ||
    !id(input.mutation_id) ||
    !integer(input.expected_revision, 1) ||
    !reason(input.reason) ||
    !input.reason.trim()
  )
    throw new ApiError("invalid_input");
}
export class NovelGovernanceApi {
  private transport: Transport;
  constructor(transport: Transport) {
    this.transport = transport;
  }
  private root(book: string) {
    if (!id(book)) throw new ApiError("invalid_input");
    return `/my/novels/${book}`;
  }
  async list(book: string, before = 0, signal?: AbortSignal) {
    if (!integer(before)) throw new ApiError("invalid_input");
    const page = await this.transport<CasePage>(
      this.root(book) + `/moderation?before=${before}`,
      { signal },
    );
    if (
      !page ||
      !Array.isArray(page.items) ||
      page.items.length > 20 ||
      !integer(page.next) ||
      (page.next !== 0 && page.next !== page.items.at(-1)?.id)
    )
      fail();
    let previous = before;
    for (const item of page.items) {
      checkedNovelCase(item, book);
      if (previous !== 0 && item.id >= previous) fail();
      previous = item.id;
    }
    return page;
  }
  async detail(
    book: string,
    caseId: number,
    beforeAppeal = 0,
    signal?: AbortSignal,
  ) {
    if (!integer(caseId, 1) || !integer(beforeAppeal))
      throw new ApiError("invalid_input");
    const detail = await this.transport<NovelCaseDetail>(
      this.root(book) + `/moderation/${caseId}?before_appeal=${beforeAppeal}`,
      { signal },
    );
    if (
      !detail ||
      checkedNovelCase(detail.case, book).id !== caseId ||
      !detail.appeals ||
      !Array.isArray(detail.appeals.items) ||
      detail.appeals.items.length > 20 ||
      !integer(detail.appeals.next) ||
      (detail.appeals.next !== 0 &&
        detail.appeals.next !== detail.appeals.items.at(-1)?.id)
    )
      fail();
    let previous = beforeAppeal;
    for (const item of detail.appeals.items) {
      checkedAppeal(item, book, caseId);
      if (previous !== 0 && item.id >= previous) fail();
      previous = item.id;
    }
    return detail;
  }
  async appeal(book: string, caseId: number, input: NovelAppealInput) {
    checkInput(caseId, input);
    return checkedAppealResult(
      await this.transport<NovelCaseResult>(
        this.root(book) + `/moderation/${caseId}`,
        {
          method: "POST",
          body: input,
        },
      ),
      book,
      caseId,
      input,
    );
  }
  async confirmAppeal(book: string, caseId: number, input: NovelAppealInput) {
    checkInput(caseId, input);
    return checkedAppealResult(
      await this.transport<NovelCaseResult>(
        this.root(book) + `/moderation-requests/${input.mutation_id}`,
      ),
      book,
      caseId,
      input,
    );
  }
}
