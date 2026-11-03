import { useEffect, useMemo, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSession } from "../auth/context";
import { NovelsApi } from "../api/novels";
import { DraftAccessGate } from "../drafts/DraftAccessGate";
import { DraftsListScreen } from "../drafts/DraftsListScreen";
import { localAllowed, draftMessage } from "../drafts/workspace";
import { id } from "../drafts/model";
import { Status } from "../components/Ui";
import { theme } from "../theme";
import {
  cacheChapterBook,
  localChapterBooks,
  nativeChapterTools,
} from "../novels/chapters/native";
import type { CachedChapterBook } from "../novels/chapters/storage";
export default function ChapterDrafts() {
  const params = useLocalSearchParams<{ book?: string | string[] }>(),
    state = useSession();
  if (typeof params.book !== "string" || !id(params.book))
    return (
      <Status
        title="书籍链接无效"
        actionLabel="返回草稿箱"
        onRetry={() => router.replace("/drafts")}
      />
    );
  return (
    <DraftAccessGate>
      <Workspace key={params.book + state.generation} book={params.book} />
    </DraftAccessGate>
  );
}
function Workspace({ book }: { book: string }) {
  const { session } = useSession(),
    [cached, setCached] = useState<CachedChapterBook | null>(null),
    [error, setError] = useState<unknown>(),
    [done, setDone] = useState(false);
  const tools = useMemo(
    () => nativeChapterTools(session, book),
    [session, book],
  );
  useEffect(() => {
    let active = true;
    const initial = session.snapshot();
    const valid = () =>
      active &&
      localAllowed(session.snapshot()) &&
      initial.generation === session.snapshot().generation;
    void (async () => {
      try {
        const local = (await localChapterBooks(session.snapshot)).find(
          (x) => x.id === book,
        );
        if (!valid()) return;
        if (local) setCached(local);
        if (initial.drafts.phase === "online") {
          const fresh = await new NovelsApi((path, options) =>
            session.authorized(path, options),
          ).read(book);
          if (!valid()) return;
          await cacheChapterBook(session.snapshot, {
            id: fresh.id,
            title: fresh.title,
          });
          if (valid()) setCached({ id: fresh.id, title: fresh.title });
        } else if (!local) throw new Error("offline_book_not_cached");
      } catch (e) {
        if (valid()) setError(e);
      } finally {
        if (valid()) setDone(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [session, book]);
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.surface }}>
      {cached ? (
        <DraftsListScreen tools={tools} chapterBook={cached} />
      ) : (
        <Status
          loading={!done}
          title={done ? "尚不能打开这本书" : "正在读取书籍资料"}
          message={error ? draftMessage(error) : undefined}
          actionLabel="返回草稿箱"
          onRetry={() => router.replace("/drafts")}
        />
      )}
    </SafeAreaView>
  );
}
