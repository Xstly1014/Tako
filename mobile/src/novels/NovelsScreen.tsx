import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
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
import { router, usePreventRemove } from "expo-router";
import { randomUUID } from "expo-crypto";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSession } from "../auth/context";
import {
  NovelsApi,
  novelMessage,
  novelTags,
  validMetadata,
  type Novel,
} from "../api/novels";
import { Action, Status } from "../components/Ui";
import { theme as t } from "../theme";
import { nativeBookJournal } from "./native";
import { BookWriter, type BookJournal } from "./writer";

export default function NovelsScreen() {
  const { phase, account, generation } = useSession();
  if (phase !== "ready" || !account)
    return (
      <SafeAreaView style={s.screen}>
        <Status
          loading={phase === "loading"}
          title="联网登录后管理私密长文"
          message="书籍资料只向本人开放。"
          actionLabel="返回我的"
          onRetry={() => router.replace("/account")}
        />
      </SafeAreaView>
    );
  return (
    <Connected key={generation} owner={account.id} generation={generation} />
  );
}
function Connected({
  owner,
  generation,
}: {
  owner: string;
  generation: number;
}) {
  const { session } = useSession();
  const tools = useMemo(() => {
    const current = () => {
      const now = session.snapshot();
      return (
        now.phase === "ready" &&
        !now.busy &&
        now.generation === generation &&
        now.account?.id === owner
      );
    };
    return {
      current,
      api: new NovelsApi((path, options) => session.authorized(path, options)),
      journal: nativeBookJournal(session),
    };
  }, [session, owner, generation]);
  return <BooksWorkspace {...tools} uuid={randomUUID} />;
}
export function BooksWorkspace({
  api,
  journal,
  current,
  uuid,
}: {
  api: NovelsApi;
  journal: BookJournal;
  current: () => boolean;
  uuid: () => string;
}) {
  const writer = useMemo(
    () => new BookWriter(journal, api, current),
    [journal, api, current],
  );
  const state = useSyncExternalStore(writer.subscribe, writer.snapshot);
  const [items, setItems] = useState<Novel[]>([]),
    [cursor, setCursor] = useState(""),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<unknown>();
  const [target, setTarget] = useState<string | null>(null),
    [baseRevision, setBaseRevision] = useState(0);
  const [editing, setEditing] = useState(false),
    [title, setTitle] = useState(""),
    [introduction, setIntroduction] = useState(""),
    [tags, setTags] = useState<string[]>(["幻想"]),
    [dirty, setDirty] = useState(false);
  const alive = useRef(true),
    loadingRef = useRef(true),
    openedPending = useRef("");
  const formEpoch = useRef(0);
  const seenCursors = useRef(new Set<string>());
  const valid = () => alive.current && current();
  useEffect(() => {
    alive.current = true;
    void writer.restore();
    return () => {
      alive.current = false;
      writer.dispose();
    };
  }, [writer]);
  const load = async (more = false) => {
    if (loadingRef.current || !valid()) return;
    loadingRef.current = true;
    setLoading(true);
    setError(undefined);
    try {
      const token = more ? cursor : "";
      const page = await api.list(token);
      if (!valid()) return;
      if (
        page.next_cursor &&
        (page.next_cursor === token ||
          (seenCursors.current.has(page.next_cursor) && more))
      )
        throw new Error("cursor_cycle");
      if (!more) seenCursors.current.clear();
      if (page.next_cursor) seenCursors.current.add(page.next_cursor);
      setItems((old) =>
        more
          ? [
              ...old,
              ...page.items.filter((x) => !old.some((y) => y.id === x.id)),
            ]
          : page.items,
      );
      setCursor(page.next_cursor);
    } catch (e) {
      if (valid()) setError(e);
    } finally {
      loadingRef.current = false;
      if (valid()) setLoading(false);
    }
  };
  // Synchronize the account-scoped external writer through its subscription.
  useEffect(
    () =>
      writer.subscribe(() => {
        const next = writer.snapshot(),
          pending = next.pending;
        if (pending && openedPending.current !== pending.input.mutation_id) {
          openedPending.current = pending.input.mutation_id;
          setTarget(pending.target);
          setBaseRevision(pending.input.base_revision);
          setTitle(pending.input.title);
          setIntroduction(pending.input.introduction);
          setTags([...pending.input.tags]);
          setEditing(true);
          setDirty(true);
        }
        if (next.phase === "confirmed" && next.result) {
          setTarget(next.result.id);
          setBaseRevision(next.result.revision);
          setDirty(false);
        }
      }),
    [writer],
  );
  useEffect(() => {
    let active = true;
    void api
      .list()
      .then((page) => {
        if (active && current()) {
          setItems(page.items);
          setCursor(page.next_cursor);
          if (page.next_cursor) seenCursors.current.add(page.next_cursor);
        }
      })
      .catch((e) => {
        if (active && current()) setError(e);
      })
      .finally(() => {
        if (active) {
          loadingRef.current = false;
          if (current()) setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [api, current]);
  const blocked =
    state.phase === "loading" || state.phase === "saving" || !!state.pending;
  const askLeave = (leave: () => void) => {
    if (state.phase === "saving") return;
    if (state.pending) {
      Alert.alert(
        "提交结果待确认",
        "固定提交已加密保留；同账号返回后可继续确认。",
        [
          { text: "继续确认", style: "cancel" },
          { text: "离开", onPress: leave },
        ],
      );
      return;
    }
    if (dirty) {
      Alert.alert("放弃未提交的资料？", "未提交表单只在当前页面保留。", [
        { text: "继续编辑", style: "cancel" },
        { text: "放弃", style: "destructive", onPress: leave },
      ]);
      return;
    }
    leave();
  };
  usePreventRemove(dirty || blocked, ({ repeat }) => askLeave(repeat));
  const back = () =>
    askLeave(() => {
      if (editing) {
        formEpoch.current++;
        setEditing(false);
        setDirty(false);
        void load();
      } else router.back();
    });
  const open = async (value: Novel | null) => {
    if (blocked || loadingRef.current) return;
    const epoch = ++formEpoch.current;
    setError(undefined);
    loadingRef.current = true;
    setLoading(true);
    try {
      const latest = value ? await api.read(value.id) : null;
      if (!valid() || epoch !== formEpoch.current) return;
      writer.reset();
      setTarget(latest?.id ?? null);
      setBaseRevision(latest?.revision ?? 0);
      setTitle(latest?.title ?? "");
      setIntroduction(latest?.introduction ?? "");
      setTags(latest ? [...latest.tags] : ["幻想"]);
      setDirty(false);
      setEditing(true);
    } catch (e) {
      if (valid() && epoch === formEpoch.current) setError(e);
    } finally {
      loadingRef.current = false;
      if (valid()) setLoading(false);
    }
  };
  const submit = () => {
    if (!validMetadata({ title, introduction, tags })) {
      setError({ invalid: true });
      return;
    }
    void writer.submit({
      target,
      input: {
        mutation_id: uuid(),
        base_revision: baseRevision,
        title,
        introduction,
        tags: tags as Novel["tags"],
      },
    });
  };
  const confirmed = state.phase === "confirmed" && state.result;
  return (
    <SafeAreaView style={s.screen}>
      <View style={s.header}>
        <Button
          label={editing ? "书籍列表" : "草稿箱"}
          disabled={state.phase === "saving"}
          onPress={() =>
            editing
              ? back()
              : askLeave(() =>
                  router.canGoBack()
                    ? router.back()
                    : router.replace("/drafts"),
                )
          }
        />
        <Text style={s.heading}>我的长文</Text>
        {!editing ? (
          <Button
            label="开新书"
            disabled={blocked || state.phase === "loading"}
            onPress={() => void open(null)}
          />
        ) : (
          <View style={{ width: 64 }} />
        )}
      </View>
      <ScrollView
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
      >
        {state.phase === "loading" ? (
          <Status
            loading={!state.error}
            title={state.error ? "无法读取提交记录" : "正在确认本机记录"}
            message={state.error ? novelMessage(state.error) : undefined}
            onRetry={state.error ? () => void writer.restore() : undefined}
          />
        ) : null}
        {state.error ? (
          <Text style={s.error} accessibilityLiveRegion="polite">
            {novelMessage(state.error)}
          </Text>
        ) : null}
        {state.error && !state.pending && state.phase !== "loading" ? (
          <Button
            label="重新读取提交记录"
            onPress={() => askLeave(() => void writer.restore())}
          />
        ) : null}
        {error ? (
          <Text style={s.error} accessibilityLiveRegion="polite">
            {typeof error === "object" && error && "invalid" in error
              ? "书名需1～200字，简介最多300字，标签选1～3个。"
              : novelMessage(error)}
          </Text>
        ) : null}
        {confirmed ? (
          <View style={s.notice}>
            <Text style={s.label}>资料已保存，尚未公开</Text>
            <Text style={s.meta}>
              {state.pending
                ? "本机记录待清理，请先重试确认。"
                : "这是提交时的确认；查看当前资料会重新读取服务器。"}
            </Text>
            {!state.pending ? (
              <Button
                label="查看当前资料"
                onPress={() => askLeave(() => void open(state.result))}
              />
            ) : null}
          </View>
        ) : null}
        {state.pending ? (
          <View style={s.notice}>
            <Text style={s.label}>
              {state.phase === "saving" ? "正在确认提交" : "原提交待确认"}
            </Text>
            <Text style={s.meta}>确认前不能改动固定提交或新开一本书。</Text>
            <Action
              label="重试确认原提交"
              disabled={state.phase === "saving"}
              onPress={() => void writer.retry()}
            />
          </View>
        ) : null}
        {editing ? (
          <>
            <Text style={s.label}>
              {target ? "编辑书籍资料" : "建立私密书籍"}
            </Text>
            <Text style={s.meta}>
              只有你能看到。章节写作和公开发布将分阶段开放。
            </Text>
            <Text style={s.label}>书名</Text>
            <TextInput
              accessibilityLabel="书名"
              value={title}
              editable={!blocked}
              onChangeText={(value) => {
                setTitle(value);
                setDirty(true);
              }}
              style={s.input}
            />
            <Text style={s.meta}>{Array.from(title).length}/200</Text>
            <Text style={s.label}>简介</Text>
            <TextInput
              accessibilityLabel="书籍简介"
              value={introduction}
              editable={!blocked}
              multiline
              textAlignVertical="top"
              onChangeText={(value) => {
                setIntroduction(value);
                setDirty(true);
              }}
              style={[s.input, s.introduction]}
            />
            <Text style={s.meta}>{Array.from(introduction).length}/300</Text>
            <Text style={s.label}>题材 · 选1～3个</Text>
            <View style={s.tags}>
              {novelTags.map((tag) => (
                <Pressable
                  key={tag}
                  accessibilityRole="checkbox"
                  accessibilityLabel={tag}
                  accessibilityState={{
                    checked: tags.includes(tag),
                    disabled: blocked,
                  }}
                  disabled={blocked}
                  onPress={() => {
                    setTags((old) =>
                      old.includes(tag)
                        ? old.filter((x) => x !== tag)
                        : [...old, tag],
                    );
                    setDirty(true);
                  }}
                  style={[s.tag, tags.includes(tag) && s.selected]}
                >
                  <Text style={s.tagText}>{tag}</Text>
                </Pressable>
              ))}
            </View>
            <Action
              label={target ? "保存资料" : "建立书籍"}
              disabled={
                blocked ||
                state.phase === "loading" ||
                !validMetadata({ title, introduction, tags }) ||
                (!!confirmed && !dirty)
              }
              onPress={submit}
            />
            {state.phase === "rejected" && target ? (
              <Button
                label="保留输入，查看服务器新资料"
                onPress={() =>
                  void (async () => {
                    const epoch = formEpoch.current;
                    try {
                      const latest = await api.read(target);
                      if (valid() && epoch === formEpoch.current)
                        Alert.alert(
                          "服务器当前资料",
                          latest.title +
                            "\n" +
                            latest.introduction +
                            "\n题材：" +
                            latest.tags.join("、") +
                            "\n你的输入未被替换。选择继续编辑后，需再次点击保存才会覆盖当前资料。",
                          [
                            { text: "继续保留输入", style: "cancel" },
                            {
                              text: "使用当前修订继续编辑",
                              onPress: () => {
                                if (!valid() || epoch !== formEpoch.current)
                                  return;
                                writer.reset();
                                setBaseRevision(latest.revision);
                                setDirty(true);
                              },
                            },
                          ],
                        );
                    } catch (e) {
                      if (valid() && epoch === formEpoch.current) setError(e);
                    }
                  })()
                }
              />
            ) : null}
          </>
        ) : (
          <>
            <View style={s.toolbar}>
              <Text style={s.meta}>私密书籍 · 尚未发布</Text>
              <Button
                label="刷新列表"
                disabled={loading || blocked}
                onPress={() => void load()}
              />
            </View>
            {items.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={"编辑书籍 " + item.title}
                disabled={blocked || loading}
                onPress={() => void open(item)}
                style={({ pressed }) => [s.row, pressed && s.pressed]}
              >
                <Text style={s.label} numberOfLines={2}>
                  {item.title}
                </Text>
                <Text style={s.meta}>{item.tags.join(" · ")} · 仅本人可见</Text>
              </Pressable>
            ))}
            {!items.length && !loading && !error ? (
              <View style={s.empty}>
                <Text style={s.label}>先建一本书</Text>
                <Text style={s.meta}>
                  填写书名、简介和题材，建立你的私密创作空间。
                </Text>
              </View>
            ) : null}
            {loading ? <ActivityIndicator color={t.brand} /> : null}
            {cursor ? (
              <Button
                label="加载更多书籍"
                disabled={loading || blocked}
                onPress={() => void load(true)}
              />
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
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
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        pressed && s.pressed,
        disabled && s.disabled,
      ]}
    >
      <Text style={s.link}>{label}</Text>
    </Pressable>
  );
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: t.surface },
  header: {
    height: 56,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  heading: { fontSize: 20, fontWeight: "600", color: t.ink },
  content: { padding: 16, gap: 12, paddingBottom: 32 },
  label: { fontSize: 16, lineHeight: 24, fontWeight: "600", color: t.ink },
  meta: { fontSize: 12, lineHeight: 20, color: t.muted },
  link: { fontSize: 14, color: t.brand },
  button: { minHeight: 44, padding: 12, justifyContent: "center" },
  input: {
    borderWidth: 1,
    borderColor: t.line,
    borderRadius: 6,
    padding: 12,
    fontSize: 16,
    color: t.ink,
    minHeight: 48,
  },
  introduction: { minHeight: 128 },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tag: {
    minHeight: 44,
    paddingHorizontal: 16,
    justifyContent: "center",
    borderWidth: 1,
    borderColor: t.line,
    borderRadius: 6,
  },
  tagText: { fontSize: 14, color: t.ink },
  selected: { backgroundColor: t.selected, borderColor: t.brand },
  error: { fontSize: 14, lineHeight: 22, color: t.danger },
  notice: {
    backgroundColor: t.background,
    padding: 16,
    gap: 8,
    borderRadius: 6,
  },
  toolbar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  row: { paddingVertical: 16, gap: 8 },
  empty: { paddingVertical: 24, gap: 8 },
  pressed: { backgroundColor: t.background },
  disabled: { opacity: 0.4 },
});
