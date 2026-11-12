import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Alert, FlatList, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Redirect, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { randomUUID } from "expo-crypto";
import { SafeAreaView } from "react-native-safe-area-context";
import { ApiError, type RequestOptions } from "../api/client";
import { useSession } from "../auth/context";
import { Action, Status } from "../components/Ui";
import { mergeReadingItems } from "../novels/reading-model";
import { theme as t } from "../theme";
import {
  changePost, isDefiniteChangeError, latestRevision, managedPost, managementMessage,
  ownerPage, ownerVersion, ownerVersions, readOwnerImage, reviewLabel,
  type Change, type Managed, type OwnedVersion, type OwnerPage, type Revision, type VersionNode,
} from "./manage";
import { shortPostsTrial } from "./trial";

export function LinkButton({ label, onPress, disabled = false }: {
  label: string; onPress: () => void; disabled?: boolean;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled }}
      onPress={onPress} disabled={disabled} style={({ pressed }) => [s.linkButton, pressed && s.pressed]}>
      <Text style={disabled ? s.meta : s.link}>{label}</Text>
    </Pressable>
  );
}
function Header({ title, back }: { title: string; back: () => void }) {
  return <View style={s.header}>
    <LinkButton label="返回" onPress={back} />
    <Text accessibilityRole="header" style={s.heading}>{title}</Text>
  </View>;
}
export function Boundary({ children }: { children: (owner: string) => ReactNode }) {
  const { phase, account } = useSession();
  if (!shortPostsTrial) return <Redirect href="/community" />;
  if (phase === "ready" && account) return children(account.id);
  return <SafeAreaView style={s.screen}>
    <Header title="我的短帖" back={() => router.dismissTo("/short-community")} />
    <Status loading={phase === "loading"} title={phase === "loading" ? "正在核对账号" : "登录后管理短帖"}
      message={phase === "offline" ? "请联网后重新打开。" : undefined}
      onRetry={phase === "loading" ? undefined : () => router.push("/account")} actionLabel="打开账号页" />
  </SafeAreaView>;
}
export function useOwner(owner: string) {
  const { session } = useSession();
  return useCallback(<T,>(path: string, options?: Omit<RequestOptions, "token">) => {
    if (session.snapshot().account?.id !== owner) throw new ApiError("stale_session");
    return session.authorized<T>(path, options);
  }, [owner, session]);
}

export function MyShortPosts() {
  return <Boundary>{(owner) => <OwnerList key={owner} owner={owner} />}</Boundary>;
}
function OwnerList({ owner }: { owner: string }) {
  const send = useOwner(owner);
  const [page, setPage] = useState<OwnerPage>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<unknown>();
  const [lastCursor, setLastCursor] = useState("");
  const active = useRef<AbortController | null>(null);
  const load = useCallback((cursor: string) => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    const signal = controller.signal;
    void ownerPage(send, cursor, signal).then((value) => {
      if (signal.aborted) return;
      setError(undefined);
      setPage((old) => ({ ...value, items: cursor && old ? mergeReadingItems(old.items, value.items) : value.items }));
    }).catch((failure: unknown) => {
      if (!signal.aborted) setError(failure);
    }).finally(() => {
      if (!signal.aborted) {
        active.current = null;
        setBusy(false);
      }
    });
  }, [send]);
  useEffect(() => {
    load("");
    return () => {
      active.current?.abort();
      active.current = null;
    };
  }, [load]);
  function fetchPage(cursor = "") {
    if (active.current) return;
    setLastCursor(cursor);
    setBusy(true);
    setError(undefined);
    load(cursor);
  }
  return <SafeAreaView style={s.screen}>
    <Header title="我的短帖" back={() => router.canGoBack() ? router.back() : router.dismissTo("/short-community")} />
    {page ? <FlatList data={page.items} keyExtractor={(item) => item.id}
      contentContainerStyle={s.form} refreshing={busy && !lastCursor} onRefresh={() => fetchPage()}
      renderItem={({ item }) => <Pressable accessibilityRole="button"
        onPress={() => router.push({ pathname: "/my-short-posts/[id]", params: { id: item.id } })}
        style={({ pressed }) => [s.row, pressed && s.pressed]}>
        <Text style={s.title} numberOfLines={2}>{item.title}</Text>
        <Text style={s.meta}>{reviewLabel(item)}{item.author_hidden ? " · 已隐藏" : ""}
          {item.platform_limited ? " · 平台限制" : ""}</Text>
      </Pressable>}
      ListEmptyComponent={<Status title="还没有提交的短帖" />}
      ListFooterComponent={<View style={s.footer}>
        {error ? <Text accessibilityRole="alert" style={s.error}>{managementMessage(error)}</Text> : null}
        {page.next_cursor || error ? <Action disabled={busy} label={error ? "重试" : "加载更多"}
          onPress={() => fetchPage(error ? lastCursor : page.next_cursor)} /> : null}
      </View>}
    /> : <Status loading={busy} title={busy ? "正在加载短帖" : "短帖列表未能加载"}
      message={error ? managementMessage(error) : undefined} onRetry={busy ? undefined : () => fetchPage()} />}
  </SafeAreaView>;
}

