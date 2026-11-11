import { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { randomUUID } from "expo-crypto";
import { Action, Status } from "../components/Ui";
import { theme as t } from "../theme";
import { mergeReadingItems } from "../novels/reading-model";
import { Boundary, LinkButton, useOwner } from "./ShortPostManagement";
import {
  filePostAppeal, isDefiniteChangeError, listPostAppeals, managementMessage, type AppealPage,
} from "./manage";

const stateText = { pending: "待复核", upheld: "维持处置", revoked: "撤销处置" };
type Submission = { id: string; caseRevision: number; reason: string };

export default function ShortPostAppeals() {
  const params = useLocalSearchParams<{ id: string; caseRevision?: string }>();
  const post = typeof params.id === "string" ? params.id : "";
  const value = Number(params.caseRevision);
  const caseRevision = Number.isSafeInteger(value) && value > 0 ? value : undefined;
  return <Boundary>{(owner) => <AppealList key={owner + ":" + post + ":" + caseRevision}
    owner={owner} post={post} caseRevision={caseRevision} />}</Boundary>;
}

function AppealList({ owner, post, caseRevision }: { owner: string; post: string; caseRevision?: number }) {
  const send = useOwner(owner);
  const [page, setPage] = useState<AppealPage>();
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(true);
  const [reason, setReason] = useState("");
  const [request, setRequest] = useState<Submission>();
  const [notice, setNotice] = useState("");
  const active = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    active.current = controller;
    const signal = controller.signal;
    listPostAppeals(send, post, 0, signal).then((value) => {
      if (!signal.aborted) setPage(value);
    }).catch((failure: unknown) => {
      if (!signal.aborted) setError(failure);
    }).finally(() => {
      if (!signal.aborted) {
        active.current = null;
        setBusy(false);
      }
    });
    return () => {
      active.current?.abort();
      active.current = null;
    };
  }, [post, send]);

  async function run(task: (signal: AbortSignal) => Promise<void>) {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    const signal = controller.signal;
    setBusy(true);
    setError(undefined);
    try { await task(signal); }
    catch (failure) { if (!signal.aborted) setError(failure); }
    finally {
      if (!signal.aborted) {
        active.current = null;
        setBusy(false);
      }
    }
  }
  async function refresh(signal: AbortSignal, before = 0) {
    const value = await listPostAppeals(send, post, before, signal);
    if (!signal.aborted) setPage((old) => ({
      ...value, items: before && old ? mergeReadingItems(old.items, value.items) : value.items,
    }));
  }
  async function submit(signal: AbortSignal) {
    if (!request && !caseRevision) return;
    const work = request ?? { id: randomUUID(), caseRevision: caseRevision!, reason: reason.trim() };
    setNotice("");
    setRequest(work);
    try {
      const value = await filePostAppeal(send, post, work.id, work.caseRevision, work.reason, signal);
      if (signal.aborted) return;
      setRequest(undefined);
      setReason("");
      setNotice(value.state === "pending" ? "已提交复核申请。" : "已找到原复核结果。");
      setPage((old) => ({
        items: [value, ...(old?.items ?? []).filter((item) => item.id !== value.id)],
        next_before: old?.next_before ?? 0,
      }));
      await refresh(signal);
    } catch (failure) {
      if (!signal.aborted && isDefiniteChangeError(failure)) setRequest(undefined);
      throw failure;
    }
  }

  const pending = page?.items.some((item) => item.case_revision === caseRevision && item.state === "pending");
  const validReason = !!reason.trim() && Array.from(reason.trim()).length <= 500;
  return <SafeAreaView style={s.screen}>
    <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <View style={s.header}>
        <Text accessibilityRole="header" style={s.title}>短帖复核</Text>
        <LinkButton label="返回短帖管理" onPress={() =>
          router.dismissTo({ pathname: "/my-short-posts/[id]", params: { id: post } })} />
      </View>
      {error ? <Text accessibilityRole="alert" style={s.error}>{managementMessage(error)}</Text> : null}
      {notice ? <Text accessibilityLiveRegion="polite" style={s.meta}>{notice}</Text> : null}
      {!page ? <Status loading={busy} title={busy ? "正在读取复核记录" : "复核记录未能加载"}
        onRetry={busy ? undefined : () => void run(refresh)} /> : <>
        {request || (caseRevision && !pending) ? <View style={s.group}>
          <Text style={s.heading}>申请复核</Text>
          <TextInput style={s.input} accessibilityLabel="复核说明" placeholder="说明希望重新核对的问题"
            multiline value={reason} onChangeText={setReason} editable={!busy && !request} maxLength={1000} />
          <Action label={request ? "重试原申请" : "提交复核申请"}
            disabled={busy || (!request && !validReason)} onPress={() => void run(submit)} />
        </View> : null}
        <View style={s.header}>
          <Text style={s.heading}>复核记录</Text>
          <LinkButton label="刷新记录" disabled={busy} onPress={() => void run(refresh)} />
        </View>
        {!page.items.length ? <Text style={s.meta}>暂无复核记录。</Text> : null}
        {page.items.map((item) => <View key={item.id} style={s.record}>
          <Text style={s.heading}>{item.version === null ? "整帖" : "V" + item.version} · {stateText[item.state]}</Text>
          <Text style={s.meta}>{new Date(item.submitted_at).toLocaleString("zh-CN")}</Text>
          {item.case_reason ? <Text style={s.body}>处置原因 · {item.case_reason}</Text> : null}
          <Text style={s.body}>申请说明 · {item.reason}</Text>
          {item.decision_reason ? <Text style={s.body}>复核结果 · {item.decision_reason}</Text> : null}
        </View>)}
        {page.next_before ? <Action label="加载更早记录" disabled={busy}
          onPress={() => void run((signal) => refresh(signal, page.next_before))} /> : null}
      </>}
    </ScrollView>
  </SafeAreaView>;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: t.surface },
  content: { padding: 16, gap: 16, width: "100%", maxWidth: 680, alignSelf: "center" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 },
  title: { fontSize: 20, fontWeight: "600", color: t.ink },
  heading: { fontSize: 16, fontWeight: "600", color: t.ink },
  body: { fontSize: 14, lineHeight: 22, color: t.ink },
  meta: { fontSize: 14, lineHeight: 22, color: t.muted },
  error: { fontSize: 14, lineHeight: 22, color: t.danger },
  group: { gap: 8 },
  input: { minHeight: 104, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: t.line, textAlignVertical: "top" },
  record: { padding: 12, gap: 8, borderRadius: 8, borderWidth: 1, borderColor: t.line },
});
