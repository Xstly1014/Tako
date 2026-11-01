import { useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSession } from "../auth/context";
import { AuthSheet } from "../components/AuthSheet";
import { BottomNavigation, unavailable } from "../components/PrototypeUi";
import { apiMessage } from "../api/client";
import { theme as t } from "../theme";
export default function Account() {
  const {
    session,
    phase,
    account,
    busy,
    error: restoreError,
    generation,
  } = useSession();
  const [sheet, setSheet] = useState(false),
    [edit, setEdit] = useState(false),
    [name, setName] = useState(""),
    [saving, setSaving] = useState(false),
    [error, setError] = useState<unknown>();
  const logout = async () => {
    setError(undefined);
    try {
      await session.logout();
      setEdit(false);
      setName("");
    } catch (e) {
      setError(e);
    }
  };
  const save = async () => {
    setSaving(true);
    setError(undefined);
    try {
      await session.setNickname(name);
      setEdit(false);
      setName("");
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  };
  return (
    <SafeAreaView style={s.screen}>
      <ScrollView
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={s.profile}>
          <Image
            source={require("../../assets/tako-chibi.png")}
            resizeMode="contain"
            style={s.art}
            accessible={false}
          />
          <View style={{ flex: 1 }}>
            <Text style={s.name}>
              {phase === "ready"
                ? account?.nickname || "未设置笔名"
                : phase === "guest"
                  ? "游客"
                  : "正在确认账号"}
            </Text>
            <Text style={s.meta}>
              {phase === "ready"
                ? "邮箱未验证 · 私测账号"
                : "游客可阅读公开作品"}
            </Text>
          </View>
        </View>
        <View style={s.stats}>
          <Pressable onPress={() => unavailable("作品管理")}>
            <Text style={s.statTitle}>作品</Text>
            <Text style={s.meta}>尚未开放</Text>
          </Pressable>
          <Pressable
            onPress={() =>
              phase === "ready" ? router.push("/favorites") : setSheet(true)
            }
          >
            <Text style={s.statTitle}>收藏</Text>
            <Text style={s.meta}>查看收藏</Text>
          </Pressable>
          <Pressable onPress={() => unavailable("关注")}>
            <Text style={s.statTitle}>关注</Text>
            <Text style={s.meta}>尚未开放</Text>
          </Pressable>
        </View>
        {phase === "loading" ? (
          <ActivityIndicator color={t.brand} />
        ) : phase === "offline" ? (
          <>
            <Text style={s.error}>{apiMessage(restoreError)}</Text>
            <Pressable
              disabled={busy}
              onPress={() => void session.restore()}
              style={s.primary}
            >
              <Text style={s.primaryText}>重试确认账号</Text>
            </Pressable>
          </>
        ) : phase === "guest" ? (
          <Pressable onPress={() => setSheet(true)} style={s.primary}>
            <Text style={s.primaryText}>登录 / 注册</Text>
          </Pressable>
        ) : (
          <View key={generation}>
            <Pressable onPress={() => unavailable("我的书架")} style={s.row}>
              <Text style={s.rowTitle}>我的书架</Text>
              <Text style={s.meta}>尚未接入手机端</Text>
            </Pressable>
            <Pressable onPress={() => unavailable("阅读偏好")} style={s.row}>
              <Text style={s.rowTitle}>阅读偏好</Text>
              <Text style={s.meta}>当前开放中篇阅读</Text>
            </Pressable>
            <Pressable onPress={() => unavailable("草稿箱")} style={s.row}>
              <Text style={s.rowTitle}>草稿箱</Text>
              <Text style={s.meta}>尚未接入手机端</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push("/favorites")}
              style={s.row}
            >
              <Text style={s.rowTitle}>我的收藏</Text>
              <Text style={s.meta}>再次阅读收藏的作品</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setEdit(!edit);
                setName(account?.nickname ?? "");
              }}
              style={s.row}
            >
              <Text style={s.rowTitle}>设置</Text>
              <Text style={s.meta}>修改笔名</Text>
            </Pressable>
            {edit ? (
              <View style={s.edit}>
                <TextInput
                  accessibilityLabel="新笔名"
                  value={name}
                  onChangeText={setName}
                  editable={!saving}
                  maxLength={64}
                  style={s.field}
                />
                <Pressable
                  disabled={saving || !name.trim()}
                  onPress={() => void save()}
                  style={[
                    s.primary,
                    (saving || !name.trim()) && { opacity: 0.4 },
                  ]}
                >
                  <Text style={s.primaryText}>
                    {saving ? "正在保存" : "保存笔名"}
                  </Text>
                </Pressable>
              </View>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="退出登录"
              disabled={busy || saving}
              onPress={() => void logout()}
              style={s.row}
            >
              <Text style={[s.rowTitle, { color: t.danger }]}>
                {busy ? "正在退出" : "退出登录"}
              </Text>
              <Text style={s.meta}>仅退出当前 App，不删除内容</Text>
            </Pressable>
          </View>
        )}
        {error || (phase === "guest" && restoreError) ? (
          <Text accessibilityLiveRegion="polite" style={s.error}>
            {apiMessage(error || restoreError)}
          </Text>
        ) : null}
        <Text style={s.note}>本地测试版 · 合成测试数据</Text>
      </ScrollView>
      <BottomNavigation
        active="me"
        onHome={() => {
          if (router.canGoBack()) router.back();
          else router.replace("/community");
        }}
      />
      <AuthSheet
        visible={sheet}
        onClose={() => setSheet(false)}
        onComplete={() => setSheet(false)}
      />
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "white" },
  content: { paddingHorizontal: 16, paddingTop: 24, paddingBottom: 32 },
  stats: {
    flexDirection: "row",
    gap: 34,
    paddingHorizontal: 6,
    paddingBottom: 18,
    marginBottom: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: t.line,
  },
  statTitle: { fontSize: 14, color: t.ink },
  title: { fontSize: 24, fontWeight: "600", color: t.ink, marginBottom: 24 },
  profile: {
    flexDirection: "row",
    gap: 16,
    alignItems: "center",
    marginBottom: 24,
  },
  art: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: t.background,
  },
  name: { fontSize: 18, fontWeight: "600", color: t.ink },
  meta: { fontSize: 12, lineHeight: 20, color: t.muted, marginTop: 4 },
  primary: {
    backgroundColor: t.brand,
    borderRadius: 12,
    minHeight: 48,
    justifyContent: "center",
    alignItems: "center",
    padding: 12,
  },
  primaryText: { fontSize: 15, fontWeight: "600", color: "white" },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    minHeight: 52,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: t.line,
  },
  rowTitle: { fontSize: 14, color: t.ink },
  error: { fontSize: 13, lineHeight: 20, color: t.danger, marginTop: 16 },
  edit: { paddingVertical: 16, gap: 12 },
  field: {
    minHeight: 48,
    padding: 12,
    borderWidth: 1,
    borderColor: t.line,
    borderRadius: 10,
    fontSize: 15,
    color: t.ink,
  },
  note: { fontSize: 11, color: t.muted, marginTop: 32 },
});
