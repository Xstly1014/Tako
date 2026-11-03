import { ApiError } from "../api/client.ts";
import {
  checkedWorkState,
  type AuthorWorksApi,
  type AuthorTimeline,
  type WorkState,
} from "../api/author-works.ts";
import type { PublicWork } from "../api/reader.ts";

export function versionDecisionBlock(
  state: WorkState,
  candidate: number,
  versions: AuthorTimeline["versions"],
) {
  const selected = versions.find((item) => item.version === candidate);
  if (state.platform_limited || !selected || selected.platform_limited)
    return "unavailable";
  if (state.author_hidden) {
    const latest = versions.find((item) => item.version === state.last_version);
    if (!latest) return "unavailable";
    // Existing restore rights permit an explicit old version only when the
    // latest version is unavailable; a healthy latest version must be restored.
    if (!latest.platform_limited && candidate !== state.last_version)
      return "restore_latest_required";
  }
  return "";
}

export type VersionPair = {
  state: WorkState;
  current: PublicWork;
  candidate: PublicWork;
  changed: {
    title: boolean;
    introduction: boolean;
    tags: boolean;
    content: boolean;
  };
};
export async function readVersionPair(
  api: Pick<AuthorWorksApi, "version" | "timeline">,
  input: WorkState,
  candidate: number,
  signal: AbortSignal,
): Promise<VersionPair> {
  const state = { ...checkedWorkState(input) };
  if (
    !Number.isSafeInteger(candidate) ||
    candidate < 1 ||
    candidate > state.last_version ||
    candidate === state.display_version
  )
    throw new ApiError("invalid_input");
  const controller = new AbortController(),
    abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const check = () => {
    if (controller.signal.aborted) throw new ApiError("comparison_cancelled");
  };
  try {
    check();
    const [current, selected] = await Promise.all([
      api.version(state.id, state.display_version, controller.signal),
      api.version(state.id, candidate, controller.signal),
    ]);
    check();
    const { state: latest } = await api.timeline(
      state.id,
      0,
      0,
      controller.signal,
    );
    check();
    // Bodies are fixed; visibility and display decisions must use the same state.
    if (
      latest.state_revision !== state.state_revision ||
      latest.display_version !== state.display_version ||
      latest.last_version !== state.last_version ||
      latest.draft_id !== state.draft_id ||
      latest.author_hidden !== state.author_hidden ||
      latest.platform_limited !== state.platform_limited ||
      latest.history_open !== state.history_open
    )
      throw new ApiError("comparison_state_changed");
    return {
      state,
      current,
      candidate: selected,
      changed: {
        title: current.title !== selected.title,
        introduction: current.introduction !== selected.introduction,
        tags:
          JSON.stringify([...current.tags].sort()) !==
          JSON.stringify([...selected.tags].sort()),
        content: current.content !== selected.content,
      },
    };
  } finally {
    signal.removeEventListener("abort", abort);
    controller.abort();
  }
}
