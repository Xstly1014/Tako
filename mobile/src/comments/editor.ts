import { ApiError } from "../api/client.ts";
import { UUID } from "../api/reader.ts";
import {
  checkedCommentResult,
  type CommentCreate,
  type CommentResult,
} from "../api/comments.ts";

// One reading page owns one editor. It never writes to disk, logs or credentials.
export class CommentEditor {
  private owner: string | null = null;
  private text = "";
  private reply: string | null = null;
  private pending: Readonly<CommentCreate> | null = null;
  private prompt: "guest" | "same-account" | null = null;
  private locked = false;
  private busy = false;
  private generation = 0;
  private disposed = false;
  private newId: () => string;
  constructor(newId: () => string) {
    this.newId = newId;
  }
  snapshot() {
    return {
      text: this.locked || this.prompt ? "" : this.text,
      replyTo: this.locked || this.prompt ? null : this.reply,
      locked: this.locked,
      prompt: this.prompt,
      busy: this.busy,
      unconfirmed: !!this.pending,
      hasInput: !!this.text || !!this.pending,
    };
  }
  syncAccount(next: string | null) {
    if (next !== null && !UUID.test(next)) throw new ApiError("invalid_input");
    if (this.disposed) return;
    if (next === this.owner) {
      if (this.locked && next) {
        this.locked = false;
        this.prompt = "same-account";
      }
      return;
    }
    this.generation++;
    this.busy = false;
    if (this.owner && next === null) {
      this.locked = true;
      return;
    }
    if (this.owner) {
      this.clear();
    } else if (this.text && next) {
      this.prompt = "guest";
    }
    this.owner = next;
    this.locked = false;
  }
  confirmInput(keep: boolean) {
    if (!this.prompt || this.locked) throw new ApiError("invalid_input");
    if (!keep) this.clear();
    this.prompt = null;
  }
  private editable() {
    if (this.disposed || this.locked || this.prompt)
      throw new ApiError("authentication_required");
    if (this.pending || this.busy) throw new ApiError("comment_unconfirmed");
  }
  edit(value: string) {
    this.editable();
    this.text = value;
  }
  replyTo(value: string | null) {
    this.editable();
    if (value !== null && !UUID.test(value))
      throw new ApiError("invalid_input");
    this.reply = value;
  }
  private clear() {
    this.text = "";
    this.reply = null;
    this.pending = null;
    this.prompt = null;
  }
  discard() {
    if (this.busy) throw new ApiError("session_busy");
    this.generation++;
    this.clear();
  }
  dispose() {
    this.generation++;
    this.disposed = true;
    this.busy = false;
    this.clear();
  }
  async submit(
    context: string,
    send: (body: CommentCreate) => Promise<CommentResult>,
  ): Promise<CommentResult> {
    if (this.disposed || this.locked || this.prompt || !this.owner)
      throw new ApiError("authentication_required", "", 401);
    if (this.busy) throw new ApiError("session_busy");
    if (!this.pending) {
      const length = Array.from(this.text.trim()).length;
      if (length < 1 || length > 1000 || !context || context.length > 512)
        throw new ApiError("invalid_input");
      const mutation = this.newId();
      if (
        !UUID.test(mutation) ||
        mutation === "00000000-0000-0000-0000-000000000000"
      )
        throw new ApiError("invalid_input");
      this.pending = Object.freeze({
        mutation_id: mutation,
        expected_account_id: this.owner,
        content: this.text,
        context,
        reply_to: this.reply,
      });
    }
    this.busy = true;
    const ticket = this.generation;
    try {
      const result = checkedCommentResult(await send({ ...this.pending }));
      if (ticket !== this.generation) throw new ApiError("stale_session");
      this.clear();
      return result;
    } catch (e) {
      if (ticket === this.generation && e instanceof ApiError) {
        if (e.status === 401) {
          this.locked = true;
          this.generation++;
          this.busy = false;
        } else if (e.status >= 400 && e.status < 500) this.pending = null;
      }
      throw e;
    } finally {
      if (ticket === this.generation) this.busy = false;
    }
  }
}
