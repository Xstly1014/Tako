import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  community,
  errorMessage,
  mergeWorks,
  ReaderError,
  type DiscoveryPage,
  type WorkCard,
} from "../api/reader";
import { Action, Status } from "../components/Ui";
import {
  BottomNavigation,
  FutureAction,
  Icon,
  unavailable,
} from "../components/PrototypeUi";
import { theme as t } from "../theme";
import { FavoriteButton } from "../components/FavoriteButton";
function WorkRow({ item }: { item: WorkCard }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`阅读 ${item.title}`}
      onPress={() =>
        router.push({ pathname: "/works/[id]", params: { id: item.id } })
      }
      style={({ pressed }) => [
        s.row,
        pressed && { backgroundColor: t.background },
      ]}
    >
      <View style={s.byline}>
        <View style={s.avatar} />
        <Text style={s.author} numberOfLines={1}>
          {item.author_nickname}
        </Text>
      </View>
      <Text style={s.title} numberOfLines={2}>
        {item.title}
      </Text>
      {item.introduction ? (
        <Text style={s.excerpt} numberOfLines={3}>
          {item.introduction}
        </Text>
      ) : null}
      <View style={s.meta}>
        <View style={s.metaLeft}>
          <Text style={s.genre}>{item.tags[0]}</Text>
          <Text style={s.metadata}>测试内容</Text>
        </View>
        <FutureAction name="赞" icon="heart" />
        <FutureAction name="评论" icon="message" />
        <FavoriteButton workId={item.id} />
      </View>
    </Pressable>
  );
}
export default function Community() {
  const [page, setPage] = useState<DiscoveryPage>(),
    [error, setError] = useState<unknown>(),
    [moreError, setMoreError] = useState<unknown>();
  const [loading, setLoading] = useState(true),
    [refreshing, setRefreshing] = useState(false),
    [moreBusy, setMoreBusy] = useState(false),
    [retry, setRetry] = useState(0);
  const generation = useRef(0),
    lock = useRef(false),
    active = useRef<AbortController | undefined>(undefined),
    list = useRef<FlatList<WorkCard>>(null);
  useEffect(() => {
    const epoch = ++generation.current,
      controller = new AbortController();
    active.current = controller;
    community("", "", controller.signal)
      .then((value) => {
        if (!controller.signal.aborted && epoch === generation.current)
          setPage(value);
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted && epoch === generation.current)
          setError(e);
      })
      .finally(() => {
        if (!controller.signal.aborted && epoch === generation.current)
          setLoading(false);
      });
    return () => {
      controller.abort();
      active.current?.abort();
    };
  }, [retry]);
  function reload() {
    active.current?.abort();
    generation.current++;
    lock.current = false;
    setLoading(true);
    setError(undefined);
    setMoreError(undefined);
    setPage(undefined);
    setRetry((n) => n + 1);
  }
  async function refresh() {
    if (loading || lock.current || refreshing) return;
    const epoch = ++generation.current,
      controller = new AbortController();
    active.current?.abort();
    active.current = controller;
    setRefreshing(true);
    setMoreError(undefined);
    try {
      const value = await community("", "", controller.signal);
      if (!controller.signal.aborted && epoch === generation.current)
        setPage(value);
    } catch (e) {
      if (!controller.signal.aborted && epoch === generation.current)
        setMoreError(e);
    } finally {
      if (!controller.signal.aborted && epoch === generation.current)
        setRefreshing(false);
    }
  }
  async function more() {
    if (!page?.next_cursor || loading || refreshing || lock.current) return;
    const epoch = generation.current,
      cursor = page.next_cursor,
      controller = new AbortController();
    active.current = controller;
    lock.current = true;
    setMoreBusy(true);
    setMoreError(undefined);
    try {
      const value = await community("", cursor, controller.signal);
      if (!controller.signal.aborted && epoch === generation.current)
        setPage(
          (old) =>
            old && {
              ...old,
              items: mergeWorks(old.items, value.items),
              next_cursor: value.next_cursor,
            },
        );
    } catch (e) {
      if (!controller.signal.aborted && epoch === generation.current)
        setMoreError(e);
    } finally {
      if (!controller.signal.aborted && epoch === generation.current) {
        lock.current = false;
        setMoreBusy(false);
      }
    }
  }
  return (
    <SafeAreaView style={s.screen}>
      <View style={s.channels}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="短内容，尚未开放"
          onPress={() => unavailable("短内容频道")}
          style={s.channelButton}
        >
          <Text style={s.channelText}>短内容</Text>
        </Pressable>
        <View style={s.current}>
          <Text style={s.currentText}>中篇</Text>
          <View style={s.underline} />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="长文，尚未开放"
          onPress={() => unavailable("长文频道")}
          style={s.channelButton}
        >
          <Text style={s.channelText}>长文</Text>
        </Pressable>
      </View>
      <View style={s.searchRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="搜索内容或作者，尚未开放"
          onPress={() => unavailable("搜索")}
          style={s.search}
        >
          <Icon name="search" size={16} />
          <Text style={s.searchHint}>搜索内容或作者</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="仅展示已关注作者，尚未开放"
          onPress={() => unavailable("关注筛选")}
          style={s.follow}
        >
          <Icon name="dots" size={16} />
        </Pressable>
      </View>
      <View style={s.content}>
        {loading ? (
          <Status loading title="正在加载作品" />
        ) : error ? (
          <Status
            title="作品列表未能加载"
            message={errorMessage(error)}
            requestId={error instanceof ReaderError ? error.requestId : ""}
            onRetry={reload}
          />
        ) : (
          <FlatList
            ref={list}
            data={page?.items ?? []}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => <WorkRow item={item} />}
            refreshing={refreshing}
            onRefresh={refresh}
            initialNumToRender={8}
            windowSize={7}
            ListEmptyComponent={
              <Status
                title="还没有公开作品"
                message="下拉刷新，查看之后发布的新作品。"
              />
            }
            ListFooterComponent={
              <View style={s.footer}>
                {moreError ? (
                  <Text accessibilityLiveRegion="polite" style={s.failure}>
                    {errorMessage(moreError)} 已加载内容仍保留。
                  </Text>
                ) : null}
                {moreBusy ? (
                  <ActivityIndicator color={t.brand} />
                ) : page?.next_cursor ? (
                  <Action
                    label={moreError ? "重试加载更多" : "加载更多"}
                    onPress={more}
                    disabled={refreshing}
                  />
                ) : page?.items.length ? (
                  <Text style={s.metadata}>已看到这里的全部作品</Text>
                ) : null}
                {moreError && !page?.next_cursor ? (
                  <Action
                    label="刷新列表"
                    onPress={refresh}
                    disabled={refreshing}
                  />
                ) : null}
              </View>
            }
          />
        )}
      </View>
      <BottomNavigation
        onHome={() =>
          list.current?.scrollToOffset({ offset: 0, animated: true })
        }
      />
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "white" },
  channels: {
    flexDirection: "row",
    gap: 26,
    justifyContent: "center",
    paddingTop: 12,
    paddingBottom: 8,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: t.line,
  },
  channelButton: {
    paddingVertical: 4,
    paddingHorizontal: 2,
    justifyContent: "center",
  },
  channelText: { fontSize: 16, color: t.muted },
  current: { alignItems: "center", paddingTop: 4, gap: 6 },
  currentText: { fontSize: 16, fontWeight: "600", color: t.ink },
  underline: { width: 32, height: 2.5, backgroundColor: t.brand },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: t.line,
  },
  search: {
    flex: 1,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 30,
    borderWidth: 1,
    borderColor: t.line,
    minHeight: 36,
  },
  searchHint: { fontSize: 13, color: t.muted },
  follow: {
    width: 34,
    height: 34,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: t.line,
    alignItems: "center",
    justifyContent: "center",
  },
  content: { flex: 1, backgroundColor: t.background },
  row: {
    backgroundColor: "white",
    paddingTop: 12,
    paddingHorizontal: 16,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: t.line,
  },
  byline: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    marginBottom: 7,
  },
  avatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#bdccef",
  },
  author: { fontSize: 12, color: t.ink, fontWeight: "600", flex: 1 },
  title: { fontSize: 16, lineHeight: 24, fontWeight: "600", color: t.ink },
  excerpt: { fontSize: 13, lineHeight: 22, color: "#4a5162", marginTop: 5 },
  meta: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 9 },
  metaLeft: { flex: 1, flexDirection: "row", gap: 6, alignItems: "center" },
  genre: {
    fontSize: 11,
    color: t.brand,
    paddingVertical: 1,
    paddingHorizontal: 6,
    backgroundColor: "#eef3ff",
    borderRadius: 4,
  },
  metadata: { fontSize: 11, lineHeight: 18, color: t.muted },
  footer: { padding: 24, gap: 16, alignItems: "center" },
  failure: { color: t.danger, fontSize: 13, lineHeight: 22 },
});
