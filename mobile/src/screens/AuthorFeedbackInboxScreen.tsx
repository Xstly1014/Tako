import { useCallback, useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSession } from "../auth/context";
import {
  AuthorFeedbackApi,
  type FeedbackPage,
  type FeedbackStatus,
} from "../api/author-feedback";
import { Action, Status } from "../components/Ui";
import { theme as t } from "../theme";

export default function AuthorFeedbackInboxScreen() {
  const { phase, account, generation } = useSession();
  if (phase !== "ready" || !account)
    return (
      <SafeAreaView>
        <Status
          loading={phase === "loading"}
          title="登录后查看本人反馈收件箱"
          actionLabel="去登录"
          onRetry={() => router.push("/account")}
        />
      </SafeAreaView>
    );
  return <Inbox key={`${account.id}:${generation}`} />;
}
function Inbox() {
  const { session } = useSession();
  const api = useMemo(
    () => new AuthorFeedbackApi((p, o) => session.authorized(p, o)),
    [session],
  );
  const [status, setStatus] = useState<FeedbackStatus>("awaiting_author");
  const [page, setPage] = useState<FeedbackPage>();
  const [error, setError] = useState<unknown>();
  const [moreFailed, setMoreFailed] = useState(false);
  const [busy, setBusy] = useState(true);
  const [retry, setRetry] = useState(0);
  const lock = useRef(false),
    controller = useRef<AbortController | null>(null);
  useFocusEffect(
    useCallback(() => {
      void retry;
      const abort = new AbortController();
      controller.current = abort;
      const read = async () => {
        lock.current = true;
        setBusy(true);
        setError(undefined);
        setMoreFailed(false);
        try {
          const value = await api.page(status, 0, abort.signal);
          if (!abort.signal.aborted) setPage(value);
        } catch (e) {
          if (!abort.signal.aborted) setError(e);
        } finally {
          if (!abort.signal.aborted) {
            lock.current = false;
            setBusy(false);
          }
        }
      };
      void read();
      return () => {
        abort.abort();
        controller.current?.abort();
        lock.current = false;
      };
    }, [api, status, retry]),
  );
  const choose = (value: FeedbackStatus) => {
    if (lock.current || status === value) return;
    setPage(undefined);
    setError(undefined);
    setStatus(value);
  };
  const more = async () => {
    if (lock.current || !page?.next) return;
    lock.current = true;
    setBusy(true);
    setError(undefined);
    const abort = new AbortController();
    controller.current = abort;
    try {
      const value = await api.page(status, page.next, abort.signal);
      if (!abort.signal.aborted)
        setPage((old) => ({
          items: [
            ...(old?.items ?? []),
            ...value.items.filter(
              (item) =>
                !old?.items.some(
                  (prior) => prior.comment.id === item.comment.id,
                ),
            ),
          ],
          next: value.next,
        }));
    } catch (e) {
      if (!abort.signal.aborted) {
        setError(e);
        setMoreFailed(true);
      }
    } finally {
      if (!abort.signal.aborted) {
        lock.current = false;
        setBusy(false);
      }
    }
  };
  return (
    <SafeAreaView style={s.screen}>
      <ScrollView contentContainerStyle={s.content}>
        <Action
          label="返回作品管理"
          onPress={() =>
            router.canGoBack() ? router.back() : router.replace("/my-works")
          }
        />
        <Text style={s.heading}>读者反馈收件箱</Text>
        <Text style={s.note}>
          仅当前可公开本人作品的可见主评论，按主评论发表顺序排列。待回应表示尚无可见作者回复，不是未读；删除或屏蔽作者回复后会重新出现。
        </Text>
        <View style={s.filters}>
          <Action
            label={
              status === "awaiting_author" ? "待回应讨论（已选）" : "待回应讨论"
            }
            disabled={busy}
            onPress={() => choose("awaiting_author")}
          />
          <Action
            label={status === "all" ? "全部讨论（已选）" : "全部讨论"}
            disabled={busy}
            onPress={() => choose("all")}
          />
        </View>
        <Action
          label="重新读取反馈"
          disabled={busy}
          onPress={() => setRetry((x) => x + 1)}
        />
        {error ? (
          <Status
            title="反馈读取失败"
            message="请重试；已读取反馈不会被当成全部结果。"
            onRetry={() => (moreFailed ? void more() : setRetry((x) => x + 1))}
          />
        ) : null}
        {!page ? (
          !error ? (
            <Status loading={busy} title="正在读取本人反馈" />
          ) : null
        ) : (
          <>
            <Text style={s.note}>
              已读取 {page.items.length} 条反馈{page.next ? "，仍有更多" : ""}
            </Text>
            {!page.items.length ? (
              <Status
                title={
                  status === "awaiting_author"
                    ? "暂无待回应讨论"
                    : "暂无可见反馈"
                }
                message="这里只显示当前可见且符合条件的讨论，不代表其他作品或隐藏内容没有评论。"
              />
            ) : null}
            {page.items.map((item) => (
              <View key={item.comment.id} style={s.item}>
                <Text style={s.heading}>{item.work_title}</Text>
                <Text style={s.note}>
                  {item.comment.nickname || "未设置笔名"} ·{" "}
                  {item.awaiting_author ? "待回应" : "已有作者回复"}
                </Text>
                <Text selectable style={s.body}>
                  {item.comment.content}
                </Text>
                <Action
                  label={`打开反馈讨论 ${item.comment.sequence}`}
                  disabled={busy}
                  onPress={() =>
                    router.push({
                      pathname: "/my-work-feedback/[id]",
                      params: {
                        id: item.comment.work_id,
                        thread_id: item.comment.id,
                      },
                    })
                  }
                />
              </View>
            ))}
            {page.next ? (
              <Action
                label="加载更多反馈"
                disabled={busy}
                onPress={() => void more()}
              />
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: t.surface },
  content: { padding: 16, gap: 16, paddingBottom: 32 },
  heading: { fontSize: 16, lineHeight: 24, fontWeight: "600", color: t.ink },
  note: { fontSize: 14, lineHeight: 22, color: t.secondary },
  body: { fontSize: 16, lineHeight: 24, color: t.ink },
  filters: { gap: 8 },
  item: {
    padding: 16,
    gap: 12,
    borderRadius: 8,
    backgroundColor: t.background,
  },
});
