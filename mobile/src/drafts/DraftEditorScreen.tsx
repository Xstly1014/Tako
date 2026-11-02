import { useCallback, useEffect, useSyncExternalStore } from "react";
import { ActivityIndicator, AppState, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useFocusEffect, useIsFocused } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { theme as t } from "../theme";
import { DraftError } from "./model";
import { draftMessage, DraftEditor, editorStatus, automaticSyncAllowed } from "./workspace";

const INPUT_SYNC_DELAY_MS = 1200;
const RETRY_SYNC_MS = 15000;
export function DraftEditorScreen({ editor, onCopied }: { editor: DraftEditor; onCopied: (key: string) => void }) {
  const state = useSyncExternalStore(editor.subscribe, editor.snapshot), focused = useIsFocused();
  const leave = () => router.canGoBack() ? router.back() : router.replace("/drafts");
  const unsaved = editor.hasUnstored();
  useFocusEffect(useCallback(() => { void editor.load().catch(() => undefined); }, [editor]));
  useEffect(() => {
    if (!focused || !state.record || (!state.record.dirty && !state.record.pending && !unsaved)) return;
    const attempt = () => {
      if (AppState.currentState === "active" && automaticSyncAllowed(editor.snapshot().error))
        void editor.synchronize().catch(() => undefined);
    };
    const timer = setTimeout(attempt, INPUT_SYNC_DELAY_MS), retry = setInterval(attempt, RETRY_SYNC_MS);
    const subscription = AppState.addEventListener("change", next => { if (next === "active") attempt(); else void editor.save().catch(() => undefined); });
    return () => { clearTimeout(timer); clearInterval(retry); subscription.remove(); };
  }, [editor, focused, state.title, state.content, state.record, unsaved]);
  return <SafeAreaView style={s.screen}>
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={s.header}>
        <Pressable onPress={leave} style={s.action}><Text style={s.link}>草稿箱</Text></Pressable>
        <Text style={s.heading}>中篇草稿</Text>
        <Pressable disabled={state.loading || state.syncing || !state.record} onPress={() => void editor.synchronize().catch(() => undefined)} style={[s.action, state.syncing && s.disabled]}><Text style={s.link}>{state.syncing ? "同步中" : "同步"}</Text></Pressable>
      </View>
      <View style={s.status}><Text accessibilityLiveRegion="polite" style={s.meta}>{editorStatus(state)}</Text>{state.record?.recoveredFrom ? <Text style={s.meta}>已另存恢复副本，原稿保留</Text> : null}</View>
      {state.error ? <View style={s.errorBox}><Text style={s.error}>{draftMessage(state.error)}</Text><Pressable onPress={() => void (state.record ? editor.save() : editor.load()).catch(() => undefined)} style={s.action}><Text style={s.link}>重试</Text></Pressable>{state.error instanceof DraftError && state.error.code === "local_conflict" ? <Pressable onPress={() => void editor.saveAsCopy().then(onCopied).catch(() => undefined)} style={s.action}><Text style={s.link}>另存本机副本</Text></Pressable> : null}</View> : null}
      {state.loading ? <ActivityIndicator color={t.brand} /> : state.record ? <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
        <TextInput accessibilityLabel="草稿标题" value={state.title} onChangeText={value => editor.input(value, state.content)} placeholder="标题" style={s.inputTitle} underlineColorAndroid="transparent" />
        <TextInput accessibilityLabel="草稿正文" value={state.content} onChangeText={value => editor.input(state.title, value)} placeholder="开始写正文" multiline textAlignVertical="top" style={s.body} underlineColorAndroid="transparent" />
      </ScrollView> : null}
      <View style={s.footer}><Text style={s.meta}>仅本机暂存无法抵抗卸载或清除 App 数据。</Text></View>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: t.surface }, header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", height: 56, paddingHorizontal: 8 },
  heading: { fontSize: 16, color: t.ink, fontWeight: "600" }, action: { minHeight: 44, padding: 12, justifyContent: "center" }, link: { color: t.brand, fontSize: 14 },
  status: { paddingHorizontal: 24, gap: 4, paddingBottom: 8 }, meta: { color: t.muted, fontSize: 12, lineHeight: 20 },
  content: { padding: 24, flexGrow: 1 }, inputTitle: { fontSize: 24, fontWeight: "600", color: t.ink, lineHeight: 32, paddingVertical: 8 },
  body: { flex: 1, minHeight: 320, fontSize: 16, lineHeight: 28, color: t.ink, paddingVertical: 16 },
  errorBox: { paddingHorizontal: 16, flexDirection: "row", alignItems: "center" }, error: { color: t.danger, fontSize: 14, lineHeight: 22, flex: 1 },
  footer: { padding: 16 }, disabled: { opacity: 0.4 },
});
