import { useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { AuthSheet } from "../components/AuthSheet";
import { useSession } from "../auth/context";
import { theme as t } from "../theme";
export default function Welcome() {
  const [sheet, setSheet] = useState(false);
  const { phase } = useSession();
  return (
    <SafeAreaView style={s.screen}>
      <View style={s.content}>
        <Image
          source={require("../../assets/tako-chibi.png")}
          style={s.art}
          resizeMode="contain"
          accessible={false}
        />
        <Text style={s.word}>tako</Text>
        <Text style={s.subtitle}>读点喜欢的，写点自己的。</Text>
        <View style={s.actions}>
          <Pressable
            accessibilityRole="button"
            disabled={phase === "loading"}
            onPress={() =>
              phase === "ready" ? router.replace("/community") : setSheet(true)
            }
            style={({ pressed }) => [s.primary, pressed && { opacity: 0.75 }]}
          >
            <Text style={s.primaryText}>
              {phase === "loading"
                ? "正在恢复登录"
                : phase === "ready"
                  ? "进入社区"
                  : "登录 / 注册"}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.replace("/preferences")}
            style={s.ghost}
          >
            <Text style={s.ghostText}>游客访问</Text>
          </Pressable>
          <Text style={s.note}>本地测试版 · 当前内容为合成测试数据</Text>
        </View>
      </View>
      <AuthSheet
        visible={sheet}
        onClose={() => setSheet(false)}
        onComplete={() => {
          setSheet(false);
          router.replace("/community");
        }}
      />
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "white" },
  content: {
    flex: 1,
    alignItems: "center",
    paddingTop: 28,
    paddingHorizontal: 36,
    paddingBottom: 28,
  },
  art: { width: 210, height: 140 },
  word: {
    fontSize: 30,
    fontWeight: "600",
    letterSpacing: 4.8,
    marginTop: 14,
    color: t.ink,
  },
  subtitle: { fontSize: 13, color: t.muted, letterSpacing: 1.5, marginTop: 6 },
  actions: { width: "100%", marginTop: "auto", gap: 12 },
  primary: {
    backgroundColor: t.brand,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    minHeight: 48,
  },
  primaryText: { color: "white", fontSize: 16, fontWeight: "600" },
  ghost: {
    minHeight: 48,
    paddingVertical: 13,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.line,
    alignItems: "center",
  },
  ghostText: { fontSize: 15, color: t.secondary },
  note: {
    fontSize: 11,
    color: t.muted,
    textAlign: "center",
    lineHeight: 18,
    marginTop: 2,
  },
});
