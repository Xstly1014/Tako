import type { components } from "../api/contract";
import type { Transport } from "../auth/session.ts";
import { ApiError } from "../api/client.ts";
import { date, id, integer } from "../drafts/model.ts";
export type LifecycleReceipt = components["schemas"]["NovelLifecycleReceipt"];
export type CompletionCheck = components["schemas"]["NovelCompletionCheck"];
export type Rectification = components["schemas"]["NovelRectification"];
export type RectificationPreview =
  components["schemas"]["NovelRectificationPreview"];
export type RectificationDetail =
  components["schemas"]["NovelRectificationDetail"];
type Schema<N extends keyof components["schemas"]> = components["schemas"][N];
const text = (v: unknown, max: number): v is string =>
  typeof v === "string" && Array.from(v).length <= max;
const fail = (): never => {
  throw new ApiError("contract");
};
const states = [
  "available",
  "submitted",
  "approved",
  "rejected",
  "cancelled",
  "withdrawn",
];
const operations: Record<
  LifecycleReceipt["operation"],
  LifecycleReceipt["state"]
> = {
  completion_check: "prepared",
  complete: "completed",
  rectification_grant: "available",
  rectification_prepare: "prepared",
  rectification_submit: "submitted",
  rectification_cancel: "cancelled",
  rectification_withdraw: "withdrawn",
  rectification_approve: "approved",
  rectification_reject: "rejected",
};
export function checkedLifecycleReceipt(
  v: LifecycleReceipt,
  book: string,
  mutation: string,
  operation?: LifecycleReceipt["operation"],
  target?: string,
) {
  if (
    !v ||
    v.novel_id !== book ||
    !id(v.novel_id) ||
    v.mutation_id !== mutation ||
    !id(v.mutation_id) ||
    !id(v.target_id) ||
    (target && v.target_id !== target) ||
    !Object.hasOwn(operations, v.operation) ||
    (operation && v.operation !== operation) ||
    operations[v.operation] !== v.state ||
    !integer(v.revision, 1) ||
    !integer(v.version) ||
    !date(v.accepted_at) ||
    (v.operation === "rectification_approve" ? v.version < 2 : v.version !== 0)
  )
    fail();
  return v;
}
export function checkedCompletionCheck(
  v: CompletionCheck,
  book: string,
  target: string,
) {
  if (
    !v ||
    v.novel_id !== book ||
    v.id !== target ||
    !id(v.novel_id) ||
    !id(v.id) ||
    !integer(v.state_revision, 1) ||
    ![
      v.formal_chapters,
      v.last_formal_ordinal,
      v.last_reserved_ordinal,
      v.hidden_chapters,
      v.restricted_chapters,
      v.pending_chapters,
      v.unpublished_drafts,
    ].every((n) => integer(n)) ||
    !(v.last_formal_chapter === null || id(v.last_formal_chapter)) ||
    ![v.author_hidden, v.platform_limited, v.completed, v.eligible].every(
      (n) => typeof n === "boolean",
    ) ||
    !date(v.expires_at) ||
    v.hidden_chapters > v.formal_chapters ||
    v.restricted_chapters > v.formal_chapters ||
    v.last_formal_ordinal > v.last_reserved_ordinal ||
    (v.formal_chapters === 0) !== (v.last_formal_chapter === null) ||
    (v.formal_chapters === 0) !== (v.last_formal_ordinal === 0) ||
    v.eligible !==
      (!v.completed && v.formal_chapters > 0 && v.pending_chapters === 0)
  )
    fail();
  return v;
}
export function checkedRectification(
  v: Rectification,
  book: string,
  target?: string,
) {
  if (
    !v ||
    v.novel_id !== book ||
    !id(v.novel_id) ||
    !id(v.id) ||
    (target && v.id !== target) ||
    !id(v.chapter_id) ||
    ![v.case_id, v.case_revision, v.base_version, v.revision].every((n) =>
      integer(n, 1),
    ) ||
    !states.includes(v.state) ||
    !text(v.reason, 2000) ||
    !v.reason.trim() ||
    !text(v.decision_reason, 2000) ||
    !(v.preview_id === null || id(v.preview_id)) ||
    !date(v.created_at) ||
    !(v.submitted_at === null || date(v.submitted_at)) ||
    !(v.decided_at === null || date(v.decided_at)) ||
    !integer(v.published_version) ||
    typeof v.revoked_case !== "boolean" ||
    typeof v.target_current !== "boolean"
  )
    fail();
  if (
    (v.state === "available" &&
      (v.preview_id !== null || v.submitted_at !== null)) ||
    (v.state !== "available" &&
      v.state !== "cancelled" &&
      (v.preview_id === null || v.submitted_at === null)) ||
    ["available", "submitted"].includes(v.state) !== (v.decided_at === null) ||
    (v.state === "approved"
      ? v.published_version !== v.base_version + 1
      : v.published_version !== 0) ||
    (v.revoked_case && v.state !== "approved")
  )
    fail();
  return v;
}
export function checkedRectificationPreview(
  v: RectificationPreview,
  book: string,
  target?: string,
  grant?: Rectification,
) {
  if (
    !v ||
    v.novel_id !== book ||
    !id(v.novel_id) ||
    !id(v.id) ||
    (target && v.id !== target) ||
    !id(v.grant_id) ||
    !id(v.chapter_id) ||
    !id(v.draft_id) ||
    ![v.base_version, v.grant_revision, v.source_revision].every((n) =>
      integer(n, 1),
    ) ||
    !text(v.title, 200) ||
    !v.title.trim() ||
    typeof v.content !== "string" ||
    !v.content.trim() ||
    new TextEncoder().encode(v.content).length > 1048576 ||
    !date(v.expires_at)
  )
    fail();
  if (
    grant &&
    (v.grant_id !== grant.id ||
      v.chapter_id !== grant.chapter_id ||
      v.base_version !== grant.base_version ||
      v.id !== grant.preview_id ||
      v.grant_revision !== 1 ||
      grant.revision < 2)
  )
    fail();
  return v;
}
export class NovelLifecycleApi {
  private transport: Transport;
  constructor(transport: Transport) {
    this.transport = transport;
  }
  private root(book: string) {
    if (!id(book)) throw new ApiError("invalid_input");
    return `/my/novels/${book}`;
  }
  private target(value: string) {
    if (!id(value)) throw new ApiError("invalid_input");
    return value;
  }
  private async write(
    book: string,
    path: string,
    input: { mutation_id: string },
    op: LifecycleReceipt["operation"],
    target?: string,
  ) {
    this.target(input.mutation_id);
    const v = await this.transport<LifecycleReceipt>(this.root(book) + path, {
      method: "POST",
      body: input,
    });
    return checkedLifecycleReceipt(v, book, input.mutation_id, op, target);
  }
  async receipt(
    book: string,
    mutation: string,
    op: LifecycleReceipt["operation"],
    target?: string,
  ) {
    this.target(mutation);
    return checkedLifecycleReceipt(
      await this.transport<LifecycleReceipt>(
        this.root(book) + `/lifecycle-requests/${mutation}`,
      ),
      book,
      mutation,
      op,
      target,
    );
  }
  prepareCompletion(book: string, input: Schema<"PrepareNovelCompletion">) {
    return this.write(book, "/completion-checks", input, "completion_check");
  }
  complete(book: string, input: Schema<"ConfirmNovelCompletion">) {
    this.target(input.check_id);
    if (input.irreversible_confirmed !== true)
      throw new ApiError("invalid_input");
    return this.write(book, "/completion", input, "complete", input.check_id);
  }
  async check(book: string, target: string) {
    this.target(target);
    return checkedCompletionCheck(
      await this.transport<CompletionCheck>(
        this.root(book) + `/completion-checks/${target}`,
      ),
      book,
      target,
    );
  }
  async list(book: string, before = 0) {
    if (!integer(before)) throw new ApiError("invalid_input");
    const p = await this.transport<Schema<"NovelRectificationPage">>(
      this.root(book) + `/rectifications?before=${before}`,
    );
    if (
      !p ||
      !Array.isArray(p.items) ||
      p.items.length > 20 ||
      !integer(p.next) ||
      (p.next !== 0 &&
        (p.items.length !== 20 || (before !== 0 && p.next >= before))) ||
      new Set(p.items.map((v) => v.id)).size !== p.items.length
    )
      fail();
    p.items.forEach((v) => checkedRectification(v, book));
    return p;
  }
  async detail(book: string, grant: string) {
    this.target(grant);
    const d = await this.transport<RectificationDetail>(
      this.root(book) + `/rectifications/${grant}`,
    );
    if (!d) fail();
    checkedRectification(d.grant, book, grant);
    if (
      d.source !== null &&
      (!d.source ||
        !id(d.source.draft_id) ||
        !text(d.source.title, 200) ||
        !integer(d.source.revision, 1))
    )
      fail();
    if ((d.grant.preview_id === null) !== (d.submitted === null)) fail();
    if (d.submitted)
      checkedRectificationPreview(
        d.submitted,
        book,
        d.grant.preview_id!,
        d.grant,
      );
    return d;
  }
  async preview(book: string, target: string) {
    this.target(target);
    return checkedRectificationPreview(
      await this.transport<RectificationPreview>(
        this.root(book) + `/rectification-previews/${target}`,
      ),
      book,
      target,
    );
  }
  prepare(
    book: string,
    grant: string,
    input: Schema<"PrepareNovelRectification">,
  ) {
    this.target(grant);
    this.target(input.draft_id);
    if (
      !integer(input.expected_revision, 1) ||
      !integer(input.source_revision, 1)
    )
      throw new ApiError("invalid_input");
    return this.write(
      book,
      `/rectifications/${grant}/previews`,
      input,
      "rectification_prepare",
    );
  }
  submit(
    book: string,
    grant: string,
    input: Schema<"SubmitNovelRectification">,
  ) {
    this.target(grant);
    this.target(input.preview_id);
    if (!integer(input.expected_revision, 1) || input.rights_confirmed !== true)
      throw new ApiError("invalid_input");
    return this.write(
      book,
      `/rectifications/${grant}/submission`,
      input,
      "rectification_submit",
      grant,
    );
  }
  withdraw(
    book: string,
    grant: string,
    input: Schema<"NovelRectificationAction">,
  ) {
    this.target(grant);
    if (
      !integer(input.expected_revision, 1) ||
      !text(input.reason, 2000) ||
      !input.reason.trim() ||
      input.revoke_case === true
    )
      throw new ApiError("invalid_input");
    return this.write(
      book,
      `/rectifications/${grant}/withdraw`,
      input,
      "rectification_withdraw",
      grant,
    );
  }
}
