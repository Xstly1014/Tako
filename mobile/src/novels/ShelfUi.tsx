import {
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import * as Crypto from "expo-crypto";
import { useSession } from "../auth/context";
import { AuthSheet } from "../components/AuthSheet";
import { theme as t } from "../theme";
import { ApiError } from "../api/client";
import { nativeShelfJournal } from "./native";
import { NovelShelfApi, type ShelfState, type ShelfWrite } from "./shelf-api";
import { ShelfOperations } from "./shelf-requests";
export function shelfMessage(e: unknown) {
  if (!(e instanceof ApiError)) return "书架暂未更新，请重试。";
  const messages: Record<string, string> = {
    storage: "本机操作记录未能读取或保存，记录会保留，请重新读取。",
    network: "连接未完成，原操作保留，可查询原结果。",
    novel_shelf_conflict: "书架状态已变化，请完成当前操作确认后重新加载。",
    novel_request_pending: "请先处理尚未确认的书架操作。",
    resource_not_found: "作品暂不可读或原结果暂未查到；原操作仍会保留。",
    mutation_id_reused: "原请求标识不匹配，当前操作未再次执行。",
    authentication_required: "请重新登录同一账号后继续处理书架。",
    stale_session: "账号已变化，请重新打开书架。",
    publication_disabled: "当前环境尚未开放公开阅读。",
    contract: "书架返回结果未通过校验，原操作保留，请重试。",
  };
  return messages[e.code] ?? "书架未能更新，请重新检查。";
}
export function ShelfLink({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.action,
        pressed && s.pressed,
        disabled && s.disabled,
      ]}
    >
      <Text style={s.link}>{label}</Text>
    </Pressable>
  );
}
export function useShelfTools() {
  const { session, account, generation, phase, busy } = useSession();
  const owner = account?.id;
  return useMemo(() => {
    if (!owner || phase !== "ready" || busy) return null;
    const current = () => {
      const now = session.snapshot();
      return (
        now.phase === "ready" &&
        !now.busy &&
        now.account?.id === owner &&
        now.generation === generation
      );
    };
    const api = new NovelShelfApi((p, o) => session.authorized(p, o));
    return {
      api,
      ops: new ShelfOperations(
        owner,
        nativeShelfJournal(session),
        api,
        current,
        Crypto.randomUUID,
      ),
      current,
    };
  }, [session, owner, generation, phase, busy]);
}
export type ShelfTools = NonNullable<ReturnType<typeof useShelfTools>>;
const empty = {
  loaded: false,
  busy: false,
  record: null,
  error: undefined,
} as ReturnType<ShelfOperations["snapshot"]>;
const noSubscribe = () => () => {};
export function useShelfState(tools: ShelfTools | null) {
  return useSyncExternalStore(
    tools?.ops.subscribe ?? noSubscribe,
    tools?.ops.snapshot ?? (() => empty),
  );
}
/** Reload after focus; unknown commands only GET their immutable receipt. */
export function useShelfStartup(
  tools: ShelfTools | null,
  reload: (signal: AbortSignal) => Promise<unknown>,
) {
  useFocusEffect(
    useCallback(() => {
      const controller = new AbortController();
      if (tools) {
        void (async () => {
          try {
            const r = await tools.ops.load();
            if (!controller.signal.aborted && r && !r.receipt && !r.rejection)
              await tools.ops.confirm();
          } catch {
            /* Operations retains and projects its own error. */
          }
          if (!controller.signal.aborted && tools.current())
            await reload(controller.signal);
        })();
      }
      return () => controller.abort();
    }, [tools, reload]),
  );
}
export function ShelfRecovery({
  tools,
  onSettled,
}: {
  tools: ShelfTools;
  onSettled: () => Promise<unknown>;
}) {
  const v = useShelfState(tools),
    r = v.record;
  const operation = r
    ? (
        {
          join: "加入书架并追更",
          follow: "重新开启追更",
          unfollow: "关闭追更",
          remove: "移出书架并关闭追更",
        } as const
      )[r.input.operation]
    : "";
  const run = (f: () => Promise<unknown>) => {
    void f().catch(() => undefined);
  };
  return (
    <View style={s.recovery}>
      {v.error ? (
        <Text accessibilityRole="alert" style={s.error}>
          {shelfMessage(v.error)}
        </Text>
      ) : null}
      {!v.loaded || v.error ? (
        <ShelfLink
          label="重新读取操作记录"
          disabled={v.busy}
          onPress={() => run(() => tools.ops.load())}
        />
      ) : null}
      {r ? (
        <>
          <Text style={s.note}>本次操作：{operation}</Text>
          <Text style={s.note}>
            {r.receipt
              ? "书架操作已确认，请刷新当前状态。"
              : r.rejection
                ? "这次书架操作未受理，请重新加载后再选择。"
                : "有一项书架操作尚未确认。离开页面仍会保留，同账号登录后可继续查询。"}
          </Text>
          <View style={s.actions}>
            <ShelfLink
              label="查看目标作品"
              onPress={() =>
                router.push({
                  pathname: "/novel/[id]",
                  params: { id: r.book, from: "shelf" },
                })
              }
            />
            {r.receipt || r.rejection ? (
              <ShelfLink
                label="刷新书架状态"
                disabled={v.busy}
                onPress={() => run(onSettled)}
              />
            ) : (
              <>
                <ShelfLink
                  label="查询原书架结果"
                  disabled={v.busy}
                  onPress={() => run(() => tools.ops.confirm())}
                />
                <ShelfLink
                  label="重试同一书架操作"
                  disabled={v.busy}
                  onPress={() => run(() => tools.ops.retry())}
                />
              </>
            )}
          </View>
        </>
      ) : null}
    </View>
  );
}
export function ShelfControls({
  book,
  readable,
}: {
  book: string;
  readable: boolean;
}) {
  const { phase, generation, account } = useSession();
  const [sheet, setSheet] = useState(false);
  if (phase === "guest")
    return (
      <>
        <ShelfLink
          label="登录后加入书架并追更"
          onPress={() => setSheet(true)}
        />
        <AuthSheet
          visible={sheet}
          onClose={() => setSheet(false)}
          onComplete={() => setSheet(false)}
        />
      </>
    );
  if (phase !== "ready")
    return <Text style={s.note}>联网确认账号后可管理书架。</Text>;
  return (
    <SignedShelfControls
      key={generation + "/" + account?.id + "/" + book}
      book={book}
      readable={readable}
    />
  );
}
function SignedShelfControls({
  book,
  readable,
}: {
  book: string;
  readable: boolean;
}) {
  const tools = useShelfTools(),
    v = useShelfState(tools);
  const [state, setState] = useState<ShelfState>(),
    [error, setError] = useState<unknown>(),
    [loading, setLoading] = useState(true),
    [fresh, setFresh] = useState(false),
    [confirmed, setConfirmed] = useState(false);
  const sequence = useRef(0),
    activeRead = useRef<AbortController | null>(null);
  const reload = useCallback(
    async (signal: AbortSignal) => {
      if (!tools) return;
      activeRead.current?.abort();
      const controller = new AbortController(),
        n = ++sequence.current;
      const abort = () => controller.abort();
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) controller.abort();
      activeRead.current = controller;
      setLoading(true);
      setFresh(false);
      setError(undefined);
      try {
        const value = await tools.api.state(book, controller.signal);
        if (
          !controller.signal.aborted &&
          tools.current() &&
          n === sequence.current
        ) {
          setState(value);
          setFresh(true);
        }
      } catch (e) {
        if (
          !controller.signal.aborted &&
          tools.current() &&
          n === sequence.current
        )
          setError(e);
      } finally {
        signal.removeEventListener("abort", abort);
        if (n === sequence.current) {
          activeRead.current = null;
          if (tools.current()) setLoading(false);
        }
      }
    },
    [tools, book],
  );
  useShelfStartup(tools, reload);
  const disabled =
    !tools || !v.loaded || v.busy || !!v.record || loading || !fresh || !state;
  const start = (operation: ShelfWrite["operation"]) => {
    if (tools && state && !disabled)
      void tools.ops
        .start(book, {
          mutation_id: Crypto.randomUUID(),
          base_revision: state.revision,
          operation,
        })
        .then(() => settle())
        .catch(() => undefined);
  };
  const settle = async () => {
    if (!tools) return;
    setConfirmed(true);
    setFresh(false);
    activeRead.current?.abort();
    await tools.ops.clear();
    if (tools.current()) await reload(new AbortController().signal);
  };
  return (
    <View style={s.controls}>
      {tools ? <ShelfRecovery tools={tools} onSettled={settle} /> : null}
      {confirmed && !fresh ? (
        <Text style={s.note}>操作已确认，当前书架状态待重新读取。</Text>
      ) : null}
      {error ? (
        <>
          <Text accessibilityRole="alert" style={s.error}>
            {shelfMessage(error)}
          </Text>
          <ShelfLink
            label="重新读取书架状态"
            disabled={loading || v.busy}
            onPress={() => void reload(new AbortController().signal)}
          />
        </>
      ) : null}
      {!loading && !fresh && !error ? (
        <ShelfLink
          label="重新读取书架状态"
          disabled={v.busy}
          onPress={() => void reload(new AbortController().signal)}
        />
      ) : null}
      {loading ? <Text style={s.note}>正在读取书架状态</Text> : null}
      {state ? (
        <View style={s.actions}>
          {!state.in_shelf ? (
            <ShelfLink
              label="加入书架并追更"
              disabled={disabled || !readable}
              onPress={() => start("join")}
            />
          ) : (
            <>
              <Text style={s.note}>
                {state.following
                  ? "已加入书架 · 追更中"
                  : "已加入书架 · 已关闭追更"}
              </Text>
              <ShelfLink
                label={state.following ? "关闭追更" : "重新开启追更"}
                disabled={disabled || (!state.following && !readable)}
                onPress={() => start(state.following ? "unfollow" : "follow")}
              />
              <ShelfLink
                label="查看我的书架"
                onPress={() => router.push("/shelf")}
              />
            </>
          )}
        </View>
      ) : null}
      <Text style={s.note}>新章提醒尚未开放，当前先保存追更选择。</Text>
    </View>
  );
}
const s = StyleSheet.create({
  controls: { gap: 8, paddingTop: 8 },
  recovery: { gap: 8 },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  action: { minHeight: 44, paddingHorizontal: 8, justifyContent: "center" },
  link: { fontSize: 14, lineHeight: 22, color: t.brand },
  note: { fontSize: 12, lineHeight: 20, color: t.muted },
  error: { fontSize: 14, lineHeight: 22, color: t.danger },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
});
