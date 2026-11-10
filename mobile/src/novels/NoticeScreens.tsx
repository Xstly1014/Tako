import { useCallback, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSession } from "../auth/context";
import { BottomNavigation, Icon } from "../components/PrototypeUi";
import { Status } from "../components/Ui";
import { ApiError } from "../api/client";
import { id } from "../drafts/model";
import { theme as t } from "../theme";
import { NovelNoticesApi, type NovelNotice } from "./notices-api";
import type { DirectoryChapter } from "./reading-api";
function noteError(e: unknown) {
  return e instanceof ApiError && e.code === "authentication_required"
    ? "请重新登录后查看本账号消息。"
    : e instanceof ApiError && e.code === "resource_not_found"
      ? "这条消息暂不可用，请返回消息列表。"
      : "消息未能更新，请重试。";
}
function Link({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.linkButton,
        pressed && s.pressed,
        disabled && s.disabled,
      ]}
    >
      <Text style={s.link}>{label}</Text>
    </Pressable>
  );
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
        <Icon name="back" color={t.ink} />
      </Pressable>
      <Text style={s.heading}>{title}</Text>
      <View style={s.back} />
    </View>
  );
}
function useTools() {
  const { session, account, phase, generation, busy } = useSession(),
    owner = account?.id;
  return useMemo(() => {
    if (phase !== "ready" || !owner || busy) return null;
    const current = () => {
      const n = session.snapshot();
      return (
        n.phase === "ready" &&
        !n.busy &&
        n.account?.id === owner &&
        n.generation === generation
      );
    };
    return {
      current,
      api: new NovelNoticesApi((p, o) => session.authorized(p, o)),
    };
  }, [session, owner, phase, generation, busy]);
}
type Page<T> = { items: T[]; next_cursor: string };
function usePages<T extends { id: string }>(
  load: (cursor: string, signal: AbortSignal) => Promise<Page<T>>,
  current: () => boolean,
) {
  const [page, setPage] = useState<Page<T>>(),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false);
  const epoch = useRef(0),
    active = useRef<AbortController | null>(null),
    locked = useRef(false);
  const fetchPage = useCallback(
    async (cursor = "") => {
      if (!current() || (cursor && locked.current)) return;
      active.current?.abort();
      const controller = new AbortController();
      active.current = controller;
      const n = ++epoch.current;
      locked.current = true;
      setBusy(true);
      setError(undefined);
      try {
        const value = await load(cursor, controller.signal);
        if (!controller.signal.aborted && n === epoch.current && current())
          setPage((old) => ({
            ...value,
            items:
              cursor && old
                ? [
                    ...old.items,
                    ...value.items.filter(
                      (i) => !old.items.some((o) => o.id === i.id),
                    ),
                  ]
                : value.items,
          }));
      } catch (e) {
        if (!controller.signal.aborted && n === epoch.current && current())
          setError(e);
      } finally {
        if (n === epoch.current) {
          locked.current = false;
          if (current()) setBusy(false);
        }
      }
    },
    [load, current],
  );
  useFocusEffect(
    useCallback(() => {
      void fetchPage();
      return () => active.current?.abort();
    }, [fetchPage]),
  );
  return { page, error, busy, fetchPage };
}
const unavailable = () => false;
export function NovelNoticesScreen() {
  const { generation, account, phase } = useSession();
  return <Inbox key={generation + "/" + phase + "/" + account?.id} />;
}
function Inbox() {
  const tools = useTools();
  const load = useCallback(
    (cursor: string, signal: AbortSignal) =>
      tools
        ? tools.api.list(cursor, signal)
        : Promise.reject(new ApiError("stale_session")),
    [tools],
  );
  const { page, error, busy, fetchPage } = usePages<NovelNotice>(
    load,
    tools?.current ?? unavailable,
  );
  return (
    <SafeAreaView style={s.screen}>
      <Header
        title="消息"
        back="返回"
        onBack={() =>
          router.canGoBack() ? router.back() : router.dismissTo("/community")
        }
      />
      {!tools ? (
        <Status
          title="登录后查看消息"
          message="消息只属于当前账号。"
          actionLabel="去登录"
          onRetry={() => router.push("/account")}
        />
      ) : (
        <FlatList
          data={page?.items ?? []}
          keyExtractor={(i) => i.id}
          refreshing={busy}
          onRefresh={() => void fetchPage()}
          contentContainerStyle={s.list}
          ListHeaderComponent={<Text style={s.note}>新章更新</Text>}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                "打开更新消息 " + (item.book?.title ?? "暂不可读的作品")
              }
              onPress={() =>
                router.push({
                  pathname: "/notice/[id]",
                  params: { id: item.id },
                })
              }
              style={({ pressed }) => [s.row, pressed && s.pressed]}
            >
              <View style={s.line}>
                <Text numberOfLines={2} style={s.title}>
                  {item.book?.title ?? "作品暂不可读"}
                </Text>
                {item.read_at === null ? (
                  <Text style={s.unread}>未读</Text>
                ) : null}
              </View>
              <Text style={s.meta}>
                {item.readable_chapters
                  ? "本次新增 " + item.readable_chapters + " 章"
                  : "本次更新暂不可读"}
              </Text>
              <Text style={s.note}>
                {new Date(item.created_at).toLocaleString()}
              </Text>
            </Pressable>
          )}
          ListEmptyComponent={
            <Status
              loading={busy}
              title={
                busy
                  ? "正在加载消息"
                  : page
                    ? "暂时没有新章消息"
                    : "消息暂未加载"
              }
              message={
                page ? "追更作品有新章后，更新会出现在这里。" : undefined
              }
            />
          }
          ListFooterComponent={
            <View style={s.footer}>
              {error ? (
                <>
                  <Text accessibilityRole="alert" style={s.error}>
                    {noteError(error)}
                  </Text>
                  <Link
                    label={page?.next_cursor ? "重试加载更多" : "重新加载消息"}
                    disabled={busy}
                    onPress={() => void fetchPage(page?.next_cursor ?? "")}
                  />
                  {page?.next_cursor ? (
                    <Link
                      label="刷新消息首页"
                      disabled={busy}
                      onPress={() => void fetchPage()}
                    />
                  ) : null}
                </>
              ) : page?.next_cursor ? (
                <Link
                  label="加载更多消息"
                  disabled={busy}
                  onPress={() => void fetchPage(page.next_cursor)}
                />
              ) : null}
            </View>
          }
        />
      )}
      <BottomNavigation
        active="message"
        onHome={() => router.dismissTo("/community")}
      />
    </SafeAreaView>
  );
}
export function NovelNoticeDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>(),
    { generation, account, phase } = useSession();
  const notice = typeof params.id === "string" ? params.id : "";
  return (
    <Detail
      key={generation + "/" + phase + "/" + account?.id + "/" + notice}
      notice={notice}
    />
  );
}
function Detail({ notice }: { notice: string }) {
  const tools = useTools(),
    [meta, setMeta] = useState<NovelNotice>(),
    [readError, setReadError] = useState(false),
    [reading, setReading] = useState(false),
    marking = useRef(false);
  const mark = useCallback(
    async (signal?: AbortSignal) => {
      if (!tools || !id(notice) || marking.current) return;
      marking.current = true;
      setReading(true);
      setReadError(false);
      try {
        const ack = await tools.api.read(notice, signal);
        if (!signal?.aborted && tools.current())
          setMeta((old) =>
            old?.id === notice ? { ...old, read_at: ack.read_at } : old,
          );
      } catch {
        if (!signal?.aborted && tools.current()) setReadError(true);
      } finally {
        marking.current = false;
        if (tools.current()) setReading(false);
      }
    },
    [tools, notice],
  );
  const load = useCallback(
    async (cursor: string, signal: AbortSignal) => {
      if (!tools || !id(notice)) throw new ApiError("resource_not_found");
      const value = await tools.api.detail(notice, cursor, signal);
      if (!signal.aborted && tools.current()) {
        setMeta(value.notice);
        if (!cursor) {
          setReadError(false);
          if (value.notice.read_at === null) void mark(signal);
        }
      }
      return value;
    },
    [tools, notice, mark],
  );
  const { page, error, busy, fetchPage } = usePages<DirectoryChapter>(
    load,
    tools?.current ?? unavailable,
  );
  return (
    <SafeAreaView style={s.screen}>
      <Header
        title="新章更新"
        back="返回消息"
        onBack={() => router.dismissTo("/notices")}
      />
      {!tools ? (
        <Status
          title="登录后查看本账号消息"
          actionLabel="去登录"
          onRetry={() => router.push("/account")}
        />
      ) : !id(notice) ? (
        <Status title="消息地址无效" />
      ) : (
        <FlatList
          data={meta?.book === null ? [] : (page?.items ?? [])}
          keyExtractor={(i) => i.id}
          refreshing={busy}
          onRefresh={() => void fetchPage()}
          contentContainerStyle={s.list}
          ListHeaderComponent={
            meta ? (
              <View style={s.summary}>
                <Text style={s.bookTitle}>
                  {meta.book?.title ?? "作品暂不可读"}
                </Text>
                <Text style={s.meta}>
                  {meta.readable_chapters
                    ? "本次更新中有 " + meta.readable_chapters + " 章当前可读"
                    : "这次更新当前暂不可读，消息仍保留。"}
                </Text>
                <Text style={s.note}>
                  {reading
                    ? "正在同步已读状态"
                    : meta.read_at
                      ? "已读"
                      : "已读状态待确认"}
                </Text>
                {readError ? (
                  <>
                    <Text accessibilityRole="alert" style={s.error}>
                      已读状态尚未确认，不影响打开章节。
                    </Text>
                  </>
                ) : null}
                {meta.read_at === null && !reading ? (
                  <Link
                    label={readError ? "重试标记已读" : "标记已读"}
                    onPress={() => void mark()}
                  />
                ) : null}
                {meta.book ? (
                  <Link
                    label="查看作品目录"
                    onPress={() =>
                      router.push({
                        pathname: "/novel/[id]",
                        params: { id: meta.novel_id, from: "notice", notice },
                      })
                    }
                  />
                ) : null}
              </View>
            ) : undefined
          }
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                "打开更新第" + item.ordinal + "章 " + (item.title ?? "暂不可读")
              }
              disabled={!item.readable}
              onPress={() =>
                meta &&
                router.push({
                  pathname: "/novel-chapter",
                  params: {
                    book: meta.novel_id,
                    chapter: item.id,
                    from: "notice",
                    notice,
                  },
                })
              }
              style={({ pressed }) => [
                s.chapter,
                pressed && s.pressed,
                !item.readable && s.disabled,
              ]}
            >
              <Text style={s.meta}>
                第{item.ordinal}章　{item.title ?? "暂不可读"}
              </Text>
            </Pressable>
          )}
          ListEmptyComponent={
            <Status
              loading={busy}
              title={
                busy ? "正在加载更新" : page ? "暂无可展示章节" : "更新未能加载"
              }
            />
          }
          ListFooterComponent={
            <View style={s.footer}>
              {error ? (
                <>
                  <Text accessibilityRole="alert" style={s.error}>
                    {noteError(error)}
                  </Text>
                  <Link
                    label="重新读取更新"
                    disabled={busy}
                    onPress={() => void fetchPage(page?.next_cursor ?? "")}
                  />
                  {page?.next_cursor ? (
                    <Link
                      label="刷新更新首页"
                      disabled={busy}
                      onPress={() => void fetchPage()}
                    />
                  ) : null}
                </>
              ) : page?.next_cursor ? (
                <Link
                  label="加载更多更新章节"
                  disabled={busy}
                  onPress={() => void fetchPage(page.next_cursor)}
                />
              ) : null}
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
    height: 56,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  back: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  heading: { fontSize: 20, lineHeight: 28, fontWeight: "600", color: t.ink },
  list: { paddingHorizontal: 16, paddingBottom: 32, flexGrow: 1 },
  row: { paddingVertical: 16, gap: 8 },
  line: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: {
    flex: 1,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "600",
    color: t.ink,
  },
  bookTitle: { fontSize: 20, lineHeight: 28, fontWeight: "600", color: t.ink },
  meta: { fontSize: 14, lineHeight: 22, color: t.secondary },
  note: { fontSize: 12, lineHeight: 20, color: t.muted },
  unread: { fontSize: 12, lineHeight: 20, color: t.brand },
  summary: { paddingVertical: 16, gap: 8 },
  footer: { paddingVertical: 16, gap: 8 },
  chapter: { minHeight: 48, paddingVertical: 12, justifyContent: "center" },
  linkButton: { minHeight: 44, justifyContent: "center", paddingHorizontal: 8 },
  link: { fontSize: 14, lineHeight: 22, color: t.brand },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
  error: { fontSize: 14, lineHeight: 22, color: t.danger },
});
