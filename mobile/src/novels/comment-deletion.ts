import { ApiError } from "../api/client.ts";
import { id, integer } from "../drafts/model.ts";
import type {
  ChapterCommentAction,
  ChapterCommentResult,
} from "./comments-api.ts";
// Memory only: a page close does not cancel an already accepted server operation.
export class ChapterCommentDeletion {
  private pending: { id: string; body: Readonly<ChapterCommentAction> } | null =
    null;
  private busy = false;
  constructor(
    privateOwner: string,
    newId: () => string,
    current: () => boolean,
    send: (
      id: string,
      body: Readonly<ChapterCommentAction>,
    ) => Promise<ChapterCommentResult>,
  ) {
    this.owner = privateOwner;
    this.newId = newId;
    this.current = current;
    this.send = send;
  }
  private owner: string;
  private newId: () => string;
  private current: () => boolean;
  private send: (
    id: string,
    body: Readonly<ChapterCommentAction>,
  ) => Promise<ChapterCommentResult>;
  pendingId() {
    return this.pending?.id ?? null;
  }
  async remove(comment: string, revision: number) {
    if (!this.current()) throw new ApiError("authentication_required");
    if (this.busy) throw new ApiError("comment_unconfirmed");
    if (!id(comment) || !id(this.owner) || !integer(revision, 1))
      throw new ApiError("invalid_input");
    if (this.pending && this.pending.id !== comment)
      throw new ApiError("comment_unconfirmed");
    if (!this.pending)
      this.pending = {
        id: comment,
        body: Object.freeze({
          mutation_id: this.newId(),
          expected_account_id: this.owner,
          expected_revision: revision,
          action: "delete",
          reason: "",
        }),
      };
    const operation = this.pending;
    this.busy = true;
    try {
      const result = await this.send(operation.id, operation.body);
      if (result.id !== operation.id || result.state !== "deleted")
        throw new ApiError("contract");
      this.pending = null;
      return this.current();
    } catch (e) {
      if (
        e instanceof ApiError &&
        e.status >= 400 &&
        e.status < 500 &&
        e.status !== 401
      )
        this.pending = null;
      throw e;
    } finally {
      this.busy = false;
    }
  }
}
