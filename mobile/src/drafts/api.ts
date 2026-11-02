import type { components, paths } from "../api/contract";
import type { Transport } from "../auth/session.ts";
import { ApiError } from "../api/client.ts";
import { date, id, integer, object, type DraftAck, type DraftPending, type ServerDraft } from "./model.ts";

export type DraftPage = paths["/api/drafts"]["get"]["responses"][200]["content"]["application/json"];
export function checkedAck(v: unknown): DraftAck {
  if (!object(v) || !id(v.draft_id) || !integer(v.revision, 1) || !date(v.saved_at)) throw new ApiError("contract");
  return v as DraftAck;
}
export function checkedDraftReceipt(v: unknown, pending: DraftPending) {
  const result = checkedAck(v);
  const expected = pending.kind === "save" ? pending.body.base_revision! + 1 : 1;
  if (result.revision !== expected || (pending.kind === "save" && result.draft_id !== pending.body.draft_id) ||
      (pending.kind === "recover" && result.draft_id === pending.body.draft_id)) throw new ApiError("contract");
  return result;
}
export function checkedDraft(v: unknown, expected: string): ServerDraft {
  if (!object(v) || v.id !== expected || !integer(v.revision, 1) || !date(v.saved_at) ||
      typeof v.title !== "string" || typeof v.content !== "string") throw new ApiError("contract");
  return v as ServerDraft;
}
export interface DraftSyncApi {
  me(): Promise<components["schemas"]["Account"]>;
  read(id: string): Promise<ServerDraft>;
  write(pending: DraftPending): Promise<DraftAck>;
}
export class DraftsApi implements DraftSyncApi {
  private transport: Transport;
  constructor(transport: Transport) { this.transport = transport; }
  async me() {
    const result = await this.transport<components["schemas"]["Account"]>("/me");
    if (!result || !id(result.id) || typeof result.nickname !== "string") throw new ApiError("contract");
    return result;
  }
  async read(draftId: string) {
    if (!id(draftId)) throw new ApiError("invalid_input");
    return checkedDraft(await this.transport(`/drafts/${draftId}`), draftId);
  }
  async list(cursor = "", signal?: AbortSignal): Promise<DraftPage> {
    const page = await this.transport<DraftPage>(`/drafts?cursor=${encodeURIComponent(cursor)}`, { signal });
    if (!page || !Array.isArray(page.items) || typeof page.next_cursor !== "string" ||
        !page.items.every((x) => id(x.id) && integer(x.revision, 1) && typeof x.title === "string" &&
          date(x.saved_at) && date(x.created_at) && (x.recovered_from === null || id(x.recovered_from)))) throw new ApiError("contract");
    return page;
  }
  async write(pending: DraftPending) {
    return checkedDraftReceipt(await this.transport(`/drafts/${pending.kind}`, { method: "POST", body: pending.body }), pending);
  }
}
