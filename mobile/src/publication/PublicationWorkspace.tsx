import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { router, useFocusEffect, usePreventRemove } from "expo-router";
import { randomUUID } from "expo-crypto";
import { useSession } from "../auth/context";
import {
  PublicationsApi,
  publicationTags,
  publicationMessage,
  type DraftPage,
} from "../api/publications";
import type { WorkState } from "../api/author-works";
import { PublicationFlow, type JournalStore } from "./flow";
import { Action, Status } from "../components/Ui";
import { theme as t } from "../theme";
import { ApiError } from "../api/client";
export function PublicationWorkspace({
  store,
  accountId,
  generation,
  draftId = "",
  revision = 0,
}: {
  store: JournalStore;
  accountId: string;
  generation: number;
  draftId?: string;
  revision?: number;
}) {
  const { session, account } = useSession();
  const api = useMemo(
    () =>
      new PublicationsApi((path, options) => session.authorized(path, options)),
    [session],
  );
  const valid = useCallback(
    () =>
      session.snapshot().generation === generation &&
      session.snapshot().account?.id === accountId,
    [session, generation, accountId],
  );
  const flow = useMemo(
    () => new PublicationFlow(api, store, accountId, valid, randomUUID),
    [api, store, accountId, valid],
  );
  const mounted = useRef(false),
    lock = useRef(false),
    initialized = useRef(false);
  const [page, setPage] = useState<DraftPage>({ items: [], next_cursor: "" });
  const [source, setSource] = useState<{
    id: string;
    revision: number;
    title: string;
    current: number;
  } | null>(null);
  const [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  const [intro, setIntro] = useState(""),
    [tags, setTags] = useState<string[]>([]),
    [rights, setRights] = useState(false),
    [nickname, setNickname] = useState("");
  const [tick, render] = useState(0),
    [currentState, setCurrentState] = useState<WorkState | null>(null),
    [stateReadFailed, setStateReadFailed] = useState(false);
  void tick;
  const current = useCallback(() => mounted.current && valid(), [valid]);
  const refreshState = useCallback(async () => {
    if (current()) {
      setCurrentState(null);
      setStateReadFailed(false);
    }
    if (!flow.result || !flow.preview) return;
    try {
      const value = await api.state(flow.result.work_id, flow.preview.draft_id);
      if (current()) setCurrentState(value);
    } catch {
      // A current-state GET cannot undo the confirmed publication receipt.
      if (current()) setStateReadFailed(true);
    }
  }, [api, flow, current]);
  const initialize = useCallback(async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await flow.restore();
      if (!current()) return;
      if (flow.preview) {
        render((x) => x + 1);
        setReady(true);
        await refreshState();
      } else if (draftId) {
        const value = await api.source(draftId);
        if (revision > value.revision)
          throw new ApiError("source_revision_unavailable");
        if (current()) {
          setSource({
            id: value.id,
            revision: revision || value.revision,
            title: value.title,
            current: value.revision,
          });
          setReady(true);
        }
      } else {
        const value = await api.drafts();
        if (current()) {
          setPage(value);
          setReady(true);
        }
      }
      initialized.current = true;
    } catch (e) {
      if (current()) setError(e);
    } finally {
      lock.current = false;
      if (current()) {
        setBusy(false);
        render((x) => x + 1);
      }
    }
  }, [flow, current, draftId, revision, api, refreshState]);
  useFocusEffect(
    useCallback(() => {
      mounted.current = true;
      if (!initialized.current) void initialize();
      return () => {
        mounted.current = false;
      };
    }, [initialize]),
  );
  const run = async (action: () => Promise<unknown>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (e) {
      if (current()) setError(e);
    } finally {
      lock.current = false;
      if (current()) {
        setBusy(false);
        render((x) => x + 1);
      }
    }
  };
  const choose = (id: string, savedRevision: number) =>
    void run(async () => {
      const value = await api.source(id);
      if (current()) {
        setSource({
          id,
          revision: savedRevision,
          current: value.revision,
          title: value.title,
        });
        setIntro("");
        setTags([]);
        setRights(false);
      }
    });
  const more = () =>
    void run(async () => {
      const value = await api.drafts(page.next_cursor);
      if (current())
        setPage((old) => ({
          items: [
            ...old.items,
            ...value.items.filter((x) => !old.items.some((y) => y.id === x.id)),
          ],
          next_cursor: value.next_cursor,
        }));
    });
  const prepare = () =>
    source &&
    void run(async () => {
      await flow.prepare(source.id, source.revision, intro, tags, rights);
      if (current()) {
        render((x) => x + 1);
        await refreshState();
      }
    });
  const publish = () =>
    void run(async () => {
      await flow.publish();
      if (current()) {
        render((x) => x + 1);
        await refreshState();
      }
    });
  const reset = () =>
    void run(async () => {
      await flow.reset();
      if (current()) {
        setSource(null);
        setCurrentState(null);
        setStateReadFailed(false);
        setIntro("");
        setTags([]);
        setRights(false);
        const value = await api.drafts();
        if (current()) setPage(value);
      }
    });
  const pending =
    !!flow.pendingPrepare || (!!flow.pendingPublish && !flow.result);
  const dirty =
    pending ||
    (!flow.result && (!!flow.preview || !!intro || !!tags.length || rights));
  usePreventRemove(dirty, ({ repeat }) =>
    Alert.alert(
      "离开发布页？",
      "尚未提交的表单只在当前页面保留。已发出的请求不会被取消；不会自动发布。",
      [
        { text: "继续检查", style: "cancel" },
        { text: "离开", onPress: repeat },
      ],
    ),
  );
  const back = () =>
    router.canGoBack() ? router.back() : router.replace("/my-works");
  const frozen = busy || pending || !!flow.preview;
  const targetId = source?.id || draftId;
  const targetRevision = source?.revision || revision;
  return (
    <>
      <View style={s.header}>
        <Pressable accessibilityRole="button" onPress={back} style={s.button}>
          <Text style={s.link}>返回</Text>
        </Pressable>
        <Text style={s.heading}>发布中篇</Text>
        <View style={s.button} />
      </View>
      <ScrollView
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={s.note}>
          仅发布服务器已确认的修订；本机尚未同步的文字不会自动包含。准备预览不会公开，正式发布需再次点击。
        </Text>
        {error ? (
          <Text accessibilityLiveRegion="polite" style={s.error}>
            {publicationMessage(error)}
          </Text>
        ) : null}
        {!flow.recoveryBlocked &&
        flow.preview &&
        targetId &&
        (flow.preview.draft_id !== targetId ||
          flow.preview.source_revision !== targetRevision) ? (
          <Text accessibilityLiveRegion="polite" style={s.note}>
            当前显示的是先前发布记录的固定快照，不是本次传入的稿件或修订。请先核对原结果；不会自动发布本次稿件。
          </Text>
        ) : null}
        {ready ? (
          <Action
            label="读取已保留的发布记录"
            disabled={busy || !!flow.pendingPrepare}
            onPress={() =>
              void run(async () => {
                await flow.restore();
                if (current()) {
                  render((x) => x + 1);
                  await refreshState();
                }
              })
            }
          />
        ) : null}
        {!ready || flow.recoveryBlocked ? (
          <Status
            loading={busy}
            title="确认本人稿件与发布记录"
            message={
              flow.recoveryBlocked
                ? "请先读取原发布记录；结果未确认前不能开始或清除其他发布。"
                : undefined
            }
            onRetry={() => void initialize()}
          />
        ) : flow.result ? (
          <>
            <Text style={s.heading}>已确认正式版本 V{flow.result.version}</Text>
            <Text style={s.note}>
              这是本次发布确认，不代表作品目前公开，也不代表平台审核通过。
            </Text>
            {stateReadFailed ? (
              <Text accessibilityLiveRegion="polite" style={s.error}>
                发布已确认，暂时无法读取作品当前状态，请重试读取。
              </Text>
            ) : null}
            {currentState ? (
              <Text style={s.note}>
                当前展示 V{currentState.display_version} ·{" "}
                {currentState.author_hidden ? "作者仍隐藏作品" : "作者未隐藏"}
                {currentState.platform_limited ? " · 平台限制" : ""}
              </Text>
            ) : (
              <Action
                label="重新读取作品现状"
                disabled={busy}
                onPress={() => void run(refreshState)}
              />
            )}
            <Action
              label="进入作品管理"
              onPress={() => router.replace("/my-works")}
            />
            {currentState &&
            !currentState.author_hidden &&
            !currentState.platform_limited ? (
              <Action
                label="读取当前展示版本"
                onPress={() =>
                  router.push({
                    pathname: "/works/[id]",
                    params: { id: currentState.id },
                  })
                }
              />
            ) : null}
            <Action
              label="确认结果并选择其他稿件"
              disabled={busy}
              onPress={reset}
            />
          </>
        ) : flow.preview ? (
          <>
            <Text style={s.heading}>
              固定预览 · 修订 R{flow.preview.source_revision}
            </Text>
            <Text style={s.meta}>
              下一正式版本 V{flow.preview.expected_version + 1} ·
              未提交预览有效至{" "}
              {new Date(flow.preview.expires_at).toLocaleString()}
            </Text>
            <Text style={s.heading}>{flow.preview.title}</Text>
            <Text style={s.note}>
              {flow.preview.introduction || "未填写简介"}
            </Text>
            <Text style={s.meta}>{flow.preview.tags.join(" · ")}</Text>
            <Text selectable style={s.body}>
              {flow.preview.content}
            </Text>
            <Text style={s.note}>
              草稿之后发生变化也不会替换这份快照。想发布新文字，应重新明确选择服务器修订。
            </Text>
            <Action
              label={
                flow.pendingPublish ? "检查原发布请求" : "正式发布这份快照"
              }
              disabled={busy}
              onPress={publish}
            />
            {!pending ? (
              <Action
                label="放弃此预览并重新选择"
                disabled={busy}
                onPress={reset}
              />
            ) : null}
          </>
        ) : source ? (
          <>
            <Text style={s.heading}>采用服务器修订 R{source.revision}</Text>
            <Text style={s.note}>
              当前服务器最新为 R{source.current}
              。预览将由服务器读取选定修订的标题和正文。
            </Text>
            {source.current !== source.revision && !pending ? (
              <Action
                label={`改用服务器最新 R${source.current}`}
                disabled={busy}
                onPress={() => {
                  setSource({ ...source, revision: source.current });
                  setRights(false);
                }}
              />
            ) : null}
            {!account?.nickname ? (
              <View style={s.panel}>
                <Text style={s.note}>发表前先设置笔名，表单内容会保留。</Text>
                <TextInput
                  accessibilityLabel="发布笔名"
                  value={nickname}
                  onChangeText={setNickname}
                  editable={!busy}
                  style={s.field}
                />
                <Action
                  label="保存发布笔名"
                  disabled={busy || !nickname.trim()}
                  onPress={() => void run(() => session.setNickname(nickname))}
                />
              </View>
            ) : null}
            <Text style={s.heading}>简介（最多 300 字）</Text>
            <TextInput
              accessibilityLabel="发布简介"
              multiline
              value={intro}
              onChangeText={setIntro}
              editable={!frozen}
              style={s.field}
            />
            <Text style={s.heading}>选择 1～3 个标签</Text>
            <View style={s.tags}>
              {publicationTags.map((tag) => (
                <Pressable
                  key={tag}
                  accessibilityRole="checkbox"
                  accessibilityLabel={`发布标签 ${tag}`}
                  accessibilityState={{
                    checked: tags.includes(tag),
                    disabled: frozen,
                  }}
                  disabled={frozen}
                  onPress={() =>
                    setTags((old) =>
                      old.includes(tag)
                        ? old.filter((x) => x !== tag)
                        : old.length < 3
                          ? [...old, tag]
                          : old,
                    )
                  }
                  style={[s.button, tags.includes(tag) && s.selected]}
                >
                  <Text style={s.link}>{tag}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityLabel="确认原创或取得发布授权"
              accessibilityState={{ checked: rights, disabled: frozen }}
              disabled={frozen}
              onPress={() => setRights((x) => !x)}
              style={s.button}
            >
              <Text style={s.note}>
                {rights ? "已确认" : "未确认"}：本内容为原创或已取得发布授权
              </Text>
            </Pressable>
            <Action
              label={flow.pendingPrepare ? "检查原预览请求" : "生成固定预览"}
              disabled={
                busy ||
                !account?.nickname ||
                (!flow.pendingPrepare &&
                  (!rights || !tags.length || Array.from(intro).length > 300))
              }
              onPress={prepare}
            />
            {!pending ? (
              <Action
                label="重新选择服务器稿件"
                disabled={busy}
                onPress={reset}
              />
            ) : (
              <Text style={s.note}>
                结果未确认，表单已冻结；检查会沿用原请求，不会换成新修订。
              </Text>
            )}
          </>
        ) : (
          <>
            <Text style={s.heading}>选择服务器已保存的稿件</Text>
            {page.items.length ? (
              page.items.map((item) => (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  accessibilityLabel={`选择服务器稿件 ${item.title || "未命名"}`}
                  disabled={busy}
                  style={s.panel}
                  onPress={() => choose(item.id, item.revision)}
                >
                  <Text style={s.heading}>{item.title || "未命名"}</Text>
                  <Text style={s.meta}>服务器修订 R{item.revision}</Text>
                </Pressable>
              ))
            ) : (
              <Status
                title="服务器暂无稿件"
                message="请先在草稿箱保存并确认同步，再进入发布。"
              />
            )}
            {page.next_cursor ? (
              <Action
                label="加载更多服务器稿件"
                disabled={busy}
                onPress={more}
              />
            ) : null}
          </>
        )}
        {busy ? <ActivityIndicator color={t.brand} /> : null}
      </ScrollView>
    </>
  );
}
const s = StyleSheet.create({
  header: {
    minHeight: 56,
    paddingHorizontal: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  content: { padding: 16, gap: 16, paddingBottom: 32 },
  heading: { fontSize: 16, fontWeight: "600", lineHeight: 24, color: t.ink },
  note: { fontSize: 14, lineHeight: 22, color: t.secondary },
  meta: { fontSize: 12, lineHeight: 20, color: t.muted },
  body: { fontSize: 16, lineHeight: 28, color: t.ink },
  error: { fontSize: 14, lineHeight: 22, color: t.danger },
  field: {
    minHeight: 48,
    padding: 12,
    borderWidth: 1,
    borderColor: t.line,
    borderRadius: 8,
    color: t.ink,
    fontSize: 16,
  },
  panel: {
    padding: 16,
    gap: 12,
    backgroundColor: t.background,
    borderRadius: 8,
  },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  button: { minHeight: 44, padding: 12, justifyContent: "center" },
  link: { fontSize: 14, color: t.brand },
  selected: { backgroundColor: t.selected, borderRadius: 8 },
});
