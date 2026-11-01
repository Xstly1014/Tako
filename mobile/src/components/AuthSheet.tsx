import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSession } from "../auth/context";
import { apiMessage, ApiError } from "../api/client";
import { theme as t } from "../theme";
export function AuthSheet(props: Parameters<typeof AuthForm>[0]) {
  return props.visible ? <AuthForm {...props} /> : null;
}
function AuthForm({
  visible,
  onClose,
  onComplete,
}: {
  visible: boolean;
  onClose: () => void;
  onComplete: () => void;
}) {
  const { session, busy: sessionBusy, phase } = useSession();
  const [submitting, setSubmitting] = useState(false);
  const busy = sessionBusy || submitting;
  const [mode, setMode] = useState<"login" | "register">("login"),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [nickname, setNickname] = useState(""),
    [error, setError] = useState<unknown>();
  const submit = async () => {
    if (busy) return;
    setSubmitting(true);
    setError(undefined);
    try {
      await session.signIn(mode, email, password);
      setPassword("");
      if (mode === "register" && nickname.trim()) {
        try {
          await session.setNickname(nickname);
        } catch {
          Alert.alert("账号已创建", "笔名未保存，可稍后在“我的”中设置。", [
            { text: "继续" },
          ]);
        }
      }
      onComplete();
    } catch (e) {
      setError(e);
    } finally {
      setSubmitting(false);
    }
  };
  const close = () => {
    if (!busy) {
      setPassword("");
      onClose();
    }
  };
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={close}
    >
      <KeyboardAvoidingView
        style={s.backdrop}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityLabel="关闭登录面板"
          onPress={close}
        />
        <View style={s.sheet} accessibilityViewIsModal>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={s.form}
          >
            <View style={s.header}>
              <View style={s.tabs}>
                {(["login", "register"] as const).map((value) => (
                  <Pressable
                    key={value}
                    disabled={busy}
                    onPress={() => {
                      setMode(value);
                      setError(undefined);
                    }}
                  >
                    <Text style={[s.tab, mode === value && s.active]}>
                      {value === "login" ? "登录" : "注册"}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Pressable
                disabled={busy}
                onPress={close}
                accessibilityRole="button"
                accessibilityLabel="关闭"
                style={s.close}
              >
                <Text style={s.tab}>×</Text>
              </Pressable>
            </View>
            <Image
              source={require("../../assets/tako-chibi.png")}
              style={s.art}
              resizeMode="contain"
              accessible={false}
            />
            <Text style={s.label}>邮箱</Text>
            <TextInput
              accessibilityLabel="邮箱"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              autoComplete="email"
              editable={!busy}
              value={email}
              onChangeText={setEmail}
              style={s.field}
              placeholder="你的邮箱地址"
            />
            {mode === "register" ? (
              <>
                <Text style={s.label}>笔名（可稍后设置）</Text>
                <TextInput
                  accessibilityLabel="笔名"
                  maxLength={64}
                  editable={!busy}
                  value={nickname}
                  onChangeText={setNickname}
                  style={s.field}
                  placeholder="读者将看到这个名字"
                />
              </>
            ) : null}
            <Text style={s.label}>密码</Text>
            <TextInput
              accessibilityLabel="密码"
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete={
                mode === "register" ? "new-password" : "current-password"
              }
              editable={!busy}
              value={password}
              onChangeText={setPassword}
              style={s.field}
              placeholder={mode === "register" ? "至少 8 个字符" : "你的密码"}
            />
            {error ? (
              <View accessibilityLiveRegion="polite">
                <Text style={s.error}>{apiMessage(error)}</Text>
                {mode === "register" &&
                error instanceof ApiError &&
                error.code === "network" ? (
                  <Text style={s.note}>
                    注册结果未确认，请用刚才的密码登录检查，不要连续重试注册。
                  </Text>
                ) : null}
              </View>
            ) : null}
            {phase === "offline" ? (
              <>
                <Text style={s.error}>上次登录尚未校验，请先恢复连接。</Text>
                <Pressable
                  disabled={busy}
                  onPress={async () => {
                    await session.restore();
                    if (session.snapshot().phase === "ready") onComplete();
                  }}
                  style={s.primary}
                >
                  <Text style={s.primaryText}>重试验证登录</Text>
                </Pressable>
              </>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={mode === "login" ? "登录账号" : "创建账号"}
                disabled={busy || !email.trim() || !password}
                onPress={() => void submit()}
                style={[
                  s.primary,
                  (busy || !email.trim() || !password) && s.disabled,
                ]}
              >
                {busy ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text style={s.primaryText}>
                    {mode === "login" ? "登录" : "创建账号"}
                  </Text>
                )}
              </Pressable>
            )}
            <Text style={s.note}>
              私测阶段不验证邮箱归属，暂不支持邮件找回密码。请勿使用重要账号的密码。
            </Text>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "#00000040",
  },
  sheet: {
    maxHeight: "94%",
    backgroundColor: "white",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  form: { padding: 24, paddingBottom: 32 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  tabs: { flexDirection: "row", gap: 24 },
  tab: { fontSize: 16, color: t.muted },
  active: {
    color: t.ink,
    fontWeight: "600",
    paddingBottom: 8,
    borderBottomWidth: 2,
    borderColor: t.brand,
  },
  close: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  art: { width: 120, height: 80, alignSelf: "center" },
  label: { fontSize: 12, color: t.secondary, marginTop: 12, marginBottom: 8 },
  field: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: t.line,
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    color: t.ink,
    backgroundColor: t.background,
  },
  primary: {
    marginTop: 20,
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: t.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: { fontSize: 16, fontWeight: "600", color: "white" },
  disabled: { opacity: 0.4 },
  note: { fontSize: 12, lineHeight: 20, color: t.muted, marginTop: 12 },
  error: { fontSize: 13, lineHeight: 20, color: t.danger, marginTop: 12 },
});
