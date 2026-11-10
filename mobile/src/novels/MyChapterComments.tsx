import { useCallback, useMemo, useState } from "react";
import { Alert, Text, View } from "react-native";
import * as Crypto from "expo-crypto";
import { ChapterCommentDeletion } from "./comment-deletion";

import { router } from "expo-router";
import { ApiError } from "../api/client";
import { useSession } from "../auth/context";
import { MyCommentList, commentStyles } from "../components/CommentsPanel";
import type { Comment } from "../api/comments";
import { ChapterCommentsApi } from "./comments-api";
import { chapterCommentForPanel } from "./comment-panel-api";
export function MyChapterComments({ book }: { book?: string } = {}) {
  const { session, account, generation } = useSession();
  const [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0);
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
    const api = new ChapterCommentsApi((p, o) => {
      if (!current()) throw new ApiError("authentication_required");
      return session.authorized(p, o);
    });
    return {
      current,
      api,
      deletion: new ChapterCommentDeletion(
        owner ?? "",
        Crypto.randomUUID,
        current,
        (id, body) => api.act(id, body),
      ),
      targets: new Map<string, { book: string; chapter: string }>(),
    };
  }, [session, account?.id, generation]);
  const load = useCallback(
    async (cursor: number, signal?: AbortSignal) => {
      const page = book
        ? await scope.api.forAuthor(book, cursor, signal)
        : await scope.api.mine(cursor, signal);
      if (!signal?.aborted && scope.current())
        for (const item of page.items)
          scope.targets.set(item.id, {
            book: item.novel_id,
            chapter: item.chapter_id,
          });
      return { ...page, items: page.items.map(chapterCommentForPanel) };
    },
    [scope, book],
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
  const remove = (item: Comment) => {
    if (!scope.current() || busy) return;
    const pending = scope.deletion.pendingId();
    if (pending && pending !== item.id) {
      setNotice("请先重试上一条未确认的删除。");
      return;
    }
    const execute = async () => {
      setBusy(true);
      setNotice("");
      try {
        if (await scope.deletion.remove(item.id, item.revision)) {
          setNotice("删除已确认。");
          setRefresh((n) => n + 1);
        }
      } catch {
        if (scope.current())
          setNotice(
            scope.deletion.pendingId()
              ? "删除结果未确认，请重试删除同一条评论。"
              : "删除未完成，请刷新后核对评论状态。",
          );
      } finally {
        if (scope.current()) setBusy(false);
      }
    };
    if (pending) {
      void execute();
      return;
    }
    Alert.alert(
      item.root_id ? "删除回复？" : "删除主评论及全部回复？",
      item.root_id
        ? "这条回复将被删除。"
        : "这条主评论下的全部回复将一起删除。",
      [
        { text: "取消", style: "cancel" },
        { text: "删除", style: "destructive", onPress: () => void execute() },
      ],
    );
  };
  return (
    <View style={commentStyles.flex}>
      {notice ? (
        <Text accessibilityRole="alert" style={commentStyles.muted}>
          {notice}
        </Text>
      ) : null}
      <MyCommentList
        key={account?.id + ":" + generation + ":" + refresh}
        loadComments={load}
        onOpen={open}
        onDelete={remove}
        deleting={busy}
      />
    </View>
  );
}
