import type { AuthorWorksApi } from "../api/author-works.ts";
import { ApiError } from "../api/client.ts";
import { isWork } from "../api/reader.ts";
import type { Transport } from "../auth/session.ts";

export async function readAuthorFeedback(
  works: Pick<AuthorWorksApi, "timeline">,
  transport: Transport,
  id: string,
  signal: AbortSignal,
) {
  if (signal.aborted) throw new ApiError("stale_session");
  // Verify ownership before obtaining public interaction context. A public
  // work alone never authorizes entry into another author's workspace.
  const { state } = await works.timeline(id, 0, 0, signal);
  if (signal.aborted) throw new ApiError("stale_session");
  if (state.author_hidden || state.platform_limited)
    throw new ApiError("feedback_unavailable");
  const value = await transport(`/works/${id}`, { signal });
  if (signal.aborted) throw new ApiError("stale_session");
  if (
    !isWork(value) ||
    value.id !== id ||
    typeof value.comment_context !== "string" ||
    !value.comment_context ||
    value.comment_context.length > 512
  )
    throw new ApiError("contract");
  // Do not retain the public body or attach a version to the comments.
  return { id, title: value.title, context: value.comment_context };
}