export function MyShortPost() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Boundary>{(owner) => <OwnerDetail key={owner + ":" + id} owner={owner}
    id={typeof id === "string" ? id.toLowerCase() : ""} />}</Boundary>;
}

function OwnerDetail({ owner, id }: { owner: string; id: string }) {
  const send = useOwner(owner);
  const [post, setPost] = useState<Managed>();
  const [revision, setRevision] = useState<Revision>();
  const [revisionVersion, setRevisionVersion] = useState<OwnedVersion>();
  const [currentVersion, setCurrentVersion] = useState<OwnedVersion>();
  const [versions, setVersions] = useState<VersionNode[]>();
  const [picked, setPicked] = useState<OwnedVersion>();
  const [nextVersion, setNextVersion] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<unknown>();
  const [pending, setPending] = useState<Change>();
  const [reloadRequired, setReloadRequired] = useState(false);
  const active = useRef<AbortController | null>(null);

  const refresh = useCallback(async (signal: AbortSignal) => {
    const current = await managedPost(send, id, signal);
    if (!signal.aborted) {
      setPost(current);
      setRevision(undefined);
      setRevisionVersion(undefined);
      setCurrentVersion(undefined);
      setPicked(undefined);
      setVersions(undefined);
      setNextVersion(0);
      setReloadRequired(false);
      if (current.display_version) {
        const state = await ownerVersion(send, id, current.display_version, signal);
        if (!signal.aborted) setCurrentVersion(state);
      }
    }
  }, [send, id]);
  useFocusEffect(useCallback(() => {
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError(undefined);
    managedPost(send, id, controller.signal).then(async (value) => {
      if (controller.signal.aborted) return;
      setPost(value);
      setRevision(undefined);
      setRevisionVersion(undefined);
      setPicked(undefined);
      setVersions(undefined);
      setNextVersion(0);
      setCurrentVersion(undefined);
      setReloadRequired(false);
      if (value.display_version) {
        const state = await ownerVersion(send, id, value.display_version, controller.signal);
        if (!controller.signal.aborted) setCurrentVersion(state);
      }
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(failure);
    }).finally(() => {
      if (!controller.signal.aborted) {
        active.current = null;
        setBusy(false);
      }
    });
    return () => {
      active.current?.abort();
      active.current = null;
    };
  }, [id, send]));

  async function run(task: (signal: AbortSignal) => Promise<void>) {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setError(undefined);
    setBusy(true);
    try { await task(controller.signal); }
    catch (failure) { if (!controller.signal.aborted) setError(failure); }
    finally {
      if (!controller.signal.aborted) {
        active.current = null;
        setBusy(false);
      }
    }
  }
  async function apply(body: Change, signal: AbortSignal) {
    setPending(body);
    try {
      await changePost(send, id, body, signal);
    } catch (failure) {
      if (!signal.aborted && isDefiniteChangeError(failure)) {
        setPending(undefined);
        setReloadRequired(true);
      }
      throw failure;
    }
    if (signal.aborted) return;
    setPending(undefined);
    setReloadRequired(true);
    await refresh(signal);
  }
  function change(action: Change["action"], version?: number) {
    if (!post || pending || reloadRequired) return;
    const body = { action, mutation_id: randomUUID(), expected_revision: post.state_revision,
      ...(version ? { version } : {}) };
    if (action === "hide") {
      Alert.alert("隐藏这条短帖？", "新访问将无法打开短帖，之后可以恢复公开。", [
        { text: "取消", style: "cancel" },
        { text: "隐藏短帖", onPress: () => void run((signal) => apply(body, signal)) },
      ]);
    } else if (action === "show_version") {
      Alert.alert("切换展示版本？", "后续读者将打开 V" + version + "。", [
        { text: "取消", style: "cancel" },
        { text: "设为展示版", onPress: () => void run((signal) => apply(body, signal)) },
      ]);
    } else {
      void run((signal) => apply(body, signal));
    }
  }
  async function readTimeline(signal: AbortSignal, before = 0) {
    const nodes = await ownerVersions(send, id, before, signal);
    if (signal.aborted) return;
    setVersions((old) => before && old ? [...old, ...nodes] : nodes);
    setNextVersion(nodes.length === 20 ? nodes[19].version : 0);
  }
  async function pickVersion(number: number, signal: AbortSignal) {
    const result = await ownerVersion(send, id, number, signal);
    if (signal.aborted) return;
    setRevision(undefined);
    setRevisionVersion(undefined);
    setPicked(result);
  }
  function openEditor(submission?: string) {
    router.push({ pathname: "/short-compose", params: { post: id, ...(submission ? { revision: submission } : {}) } });
  }
  function openAppeals(caseRevision?: number) {
    router.push({ pathname: "/my-short-posts/[id]/appeals",
      params: { id, ...(caseRevision ? { caseRevision: String(caseRevision) } : {}) } });
  }
  const revisionLabel = revision?.state === "pending" ? "待先审" :
    revision?.state === "rejected" ? "已驳回" : revision?.state === "superseded" ? "已替换" :
      revision?.post_review_pending ? "待后审" : "已发布";
  return <SafeAreaView style={s.screen}>
    <Header title="短帖管理" back={() => router.dismissTo("/my-short-posts")} />
    {!post ? <Status loading={busy} title={busy ? "正在加载短帖" : "短帖未能打开"}
      message={error ? managementMessage(error) : undefined} onRetry={busy ? undefined : () => void run(refresh)} /> :
      <ScrollView contentContainerStyle={s.form}>
        <Text style={s.heading}>{post.title}</Text>
        <Text style={s.meta}>{reviewLabel(post)}{post.author_hidden ? " · 已隐藏" : ""}
          {post.platform_limited ? " · 平台限制" : ""}</Text>
        {post.review_reason ? <Text style={s.body}>审核说明 · {post.review_reason}</Text> : null}
        {currentVersion?.platform_limited ? <Text style={s.error}>当前展示版本已被限制
          {currentVersion.review_reason ? " · " + currentVersion.review_reason : ""}</Text> : null}
        {error ? <Text accessibilityRole="alert" style={s.error}>{managementMessage(error)}</Text> : null}
        {pending ? <Action label="重试原操作" disabled={busy}
          onPress={() => void run((signal) => apply(pending, signal))} /> : <View style={s.controls}>
          <LinkButton label="刷新状态" disabled={busy} onPress={() => void run(refresh)} />
          <LinkButton label={post.display_version ? "修订当前内容" : "修改这次提交"} disabled={busy || reloadRequired}
            onPress={() => openEditor()} />
          {post.published_at ? <>
            <LinkButton label={post.author_hidden ? "恢复公开" : "隐藏短帖"}
              disabled={busy || reloadRequired || (post.author_hidden && post.platform_limited)}
              onPress={() => change(post.author_hidden ? "restore" : "hide")} />
            <LinkButton label={post.history_enabled ? "关闭历史阅读" : "开放历史阅读"}
              disabled={busy || reloadRequired}
              onPress={() => change(post.history_enabled ? "history_close" : "history_open")} />
          </> : null}
        </View>}
        <View style={s.controls}>
          <LinkButton label="提交记录" disabled={busy}
            onPress={() => router.push({ pathname: "/my-short-posts/[id]/submissions", params: { id } })} />
          <LinkButton label="复核记录" disabled={busy} onPress={() => openAppeals()} />
          {post.limit_case_revision ? <LinkButton label="申请整帖复核" disabled={busy}
            onPress={() => openAppeals(post.limit_case_revision!)} /> : null}
          {!picked && !revision && currentVersion?.limit_case_revision ?
            <LinkButton label="申请当前版本复核" disabled={busy}
              onPress={() => openAppeals(currentVersion.limit_case_revision!)} /> : null}
        </View>
        {post.display_version ? <View style={s.revision}>
          <LinkButton label={versions ? "刷新版本记录" : "查看正式版本"} disabled={busy}
            onPress={() => void run((signal) => readTimeline(signal))} />
          {versions?.length ? <ScrollView horizontal contentContainerStyle={s.timeline}>
            {versions.map((node, index) => <View key={node.version}>
              {index + 1 < versions.length ? <View style={s.timelineLine} /> : null}
              <Pressable accessibilityRole="button"
                accessibilityLabel={"V" + node.version + (node.platform_limited ? "，受限" : "")}
                accessibilityState={{ selected: picked?.version === node.version, disabled: busy }}
                disabled={busy} style={s.dotButton}
                onPress={() => void run((signal) => pickVersion(node.version, signal))}>
                <View style={[s.dot, node.version === post.display_version && s.activeDot,
                  node.platform_limited && s.limitedDot, picked?.version === node.version && s.selectedDot]} />
              </Pressable>
            </View>)}
          </ScrollView> : null}
          {nextVersion ? <LinkButton label="加载更早版本" disabled={busy}
            onPress={() => void run((signal) => readTimeline(signal, nextVersion))} /> : null}
        </View> : null}
        {picked ? <View style={s.revision}>
          <Text style={s.title}>{picked.title}</Text>
          <Text style={s.meta}>V{picked.version} · {new Date(picked.published_at).toLocaleDateString("zh-CN")}</Text>
          {picked.platform_limited ? <Text style={s.error}>此版本已被限制
            {picked.review_reason ? " · " + picked.review_reason : ""}</Text> : null}
          <Text selectable style={s.body}>{picked.content}</Text>
          <PrivateImages key={"version:" + picked.version} send={send} ids={picked.images.map((image) => image.id)} />
          <View style={s.controls}>
            <LinkButton label="返回当前内容" disabled={busy} onPress={() => setPicked(undefined)} />
            {picked.limit_case_revision ? <LinkButton label="申请此版本复核" disabled={busy}
              onPress={() => openAppeals(picked.limit_case_revision!)} /> : null}
            {!picked.platform_limited && picked.version !== post.display_version ? <Action
              label="设为展示版" disabled={busy || !!pending || reloadRequired || post.platform_limited}
              onPress={() => change("show_version", picked.version)} /> : null}
          </View>
        </View> : null}
        {!revision && !picked ? <>
          <Text style={s.title}>{post.display_version ? "当前展示内容" : "本次提交内容"}</Text>
          <Text selectable style={s.body}>{post.content}</Text>
          <PrivateImages key={"current:" + post.state_revision} send={send} ids={post.images.map((image) => image.id)} />
        </> : null}
        {picked ? null : revision ? <LinkButton label="返回当前内容" disabled={busy} onPress={() => {
          setRevision(undefined);
          setRevisionVersion(undefined);
        }} /> : post.latest_submission_id ? <LinkButton label="查看最近一次修订" disabled={busy}
          onPress={() => void run(async (signal) => {
            const result = await latestRevision(send, id, post.latest_submission_id!, signal);
            if (signal.aborted) return;
            setRevision(result);
            setRevisionVersion(undefined);
            if (result.version !== null) {
              const state = await ownerVersion(send, id, result.version, signal);
              if (!signal.aborted) setRevisionVersion(state);
            }
          })} /> : null}
        {revision ? <View style={s.revision}>
          <Text style={s.title}>{revision.title}</Text>
          <Text style={s.meta}>{revisionLabel}</Text>
          {revision.review_reason ? <Text style={s.body}>审核说明 · {revision.review_reason}</Text> : null}
          {revisionVersion?.platform_limited ? <Text style={s.error}>此版本已被限制
            {revisionVersion.review_reason ? " · " + revisionVersion.review_reason : ""}</Text> : null}
          {revisionVersion?.limit_case_revision ? <LinkButton label="申请此版本复核" disabled={busy}
            onPress={() => openAppeals(revisionVersion.limit_case_revision!)} /> : null}
          {(revision.state === "pending" || revision.state === "rejected") ?
            <LinkButton label="修改这次提交" disabled={busy || !!pending || reloadRequired}
              onPress={() => openEditor(revision.id)} /> : null}
          <Text selectable style={s.body}>{revision.content}</Text>
          <PrivateImages key={revision.id} send={send} ids={revision.images.map((image) => image.id)} />
        </View> : null}
      </ScrollView>}
  </SafeAreaView>;
}

