import type { components } from "../api/contract";
import { ApiError } from "../api/client.ts";
import type { Transport } from "../auth/session.ts";
import { id, integer, date } from "../drafts/model.ts";
export type AuthorPolicyPage = components["schemas"]["AuthorPolicyPage"];
export class AuthorPolicyApi {
  private transport: Transport;
  constructor(transport: Transport) {
    this.transport = transport;
  }
  async read(book: string | null, before = 0, signal?: AbortSignal) {
    if ((book !== null && !id(book)) || !integer(before))
      throw new ApiError("invalid_input");
    const p = await this.transport<AuthorPolicyPage>(
      `${book === null ? "/my/author-policy" : `/my/novels/${book}/author-policy`}${before ? `?before=${before}` : ""}`,
      { signal },
    );
    const policy = p?.policy;
    if (
      !policy ||
      !integer(policy.revision) ||
      typeof policy.active !== "boolean" ||
      typeof policy.reason !== "string" ||
      Array.from(policy.reason).length > 2000 ||
      !(policy.observation_until === null || date(policy.observation_until)) ||
      (policy.active && policy.observation_until === null) ||
      !Array.isArray(p.items) ||
      p.items.length > 20 ||
      !integer(p.next)
    )
      throw new ApiError("contract");
    let prior = before || Number.MAX_SAFE_INTEGER;
    const seen = new Set<string>();
    for (const e of p.items) {
      if (
        !e ||
        !id(e.context_id) ||
        !["novel", "work"].includes(e.context_kind) ||
        !id(e.mutation_id) ||
        seen.has(e.mutation_id) ||
        !integer(e.revision, 1) ||
        e.revision >= prior ||
        !["start", "extend", "revoke"].includes(e.action) ||
        !date(e.created_at) ||
        typeof e.reason !== "string" ||
        !e.reason.trim() ||
        Array.from(e.reason).length > 2000 ||
        !(e.previous_until === null || date(e.previous_until)) ||
        !(e.observation_until === null || date(e.observation_until)) ||
        (e.action === "revoke"
          ? e.observation_until !== null
          : e.observation_until === null)
      )
        throw new ApiError("contract");
      seen.add(e.mutation_id);
      prior = e.revision;
    }
    if (
      p.next &&
      (p.items.length !== 20 || p.next !== p.items.at(-1)?.revision)
    )
      throw new ApiError("contract");
    return p;
  }
}
