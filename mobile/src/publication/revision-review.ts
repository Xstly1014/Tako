import { ApiError } from "../api/client.ts";
import type { AuthorWorksApi, WorkState } from "../api/author-works.ts";
import type { PublicationsApi } from "../api/publications.ts";

// This is a read-only snapshot. Preparing a preview still fixes the selected R;
// the snapshot never grants publication or changes visibility.
export async function readRevisionReview(
  api: Pick<PublicationsApi, "source" | "state">,
  works: Pick<AuthorWorksApi, "version">,
  input: WorkState,
  revision: number,
) {
  const state = { ...input };
  const [source, current] = await Promise.all([
    api.source(state.draft_id),
    works.version(state.id, state.display_version),
  ]);
  const [afterSource, afterState] = await Promise.all([
    api.source(state.draft_id),
    api.state(state.id, state.draft_id),
  ]);
  if (
    source.revision !== revision ||
    afterSource.revision !== revision ||
    afterState.state_revision !== state.state_revision ||
    afterState.display_version !== state.display_version ||
    afterState.last_version !== state.last_version
  ) {
    throw new ApiError("revision_review_changed");
  }
  return {
    source,
    current,
    state: { ...state },
    changed: {
      title: source.title !== current.title,
      content: source.content !== current.content,
    },
  };
}