function asImageSource(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new ApiError("contract"));
    };
    reader.onerror = () => reject(new ApiError("contract"));
    reader.readAsDataURL(blob);
  });
}
export function PrivateImages({ ids, send }: { ids: string[]; send: ReturnType<typeof useOwner> }) {
  const [uri, setUri] = useState<string>();
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(-1);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  async function load(index: number) {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    const signal = controller.signal;
    setSelected(index);
    setBusy(true);
    setError(undefined);
    setUri(undefined);
    try {
      const blob = await readOwnerImage(send, ids[index], signal);
      const source = await asImageSource(blob);
      if (!signal.aborted) setUri(source);
    } catch (failure) {
      if (!signal.aborted) setError(failure);
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }
  if (!ids.length) return null;
  return <View style={s.revision}>
    <View style={s.controls}>
      {ids.map((id, index) => <LinkButton key={id}
        label={"配图 " + (index + 1)} disabled={busy && selected === index} onPress={() => void load(index)} />)}
    </View>
    {busy ? <Text style={s.meta}>正在读取配图</Text> : null}
    {error ? <Text accessibilityRole="alert" style={s.error}>{managementMessage(error)}</Text> : null}
    {uri ? <Image source={{ uri }} style={s.image} resizeMode="contain"
      accessibilityLabel={"配图 " + (selected + 1)} accessible onError={() => {
        setUri(undefined);
        setError(new ApiError("contract"));
      }} /> : null}
  </View>;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: t.surface },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, gap: 16 },
  form: { width: "100%", maxWidth: 680, alignSelf: "center", padding: 16, gap: 12 },
  heading: { color: t.ink, fontSize: 20, lineHeight: 28, fontWeight: "600" },
  title: { color: t.ink, fontSize: 16, lineHeight: 24, fontWeight: "600" },
  body: { color: t.ink, fontSize: 16, lineHeight: 24 },
  meta: { color: t.muted, fontSize: 14, lineHeight: 22 },
  link: { color: t.brand, fontSize: 14, fontWeight: "600" },
  error: { color: t.danger, fontSize: 14, lineHeight: 22 },
  pressed: { opacity: 0.68 },
  linkButton: { minHeight: 44, minWidth: 44, paddingHorizontal: 8, justifyContent: "center" },
  row: { padding: 16, gap: 4, borderColor: t.line, borderWidth: 1, borderRadius: 8 },
  footer: { gap: 8, paddingVertical: 8 },
  controls: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  revision: { gap: 8 },
  timeline: { alignItems: "center" },
  timelineLine: { position: "absolute", top: 21, left: 22, width: 44, height: 2, backgroundColor: t.line },
  dotButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: t.disabled },
  activeDot: { backgroundColor: t.brand },
  limitedDot: { backgroundColor: t.danger },
  selectedDot: { borderColor: t.ink, borderWidth: 2 },
  image: { width: "100%", aspectRatio: 4 / 3, backgroundColor: t.background, borderRadius: 8 },
});
