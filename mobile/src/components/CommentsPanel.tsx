import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Crypto from "expo-crypto";
import { router } from "expo-router";
import { useSession } from "../auth/context";
import { ApiError, apiMessage, request } from "../api/client";
import {
  CommentsApi,
  type Comment,
  type CommentAction,
  type CommentPage,
} from "../api/comments";
import { CommentEditor } from "../comments/editor";
import { AuthSheet } from "./AuthSheet";
import { theme as t } from "../theme";

export function commentMessage(e: unknown) {
  const codes: Record<string, string> = {
    invalid_input: "内容需为 1～1000 字；账号或请求参数变化时请检查后重试。",
    nickname_required: "发表前请先设置笔名，当前文字仍保留。",
    reading_context_invalid: "阅读上下文已失效，请先复制文字，再重新打开作品。",
    version_unavailable: "当前阅读内容已受限，暂不能发表。",
    comment_conflict:
      "讨论已变化，可能已删除或屏蔽。请保留文字并重新选择回复对象。",
    resource_not_found: "作品或讨论暂不可用，当前输入仍保留。",
    rate_limited: "发表较频繁，请稍后再试。",
  };
  return e instanceof ApiError
    ? (codes[e.code] ?? apiMessage(e))
    : apiMessage(e);
}
export type CommentPanelApi = Pick<CommentsApi, "list" | "create" | "remove">;
export function useCommentsApi() {
  const { session } = useSession();
  return useMemo(
    () =>
      new CommentsApi((path, options) => {
        if (
          options?.method ||
          path.startsWith("/my/") ||
          session.snapshot().phase === "ready"
        )
          return session.authorized(path, options);
        return request(path, options);
      }),
    [session],
  );
}
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
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        (disabled || pressed) && { opacity: 0.45 },
      ]}
    >
      <Text style={s.link}>{label}</Text>
    </Pressable>
  );
}
function Rows({
  load,
  render,
}: {
  load: (cursor: number, signal?: AbortSignal) => Promise<CommentPage>;
  render: (item: Comment) => React.ReactElement;
}) {
  const [page, setPage] = useState<CommentPage>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [retry, setRetry] = useState(0);
  const alive = useRef(false),
    lock = useRef(false),
    controller = useRef<AbortController | null>(null);
  useEffect(() => {
    alive.current = true;
    const abort = new AbortController();
    controller.current = abort;
    lock.current = true;
    load(0, abort.signal)
      .then((value) => {
        if (!abort.signal.aborted) setPage(value);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e);
      })
      .finally(() => {
        if (!abort.signal.aborted) {
          lock.current = false;
          setBusy(false);
        }
      });
    return () => {
      alive.current = false;
      abort.abort();
      controller.current?.abort();
    };
  }, [load, retry]);
  const more = async () => {
    if (lock.current || !page?.next) return;
    lock.current = true;
    setBusy(true);
    setError(undefined);
    const abort = new AbortController();
    controller.current = abort;
    try {
      const next = await load(page.next, abort.signal);
      if (alive.current && !abort.signal.aborted)
        setPage((old) => ({
          items: [
            ...(old?.items ?? []),
            ...next.items.filter((x) => !old?.items.some((o) => o.id === x.id)),
          ],
          next: next.next,
        }));
    } catch (e) {
      if (alive.current && !abort.signal.aborted) setError(e);
    } finally {
      lock.current = false;
      if (alive.current && !abort.signal.aborted) setBusy(false);
    }
  };
  const refresh = () => {
    controller.current?.abort();
    setPage(undefined);
    setError(undefined);
    setRetry((x) => x + 1);
  };
  if (!page)
    return (
      <View style={s.notice}>
        {error ? (
          <>
            <Text style={s.error}>{commentMessage(error)}</Text>
            <Button label="重新加载评论" onPress={refresh} />
          </>
        ) : (
          <>
            <ActivityIndicator color={t.brand} />
            <Text style={s.muted}>正在读取评论</Text>
          </>
        )}
      </View>
    );
  return (
    <>
      <FlatList
        data={page.items}
        keyExtractor={(x) => x.id}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => render(item)}
        ListEmptyComponent={
          <Text style={s.empty}>还没有评论，读完说说你的想法。</Text>
        }
        ListFooterComponent={
          <View style={s.notice}>
            {error ? (
              <Text style={s.error}>{commentMessage(error)}</Text>
            ) : null}
            {busy ? (
              <ActivityIndicator color={t.brand} />
            ) : page.next ? (
              <Button
                label={error ? "重试加载更多" : "加载更多评论"}
                onPress={() => void more()}
              />
            ) : null}
          </View>
        }
      />
    </>
  );
}
function Replies({
  api,
  workId,
  root,
  render,
}: {
  api: CommentPanelApi;
  workId: string;
  root: string;
  render: (item: Comment) => React.ReactElement;
}) {
  const [page, setPage] = useState<CommentPage>(),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    [retry, setRetry] = useState(0);
  const lock = useRef(false),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const abort = new AbortController();
    api
      .list(workId, 0, root, abort.signal)
      .then((p) => {
        if (!abort.signal.aborted) setPage(p);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e);
      });
    return () => {
      alive.current = false;
      abort.abort();
    };
  }, [api, workId, root, retry]);
  const more = async () => {
    if (lock.current || !page?.next) return;
    lock.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const next = await api.list(workId, page.next, root);
      if (alive.current)
        setPage((old) => ({
          items: [
            ...(old?.items ?? []),
            ...next.items.filter((x) => !old?.items.some((o) => o.id === x.id)),
          ],
          next: next.next,
        }));
    } catch (e) {
      if (alive.current) setError(e);
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return (
    <View style={s.replies}>
      {page?.items.map((x) => (
        <View key={x.id}>{render(x)}</View>
      ))}
      {error ? (
        <>
          <Text style={s.error}>{commentMessage(error)}</Text>
          <Button
            label="重试回复"
            onPress={() => {
              if (page?.next) void more();
              else {
                setError(undefined);
                setRetry((x) => x + 1);
              }
            }}
          />
        </>
      ) : !page ? (
        <ActivityIndicator color={t.brand} />
      ) : null}
      {page && !page.items.length ? (
        <Text style={s.muted}>暂无可见回复</Text>
      ) : null}
      {page?.next ? (
        <Button
          label={busy ? "正在加载" : "更多回复"}
          disabled={busy}
          onPress={() => void more()}
        />
      ) : null}
    </View>
  );
}
function Thread({
  item,
  api,
  onReply,
  onDelete,
  disabled,
}: {
  item: Comment;
  api: CommentPanelApi;
  onReply: (item: Comment) => void;
  onDelete: (item: Comment) => void;
  disabled: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const row = (entry: Comment) => (
    <View style={s.row}>
      <Text style={s.author}>
        {entry.nickname || "未设置笔名"}
        {entry.root_id && entry.reply_to !== entry.root_id
          ? ` 回复 ${entry.reply_name || "已不可见的评论"}`
          : ""}
      </Text>
      <Text selectable style={s.body}>
        {entry.content}
      </Text>
      <View style={s.actions}>
        <Button
          label="回复"
          disabled={disabled}
          onPress={() => onReply(entry)}
        />
        {entry.can_delete ? (
          <Button
            label="删除"
            disabled={disabled}
            onPress={() => onDelete(entry)}
          />
        ) : null}
      </View>
    </View>
  );
  return (
    <View style={s.thread}>
      {row(item)}
      <Button
        label={expanded ? "收起回复" : "查看回复"}
        onPress={() => setExpanded(!expanded)}
      />
      {expanded ? (
        <Replies api={api} workId={item.work_id} root={item.id} render={row} />
      ) : null}
    </View>
  );
}
export function CommentsPanel({
  workId,
  context,
  visible,
  onClose,
  onDirtyChange,
  loadThread,
  api: suppliedApi,
}: {
  workId: string;
  context: string;
  visible: boolean;
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
  loadThread?: (signal?: AbortSignal) => Promise<CommentPage>;
  api?: CommentPanelApi;
}) {
  const { session, account, phase, generation } = useSession();
  const defaultApi = useCommentsApi();
  const api = suppliedApi ?? defaultApi;
  const [editor] = useState(() => {
    const value = new CommentEditor(Crypto.randomUUID);
    value.syncAccount(session.snapshot().account?.id ?? null);
    return value;
  });
  const [, redraw] = useReducer((x) => x + 1, 0),
    [auth, setAuth] = useState(false),
    [notice, setNotice] = useState(""),
    [refresh, setRefresh] = useState(0),
    [target, setTarget] = useState<Comment | null>(null),
    [removing, setRemoving] = useState(false),
    [hasDelete, setHasDelete] = useState(false),
    [nickname, setNickname] = useState(""),
    [savingName, setSavingName] = useState(false);
  const pendingDelete = useRef<{
      id: string;
      body: CommentAction;
      owner: string;
    } | null>(null),
    alive = useRef(false),
    input = useRef<React.ComponentRef<typeof TextInput>>(null),
    deleteLock = useRef(false);
  const notify = useCallback(() => {
    if (alive.current) {
      redraw();
      setHasDelete(!!pendingDelete.current);
      onDirtyChange(editor.snapshot().hasInput || !!pendingDelete.current);
    }
  }, [editor, onDirtyChange]);
  const changeDraft = (action: () => void) => {
    try {
      action();
      notify();
    } catch (e) {
      setNotice(commentMessage(e));
    }
  };
  useEffect(() => {
    alive.current = true;
    let last = session.snapshot().account?.id ?? null;
    const sync = () => {
      if (!alive.current) return;
      const next = session.snapshot().account?.id ?? null;
      editor.syncAccount(next);
      if (next !== last) {
        pendingDelete.current = null;
        setTarget(null);
        setNotice("");
        setNickname("");
      }
      last = next;
      notify();
    };
    const unsubscribe = session.subscribe(sync);
    // Reconcile any session change between the first render and subscription.
    queueMicrotask(sync);
    return () => {
      alive.current = false;
      unsubscribe();
      queueMicrotask(() => {
        if (!alive.current) editor.dispose();
      });
    };
  }, [session, editor, notify]);
  const state = editor.snapshot(),
    viewer = account?.id ?? "guest";
  const load = useCallback(
    (cursor: number, signal?: AbortSignal) =>
      loadThread
        ? loadThread(signal)
        : api.list(workId, cursor, undefined, signal),
    [api, workId, loadThread],
  );
  const publish = async () => {
    setNotice("");
    try {
      const operation = editor.submit(context, (body) =>
        api.create(workId, body),
      );
      notify();
      const result = await operation;
      if (alive.current) {
        setNotice(
          result.state === "published"
            ? "评论已发表。"
            : "原发表已确认；该评论现已删除或被屏蔽。",
        );
        setTarget(null);
        setRefresh((x) => x + 1);
      }
    } catch (e) {
      if (alive.current) setNotice(commentMessage(e));
    } finally {
      notify();
    }
  };
  const remove = async () => {
    const pending = pendingDelete.current;
    if (!pending || deleteLock.current) return;
    if (session.snapshot().account?.id !== pending.owner) {
      pendingDelete.current = null;
      return;
    }
    deleteLock.current = true;
    setRemoving(true);
    setNotice("");
    try {
      await api.remove(pending.id, pending.body);
      if (alive.current && pendingDelete.current === pending) {
        pendingDelete.current = null;
        setNotice("评论已删除。");
        setRefresh((x) => x + 1);
      }
    } catch (e) {
      if (alive.current && pendingDelete.current === pending) {
        if (e instanceof ApiError && e.status >= 400 && e.status < 500)
          pendingDelete.current = null;
        setNotice(commentMessage(e));
      }
    } finally {
      deleteLock.current = false;
      if (alive.current) setRemoving(false);
      notify();
    }
  };
  const chooseDelete = (item: Comment) => {
    if (!account || pendingDelete.current) return;
    Alert.alert(
      "删除评论",
      item.root_id
        ? "删除这条回复？"
        : "主评论和全部回复将一起删除，无法恢复。",
      [
        { text: "取消", style: "cancel" },
        {
          text: "删除",
          style: "destructive",
          onPress: () => {
            if (session.snapshot().account?.id !== account.id) return;
            pendingDelete.current = {
              id: item.id,
              owner: account.id,
              body: {
                mutation_id: Crypto.randomUUID(),
                expected_account_id: account.id,
                expected_revision: item.revision,
                action: "delete",
                reason: "",
              },
            };
            notify();
            void remove();
          },
        },
      ],
    );
  };
  const chooseReply = (item: Comment) => {
    try {
      editor.replyTo(item.id);
      setTarget(item);
      notify();
      input.current?.focus();
    } catch (e) {
      setNotice(commentMessage(e));
    }
  };
  const saveName = async () => {
    if (savingName) return;
    setSavingName(true);
    try {
      await session.setNickname(nickname);
      if (alive.current) setNickname("");
    } catch (e) {
      if (alive.current) setNotice(commentMessage(e));
    } finally {
      if (alive.current) setSavingName(false);
    }
  };
  return (
    <>
      <Modal
        visible={visible && !auth}
        animationType="slide"
        onRequestClose={onClose}
      >
        <SafeAreaView style={s.screen}>
          <View style={s.header}>
            <Button label="收起评论" onPress={onClose} />
            <Text style={s.heading}>评论</Text>
            <Button label="刷新" onPress={() => setRefresh((x) => x + 1)} />
          </View>
          <KeyboardAvoidingView
            style={s.flex}
            behavior={Platform.OS === "ios" ? "padding" : "height"}
          >
            <View style={s.flex}>
              <Rows
                key={`${viewer}:${generation}:${refresh}`}
                load={load}
                render={(item) => (
                  <Thread
                    item={item}
                    api={api}
                    onReply={chooseReply}
                    onDelete={chooseDelete}
                    disabled={
                      state.busy ||
                      state.unconfirmed ||
                      removing ||
                      hasDelete ||
                      state.locked ||
                      !!state.prompt
                    }
                  />
                )}
              />
            </View>
            <View style={s.editor}>
              {notice ? (
                <Text accessibilityLiveRegion="polite" style={s.noticeText}>
                  {notice}
                </Text>
              ) : null}
              {phase === "ready" && account && !account.nickname ? (
                <View>
                  <Text style={s.muted}>
                    发表前请先设置笔名，当前文字不会丢失。
                  </Text>
                  <TextInput
                    accessibilityLabel="评论笔名"
                    value={nickname}
                    editable={!savingName}
                    onChangeText={setNickname}
                    maxLength={64}
                    placeholder="读者将看到这个名字"
                    style={s.input}
                  />
                  <Button
                    label={savingName ? "正在保存" : "保存笔名"}
                    disabled={savingName || !nickname.trim()}
                    onPress={() => void saveName()}
                  />
                </View>
              ) : null}
              {hasDelete ? (
                <Button
                  label={removing ? "正在删除" : "检查原删除操作"}
                  disabled={removing}
                  onPress={() => void remove()}
                />
              ) : null}
              {state.prompt ? (
                <>
                  <Text style={s.body}>
                    {state.prompt === "guest"
                      ? "将刚才的游客文字带入当前账号？"
                      : "恢复本账号在当前页面的未发表文字？"}
                  </Text>
                  <View style={s.actions}>
                    <Button
                      label="保留文字"
                      onPress={() => {
                        changeDraft(() => editor.confirmInput(true));
                      }}
                    />
                    <Button
                      label="丢弃文字"
                      onPress={() => {
                        changeDraft(() => {
                          editor.confirmInput(false);
                          setTarget(null);
                        });
                      }}
                    />
                  </View>
                </>
              ) : null}
              {target && !state.locked && !state.prompt ? (
                <View style={s.actions}>
                  <Text style={s.muted}>回复 {target.nickname}</Text>
                  <Button
                    label="取消回复"
                    disabled={state.unconfirmed || state.busy}
                    onPress={() => {
                      changeDraft(() => {
                        editor.replyTo(null);
                        setTarget(null);
                      });
                    }}
                  />
                </View>
              ) : null}
              <TextInput
                ref={input}
                accessibilityLabel="评论正文"
                multiline
                value={state.text}
                editable={
                  !state.busy &&
                  !state.unconfirmed &&
                  !state.locked &&
                  !state.prompt
                }
                onChangeText={(text) => {
                  changeDraft(() => editor.edit(text));
                }}
                placeholder="说点友好的…"
                style={s.input}
              />
              <View style={s.actions}>
                <Text style={s.muted}>
                  {Array.from(state.text.trim()).length} / 1000
                </Text>
                {phase !== "ready" || state.locked ? (
                  <Button label="登录后发表" onPress={() => setAuth(true)} />
                ) : state.prompt ? null : (
                  <Button
                    label={
                      state.busy
                        ? "正在提交"
                        : state.unconfirmed
                          ? "检查原发表"
                          : "发表"
                    }
                    disabled={
                      state.busy ||
                      !context ||
                      (!state.unconfirmed &&
                        (!state.text.trim() ||
                          Array.from(state.text.trim()).length > 1000))
                    }
                    onPress={() => void publish()}
                  />
                )}
              </View>
              <Text style={s.note}>
                未发表文字仅在当前页面内存中保留，关闭 App 不恢复。
              </Text>
              <Button
                label="我的评论与处置原因"
                onPress={() => {
                  onClose();
                  router.push("/my-comments");
                }}
              />
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
      <AuthSheet
        visible={auth}
        onClose={() => setAuth(false)}
        onComplete={() => setAuth(false)}
      />
    </>
  );
}
export const commentStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "white" },
  flex: { flex: 1 },
  header: {
    height: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: t.line,
  },
  heading: { fontSize: 16, fontWeight: "600", color: t.ink },
  thread: { paddingHorizontal: 16, paddingVertical: 16 },
  row: { paddingTop: 8 },
  author: { fontSize: 14, lineHeight: 22, fontWeight: "600", color: t.ink },
  body: { fontSize: 14, lineHeight: 22, color: t.ink, marginTop: 8 },
  muted: { fontSize: 12, lineHeight: 20, color: t.muted },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    flexWrap: "wrap",
  },
  button: { minHeight: 44, justifyContent: "center", paddingHorizontal: 8 },
  link: { fontSize: 13, color: t.brand },
  replies: { marginLeft: 16 },
  notice: { padding: 16, gap: 8, alignItems: "center" },
  error: { fontSize: 13, lineHeight: 20, color: t.danger },
  empty: { padding: 24, fontSize: 14, lineHeight: 22, color: t.muted },
  editor: {
    paddingHorizontal: 16,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: t.line,
  },
  input: {
    minHeight: 64,
    maxHeight: 120,
    padding: 12,
    fontSize: 14,
    lineHeight: 22,
    color: t.ink,
    backgroundColor: t.background,
    borderRadius: 8,
    textAlignVertical: "top",
  },
  noticeText: {
    fontSize: 13,
    lineHeight: 20,
    color: t.secondary,
    marginBottom: 8,
  },
  note: { fontSize: 11, lineHeight: 18, color: t.muted },
});
const s = commentStyles;

export function MyCommentList() {
  const api = useCommentsApi();
  const { account, generation } = useSession();
  const load = useCallback(
    (cursor: number, signal?: AbortSignal) => api.mine(cursor, signal),
    [api],
  );
  return (
    <View style={s.flex}>
      {account ? (
        <Rows
          key={`${account.id}:${generation}`}
          load={load}
          render={(item) => (
            <View style={s.thread}>
              <Text style={s.author}>
                {item.deleted
                  ? "已删除"
                  : item.blocked
                    ? "被平台屏蔽"
                    : "已发表"}
              </Text>
              <Text selectable style={s.body}>
                {item.content || "正文已移除"}
              </Text>
              {item.reason ? (
                <Text selectable style={s.noticeText}>
                  处置原因：{item.reason}
                </Text>
              ) : null}
              <Text style={s.muted}>
                {new Date(item.created_at).toLocaleString("zh-CN")}
              </Text>
              <Button
                label="打开所属作品"
                onPress={() =>
                  router.push({
                    pathname: "/works/[id]",
                    params: { id: item.work_id },
                  })
                }
              />
            </View>
          )}
        />
      ) : (
        <Text style={s.empty}>请到“我的”登录后查看本人评论及处置原因。</Text>
      )}
    </View>
  );
}
