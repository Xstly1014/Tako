import { useCallback, useRef, useState } from "react";
import { useFocusEffect, router } from "expo-router";
import { Alert, Pressable, StyleSheet, Text } from "react-native";
import { useSession } from "../auth/context";
import { apiMessage } from "../api/client";
import type { components } from "../api/contract";
import { theme as t } from "../theme";
import { AuthSheet } from "./AuthSheet";

type State = components["schemas"]["AuthorFollowState"];
type Target = { kind: "work" | "post" | "novel"; id: string };
export function AuthorFollowButton(props: Target) {
  const { generation, account } = useSession();
  return (
    <FollowControl
      key={`${generation}:${account?.id}:${props.kind}:${props.id}`}
      {...props}
    />
  );
}
function FollowControl({ kind, id }: Target) {
  const { session, phase, account, busy: sessionBusy } = useSession();
  const path = `/my/author-social/targets/${kind}/${id}`;
  const [state, setState] = useState<State>();
  const [error, setError] = useState(false);
  const [login, setLogin] = useState(false);
  const [busy, setBusy] = useState(false);
  const focus = useRef<AbortController | null>(null);
  const lock = useRef(false);
  const read = useCallback(
    async (signal: AbortSignal) => {
      setBusy(true);
      try {
        const result = await session.authorized<State>(path, { signal });
        if (!signal.aborted) {
          setState(result);
          setError(false);
        }
      } catch {
        if (!signal.aborted) {
          setState(undefined);
          setError(true);
        }
      } finally {
        if (!signal.aborted) setBusy(false);
      }
    },
    [session, path],
  );
  useFocusEffect(
    useCallback(() => {
      const controller = new AbortController();
      focus.current = controller;
      if (phase === "ready") void read(controller.signal);
      return () => {
        controller.abort();
        focus.current = null;
      };
    }, [read, phase]),
  );
  if (state?.own) return null;
  async function change(before: State, signal: AbortSignal) {
    if (
      lock.current ||
      signal.aborted ||
      session.snapshot().account?.id !== account?.id
    )
      return;
    lock.current = true;
    setBusy(true);
    try {
      const value = await session.authorized<State>(path, {
        method: "PUT",
        signal,
        body: {
          following: !before.following,
          expected_revision: before.revision,
        },
      });
      if (!signal.aborted) setState(value);
    } catch (e) {
      if (!signal.aborted) {
        Alert.alert("请核对关注状态", apiMessage(e));
        await read(signal);
      }
    } finally {
      lock.current = false;
      if (!signal.aborted) setBusy(false);
    }
  }
  function press() {
    const signal = focus.current?.signal;
    if (!signal || busy || sessionBusy) return;
    if (phase !== "ready") {
      setLogin(true);
      return;
    }
    if (!state || error) {
      void read(signal);
      return;
    }
    if (!state.following && !account?.nickname) {
      Alert.alert("先设置昵称", "关注后，作者可以在粉丝名单中看到你的昵称。", [
        { text: "取消", style: "cancel" },
        { text: "设置昵称", onPress: () => router.push("/account") },
      ]);
      return;
    }
    Alert.alert(
      state.following ? "取消关注这位作者？" : "关注这位作者？",
      state.following
        ? "这位作者的作品将移出你的关注动态。"
        : "作者可以在粉丝名单中看到你的昵称。",
      [
        { text: "返回", style: "cancel" },
        {
          text: state.following ? "取消关注" : "关注",
          onPress: () => void change(state, signal),
        },
      ],
    );
  }
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{
          selected: state?.following,
          disabled: busy || sessionBusy,
        }}
        disabled={busy || sessionBusy}
        onPress={press}
        style={({ pressed }) => [
          s.button,
          state?.following && s.active,
          pressed && s.pressed,
        ]}
      >
        <Text style={s.text}>
          {busy
            ? "读取中…"
            : error
              ? "重查关注"
              : state?.following
                ? "已关注"
                : "关注作者"}
        </Text>
      </Pressable>
      <AuthSheet
        visible={login}
        onClose={() => setLogin(false)}
        onComplete={() => setLogin(false)}
      />
    </>
  );
}
const s = StyleSheet.create({
  button: {
    minHeight: 44,
    paddingHorizontal: 12,
    alignSelf: "center",
    justifyContent: "center",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: t.line,
  },
  active: { backgroundColor: t.selected, borderColor: t.selected },
  pressed: { opacity: 0.6 },
  text: { fontSize: 13, fontWeight: "600", color: t.brand },
});
