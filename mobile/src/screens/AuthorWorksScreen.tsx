import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router, useFocusEffect, usePreventRemove } from "expo-router";
import { randomUUID } from "expo-crypto";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSession } from "../auth/context";
import {
  AuthorWorksApi,
  WorkAction,
  authorWorkMessage,
  type AuthorTimeline,
  type WorkChange,
  type WorkPage,
} from "../api/author-works";
import type { PublicWork } from "../api/reader";
import { Action, Status } from "../components/Ui";
import { theme as t } from "../theme";

function Button({
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
        s.button,
        disabled && s.disabled,
        pressed && s.pressed,
      ]}
    >
      <Text style={s.link}>{label}</Text>
    </Pressable>
  );
}
export default function AuthorWorksScreen() {
  const { generation, account, phase, session } = useSession();
  if (phase !== "ready" || !account)
    return (
      <SafeAreaView style={s.screen}>
        <Status
          loading={phase === "loading"}
          title={phase === "offline" ? "连接后确认账号" : "登录后管理本人作品"}
          message="私密作品仅向当前登录账号开放。"
          actionLabel={phase === "offline" ? "重试确认账号" : "返回我的"}
          onRetry={() =>
            phase === "offline"
              ? void session.restore()
              : router.replace("/account")
          }
        />
      </SafeAreaView>
    );
  return (
    <Workspace
      key={generation}
      generation={generation}
      accountId={account.id}
    />
  );
}
function Workspace({
  generation,
  accountId,
}: {
  generation: number;
  accountId: string;
}) {
  const { session } = useSession();
  const api = useMemo(
    () =>
      new AuthorWorksApi((path, options) => session.authorized(path, options)),
    [session],
  );
  const [page, setPage] = useState<WorkPage>({ items: [], next_cursor: "" });
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState<unknown>();
  const alive = useRef(true),
    fetching = useRef(false);
  const valid = useCallback(
    () =>
      alive.current &&
      session.snapshot().generation === generation &&
      session.snapshot().account?.id === accountId,
    [session, generation, accountId],
  );
  const load = useCallback(
    async (cursor = "") => {
      if (fetching.current) return;
      fetching.current = true;
      setBusy(true);
      setError(undefined);
      try {
        const result = await api.list(cursor);
        if (valid()) {
          setPage((old) => ({
            items: cursor
              ? [
                  ...old.items,
                  ...result.items.filter(
                    (x) => !old.items.some((y) => y.id === x.id),
                  ),
                ]
              : result.items,
            next_cursor: result.next_cursor,
          }));
          setLoaded(true);
        }
      } catch (e) {
        if (valid()) setError(e);
      } finally {
        fetching.current = false;
        if (valid()) setBusy(false);
      }
    },
    [api, valid],
  );
  useFocusEffect(
    useCallback(() => {
      alive.current = true;
      void load();
      return () => {
        alive.current = false;
      };
    }, [load]),
  );
  return (
    <SafeAreaView style={s.screen}>
      {selected ? (
        <WorkDetail
          key={selected}
          id={selected}
          api={api}
          valid={valid}
          onClose={() => {
            setSelected("");
            void load();
          }}
        />
      ) : (
        <>
          <View style={s.header}>
            <Button
              label="返回我的"
              onPress={() => router.dismissTo("/account")}
            />
            <Text style={s.heading}>作品管理</Text>
            <Button
              label="刷新作品"
              onPress={() => void load()}
              disabled={busy}
            />
          </View>
          <ScrollView contentContainerStyle={s.content}>
            <Action
              label="发布服务器已保存稿件"
              onPress={() => router.push("/publish")}
            />
            <Text style={s.note}>
              这里管理已正式发布的中篇。编辑工作稿请使用草稿箱。
            </Text>
            {!page.items.length ? (
              busy ? (
                <Status loading title="正在读取本人作品" />
              ) : error ? (
                <Status
                  title="作品未能加载"
                  message={authorWorkMessage(error)}
                  onRetry={() => void load()}
                />
              ) : loaded ? (
                <Status
                  title="还没有正式作品"
                  message="已保存的私密草稿不会自动公开。"
                />
              ) : null
            ) : (
              page.items.map((item) => (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  accessibilityLabel={`管理作品 ${item.title}`}
                  onPress={() => setSelected(item.id)}
                  style={({ pressed }) => [s.row, pressed && s.pressed]}
                >
                  <Text style={s.workTitle}>{item.title}</Text>
                  <Text style={s.meta}>
                    展示 V{item.display_version} · 最新 V{item.last_version} ·{" "}
                    {item.author_hidden ? "作者已隐藏" : "作者未隐藏"}
                    {item.platform_limited ? " · 平台限制" : ""}
                  </Text>
                </Pressable>
              ))
            )}
            {page.items.length > 0 && error ? (
              <Text style={s.error}>{authorWorkMessage(error)}</Text>
            ) : null}
            {busy ? (
              <ActivityIndicator color={t.brand} />
            ) : page.next_cursor ? (
              <Button
                label={error ? "重试加载更多作品" : "加载更多作品"}
                onPress={() => void load(page.next_cursor)}
              />
            ) : null}
          </ScrollView>
        </>
      )}
    </SafeAreaView>
  );
}
const eventNames: Record<string, string> = {
  hidden: "隐藏作品",
  restored: "恢复公开",
  display_changed: "切换展示",
  history_opened: "开放历史正文",
  history_closed: "关闭历史正文",
};
function WorkDetail({
  id,
  api,
  valid,
  onClose,
}: {
  id: string;
  api: AuthorWorksApi;
  valid: () => boolean;
  onClose: () => void;
}) {
  const [data, setData] = useState<AuthorTimeline | null>(null),
    [body, setBody] = useState<PublicWork | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [notice, setNotice] = useState("");
  const [confirmation, setConfirmation] = useState<Readonly<WorkChange> | null>(
      null,
    ),
    [pending, setPending] = useState(false);
  const mounted = useRef(true),
    lock = useRef(false);
  const confirmedAction = useRef(false);
  const [stateReadFailed, setStateReadFailed] = useState(false);
  const operation = useMemo(
    () => new WorkAction(id, valid, randomUUID),
    [id, valid],
  );
  const current = useCallback(() => mounted.current && valid(), [valid]);
  const reload = useCallback(async () => {
    const result = await api.timeline(id);
    if (current()) {
      setData(result);
      setBody(null);
      setStateReadFailed(false);
      if (confirmedAction.current)
        setNotice("操作已确认，当前状态已重新读取。工作稿未修改。");
    }
  }, [api, id, current]);
  const read = useCallback(async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await reload();
    } catch (e) {
      if (current()) {
        setError(e);
        setStateReadFailed(confirmedAction.current);
      }
    } finally {
      lock.current = false;
      if (current()) setBusy(false);
    }
  }, [reload, current]);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  useFocusEffect(
    useCallback(() => {
      mounted.current = true;
      void read();
      return () => {
        mounted.current = false;
      };
    }, [read]),
  );
  usePreventRemove(pending, ({ repeat }) => {
    Alert.alert(
      "操作结果尚未确认",
      "离开后不保留重试标识。再次进入会读取服务器现状，不会自动补发。",
      [
        { text: "继续检查", style: "cancel" },
        { text: "离开并重新读取", onPress: repeat },
      ],
    );
  });
  const close = () =>
    pending
      ? Alert.alert(
          "操作结果尚未确认",
          "返回列表后不保留重试标识。再次进入会读取服务器现状。",
          [
            { text: "继续检查", style: "cancel" },
            { text: "返回列表", onPress: onClose },
          ],
        )
      : onClose();
  const propose = (
    action: WorkChange["action"],
    version?: number,
    history?: boolean,
  ) => {
    if (!data || busy || pending) return;
    try {
      setConfirmation(operation.prepare(data.state, action, version, history));
      setError(undefined);
    } catch (e) {
      setError(e);
    }
  };
  const execute = async () => {
    const request = operation.pending ?? confirmation;
    if (!request || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(undefined);
    setNotice("");
    confirmedAction.current = false;
    setStateReadFailed(false);
    setConfirmation(null);
    setPending(true);
    try {
      await operation.send(request, api);
      if (!current()) return;
      confirmedAction.current = true;
      setPending(false);
      setData(null);
      setBody(null);
      setNotice("操作已确认，正在读取当前状态。工作稿未修改。");
      await reload();
      if (current())
        setNotice("操作已确认，当前状态已重新读取。工作稿未修改。");
    } catch (e) {
      if (!current()) return;
      setPending(Boolean(operation.pending));
      setError(e);
      setStateReadFailed(confirmedAction.current);
      if (!operation.pending) {
        setData(null);
        setBody(null);
      }
    } finally {
      lock.current = false;
      if (current()) setBusy(false);
    }
  };
  const more = async (kind: "versions" | "events") => {
    if (!data || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const result = await api.timeline(
        id,
        kind === "versions" ? data.next_version_before : 0,
        kind === "events" ? data.next_event_before : 0,
      );
      if (!current()) return;
      if (result.state.state_revision !== data.state.state_revision) {
        await reload();
        setNotice("分页期间状态已变化，已重新读取，请重新确认操作。");
        return;
      }
      if (kind === "versions")
        setData({
          ...data,
          versions: [
            ...data.versions,
            ...result.versions.filter(
              (x) => !data.versions.some((y) => y.version === x.version),
            ),
          ],
          next_version_before: result.next_version_before,
        });
      else
        setData({
          ...data,
          events: [
            ...data.events,
            ...result.events.filter(
              (x) => !data.events.some((y) => y.sequence === x.sequence),
            ),
          ],
          next_event_before: result.next_event_before,
        });
    } catch (e) {
      if (current()) setError(e);
    } finally {
      lock.current = false;
      if (current()) setBusy(false);
    }
  };
  const preview = async (version: number) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const result = await api.version(id, version);
      if (current()) setBody(result);
    } catch (e) {
      if (current()) setError(e);
    } finally {
      lock.current = false;
      if (current()) setBusy(false);
    }
  };
  const state = data?.state,
    disabled = busy || pending || !!confirmation;
  const latest = data?.versions.find((x) => x.version === state?.last_version);
  return (
    <>
      <View style={s.header}>
        <Button label="返回作品列表" onPress={close} disabled={busy} />
        <Text style={s.heading}>管理作品</Text>
        <Button
          label="刷新状态"
          onPress={() => void read()}
          disabled={disabled}
        />
      </View>
      <ScrollView contentContainerStyle={s.content}>
        {notice ? (
          <Text accessibilityLiveRegion="polite" style={s.note}>
            {notice}
          </Text>
        ) : null}
        {error ? (
          <Text accessibilityLiveRegion="polite" style={s.error}>
            {stateReadFailed
              ? "操作已确认，暂时无法读取作品当前状态，请重试读取。"
              : authorWorkMessage(error)}
          </Text>
        ) : null}
        {pending ? (
          <View style={s.panel}>
            <Text style={s.note}>
              原操作结果未确认，请保持页面。只会检查原请求。
            </Text>
            <Action
              label="检查原管理操作"
              disabled={busy}
              onPress={() => void execute()}
            />
          </View>
        ) : null}
        {!data ? (
          busy ? (
            <Status loading title="正在读取作品状态" />
          ) : (
            <Status
              title="需读取当前作品状态"
              message="读取成功后才能管理作品。"
              onRetry={() => void read()}
            />
          )
        ) : (
          <>
            <Text style={s.workTitle}>
              {state?.author_hidden ? "作者已隐藏" : "作者未隐藏"}
              {state?.platform_limited ? " · 平台限制" : ""}
            </Text>
            <Text style={s.meta}>
              展示 V{state?.display_version} · 最新 V{state?.last_version} ·
              历史正文{state?.history_open ? "开放" : "关闭"}
            </Text>
            <Text style={s.note}>
              平台限制优先于作者设置。作品管理不更改私密工作稿。
            </Text>
            {!state?.author_hidden && !state?.platform_limited ? (
              <Button
                label="查看读者当前展示"
                disabled={disabled || !!error || stateReadFailed}
                onPress={() =>
                  router.push({ pathname: "/works/[id]", params: { id } })
                }
              />
            ) : null}
            {state?.author_hidden ? (
              <>
                <Button
                  label={`恢复公开并展示最新 V${state.last_version}`}
                  disabled={
                    disabled ||
                    state.platform_limited ||
                    !latest ||
                    latest.platform_limited
                  }
                  onPress={() => propose("restore")}
                />
                {latest?.platform_limited ? (
                  <Text style={s.error}>
                    最新版受限，请在下方明确选择正常旧版恢复。
                  </Text>
                ) : null}
              </>
            ) : (
              <Button
                label="隐藏作品"
                disabled={disabled}
                onPress={() => propose("hide")}
              />
            )}
            <Button
              label={state?.history_open ? "关闭历史正文" : "开放历史正文"}
              disabled={disabled}
              onPress={() =>
                propose("set_history", undefined, !state?.history_open)
              }
            />
            {confirmation ? (
              <View accessibilityRole="alert" style={s.panel}>
                <Text style={s.heading}>
                  确认
                  {confirmation.action === "hide"
                    ? "隐藏作品"
                    : confirmation.action === "restore"
                      ? "恢复公开"
                      : confirmation.action === "switch_display"
                        ? "切换展示"
                        : "修改历史权限"}
                </Text>
                <Text style={s.note}>
                  {confirmation.action === "hide"
                    ? "隐藏后读者不能新访问作品或互动。"
                    : confirmation.action === "set_history"
                      ? confirmation.history_open
                        ? "全部正常正式历史版本将可被读者阅读。"
                        : "读者仅可读取当前展示版本正文。"
                      : `将${confirmation.action === "restore" ? "恢复公开并" : ""}展示 V${confirmation.version ?? state?.last_version}；历史正文${state?.history_open ? "开放" : "关闭"}。`}
                </Text>
                <Action
                  label="执行管理操作"
                  disabled={busy}
                  onPress={() => void execute()}
                />
                <Button
                  label="取消操作"
                  disabled={busy}
                  onPress={() => setConfirmation(null)}
                />
              </View>
            ) : null}
            <Text style={s.section}>正式版本</Text>
            {data.versions.map((v) => (
              <View key={v.version} style={s.row}>
                <Text style={s.workTitle}>
                  V{v.version} · {v.title}
                </Text>
                <Text style={s.meta}>
                  {v.platform_limited ? "平台已限制" : "正常版本"}
                  {v.version === state?.display_version
                    ? " · 当前展示"
                    : ""} · {v.published_at}
                </Text>
                <Button
                  label={`查看本人 V${v.version} 正文`}
                  disabled={busy}
                  onPress={() => void preview(v.version)}
                />
                {!v.platform_limited &&
                !state?.platform_limited &&
                (!state?.author_hidden ||
                  (latest?.platform_limited &&
                    v.version !== state.last_version)) ? (
                  <Button
                    label={
                      state?.author_hidden
                        ? `选择 V${v.version} 恢复公开`
                        : `展示 V${v.version}`
                    }
                    disabled={
                      disabled ||
                      (!state?.author_hidden &&
                        v.version === state?.display_version)
                    }
                    onPress={() =>
                      propose(
                        state?.author_hidden ? "restore" : "switch_display",
                        v.version,
                      )
                    }
                  />
                ) : null}
              </View>
            ))}
            {data.next_version_before ? (
              <Button
                label="加载更多正式版本"
                disabled={disabled}
                onPress={() => void more("versions")}
              />
            ) : null}
            {body ? (
              <View style={s.panel}>
                <Text style={s.workTitle}>
                  本人版本 V{body.version} · {body.title}
                </Text>
                <Text style={s.note}>
                  此处为本人管理读取，不代表读者可访问。
                </Text>
                <Text selectable style={s.body}>
                  {body.content}
                </Text>
                <Button label="收起本人正文" onPress={() => setBody(null)} />
              </View>
            ) : null}
            <Text style={s.section}>管理记录</Text>
            {data.events.length ? (
              data.events.map((e) => (
                <Text key={e.sequence} style={s.meta}>
                  {eventNames[e.kind]} · V{e.version} · {e.created_at}
                </Text>
              ))
            ) : (
              <Text style={s.note}>暂无管理记录。</Text>
            )}
            {data.next_event_before ? (
              <Button
                label="加载更多管理记录"
                disabled={disabled}
                onPress={() => void more("events")}
              />
            ) : null}
          </>
        )}
        {busy ? <ActivityIndicator color={t.brand} /> : null}
        <Text style={s.note}>
          管理操作仅在当前页面保留；关闭后不会自动补发。
        </Text>
      </ScrollView>
    </>
  );
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: t.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 56,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: t.line,
  },
  heading: { fontSize: 16, fontWeight: "600", color: t.ink },
  content: { padding: 16, gap: 16, paddingBottom: 32 },
  row: {
    paddingVertical: 16,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: t.line,
  },
  workTitle: { fontSize: 16, fontWeight: "600", lineHeight: 24, color: t.ink },
  meta: { fontSize: 12, lineHeight: 20, color: t.muted },
  note: { fontSize: 14, lineHeight: 22, color: t.secondary },
  error: { fontSize: 14, lineHeight: 22, color: t.danger },
  link: { fontSize: 14, color: t.brand },
  button: {
    minHeight: 44,
    padding: 8,
    justifyContent: "center",
    alignItems: "flex-start",
  },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
  panel: {
    padding: 16,
    gap: 16,
    backgroundColor: t.background,
    borderRadius: 8,
  },
  section: { fontSize: 16, fontWeight: "600", color: t.ink, marginTop: 16 },
  body: { fontSize: 16, lineHeight: 28, color: t.ink },
});
