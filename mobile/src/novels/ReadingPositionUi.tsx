import {
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { AppState, StyleSheet, Text, View, Pressable } from "react-native";
import { useFocusEffect } from "expo-router";
import * as Crypto from "expo-crypto";
import { useSession } from "../auth/context";
import { id } from "../drafts/model";
import { theme as t } from "../theme";
import { nativeReadingJournal } from "./native";
import { ReadingPositionApi } from "./reading-position-api";
import { ReadingSynchronizer, type ReadingCandidate } from "./reading-sync";
export function useReadingPosition(book: string) {
  const { session, account, phase, localOwner, generation, busy } =
    useSession();
  const owner = account?.id ?? (phase === "offline" ? localOwner : null);
  const sync = useMemo(() => {
    if (!owner || busy || !id(book)) return null;
    const current = () => {
      const s = session.snapshot();
      const who =
        s.account?.id ?? (s.phase === "offline" ? s.localOwner : null);
      return !s.busy && s.generation === generation && who === owner;
    };
    const online = () => current() && session.snapshot().phase === "ready";
    return new ReadingSynchronizer(
      owner,
      book,
      nativeReadingJournal(session, book),
      new ReadingPositionApi((p, o) => session.authorized(p, o)),
      current,
      online,
      Crypto.randomUUID,
    );
  }, [session, owner, generation, book, busy]);
  return sync;
}
const empty = {
  ready: false,
  busy: false,
  error: "",
  record: null,
  cloud: null,
} as ReturnType<ReadingSynchronizer["snapshot"]>;
const noopSubscribe = () => () => {};
export function useReadingState(sync: ReadingSynchronizer | null) {
  return useSyncExternalStore(
    sync?.subscribe ?? noopSubscribe,
    sync?.snapshot ?? (() => empty),
  );
}
const reconnectAttempts = new WeakMap<
  ReturnType<typeof useSession>["session"],
  number
>();
export function useReadingLifecycle(sync: ReadingSynchronizer | null) {
  const { session } = useSession();
  const [localError, setError] = useState("");
  const focused = useRef(false);
  const operation = useCallback(async (f: () => Promise<unknown>) => {
    try {
      await f();
      setError("");
    } catch {
      setError("续读位置暂存或同步未完成，原记录保留，可重试。");
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      if (!sync) return;
      let active = true;
      focused.current = true;
      const check = async (force = false) => {
        if (!active) return;
        if (
          session.snapshot().phase === "offline" &&
          !session.snapshot().busy &&
          Date.now() - (reconnectAttempts.get(session) ?? 0) >= 30_000
        ) {
          reconnectAttempts.set(session, Date.now());
          await session.restore();
          return;
        }
        await operation(async () => {
          await sync.restore(force);
          if (active && !sync.snapshot().record?.pending) await sync.sync();
        });
      };
      void check(true);
      const timer = setInterval(() => {
        if (AppState.currentState === "active") void check();
      }, 30_000);
      const listener = AppState.addEventListener("change", (state) => {
        if (state === "active") void check();
        else void operation(() => sync.sync());
      });
      return () => {
        active = false;
        focused.current = false;
        clearInterval(timer);
        listener.remove();
        void operation(() => sync.sync());
      };
    }, [sync, operation, session]),
  );
  return { localError, operation, focused };
}
export function ReadingPositionControls({
  sync,
  onResume,
  error = "",
  currentChapter,
}: {
  sync: ReadingSynchronizer | null;
  onResume: (p: ReadingCandidate) => void;
  error?: string;
  currentChapter?: string;
}) {
  const { phase } = useSession();
  const state = useReadingState(sync),
    [actionError, setError] = useState("");
  const run = async (f: () => Promise<unknown>) => {
    try {
      await f();
      setError("");
    } catch {
      setError("操作未完成，位置记录保留，请重试。");
    }
  };
  if (!sync) return null;
  const record = state.record,
    position = record?.candidate ?? record?.cloud;
  const pending = record?.pending;
  const conflict = record?.conflict;
  const issue =
    error ||
    actionError ||
    (pending || conflict || record?.blocked ? "" : state.error);
  const describe = (p: ReadingCandidate) =>
    `${currentChapter ? (p.chapter_id === currentChapter ? "本章" : "其他章节") : "章节"}第${p.locator.paragraph + 1}段`;

  return (
    <View style={s.panel}>
      <Text style={s.note} accessibilityLiveRegion="polite">
        {!state.ready
          ? "正在读取续读位置"
          : pending
            ? "原同步请求尚未确认，本机位置保留"
            : conflict
              ? "本机与云端位置有变化，请选择要继续的位置"
              : record?.blocked
                ? "上次位置暂时无法同步，本机记录保留"
                : phase === "offline"
                  ? "本机保留了续读位置，联网后再同步"
                  : record?.candidate
                    ? "阅读位置已暂存在本机"
                    : record?.cloud
                      ? "阅读位置已同步"
                      : "登录后的阅读位置会私密同步"}
      </Text>
      {issue ? <Text style={s.note}>{issue}</Text> : null}
      {conflict && record?.candidate ? (
        <Text style={s.note}>
          本机：{describe(record.candidate)}；云端：
          {state.cloud
            ? state.cloud.position
              ? describe(state.cloud.position)
              : "尚无位置"
            : "待重新核对"}
          。可先打开位置再决定。
        </Text>
      ) : null}
      <View style={s.actions}>
        {error || actionError || state.error ? (
          <Control
            label="重新读取本机位置"
            disabled={state.busy}
            onPress={() => void run(() => sync.restore(true))}
          />
        ) : null}
        {position ? (
          <Control
            label={record?.candidate ? "继续本机位置" : "继续上次阅读"}
            disabled={state.busy}
            onPress={() => onResume(position)}
          />
        ) : null}
        {pending ? (
          <>
            <Control
              label="查询原续读请求"
              disabled={state.busy}
              onPress={() => void run(() => sync.refresh())}
            />
            <Control
              label="重试原续读请求"
              disabled={state.busy}
              onPress={() => void run(() => sync.sync(true))}
            />
          </>
        ) : conflict ? (
          <>
            <Control
              label="使用本机位置"
              disabled={state.busy}
              onPress={() => void run(() => sync.chooseLocal())}
            />
            <Control
              label="采用云端位置并继续"
              disabled={state.busy}
              onPress={() =>
                void run(async () => {
                  const cloud = await sync.chooseCloud();
                  if (cloud?.position) onResume(cloud.position);
                })
              }
            />
          </>
        ) : (
          <Control
            label="检查续读同步"
            disabled={state.busy || !state.ready}
            onPress={() =>
              void run(async () => {
                await sync.refresh();
                await sync.sync();
              })
            }
          />
        )}
        {record?.blocked ? (
          <Control
            label="重新检查本机位置"
            disabled={state.busy}
            onPress={() => void run(() => sync.chooseLocal())}
          />
        ) : null}
      </View>
      {state.cloud?.position && !state.cloud.readable ? (
        <Text style={s.note}>
          云端所指章节暂不可读，位置仍保留；可以自行选择其他章节。
        </Text>
      ) : null}
    </View>
  );
}
function Control({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      accessibilityState={{ disabled: !!disabled }}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 44,
        justifyContent: "center",
        opacity: disabled ? 0.45 : pressed ? 0.65 : 1,
      })}
    >
      <Text style={{ fontSize: 14, lineHeight: 24, color: t.brand }}>
        {label}
      </Text>
    </Pressable>
  );
}
const s = StyleSheet.create({
  panel: { gap: 8, marginVertical: 16 },
  note: { fontSize: 12, lineHeight: 20, color: t.muted },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
