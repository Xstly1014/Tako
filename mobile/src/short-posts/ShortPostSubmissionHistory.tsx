import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams, usePreventRemove } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Status } from "../components/Ui";
import { theme as t } from "../theme";
import { Boundary, LinkButton, PrivateImages, useOwner } from "./ShortPostManagement";
import {
  initialSubmission, latestRevision, managementMessage, submissionHistory, submissionLabel,
  type Revision, type SubmissionNode, type SubmissionPage,
} from "./manage";

export default function ShortPostSubmissionHistory() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Boundary>{(owner) => <History key={owner + ":" + id} owner={owner} id={id} />}</Boundary>;
}

type Selection = { node: SubmissionNode; initial: boolean };

function History({ owner, id }: { owner: string; id: string }) {
  const send = useOwner(owner);
  const request = useRef<AbortController | null>(null);
  const [page, setPage] = useState<SubmissionPage>();
  const [selection, setSelection] = useState<Selection>();
  const [detail, setDetail] = useState<Revision>();
  const [error, setError] = useState<unknown>();
  const [pending, setPending] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    submissionHistory(send, id, 0, controller.signal).then((value) => {
      if (!controller.signal.aborted) setPage(value);
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(failure);
    });
    return () => controller.abort();
  }, [attempt, id, send]);
  useEffect(() => () => request.current?.abort(), []);

  async function run(task: (signal: AbortSignal) => Promise<void>) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setError(undefined);
    try {
      await task(controller.signal);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure);
    } finally {
      if (!controller.signal.aborted) setPending(false);
    }
  }

  function open(selected: Selection) {
    setSelection(selected);
    setDetail(undefined);
    void run(async (signal) => {
      const value = selected.initial
        ? await initialSubmission(send, id, signal)
        : await latestRevision(send, id, selected.node.id, signal);
      if (!signal.aborted) setDetail(value);
    });
  }

  function loadMore() {
    if (!page?.next_before || pending) return;
    void run(async (signal) => {
      const value = await submissionHistory(send, id, page.next_before, signal);
      if (signal.aborted) return;
      const loaded = new Set(page.items.map((node) => node.id));
      setPage({ ...value, items: [...page.items, ...value.items.filter((node) => !loaded.has(node.id))] });
    });
  }

  function closeDetail() {
    request.current?.abort();
    setPending(false);
    setSelection(undefined);
    setDetail(undefined);
    setError(undefined);
  }

  usePreventRemove(!!selection, closeDetail);

  return <SafeAreaView style={s.screen}>
    <View style={s.header}>
      <LinkButton label={selection ? "返回提交记录" : "返回短帖管理"} onPress={selection
        ? closeDetail : () => router.dismissTo({ pathname: "/my-short-posts/[id]", params: { id } })} />
      <Text accessibilityRole="header" style={s.heading}>{selection ? "提交详情" : "提交记录"}</Text>
    </View>
    <ScrollView style={selection ? s.hidden : undefined} contentContainerStyle={s.content}>
      {page ? <>
        <SubmissionRow node={page.initial} initial disabled={pending} onPress={() => open({ node: page.initial, initial: true })} />
        {page.items.map((node) => <SubmissionRow key={node.id} node={node} disabled={pending}
          onPress={() => open({ node, initial: false })} />)}
        {error && !selection ? <Status title="未能读取更多提交" message={managementMessage(error)} /> : null}
        {page.next_before > 0 ? <LinkButton label={pending ? "正在加载" : "加载更早提交"}
          disabled={pending} onPress={loadMore} /> : null}
      </> : !selection ? <Status loading={!error} title={error ? "未能读取提交记录" : "正在读取提交记录"}
        message={error ? managementMessage(error) : undefined} onRetry={error ? () => {
          setError(undefined);
          setAttempt((value) => value + 1);
        } : undefined} /> : null}
    </ScrollView>
    {selection ? <ScrollView contentContainerStyle={s.content}>
      {detail ? <>
        <Text style={s.title}>{detail.title || "无标题"}</Text>
        <Text style={s.meta}>{submissionLabel(detail)}{detail.version ? " · V" + detail.version : ""}</Text>
        {detail.review_reason ? <View style={s.reason}>
          <Text style={s.label}>审核原因</Text>
          <Text selectable style={s.body}>{detail.review_reason}</Text>
        </View> : null}
        <Text selectable style={s.body}>{detail.content}</Text>
        <PrivateImages key={detail.id} ids={detail.images.map((image) => image.id)} send={send} />
        {detail.state === "rejected" || detail.state === "pending" ? <LinkButton label="修改这次提交"
          onPress={() => router.push({ pathname: "/short-compose",
            params: selection.initial ? { post: id, initial: "1", history: "1" } : { post: id, revision: detail.id, history: "1" } })} /> : null}
      </> : <Status loading={pending} title={error ? "未能打开提交" : "正在读取提交"}
        message={error ? managementMessage(error) : undefined} onRetry={error ? () => open(selection) : undefined} />}
    </ScrollView> : null}
  </SafeAreaView>;
}

function SubmissionRow({ node, initial = false, disabled, onPress }: {
  node: SubmissionNode; initial?: boolean; disabled: boolean; onPress: () => void;
}) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress}
    style={({ pressed }) => [s.row, pressed && s.pressed]}>
    {initial ? <Text style={s.meta}>首发提交</Text> : null}
    <Text numberOfLines={2} style={s.label}>{node.title || "无标题"}</Text>
    <Text style={node.state === "rejected" ? s.rejected : s.meta}>
      {submissionLabel(node)} · {new Date(node.submitted_at).toLocaleString()}
    </Text>
  </Pressable>;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: t.surface },
  header: { borderBottomWidth: 1, borderBottomColor: t.line, paddingHorizontal: 20, paddingBottom: 12 },
  heading: { color: t.ink, fontSize: 23, fontWeight: "700" },
  content: { paddingHorizontal: 20, paddingVertical: 16, gap: 12 },
  hidden: { display: "none" },
  row: { gap: 5, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: t.line },
  pressed: { backgroundColor: t.selected },
  title: { fontSize: 21, fontWeight: "700", color: t.ink },
  label: { fontSize: 15, fontWeight: "600", color: t.ink },
  body: { fontSize: 16, lineHeight: 25, color: t.ink },
  meta: { fontSize: 13, color: t.secondary },
  rejected: { fontSize: 13, color: t.danger },
  reason: { gap: 4, padding: 12, backgroundColor: t.background, borderRadius: 8 },
});
