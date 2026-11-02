import { useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSession } from "../auth/context";
import { AuthSheet } from "../components/AuthSheet";
import { theme as t } from "../theme";
import { draftMessage, localAllowed } from "./workspace";

export function DraftAccessGate({ children, owner }: { children: React.ReactNode; owner?: string }) {
  const state = useSession();
  const [sheet, setSheet] = useState(false), [error, setError] = useState<unknown>();
  if (localAllowed(state) && (!owner || owner === state.drafts.owner)) return children;
  const confirmation = state.phase === "ready" && state.drafts.phase === "confirmation" &&
    (!owner || owner === state.drafts.owner);
  const back = () => router.canGoBack() ? router.back() : router.replace("/account");
  const retry = async () => {
    setError(undefined);
    try { if (confirmation) await state.session.confirmDraftAccess(); else await state.session.restore(); }
    catch (e) { setError(e); }
  };
  const switchAccount = async () => {
    setError(undefined);
    try { await state.session.logout(); setSheet(true); } catch (e) { setError(e); }
  };
  return <SafeAreaView style={s.screen}>
    <Pressable accessibilityRole="button" onPress={back} style={s.back}><Text style={s.link}>返回</Text></Pressable>
    <View style={s.center}>
      <Image source={require("../../assets/tako-chibi.png")} style={s.art} resizeMode="contain" accessible={false} />
      <Text style={s.title}>{confirmation ? "使用本机草稿" : "草稿已锁定"}</Text>
      <Text style={s.copy}>{confirmation ? "允许此账号恢复和编辑这台手机上的加密草稿。其他账号无法读取。" : "请用原账号登录并恢复。本机加密记录会保留。"}</Text>
      {state.busy ? <ActivityIndicator color={t.brand} /> : state.phase === "guest" ?
        <Pressable style={s.button} onPress={() => setSheet(true)}><Text style={s.buttonText}>登录 / 注册</Text></Pressable> :
        <Pressable style={s.button} onPress={() => void retry()}><Text style={s.buttonText}>{confirmation ? "恢复并继续" : "重新校验账号"}</Text></Pressable>}
      {owner && state.phase === "ready" && state.drafts.owner !== owner ? <Pressable disabled={state.busy} onPress={() => void switchAccount()} style={s.back}><Text style={s.link}>切换账号</Text></Pressable> : null}
      <Pressable onPress={() => router.replace("/drafts")} style={s.back}><Text style={s.link}>返回草稿箱</Text></Pressable>
      {error || state.error ? <Text style={s.error}>{draftMessage(error || state.error)}</Text> : null}
    </View>
    <AuthSheet visible={sheet} onClose={() => setSheet(false)} onComplete={() => setSheet(false)} />
  </SafeAreaView>;
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: t.surface, padding: 16 }, back: { padding: 12, minHeight: 44 },
  link: { color: t.brand, fontSize: 14 }, center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 24 },
  art: { width: 96, height: 112 }, title: { color: t.ink, fontSize: 20, fontWeight: "600" },
  copy: { color: t.secondary, fontSize: 14, lineHeight: 22, textAlign: "center" },
  button: { padding: 16, borderRadius: 8, backgroundColor: t.brand }, buttonText: { color: "white", fontWeight: "600" },
  error: { color: t.danger, fontSize: 14, lineHeight: 22 },
});
