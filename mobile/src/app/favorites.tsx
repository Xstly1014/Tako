import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSession } from "../auth/context";
import {
  checkedPage,
  type FavoriteItem,
  type FavoritePage,
} from "../api/favorites";
import { apiMessage } from "../api/client";
import { Icon } from "../components/PrototypeUi";
import { FavoriteButton } from "../components/FavoriteButton";
import { Status } from "../components/Ui";
import { theme as t } from "../theme";
export default function Favorites() {
  const { account, generation } = useSession();
  return <FavoriteList key={generation} accountId={account?.id} />;
}
function FavoriteList({ accountId }: { accountId?: string }) {
  const { session, phase } = useSession();
  const [items, setItems] = useState<FavoriteItem[]>([]),
    [cursor, setCursor] = useState(""),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState<unknown>(),
    [retry, setRetry] = useState(0);
  useFocusEffect(
    useCallback(() => {
      const controller = new AbortController();
      if (phase !== "ready") return () => controller.abort();
      setBusy(true);
      setError(undefined);
      session
        .authorized<FavoritePage>("/my/favorites", {
          signal: controller.signal,
        })
        .then(checkedPage)
        .then((page) => {
          if (!controller.signal.aborted) {
            setItems(page.items);
            setCursor(page.next_cursor);
            setLoaded(true);
          }
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(e);
        })
        .finally(() => {
          if (!controller.signal.aborted) setBusy(false);
        });
      return () => controller.abort();
      // The retry counter intentionally invalidates this focus request.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [phase, session, retry]),
  );
  const more = async () => {
    if (busy || !cursor) return;
    setBusy(true);
    setError(undefined);
    try {
      const page = checkedPage(
        await session.authorized<FavoritePage>(
          `/my/favorites?cursor=${encodeURIComponent(cursor)}`,
        ),
      );
      setItems((old) => [
        ...old,
        ...page.items.filter((x) => !old.some((o) => o.work_id === x.work_id)),
      ]);
      setCursor(page.next_cursor);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <SafeAreaView style={s.screen}>
      <View style={s.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="返回我的"
          onPress={() =>
            router.canGoBack() ? router.back() : router.replace("/account")
          }
          style={s.back}
        >
          <Icon name="back" color={t.ink} />
        </Pressable>
        <Text style={s.title}>我的收藏</Text>
        <View style={s.back} />
      </View>
      {!accountId ? (
        <Status
          title="登录后查看收藏"
          message="请回到“我的”登录，收藏不会与其他账号混用。"
          actionLabel="去登录"
          onRetry={() => router.replace("/account")}
        />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.work_id}
          refreshing={busy && loaded && !cursor}
          onRefresh={() => setRetry((x) => x + 1)}
          renderItem={({ item }) => (
            <View style={s.row}>
              <Pressable
                disabled={!item.work}
                accessibilityRole="button"
                accessibilityLabel={
                  item.work ? `阅读收藏 ${item.work.title}` : "收藏作品暂不可读"
                }
                onPress={() =>
                  router.push({
                    pathname: "/works/[id]",
                    params: { id: item.work_id },
                  })
                }
                style={{ flex: 1 }}
              >
                <Text numberOfLines={2} style={s.workTitle}>
                  {item.work?.title ?? "作品暂不可读"}
                </Text>
                <Text style={s.meta}>
                  {item.work?.author_nickname ??
                    "隐藏或受限后仍保留收藏，可随时取消。"}
                </Text>
              </Pressable>
              <FavoriteButton
                workId={item.work_id}
                cancelOnly
                onChanged={() => setRetry((x) => x + 1)}
              />
            </View>
          )}
          ListEmptyComponent={
            busy && !loaded ? (
              <Status loading title="正在读取收藏" />
            ) : error ? (
              <Status
                title="收藏未能加载"
                message={apiMessage(error)}
                onRetry={() => setRetry((x) => x + 1)}
              />
            ) : (
              <Status
                title="还没有收藏作品"
                message="阅读时点击收藏，下次可从这里继续。"
                actionLabel="去发现作品"
                onRetry={() => router.replace("/community")}
              />
            )
          }
          ListFooterComponent={
            items.length > 0 ? (
              <View style={s.footer}>
                {error ? (
                  <Text style={s.error}>{apiMessage(error)}</Text>
                ) : null}
                {busy ? (
                  <ActivityIndicator color={t.brand} />
                ) : cursor ? (
                  <Pressable onPress={() => void more()} style={s.more}>
                    <Text style={s.moreText}>
                      {error ? "重试加载更多" : "加载更多"}
                    </Text>
                  </Pressable>
                ) : (
                  <Text style={s.meta}>已显示全部收藏</Text>
                )}
              </View>
            ) : undefined
          }
        />
      )}
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "white" },
  header: {
    height: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: t.line,
  },
  back: {
    width: 48,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 16, fontWeight: "600", color: t.ink },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    padding: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: t.line,
  },
  workTitle: { fontSize: 16, lineHeight: 24, color: t.ink, fontWeight: "600" },
  meta: { fontSize: 12, lineHeight: 20, color: t.muted, marginTop: 8 },
  footer: { padding: 24, alignItems: "center", gap: 12 },
  error: { fontSize: 13, color: t.danger },
  more: { padding: 12, minHeight: 44 },
  moreText: { fontSize: 14, color: t.brand },
});
