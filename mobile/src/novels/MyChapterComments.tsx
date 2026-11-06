import { useCallback, useMemo } from "react";
import { router } from "expo-router";
import { ApiError } from "../api/client";
import { useSession } from "../auth/context";
import { MyCommentList } from "../components/CommentsPanel";
import type { Comment } from "../api/comments";
import { ChapterCommentsApi } from "./comments-api";
import { chapterCommentForPanel } from "./comment-panel-api";
export function MyChapterComments() {
  const { session, account, generation } = useSession();
  const scope = useMemo(() => {
    const owner = account?.id,
      epoch = generation;
    const current = () => {
      const state = session.snapshot();
      return (
        state.phase === "ready" &&
        state.account?.id === owner &&
        state.generation === epoch
      );
    };
    return {
      current,
      api: new ChapterCommentsApi((p, o) => {
        if (!current()) throw new ApiError("authentication_required");
        return session.authorized(p, o);
      }),
      targets: new Map<string, { book: string; chapter: string }>(),
    };
  }, [session, account?.id, generation]);
  const load = useCallback(
    async (cursor: number, signal?: AbortSignal) => {
      const page = await scope.api.mine(cursor, signal);
      if (!signal?.aborted && scope.current())
        for (const item of page.items)
          scope.targets.set(item.id, {
            book: item.novel_id,
            chapter: item.chapter_id,
          });
      return { ...page, items: page.items.map(chapterCommentForPanel) };
    },
    [scope],
  );
  const open = useCallback(
    (item: Comment) => {
      const target = scope.targets.get(item.id);
      if (target && scope.current())
        router.push({
          pathname: "/novel-chapter",
          params: { book: target.book, chapter: target.chapter },
        });
    },
    [scope],
  );
  return (
    <MyCommentList
      key={account?.id + ":" + generation}
      loadComments={load}
      onOpen={open}
    />
  );
}
