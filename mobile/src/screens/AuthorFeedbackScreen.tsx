import { useEffect, useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text } from "react-native";
import { router, usePreventRemove } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSession } from "../auth/context";
import { AuthorWorksApi } from "../api/author-works";
import { ApiError } from "../api/client";
import { readAuthorFeedback } from "../author-works/feedback";
import { CommentsPanel } from "../components/CommentsPanel";
import { Action, Status } from "../components/Ui";
import { theme as t } from "../theme";

export default function AuthorFeedbackScreen({ id }: { id: string }) {
  const { phase, account } = useSession();
  const [owner, setOwner] = useState(account?.id ?? null);
  if (account && account.id !== owner) setOwner(account.id);
  if (!owner)
    return (
      <SafeAreaView>
        <Status
          loading={phase === "loading"}
          title="登录后查看本人作品反馈"
          actionLabel="去登录"
          onRetry={() => router.push("/account")}
        />
      </SafeAreaView>
    );
  return <Feedback key={`${owner}:${id}`} id={id} owner={owner} />;
}
function Feedback({ id, owner }: { id: string; owner: string }) {
  const { session, phase, account, generation } = useSession();
  const signedIn = phase === "ready" && account?.id === owner;
  const works = useMemo(
    () => new AuthorWorksApi((p, o) => session.authorized(p, o)),
    [session],
  );
  const [data, setData] = useState<
    Awaited<ReturnType<typeof readAuthorFeedback>> & { generation: number }
  >();
  const [error, setError] = useState<unknown>();
  const [retry, setRetry] = useState(0);
  const [visible, setVisible] = useState(false);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!signedIn) return;
    const abort = new AbortController();
    void readAuthorFeedback(
      works,
      (p, o) => session.authorized(p, o),
      id,
      abort.signal,
    )
      .then((value) => {
        if (!abort.signal.aborted) {
          setData({ ...value, generation });
          setError(undefined);
          setVisible(true);
        }
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e);
      });
    return () => abort.abort();
  }, [id, retry, session, works, signedIn, generation]);
  const reload = () => {
    if (dirty) return;
    setData(undefined);
    setError(undefined);
    setRetry((x) => x + 1);
  };
  const retryAccess = () => {
    // Reauthentication may fail to read access while the old editor is locked.
    // Retrying that GET must keep its in-memory text and original request.
    setError(undefined);
    setRetry((x) => x + 1);
  };
  usePreventRemove(dirty, ({ repeat }) =>
    Alert.alert(
      "离开作者反馈？",
      "未发表文字或未确认操作只在本页保留。离开不会取消服务端已收到的请求。",
      [
        { text: "继续处理", style: "cancel" },
        { text: "丢弃并离开", style: "destructive", onPress: repeat },
      ],
    ),
  );
  const back = () =>
    router.canGoBack()
      ? router.back()
      : router.replace({ pathname: "/my-works/[id]", params: { id } });
  const unavailable =
    error instanceof ApiError &&
    ["feedback_unavailable", "resource_not_found"].includes(error.code);
  const ready = signedIn && data?.generation === generation;
  return (
    <SafeAreaView style={s.screen}>
      <ScrollView contentContainerStyle={s.content}>
        <Action label="返回作品管理" onPress={back} />
        <Text style={s.heading}>作者反馈</Text>
        <Text style={s.note}>
          评论归属作品，不按版本拆分。删除主评论会同时删除全部回复；未发表文字只在本页内存中保留。
        </Text>
        {!signedIn ? (
          <Status
            loading={phase === "loading"}
            title="登录后继续处理本人反馈"
            message="原账号输入在本页内存中锁定；同账号重登后可明确恢复，不会自动发表。"
            actionLabel="去登录"
            onRetry={() => router.push("/account")}
          />
        ) : ready ? (
          <>
            <Text style={s.heading}>{data.title}</Text>
            <Action label="打开作品评论" onPress={() => setVisible(true)} />
            <Action
              label="重新确认反馈访问"
              disabled={dirty}
              onPress={reload}
            />
            {dirty ? (
              <Text style={s.note}>
                本页仍有未发表文字或待确认操作，可重新打开评论继续处理；重新读取访问资格暂不可用。
              </Text>
            ) : null}
          </>
        ) : (
          <Status
            loading={!error}
            title={
              unavailable
                ? "作品反馈暂不可读"
                : error
                  ? "无法读取作品反馈"
                  : "正在确认本人作品反馈"
            }
            message={
              unavailable
                ? "作品隐藏、受限或已不可访问。请回作品管理核对，不会自动恢复公开。"
                : error
                  ? "请重试确认当前账号与作品访问资格。尚未发出评论操作。"
                  : undefined
            }
            onRetry={error ? retryAccess : undefined}
          />
        )}
      </ScrollView>
      {data ? (
        <CommentsPanel
          workId={data.id}
          context={data.context}
          visible={visible && ready}
          onClose={() => setVisible(false)}
          onDirtyChange={setDirty}
        />
      ) : null}
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: t.surface },
  content: { padding: 16, gap: 16 },
  heading: { color: t.ink, fontSize: 16, lineHeight: 24, fontWeight: "600" },
  note: { color: t.secondary, fontSize: 14, lineHeight: 22 },
});
