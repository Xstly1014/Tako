import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
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
import { mergeReadingItems, readingChunks } from "./reading-model";
import { id } from "../drafts/model";
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
  const params = useLocalSearchParams<{ id: string }>();
  const book = typeof params.id === "string" ? params.id : "";
  return <DirectoryContent key={book} book={book} />;
}
function DirectoryContent({ book }: { book: string }) {
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
        back="长文频道"
        onBack={() => router.dismissTo("/novel-community")}
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
                  params: { book, chapter: item.id },
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
  const params = useLocalSearchParams<{ book: string; chapter: string }>();
  const book = typeof params.book === "string" ? params.book : "",
    chapter = typeof params.chapter === "string" ? params.chapter : "";
  return (
    <ChapterContent key={book + "/" + chapter} book={book} chapter={chapter} />
  );
}
function ChapterContent({ book, chapter }: { book: string; chapter: string }) {
  const valid = id(book) && id(chapter);
  const [result, setResult] = useState<{
      key: string;
      value: PublicNovelChapter;
      chunks: string[];
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
            setResult({ key, value, chunks: readingChunks(value.content) });
        })
        .catch((e: unknown) => {
          if (!controller.signal.aborted) setError(e);
        });
    return () => controller.abort();
  }, [book, chapter, valid, key, retry]);
  const value = result?.key === key ? result : undefined;
  // No focus reload: a reader can finish the already-loaded formal text.
  return (
    <SafeAreaView style={s.screen}>
      <Header
        title="长文阅读"
        back={id(book) ? "章节目录" : "长文频道"}
        onBack={() =>
          id(book)
            ? router.dismissTo({
                pathname: "/novel/[id]",
                params: { id: book },
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
            </View>
          }
          renderItem={({ item }) => (
            <Text selectable style={s.body}>
              {item}
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
                    params: { id: book },
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
