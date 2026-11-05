import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import {
  FlatList,
  AppState,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { ShelfControls } from "./ShelfUi";
import { Action, Brand, Status } from "../components/Ui";
import { BottomNavigation } from "../components/PrototypeUi";
import { theme as t } from "../theme";
import {
  NovelReadingApi,
  novelReadingMessage,
  type PublicNovel,
  type DirectoryChapter,
  type PublicNovelChapter,
} from "./reading-api";
import { mergeReadingItems } from "./reading-model";
import { id } from "../drafts/model";
import {
  locatedReadingChunks,
  readingChunkIndex,
  validReadingLocation,
  type LocatedChunk,
} from "./reading-location";
import {
  useReadingPosition,
  useReadingState,
  useReadingLifecycle,
  ReadingPositionControls,
} from "./ReadingPositionUi";
import type { ReadingCandidate } from "./reading-sync";
const api = new NovelReadingApi();
type Page<T> = { items: T[]; next_cursor: string };
/** A failed next-page request keeps the prior page and cursor. Unmount cancels all reads. */
function usePages<T extends { id: string }>(
  load: (cursor: string, signal: AbortSignal) => Promise<Page<T>>,
) {
  const [page, setPage] = useState<Page<T>>(),
    [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(true);
  const epoch = useRef(0),
    active = useRef<AbortController | null>(null),
    locked = useRef(false);
  const fetchPage = useCallback(
    async (cursor = "") => {
      if (locked.current) return;
      locked.current = true;
      setBusy(true);
      setError(undefined);
      const generation = ++epoch.current,
        controller = new AbortController();
      active.current?.abort();
      active.current = controller;
      try {
        const value = await load(cursor, controller.signal);
        if (generation === epoch.current && !controller.signal.aborted)
          setPage((old) => ({
            ...value,
            items:
              cursor && old
                ? mergeReadingItems(old.items, value.items)
                : value.items,
          }));
      } catch (e) {
        if (generation === epoch.current && !controller.signal.aborted)
          setError(e);
      } finally {
        if (generation === epoch.current && !controller.signal.aborted) {
          locked.current = false;
          setBusy(false);
        }
      }
    },
    [load],
  );
  useEffect(() => {
    const controller = new AbortController();
    active.current = controller;
    locked.current = true;
    load("", controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setPage(value);
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted) setError(e);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          locked.current = false;
          setBusy(false);
        }
      });
    return () => {
      controller.abort();
      active.current?.abort();
    };
  }, [load]);
  return { page, error, busy, fetchPage };
}
function Header({
  title,
  back,
  onBack,
}: {
  title: string;
  back: string;
  onBack: () => void;
}) {
  return (
    <View style={s.header}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={back}
        onPress={onBack}
        style={s.back}
      >
        <Text style={s.link}>{back}</Text>
      </Pressable>
      <Text style={s.heading}>{title}</Text>
      <Brand />
    </View>
  );
}
function Footer({
  busy,
  error,
  next,
  more,
  refresh,
}: {
  busy: boolean;
  error: unknown;
  next?: string;
  more: () => void;
  refresh: () => void;
}) {
  return (
    <View style={s.footer}>
      {error ? (
        <Text accessibilityRole="alert" style={s.error}>
          {novelReadingMessage(error)}
        </Text>
      ) : null}
      {next ? (
        <Action
          label={busy ? "正在加载" : error ? "重试加载更多" : "加载更多"}
          disabled={busy}
          onPress={more}
        />
      ) : null}
      {error && !next ? (
        <Action label="重新加载" disabled={busy} onPress={refresh} />
      ) : null}
    </View>
  );
}
export function NovelCommunityScreen() {
  const load = useCallback(
    (cursor: string, signal: AbortSignal) => api.list(cursor, signal),
    [],
  );
  const { page, error, busy, fetchPage } = usePages<PublicNovel>(load);
  return (
    <SafeAreaView style={s.screen}>
      <Header
        title="长文"
        back="中篇"
        onBack={() => router.dismissTo("/community")}
      />
      {!page ? (
        <Status
          loading={busy}
          title={busy ? "正在加载长文" : "长文未能加载"}
          message={error ? novelReadingMessage(error) : undefined}
          onRetry={busy ? undefined : () => void fetchPage()}
        />
      ) : (
        <FlatList
          data={page.items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={s.list}
          refreshing={busy && !!page}
          onRefresh={() => void fetchPage()}
          initialNumToRender={8}
          windowSize={7}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={"打开作品 " + item.title}
              onPress={() =>
                router.push({
                  pathname: "/novel/[id]",
                  params: { id: item.id },
                })
              }
              style={({ pressed }) => [s.row, pressed && s.pressed]}
            >
              <Text style={s.title} numberOfLines={2}>
                {item.title}
              </Text>
              <Text style={s.meta}>
                {item.author} · {item.completed ? "已完结" : "连载中"} ·{" "}
                {item.chapter_count} 章
              </Text>
              {item.introduction ? (
                <Text style={s.intro} numberOfLines={3}>
                  {item.introduction}
                </Text>
              ) : null}
              <Text style={s.meta}>{item.tags.join(" · ")}</Text>
            </Pressable>
          )}
          ListEmptyComponent={
            <Status
              title="还没有公开长文"
              message="作品发布可读章节后会出现在这里。下拉可刷新。"
            />
          }
          ListFooterComponent={
            <Footer
              busy={busy}
              error={error}
              next={page.next_cursor}
              more={() => void fetchPage(page.next_cursor)}
              refresh={() => void fetchPage()}
            />
          }
        />
      )}
      <BottomNavigation onHome={() => router.dismissTo("/community")} />
    </SafeAreaView>
  );
}
export function NovelDirectoryScreen() {
  const params = useLocalSearchParams<{
    id: string;
    from?: string;
    notice?: string;
  }>();
  const book = typeof params.id === "string" ? params.id : "";
  return (
    <DirectoryContent
      key={book}
      book={book}
      fromShelf={params.from === "shelf"}
      fromNotice={
        params.from === "notice" && id(params.notice)
          ? params.notice
          : undefined
      }
    />
  );
}
function DirectoryContent({
  book,
  fromShelf,
  fromNotice,
}: {
  book: string;
  fromShelf: boolean;
  fromNotice?: string;
}) {
  const sync = useReadingPosition(book);
  const { localError } = useReadingLifecycle(sync);
  const valid = id(book);
  const [details, setDetails] = useState<PublicNovel>();
  const load = useCallback(
    async (cursor: string, signal: AbortSignal) => {
      if (!cursor) {
        const value = await api.book(book, signal);
        if (!signal.aborted) setDetails(value);
      }
      return api.directory(book, cursor, signal);
    },
    [book],
  );
  const { page, error, busy, fetchPage } = usePages<DirectoryChapter>(load);
  return (
    <SafeAreaView style={s.screen}>
      <Header
        title="章节目录"
        back={fromNotice ? "消息详情" : fromShelf ? "我的书架" : "长文频道"}
        onBack={() =>
          fromNotice
            ? router.dismissTo({
                pathname: "/notice/[id]",
                params: { id: fromNotice },
              })
            : router.dismissTo(fromShelf ? "/shelf" : "/novel-community")
        }
      />
      {!valid || !page ? (
        <Status
          loading={valid && busy}
          title={
            !valid ? "阅读地址无效" : busy ? "正在加载目录" : "目录未能加载"
          }
          message={error ? novelReadingMessage(error) : undefined}
          onRetry={valid && !busy ? () => void fetchPage() : undefined}
        />
      ) : (
        <FlatList
          key={book}
          data={page.items}
          keyExtractor={(item) => item.id}
          refreshing={busy}
          onRefresh={() => void fetchPage()}
          initialNumToRender={16}
          windowSize={7}
          contentContainerStyle={s.list}
          ListHeaderComponent={
            details ? (
              <View style={s.book}>
                <Text style={s.bookTitle}>{details.title}</Text>
                <Text style={s.meta}>
                  {details.author} · {details.completed ? "已完结" : "连载中"}
                </Text>
                {details.introduction ? (
                  <Text style={s.intro}>{details.introduction}</Text>
                ) : null}
                <ShelfControls book={book} readable={!error} />
                <ReadingPositionControls
                  sync={sync}
                  error={localError}
                  onResume={(p) =>
                    router.push({
                      pathname: "/novel-chapter",
                      params: {
                        book,
                        chapter: p.chapter_id,
                        resume: "1",
                        ...(fromNotice
                          ? { from: "notice", notice: fromNotice }
                          : fromShelf
                            ? { from: "shelf" }
                            : {}),
                      },
                    })
                  }
                />
              </View>
            ) : undefined
          }
          renderItem={({ item }) => (
            <Pressable
              disabled={!item.readable}
              accessibilityRole="button"
              accessibilityState={{ disabled: !item.readable }}
              accessibilityLabel={
                "第" +
                item.ordinal +
                "章 " +
                (item.readable ? item.title : "暂不可读")
              }
              onPress={() =>
                router.push({
                  pathname: "/novel-chapter",
                  params: {
                    book,
                    chapter: item.id,
                    ...(fromNotice
                      ? { from: "notice", notice: fromNotice }
                      : fromShelf
                        ? { from: "shelf" }
                        : {}),
                  },
                })
              }
              style={({ pressed }) => [s.chapterRow, pressed && s.pressed]}
            >
              <Text style={[s.chapterTitle, !item.readable && s.muted]}>
                第{item.ordinal}章　{item.readable ? item.title : "暂不可读"}
              </Text>
            </Pressable>
          )}
          ListEmptyComponent={
            <Status
              title="暂无可展示的章节"
              message="下拉刷新可重新检查目录。"
            />
          }
          ListFooterComponent={
            <Footer
              busy={busy}
              error={error}
              next={page.next_cursor}
              more={() => void fetchPage(page.next_cursor)}
              refresh={() => void fetchPage()}
            />
          }
        />
      )}
    </SafeAreaView>
  );
}
export function NovelChapterScreen() {
  const params = useLocalSearchParams<{
    book: string;
    chapter: string;
    resume?: string;
    from?: string;
    notice?: string;
  }>();
  const book = typeof params.book === "string" ? params.book : "",
    chapter = typeof params.chapter === "string" ? params.chapter : "";
  return (
    <ChapterContent
      key={book + "/" + chapter}
      book={book}
      chapter={chapter}
      resume={params.resume === "1"}
      fromShelf={params.from === "shelf"}
      fromNotice={
        params.from === "notice" && id(params.notice)
          ? params.notice
          : undefined
      }
    />
  );
}
function ChapterContent({
  book,
  chapter,
  resume,
  fromShelf,
  fromNotice,
}: {
  book: string;
  chapter: string;
  resume: boolean;
  fromShelf: boolean;
  fromNotice?: string;
}) {
  const sync = useReadingPosition(book),
    state = useReadingState(sync);
  const { localError, operation, focused } = useReadingLifecycle(sync);
  const list = useRef<FlatList<LocatedChunk>>(null);
  const [resumeNotice, setResumeNotice] = useState("");
  const firstSync = useRef(sync);
  const applied = useRef<ReturnType<typeof useReadingPosition> | undefined>(
      undefined,
    ),
    captureAllowed = useRef(false),
    restoreIndex = useRef<number | null>(null),
    restoreAttempts = useRef(0);
  const capture = useRef<(p: ReadingCandidate) => void>(() => {});
  const [visibleLocation, setVisibleLocation] = useState<{
    sync: NonNullable<typeof sync>;
    value: ReadingCandidate;
  } | null>(null);
  const restoreTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const onVisible = useCallback(
    ({
      viewableItems,
    }: {
      viewableItems: {
        item: LocatedChunk;
        index?: number | null;
        isViewable: boolean;
      }[];
    }) => {
      if (!captureAllowed.current) return;
      const first = viewableItems.find(
        (v) => v.isViewable && typeof v.index === "number",
      );
      if (first)
        capture.current({
          chapter_id: chapter,
          version: 0,
          locator: {
            algorithm: 1,
            paragraph: first.item.paragraph,
            offset: first.item.offset,
          },
        });
    },
    [chapter],
  );
  const viewability = useMemo(
    () => ({ minimumViewTime: 2000, itemVisiblePercentThreshold: 30 }),
    [],
  );
  const valid = id(book) && id(chapter);
  const [result, setResult] = useState<{
      key: string;
      value: PublicNovelChapter;
      chunks: LocatedChunk[];
    }>(),
    [error, setError] = useState<unknown>(),
    [retry, setRetry] = useState(0);
  const key = book + "/" + chapter;
  useEffect(() => {
    const controller = new AbortController();
    if (valid)
      api
        .chapter(book, chapter, controller.signal)
        .then((value) => {
          if (!controller.signal.aborted)
            setResult({
              key,
              value,
              chunks: locatedReadingChunks(value.content),
            });
        })
        .catch((e: unknown) => {
          if (!controller.signal.aborted) setError(e);
        });
    return () => controller.abort();
  }, [book, chapter, valid, key, retry]);
  const value = result?.key === key ? result : undefined;
  useEffect(() => {
    capture.current = (p) => {
      if (
        value &&
        sync &&
        sync.snapshot().ready &&
        focused.current &&
        AppState.currentState === "active"
      ) {
        applied.current = sync;
        setVisibleLocation({
          sync,
          value: { ...p, version: value.value.version },
        });
      }
    };
    return () => {
      capture.current = () => {};
    };
  }, [value, sync, focused]);
  useEffect(() => {
    captureAllowed.current = false;
    return () => {
      captureAllowed.current = false;
      if (restoreTimer.current) clearTimeout(restoreTimer.current);
    };
  }, [sync]);
  const applyLocation = useCallback(
    (p: ReadingCandidate) => {
      if (p.chapter_id !== chapter) {
        router.replace({
          pathname: "/novel-chapter",
          params: {
            book,
            chapter: p.chapter_id,
            resume: "1",
            ...(fromNotice
              ? { from: "notice", notice: fromNotice }
              : fromShelf
                ? { from: "shelf" }
                : {}),
          },
        });
        return;
      }
      if (!value) return;
      applied.current = sync;
      captureAllowed.current = false;
      const compatible =
        p.version === value.value.version &&
        validReadingLocation(value.value.content, p.locator);
      setResumeNotice(
        compatible
          ? "已回到上次阅读位置"
          : "本章已修订，从本章开头继续；旧位置不会套用到新正文。",
      );
      const index = compatible
        ? readingChunkIndex(value.value.content, p.locator)
        : 0;
      restoreIndex.current = index;
      restoreAttempts.current = 0;
      try {
        list.current?.scrollToIndex({
          index,
          animated: false,
          viewPosition: 0,
        });
      } catch {
        setResumeNotice("位置暂未定位，可继续阅读或再次点击续读。");
      }
    },
    [book, chapter, value, sync, fromShelf, fromNotice],
  );
  useEffect(() => {
    if (
      !value ||
      !sync ||
      !state.ready ||
      state.busy ||
      applied.current === sync
    )
      return;
    // Signing in or changing accounts does not import the previous viewer's scroll position.
    if (firstSync.current !== sync) {
      applied.current = sync;
      return;
    }
    const p = state.record?.candidate ?? state.record?.cloud;
    if (resume && p && p.chapter_id === chapter) {
      const timer = setTimeout(() => {
        applied.current = sync;
        applyLocation(p);
      }, 0);
      return () => clearTimeout(timer);
    }
    const timer = setTimeout(() => {
      if (applied.current === sync) return;
      applied.current = sync;
      if (!focused.current || AppState.currentState !== "active") return;
      captureAllowed.current = true;
      setVisibleLocation({
        sync,
        value: {
          chapter_id: chapter,
          version: value.value.version,
          locator: { algorithm: 1, paragraph: 0, offset: 0 },
        },
      });
    }, 2000);
    return () => clearTimeout(timer);
  }, [
    value,
    sync,
    state.ready,
    state.busy,
    state.record,
    resume,
    chapter,
    applyLocation,
    focused,
  ]);
  useEffect(() => {
    if (!sync || visibleLocation?.sync !== sync) return;
    void operation(() => sync.capture(visibleLocation.value));
  }, [sync, visibleLocation, operation]);
  useEffect(() => {
    if (
      !sync ||
      !state.record?.candidate ||
      state.record.pending ||
      state.record.conflict ||
      state.record.blocked ||
      state.busy ||
      state.error
    )
      return;
    const timer = setTimeout(() => {
      if (focused.current && AppState.currentState === "active")
        void operation(() => sync.sync());
    }, 10_000);
    return () => clearTimeout(timer);
  }, [sync, state.record, state.busy, state.error, operation, focused]);
  // No focus reload: a reader can finish the already-loaded formal text.
  return (
    <SafeAreaView style={s.screen}>
      <Header
        title="长文阅读"
        back={fromNotice ? "消息详情" : id(book) ? "章节目录" : "长文频道"}
        onBack={() =>
          fromNotice
            ? router.dismissTo({
                pathname: "/notice/[id]",
                params: { id: fromNotice },
              })
            : id(book)
              ? router.dismissTo({
                  pathname: "/novel/[id]",
                  params: {
                    id: book,
                    ...(fromNotice
                      ? { from: "notice", notice: fromNotice }
                      : fromShelf
                        ? { from: "shelf" }
                        : {}),
                  },
                })
              : router.dismissTo("/novel-community")
        }
      />
      {!value ? (
        <Status
          loading={valid && !error}
          title={
            !valid ? "阅读地址无效" : error ? "章节未能加载" : "正在加载章节"
          }
          message={error ? novelReadingMessage(error) : undefined}
          onRetry={
            valid && error
              ? () => {
                  setError(undefined);
                  setRetry((n) => n + 1);
                }
              : undefined
          }
        />
      ) : (
        <FlatList
          ref={list}
          onViewableItemsChanged={onVisible}
          viewabilityConfig={viewability}
          onScrollBeginDrag={() => {
            captureAllowed.current = true;
          }}
          onScrollToIndexFailed={(info) => {
            if (
              restoreIndex.current === null ||
              restoreAttempts.current++ >= 3
            ) {
              setResumeNotice("未能精确定位，可以重试续读或从当前处阅读。");
              return;
            }
            list.current?.scrollToOffset({
              offset: Math.max(0, info.averageItemLength * info.index),
              animated: false,
            });
            if (restoreTimer.current) clearTimeout(restoreTimer.current);
            restoreTimer.current = setTimeout(() => {
              try {
                if (restoreIndex.current !== null)
                  list.current?.scrollToIndex({
                    index: restoreIndex.current,
                    animated: false,
                    viewPosition: 0,
                  });
              } catch {
                setResumeNotice("位置暂未定位，可重试续读。");
              }
            }, 150);
          }}
          key={key}
          data={value.chunks}
          keyExtractor={(_, index) => String(index)}
          initialNumToRender={8}
          windowSize={7}
          contentContainerStyle={s.reading}
          ListHeaderComponent={
            <View style={s.book}>
              <Text style={s.meta}>第{value.value.ordinal}章</Text>
              <Text style={s.bookTitle}>{value.value.title}</Text>
              <ReadingPositionControls
                sync={sync}
                currentChapter={chapter}
                onResume={applyLocation}
                error={localError}
              />
              {resumeNotice ? <Text style={s.meta}>{resumeNotice}</Text> : null}
            </View>
          }
          renderItem={({ item }) => (
            <Text selectable style={s.body}>
              {item.text || "\n"}
            </Text>
          )}
          ListFooterComponent={
            <View style={s.footer}>
              <Text style={s.meta}>本章结束</Text>
              <Action
                label="返回目录"
                onPress={() =>
                  router.dismissTo({
                    pathname: "/novel/[id]",
                    params: {
                      id: book,
                      ...(fromNotice
                        ? { from: "notice", notice: fromNotice }
                        : fromShelf
                          ? { from: "shelf" }
                          : {}),
                    },
                  })
                }
              />
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: t.surface },
  header: {
    minHeight: 56,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomColor: t.line,
    borderBottomWidth: 1,
    gap: 8,
  },
  back: { minHeight: 48, justifyContent: "center" },
  heading: { fontSize: 16, fontWeight: "600", color: t.ink },
  link: { color: t.brand, fontSize: 14 },
  list: { flexGrow: 1, paddingHorizontal: 16 },
  row: {
    paddingVertical: 24,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: t.line,
  },
  title: { fontSize: 20, lineHeight: 28, fontWeight: "600", color: t.ink },
  meta: { fontSize: 12, lineHeight: 20, color: t.muted },
  intro: { fontSize: 14, lineHeight: 24, color: t.secondary },
  footer: { paddingVertical: 24, gap: 16 },
  error: { fontSize: 14, lineHeight: 24, color: t.danger },
  pressed: { backgroundColor: t.background },
  book: { paddingVertical: 24, gap: 12 },
  bookTitle: { fontSize: 24, lineHeight: 32, fontWeight: "600", color: t.ink },
  chapterRow: {
    minHeight: 56,
    paddingVertical: 16,
    borderBottomColor: t.line,
    borderBottomWidth: 1,
  },
  chapterTitle: { fontSize: 16, lineHeight: 24, color: t.ink },
  muted: { color: t.muted },
  reading: { paddingHorizontal: 24, paddingBottom: 24 },
  body: { fontSize: 18, lineHeight: 32, color: t.ink },
});
