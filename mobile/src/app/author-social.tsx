import { useCallback, useRef, useState } from "react";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { shortPostsTrial } from "../short-posts/trial";
import type { components } from "../api/contract";
import { apiMessage } from "../api/client";
import { useSession } from "../auth/context";
import { Status } from "../components/Ui";
import { theme as t } from "../theme";

const labels = {
  feed: "关注动态",
  following: "我的关注",
  followers: "我的粉丝",
} as const;
type Tab = keyof typeof labels;
type Person = components["schemas"]["FollowPerson"];
type Work = components["schemas"]["FollowFeedItem"];
type Item = Person | Work;
type Page = { items: Item[]; next_cursor: string; total?: number };
const key = (item: Item) => ("kind" in item ? item.kind : "person") + item.id;
const formats = { work: "中篇", post: "短帖", novel: "长文" } as const;
function back() {
  if (router.canGoBack()) router.back();
  else router.replace("/account");
}

export default function AuthorSocial() {
  const { tab } = useLocalSearchParams<{ tab?: string }>();
  const { generation, phase, account, session } = useSession();
  const [choice, setChoice] = useState<Tab>(
    tab === "following" || tab === "followers" ? tab : "feed",
  );
  return (
    <SafeAreaView style={s.screen}>
      <View style={s.header}>
        <Pressable
          accessibilityLabel="返回"
          accessibilityRole="button"
          onPress={back}
          style={s.control}
        >
          <Text style={s.link}>‹ 返回</Text>
        </Pressable>
        <Text accessibilityRole="header" style={s.heading}>
          关注与粉丝
        </Text>
        <View style={s.control} />
      </View>
      {phase === "ready" && account ? (
        <>
          <View style={s.tabs}>
            {(Object.keys(labels) as Tab[]).map((k) => (
              <Pressable
                key={k}
                accessibilityRole="tab"
                accessibilityState={{ selected: k === choice }}
                onPress={() => setChoice(k)}
                style={[s.tab, choice === k && s.current]}
              >
                <Text style={choice === k ? s.link : s.secondary}>
                  {labels[k]}
                </Text>
              </Pressable>
            ))}
          </View>
          <SocialList
            key={`${generation}:${account.id}:${choice}`}
            tab={choice}
          />
        </>
      ) : (
        <Status
          loading={phase === "loading"}
          title={
            phase === "offline" ? "连接后查看关注" : "登录后查看关注和粉丝"
          }
          actionLabel={phase === "offline" ? "重新连接" : "前往我的"}
          onRetry={() =>
            phase === "offline"
              ? void session.restore()
              : router.push("/account")
          }
        />
      )}
    </SafeAreaView>
  );
}
function SocialList({ tab }: { tab: Tab }) {
  const { session } = useSession();
  const [page, setPage] = useState<Page>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const focus = useRef<AbortController | null>(null);
  const lock = useRef(false);
  const load = useCallback(
    async (signal: AbortSignal, cursor = "") => {
      if (signal.aborted || lock.current) return;
      lock.current = true;
      setBusy(true);
      setError("");
      if (!cursor) setPage(undefined);
      try {
        const params = new URLSearchParams();
        if (cursor) params.set("cursor", cursor);
        if (tab === "feed" && !shortPostsTrial)
          params.set("include_posts", "false");
        const query = params.toString();
        const result = await session.authorized<Page>(
          `/my/author-social/${tab}${query ? "?" + query : ""}`,
          { signal },
        );
        if (!signal.aborted)
          setPage((old) => {
            if (!cursor || !old) return result;
            const seen = new Set(old.items.map(key));
            return {
              ...result,
              items: [
                ...old.items,
                ...result.items.filter((item) => !seen.has(key(item))),
              ],
            };
          });
      } catch (e) {
        if (!signal.aborted) setError(apiMessage(e));
      } finally {
        if (!signal.aborted) {
          lock.current = false;
          setBusy(false);
        }
      }
    },
    [session, tab],
  );
  useFocusEffect(
    useCallback(() => {
      const controller = new AbortController();
      focus.current = controller;
      lock.current = false;
      void load(controller.signal);
      return () => {
        controller.abort();
        focus.current = null;
      };
    }, [load]),
  );
  const refresh = (cursor = "") => {
    if (focus.current) void load(focus.current.signal, cursor);
  };
  function remove(person: Person) {
    const signal = focus.current?.signal;
    if (!signal || signal.aborted) return;
    Alert.alert(
      "取消关注" + person.nickname + "？",
      "这位作者的作品将移出你的关注动态。",
      [
        { text: "返回", style: "cancel" },
        {
          text: "取消关注",
          onPress: async () => {
            if (signal.aborted || lock.current) return;
            lock.current = true;
            setBusy(true);
            let issue = "";
            try {
              await session.authorized(
                `/my/author-social/targets/relation/${person.id}`,
                {
                  method: "PUT",
                  signal,
                  body: {
                    following: false,
                    expected_revision: person.revision,
                  },
                },
              );
            } catch (e) {
              issue = apiMessage(e);
            }
            if (signal.aborted) return;
            lock.current = false;
            await load(signal);
            if (issue && !signal.aborted) Alert.alert("请核对关注状态", issue);
          },
        },
      ],
    );
  }
  function open(item: Work) {
    const pathname =
      item.kind === "work"
        ? "/works/[id]"
        : item.kind === "post"
          ? "/short-posts/[id]"
          : "/novel/[id]";
    router.push({ pathname, params: { id: item.id, from: "author-feed" } });
  }
  if (!page)
    return (
      <Status
        loading={busy}
        title={busy ? "正在读取" + labels[tab] : labels[tab] + "未能加载"}
        message={error}
        onRetry={busy ? undefined : () => refresh()}
      />
    );
  return (
    <FlatList
      data={page.items}
      keyExtractor={key}
      refreshing={false}
      onRefresh={() => refresh()}
      contentContainerStyle={s.list}
      ListHeaderComponent={
        page.total ? (
          <Text style={s.count}>
            {labels[tab]} · {page.total}
          </Text>
        ) : undefined
      }
      ListEmptyComponent={
        <Status
          title={
            tab === "feed"
              ? "暂无公开动态"
              : tab === "followers"
                ? "还没有粉丝"
                : "还没有关注作者"
          }
          message={
            tab === "followers"
              ? "读者关注你后，会出现在这里。"
              : "在作品阅读页关注作者，就能在这里找到对方的公开作品。"
          }
        />
      }
      renderItem={({ item }) =>
        "kind" in item ? (
          <Pressable
            style={({ pressed }) => [s.row, pressed && s.pressed]}
            accessibilityRole="button"
            onPress={() => open(item)}
          >
            <View style={s.grow}>
              <Text style={s.meta}>
                {formats[item.kind]} · {item.author}
              </Text>
              <Text numberOfLines={2} style={s.title}>
                {item.title}
              </Text>
              <Text style={s.meta}>
                {new Date(item.updated_at).toLocaleDateString()}
              </Text>
            </View>
            <Text style={s.meta}>›</Text>
          </Pressable>
        ) : (
          <View style={s.row}>
            <View style={s.avatar}>
              <Text style={s.link}>{Array.from(item.nickname)[0] || "读"}</Text>
            </View>
            <View style={s.grow}>
              <Text style={s.title}>{item.nickname || "读者"}</Text>
              <Text style={s.meta}>
                {new Date(item.followed_at).toLocaleDateString()} 关注
              </Text>
            </View>
            {tab === "following" && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={"取消关注" + item.nickname}
                disabled={busy}
                style={s.control}
                onPress={() => remove(item)}
              >
                <Text style={s.secondary}>已关注</Text>
              </Pressable>
            )}
          </View>
        )
      }
      ListFooterComponent={
        page.next_cursor ? (
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => refresh(page.next_cursor)}
            style={s.footer}
          >
            {error ? <Text style={s.secondary}>{error}</Text> : null}
            <Text style={s.link}>
              {busy ? "正在读取…" : error ? "重试加载更多" : "加载更多"}
            </Text>
          </Pressable>
        ) : undefined
      }
    />
  );
}
const s = StyleSheet.create({
  count: { color: t.muted, fontSize: 12, marginTop: 16 },
  screen: { flex: 1, backgroundColor: t.surface },
  header: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
  },
  heading: { fontSize: 18, fontWeight: "600", color: t.ink },
  control: {
    minWidth: 54,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  tabs: {
    flexDirection: "row",
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: t.line,
    gap: 20,
  },
  tab: { minHeight: 44, justifyContent: "center" },
  current: { borderBottomWidth: 2, borderColor: t.brand },
  link: { color: t.brand, fontWeight: "600", fontSize: 14 },
  secondary: { color: t.secondary, fontSize: 14 },
  list: {
    width: "100%",
    maxWidth: 640,
    alignSelf: "center",
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: t.line,
  },
  grow: { flex: 1, gap: 4 },
  title: { fontSize: 16, lineHeight: 24, color: t.ink, fontWeight: "600" },
  meta: { fontSize: 12, color: t.muted, lineHeight: 18 },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: t.selected,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { backgroundColor: t.background },
  footer: { padding: 16, alignItems: "center" },
});
