import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";
import * as Crypto from "expo-crypto";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSession } from "../auth/context";
import { Icon } from "../components/PrototypeUi";
import { Status } from "../components/Ui";
import { theme as t } from "../theme";
import type { ShelfPage, ShelfState, ShelfWrite } from "./shelf-api";
import {
  ShelfLink,
  ShelfRecovery,
  shelfMessage,
  useShelfTools,
  useShelfState,
  useShelfStartup,
} from "./ShelfUi";
export function ShelfScreen() {
  const { generation, account, phase } = useSession();
  return <ShelfList key={generation + "/" + phase + "/" + account?.id} />;
}
function ShelfList() {
  const { phase } = useSession(),
    tools = useShelfTools(),
    op = useShelfState(tools);
  const [page, setPage] = useState<ShelfPage>(),
    [busy, setBusy] = useState(false),
    [fresh, setFresh] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState<unknown>();
  const request = useRef(0),
    locked = useRef(false),
    activeRead = useRef<AbortController | null>(null);
  const load = useCallback(
    async (cursor = "", signal?: AbortSignal) => {
      if (!tools || (cursor && locked.current)) return;
      // A refresh supersedes the focus read; an old response must not reopen stale controls.
      if (!cursor) activeRead.current?.abort();
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) controller.abort();
      activeRead.current = controller;
      locked.current = true;
      const n = ++request.current;
      setBusy(true);
      setFresh(false);
      setError(undefined);
      try {
        const value = await tools.api.list(cursor, controller.signal);
        if (
          !controller.signal.aborted &&
          tools.current() &&
          n === request.current
        ) {
          setPage((old) => ({
            ...value,
            items:
              cursor && old
                ? [
                    ...old.items,
                    ...value.items.filter(
                      (i) =>
                        !old.items.some(
                          (o) => o.relation.novel_id === i.relation.novel_id,
                        ),
                    ),
                  ]
                : value.items,
          }));
          setFresh(true);
        }
      } catch (e) {
        if (
          !controller.signal.aborted &&
          tools.current() &&
          n === request.current
        )
          setError(e);
      } finally {
        signal?.removeEventListener("abort", abort);
        if (n === request.current) {
          locked.current = false;
          activeRead.current = null;
          if (tools.current()) setBusy(false);
        }
      }
    },
    [tools],
  );
  const startup = useCallback(
    (signal: AbortSignal) => load("", signal),
    [load],
  );
  useShelfStartup(tools, startup);
  const start = (state: ShelfState, operation: ShelfWrite["operation"]) => {
    if (tools && fresh && !busy && op.loaded && !op.busy && !op.record)
      void tools.ops
        .start(state.novel_id, {
          mutation_id: Crypto.randomUUID(),
          base_revision: state.revision,
          operation,
        })
        .then(() => settle())
        .catch(() => undefined);
  };
  const remove = (state: ShelfState) =>
    Alert.alert("移出书架？", "会同时关闭追更，续读位置和已有消息保留。", [
      { text: "保留", style: "cancel" },
      {
        text: "移出并关闭追更",
        style: "destructive",
        onPress: () => start(state, "remove"),
      },
    ]);
  const settle = async () => {
    if (!tools) return;
    setConfirmed(true);
    setFresh(false);
    activeRead.current?.abort();
    await tools.ops.clear();
    if (tools.current()) await load();
  };
  const disabled = !fresh || busy || !op.loaded || op.busy || !!op.record;
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
        <Text style={s.title}>我的书架</Text>
        <View style={s.back} />
      </View>
      {phase !== "ready" || !tools ? (
        <Status
          title={
            phase === "guest" ? "登录后查看书架" : "联网确认账号后查看书架"
          }
          message="书架只属于当前账号。"
          actionLabel="返回我的"
          onRetry={() => router.replace("/account")}
        />
      ) : (
        <FlatList
          data={page?.items ?? []}
          keyExtractor={(item) => item.relation.novel_id}
          refreshing={busy}
          onRefresh={() => void load()}
          contentContainerStyle={s.list}
          ListHeaderComponent={
            <View style={s.summary}>
              <Text style={s.note}>新章提醒尚未开放，当前先保存追更选择。</Text>
              <ShelfRecovery tools={tools} onSettled={settle} />
            </View>
          }
          renderItem={({ item }) => (
            <View style={s.row}>
              <Pressable
                accessibilityRole="button"
                disabled={!item.book}
                accessibilityLabel={
                  item.book ? "打开目录 " + item.book.title : "书架作品暂不可读"
                }
                onPress={() =>
                  router.push({
                    pathname: "/novel/[id]",
                    params: { id: item.relation.novel_id, from: "shelf" },
                  })
                }
                style={s.book}
              >
                <Text numberOfLines={2} style={s.bookTitle}>
                  {item.book?.title ?? "作品暂不可读"}
                </Text>
                <Text style={s.meta}>
                  {item.book
                    ? item.book.author +
                      " · " +
                      (item.book.completed ? "已完结" : "连载中")
                    : "记录与续读位置保留"}
                </Text>
              </Pressable>
              <View style={s.actions}>
                <Text style={s.note}>
                  {item.relation.following ? "追更中" : "已关闭追更"}
                </Text>
                <ShelfLink
                  label={item.relation.following ? "关闭追更" : "重新开启追更"}
                  disabled={
                    disabled || (!item.relation.following && !item.book)
                  }
                  onPress={() =>
                    start(
                      item.relation,
                      item.relation.following ? "unfollow" : "follow",
                    )
                  }
                />
                <ShelfLink
                  label="移出书架"
                  disabled={disabled}
                  onPress={() => remove(item.relation)}
                />
              </View>
            </View>
          )}
          ListEmptyComponent={
            <Status
              loading={busy}
              title={
                busy ? "正在加载书架" : page ? "书架还没有作品" : "书架暂未加载"
              }
              message={
                page
                  ? "到长文频道找到想追的作品，在目录中加入书架。"
                  : undefined
              }
              actionLabel={page ? "去长文频道" : undefined}
              onRetry={page ? () => router.push("/novel-community") : undefined}
            />
          }
          ListFooterComponent={
            <View style={s.footer}>
              {confirmed && !fresh ? (
                <Text style={s.note}>操作已确认，当前书架状态待重新读取。</Text>
              ) : null}
              {!fresh && !busy && !error ? (
                <ShelfLink
                  label="刷新书架"
                  disabled={op.busy}
                  onPress={() => void load()}
                />
              ) : null}
              {error ? (
                <>
                  <Text accessibilityRole="alert" style={s.error}>
                    {shelfMessage(error)}
                  </Text>
                  <ShelfLink
                    label={page?.next_cursor ? "重试加载更多" : "重新加载书架"}
                    disabled={busy}
                    onPress={() => void load(page?.next_cursor ?? "")}
                  />
                  {page?.next_cursor ? (
                    <ShelfLink
                      label="刷新书架首页"
                      disabled={busy}
                      onPress={() => void load()}
                    />
                  ) : null}
                </>
              ) : page?.next_cursor ? (
                <ShelfLink
                  label="加载更多"
                  disabled={busy}
                  onPress={() => void load(page.next_cursor)}
                />
              ) : null}
              {busy ? <ActivityIndicator color={t.brand} /> : null}
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
  },
  back: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 20, lineHeight: 28, fontWeight: "600", color: t.ink },
  list: { paddingHorizontal: 16, paddingBottom: 32, flexGrow: 1 },
  summary: { gap: 8, paddingBottom: 16 },
  row: { paddingVertical: 16, gap: 8 },
  book: { minHeight: 48, gap: 8 },
  bookTitle: { fontSize: 16, lineHeight: 24, fontWeight: "600", color: t.ink },
  meta: { fontSize: 14, lineHeight: 22, color: t.secondary },
  note: { fontSize: 12, lineHeight: 20, color: t.muted },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  footer: { gap: 8, paddingVertical: 16 },
  error: { fontSize: 14, lineHeight: 22, color: t.danger },
});
