import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { theme as t } from "../theme";
import type { LocalDraft } from "./model";
import type { DraftPage } from "./api";
import { draftMessage, localAllowed, type DraftTools } from "./workspace";

type Row = { key: string; title: string; local?: LocalDraft; serverId?: string };
export function DraftsListScreen({ tools }: { tools: DraftTools }) {
  const [locals, setLocals] = useState<LocalDraft[]>([]), [servers, setServers] = useState<DraftPage["items"]>([]);
  const [cursor, setCursor] = useState(""), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const acting = useRef(false);
  const identity = tools.current();
  const same = (generation: number, owner: string | null) => {
    const value = tools.current(); return localAllowed(value) && generation === value.generation && owner === value.drafts.owner;
  };
  const refresh = useCallback(async () => {
    const before = tools.current(); if (!localAllowed(before)) return;
    setLoading(true); setError(undefined);
    try {
      const local = await tools.local.list();
      if (!same(before.generation, before.drafts.owner)) return;
      setLocals(local.filter((x): x is LocalDraft => !!x));
      if (await tools.online()) {
        const page = await tools.api.list();
        if (!same(before.generation, before.drafts.owner)) return;
        setServers(page.items); setCursor(page.next_cursor);
      }
    } catch (e) { if (same(before.generation, before.drafts.owner)) setError(e); }
    finally { if (same(before.generation, before.drafts.owner)) setLoading(false); }
    // tools is one stable session-owned facade; same checks current identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tools]);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  const run = async (action: () => Promise<void>) => {
    if (acting.current) return;
    acting.current = true;
    const before = tools.current(); setBusy(true); setError(undefined);
    try { await action(); } catch (e) { if (same(before.generation, before.drafts.owner)) setError(e); }
    finally { acting.current = false; setBusy(false); }
  };
  const open = async (row?: Row) => {
    const before = tools.current();
    if (!localAllowed(before)) return;
    let record = row?.local;
    if (!row) record = await tools.local.create(tools.uuid());
    else if (!record && row.serverId) record = await tools.local.cacheServer(await tools.api.read(row.serverId));
    if (record && same(before.generation, before.drafts.owner)) router.push(`/drafts/${record.id}`);
  };
  const more = async () => {
    const before = tools.current(), page = await tools.api.list(cursor);
    if (same(before.generation, before.drafts.owner)) {
      setServers(old => [...old, ...page.items.filter(x => !old.some(y => x.id === y.id))]);
      setCursor(page.next_cursor);
    }
  };
  const seen = new Set(locals.map(x => x.serverId).filter(Boolean));
  const rows: Row[] = [...locals.map(local => ({ key: local.id, title: local.title, local })),
    ...(identity.drafts.phase === "online" ? servers : []).filter(x => !seen.has(x.id)).map(x => ({ key: "server-" + x.id, title: x.title, serverId: x.id }))];
  const visible = localAllowed(identity);
  return <SafeAreaView style={s.screen}>
    <View style={s.header}>
      <Pressable onPress={() => router.canGoBack() ? router.back() : router.replace("/account")} style={s.action}><Text style={s.link}>返回</Text></Pressable>
      <Text style={s.title}>草稿箱</Text>
      <Pressable disabled={busy || !visible} onPress={() => void run(() => open())} style={[s.action, busy && s.disabled]}><Text style={s.link}>新建中篇</Text></Pressable>
    </View>
    <View style={s.toolbar}><Text style={s.meta}>{identity.drafts.phase === "offline" ? "当前离线，仅显示本机草稿" : "私密草稿，不会自动发布"}</Text><Pressable disabled={loading || busy} onPress={() => void refresh()} style={s.action}><Text style={s.link}>刷新</Text></Pressable></View>
    {error ? <Text accessibilityLiveRegion="polite" style={s.error}>{draftMessage(error)}</Text> : null}
    <FlatList data={visible ? rows : []} keyExtractor={row => row.key}
      renderItem={({ item }) => <Pressable disabled={busy} onPress={() => void run(() => open(item))} style={({ pressed }) => [s.row, pressed && s.pressed]}>
        <Text style={s.rowTitle} numberOfLines={2}>{item.title || "未命名草稿"}</Text>
        <Text style={s.meta}>{!item.local ? "服务器草稿，打开后可离线续写" : item.local.pending ? "本机暂存，服务器结果待确认" : item.local.dirty ? "本机暂存，待同步" : "已保存到服务器"}</Text>
      </Pressable>}
      ListEmptyComponent={loading ? <ActivityIndicator color={t.brand} /> : <View style={s.empty}><Text style={s.rowTitle}>还没有本机草稿</Text><Text style={s.meta}>新建中篇，或联网刷新服务器草稿。</Text></View>}
      ListFooterComponent={cursor ? <Pressable disabled={busy || loading} onPress={() => void run(more)} style={s.action}><Text style={s.link}>加载更多</Text></Pressable> : undefined} />
  </SafeAreaView>;
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: t.surface }, header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 8, height: 56 },
  title: { color: t.ink, fontSize: 20, fontWeight: "600" }, action: { minHeight: 44, padding: 12, justifyContent: "center" },
  link: { color: t.brand, fontSize: 14 }, toolbar: { paddingHorizontal: 16, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  meta: { fontSize: 12, color: t.muted, lineHeight: 20 }, row: { padding: 16, gap: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: t.line },
  rowTitle: { color: t.ink, fontSize: 16, fontWeight: "600", lineHeight: 24 }, pressed: { backgroundColor: t.background }, disabled: { opacity: 0.4 },
  error: { color: t.danger, padding: 16, fontSize: 14 }, empty: { padding: 24, gap: 8 },
});
