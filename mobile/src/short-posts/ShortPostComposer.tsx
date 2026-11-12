import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { Redirect, router, useLocalSearchParams, useNavigation, usePreventRemove } from "expo-router";
import { randomUUID } from "expo-crypto";
import { launchImageLibraryAsync, type ImagePickerAsset } from "expo-image-picker";
import { File } from "expo-file-system";
import { fetch as nativeFetch } from "expo/fetch";
import { SafeAreaView } from "react-native-safe-area-context";
import { ApiError, type RequestOptions } from "../api/client";
import { useSession } from "../auth/context";
import { UUID } from "../api/reader";
import { AuthSheet } from "../components/AuthSheet";
import { Action, Status } from "../components/Ui";
import { NovelReadingApi, type PublicNovel, type PublicNovelPage } from "../novels/reading-api";
import { mergeReadingItems } from "../novels/reading-model";
import { shortPostJournal } from "../publication/journal";
import { theme as t } from "../theme";
import { composeMessage, postInput, preparePost, ShortPostSubmission, type Preview, type Receipt, type RevisionTarget } from "./publish";
import { shortPostsTrial } from "./trial";
import { initialSubmission, latestRevision, managedPost, type Managed, type Revision } from "./manage";
import { PrivateImages, useOwner } from "./ShortPostManagement";

type Photo = { id: string; asset?: ImagePickerAsset; uploaded: boolean };
type Book = Pick<PublicNovel, "id" | "title">;
const maxImages = 4;
function back(post?: string, history = false) {
  if (post && UUID.test(post) && history)
    router.dismissTo({ pathname: "/my-short-posts/[id]/submissions", params: { id: post } });
  else if (post && UUID.test(post)) router.dismissTo({ pathname: "/my-short-posts/[id]", params: { id: post } });
  else router.dismissTo("/short-community");
}
type Seed = { post: Managed; snapshot: Managed | Revision; replacesPending: boolean };

function TextAction({ label, onPress, disabled = false }: {
  label: string; onPress: () => void; disabled?: boolean;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled}
      onPress={onPress} style={({ pressed }) => [s.control, pressed && s.pressed]}>
      <Text style={disabled ? s.meta : s.link}>{label}</Text>
    </Pressable>
  );
}

export default function ShortPostComposer() {
  const { account, phase } = useSession();
  const params = useLocalSearchParams<{ post?: string; revision?: string; initial?: string; history?: string }>();
  const post = typeof params.post === "string" ? params.post : undefined;
  const source = typeof params.revision === "string" ? params.revision : undefined;
  const initial = !source && params.initial === "1";
  const history = params.history === "1";
  const [auth, setAuth] = useState(false);
  if (!shortPostsTrial) return <Redirect href="/community" />;
  if (phase === "ready" && account?.nickname) {
    return post === undefined
      ? <AuthorComposer key={account.id} owner={account.id} />
      : <RevisionEntry key={account.id + ":" + post + ":" + (source ?? (initial ? "initial" : ""))}
          owner={account.id} post={post} source={source} initial={initial} history={history} />;
  }
  return (
    <SafeAreaView style={s.screen}>
      <TextAction label={history ? "返回提交记录" : post ? "返回短帖管理" : "返回短内容"} onPress={() => back(post, history)} />
      <Status loading={phase === "loading"} title={
        phase === "loading" ? "正在核对账号" :
          phase === "offline" ? "联网后发帖" : account ? "先设置笔名" : "登录后发帖"
      } />
      {phase === "guest" ? <Action label="登录或注册" onPress={() => setAuth(true)} /> : null}
      {phase === "ready" || phase === "offline" ? (
        <Action label="打开账号设置" onPress={() => router.push("/account")} />
      ) : null}
      <AuthSheet visible={auth} onClose={() => setAuth(false)} onComplete={() => setAuth(false)} />
    </SafeAreaView>
  );
}

function RevisionEntry({ owner, post, source, initial, history }: {
  owner: string; post: string; source?: string; initial: boolean; history: boolean;
}) {
  const send = useOwner(owner);
  const [seed, setSeed] = useState<Seed>();
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    managedPost(send, post, signal).then(async (item) => {
      const latest = item.latest_submission_id
        ? await latestRevision(send, post, item.latest_submission_id, signal) : undefined;
      const snapshot = initial ? await initialSubmission(send, post, signal)
        : !source ? item : latest?.id === source
        ? latest : await latestRevision(send, post, source, signal);
      if (!signal.aborted) setSeed({ post: item, snapshot,
        replacesPending: latest?.state === "pending" || (!item.display_version && item.review_status === "pending") });
    }).catch((failure: unknown) => {
      if (!signal.aborted) setError(failure);
    });
    return () => controller.abort();
  }, [attempt, initial, post, send, source]);
  return seed ? <AuthorComposer owner={owner} seed={seed} history={history} /> : <SafeAreaView style={s.screen}>
    <TextAction label={history ? "返回提交记录" : "返回短帖管理"} onPress={() => back(post, history)} />
    <Status loading={!error} title={error ? "未能打开原稿" : "正在读取原稿"}
      message={error ? composeMessage(error) : undefined}
      onRetry={error ? () => { setError(undefined); setAttempt((value) => value + 1); } : undefined} />
  </SafeAreaView>;
}

function imageSource(asset: ImagePickerAsset) {
  const file = new File(asset.uri);
  const type = asset.mimeType ?? file.type;
  const name = asset.fileName ?? asset.uri.split("/").pop() ?? "";
  const mediaType: NonNullable<RequestOptions["binary"]>["mediaType"] | null = type === "image/jpeg" || type === "image/png" ? type :
    (!type || type === "application/octet-stream") && /\.png$/i.test(name) ? "image/png" :
    (!type || type === "application/octet-stream") && /\.jpe?g$/i.test(name) ? "image/jpeg" : null;
  if (!mediaType) throw new ApiError("image_type_unsupported");
  if (!file.exists) throw new ApiError("invalid_image");
  if (file.size > 8 * 1024 * 1024) throw new ApiError("payload_too_large");
  if (asset.width * asset.height > 12000000) throw new ApiError("image_too_large");
  return { file, mediaType };
}

function AuthorComposer({ owner, seed, history = false }: { owner: string; seed?: Seed; history?: boolean }) {
  const { session } = useSession();
  const nav = useNavigation();
  const send = useCallback(<T,>(path: string, options?: Omit<RequestOptions, "token">) => {
    if (session.snapshot().account?.id !== owner) throw new ApiError("stale_session");
    return session.authorized<T>(path, options);
  }, [owner, session]);
  const publication = useMemo(() => new ShortPostSubmission(owner, send, shortPostJournal(owner)), [owner, send]);
  const books = useMemo(() => new NovelReadingApi(send), [send]);
  const [title, setTitle] = useState(seed?.snapshot.title ?? "");
  const [content, setContent] = useState(seed?.snapshot.content ?? "");
  const [photos, setPhotos] = useState<Photo[]>(() =>
    seed?.snapshot.images.map(({ id }) => ({ id, uploaded: true })) ?? []);
  const [book, setBook] = useState<Book | undefined>(() => {
    const id = seed?.snapshot.novel_id;
    return id ? { id, title: "原关联长文" } : undefined;
  });
  const [target, setTarget] = useState<RevisionTarget | undefined>(() =>
    seed ? { post: seed.post.id, expectedRevision: seed.post.state_revision } : undefined);
  const [conflict, setConflict] = useState(false);
  const [replacesPending, setReplacesPending] = useState(seed?.replacesPending ?? false);
  const [edited, setEdited] = useState(false);
  const [options, setOptions] = useState<PublicNovelPage>();
  const [choosing, setChoosing] = useState(false);
  const [preview, setPreview] = useState<Preview>();
  const [rights, setRights] = useState(false);
  const [receipt, setReceipt] = useState<Receipt>();
  const [pending, setPending] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<unknown>();
  const active = useRef<AbortController | null>(null);
  const previewKey = useRef<string | null>(null);
  const dirty = seed ? edited : Boolean(title || content || photos.length || book);

  const run = useCallback(async (task: (signal: AbortSignal) => Promise<void>) => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError(undefined);
    try { await task(controller.signal); }
    catch (e) { if (!controller.signal.aborted) setError(e); }
    finally {
      if (!controller.signal.aborted) {
        active.current = null;
        setBusy(false);
      }
    }
  }, []);

  const recover = useCallback(async (signal: AbortSignal) => {
    const state = await publication.recover(signal);
    if (signal.aborted) return;
    setPending(state.pending);
    setReceipt(state.pending ? state.receipt : undefined);
    setReady(true);
  }, [publication]);

  useEffect(() => {
    const controller = new AbortController();
    active.current = controller;
    publication.recover(controller.signal)
      .then((state) => {
        if (controller.signal.aborted) return;
        setPending(state.pending);
        setReceipt(state.pending ? state.receipt : undefined);
        setReady(true);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setError(error);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          active.current = null;
          setBusy(false);
        }
      });
    return () => {
      active.current?.abort();
      active.current = null;
    };
  }, [publication]);

  usePreventRemove(busy || (!receipt && !pending && dirty), ({ data }) => {
    if (busy) return;
    Alert.alert("放弃这次编辑？", "返回后，这次未提交的文字和选图不会保留。", [
      { text: "继续编辑", style: "cancel" },
      { text: "放弃编辑", style: "destructive", onPress: () => nav.dispatch(data.action) },
    ]);
  });

  function invalidate() {
    setEdited(true);
    previewKey.current = null;
    setPreview(undefined);
    setRights(false);
  }

  async function pick(signal: AbortSignal) {
    const result = await launchImageLibraryAsync({
      mediaTypes: ["images"], allowsMultipleSelection: true,
      selectionLimit: maxImages - photos.length, quality: 1, exif: false,
    });
    if (signal.aborted || result.canceled) return;
    const accepted: Photo[] = [];
    let rejected: unknown;
    for (const asset of result.assets.slice(0, maxImages - photos.length)) {
      try {
        imageSource(asset);
        accepted.push({ id: randomUUID(), asset, uploaded: false });
      } catch (error) { rejected = error; }
    }
    if (accepted.length) {
      setPhotos((old) => [...old, ...accepted]);
      invalidate();
    }
    if (rejected) throw rejected;
  }

  async function stage(photo: Photo, signal: AbortSignal) {
    if (!photo.asset) throw new ApiError("short_post_image_unavailable");
    const { file, mediaType } = imageSource(photo.asset);
    const upload = (id: string) => send<{ id: string }>("/my/short-post-images/" + id, {
      method: "PUT",
      signal,
      binary: { mediaType, send: (url, init) => nativeFetch(url, { ...init, body: file }) },
    });
    let id = photo.id;
    let result;
    try { result = await upload(id); }
    catch (error) {
      if (!(error instanceof ApiError) || error.code !== "short_post_image_unavailable" || signal.aborted)
        throw error;
      id = randomUUID();
      setPhotos((old) => old.map((item) => item.id === photo.id ? { ...item, id } : item));
      result = await upload(id);
    }
    if (result?.id !== id) throw new ApiError("contract");
    if (!signal.aborted) setPhotos((old) => old.map((item) =>
      item.id === id ? { ...item, uploaded: true } : item));
    return id;
  }

  async function openPreview(signal: AbortSignal) {
    const input = postInput({ title, content, novel_id: book?.id ?? null, image_ids: [] });
    for (const photo of photos) {
      if (signal.aborted) return;
      input.image_ids.push(photo.uploaded ? photo.id : await stage(photo, signal));
    }
    if (signal.aborted) return;
    const key = previewKey.current ??= randomUUID();
    try {
      const fixed = await preparePost(send, key, input, signal);
      if (!signal.aborted) setPreview(fixed);
    } catch (error) {
      if (!signal.aborted && error instanceof ApiError) {
        if (error.code === "short_post_image_unavailable")
          setPhotos((old) => old.map((item) => item.asset ? { ...item, uploaded: false } : item));
        if (error.code === "short_post_image_unavailable" || error.code === "preview_expired")
          invalidate();
      }
      throw error;
    }
  }

  async function submit(signal: AbortSignal, retry = false) {
    try {
      if (retry) {
        setReceipt(await publication.retry(signal));
      } else if (preview && rights) {
        setReceipt(await publication.confirm(randomUUID(), preview.id, signal, target));
      }
    } catch (error) {
      if (!signal.aborted) {
        const repair = error instanceof ApiError &&
          ["preview_expired", "short_post_novel_unavailable", "work_state_conflict"].includes(error.code);
        if (repair) {
          invalidate();
          setPending(false);
          if (error.code === "work_state_conflict" && target) setConflict(true);
        } else {
          setReady(false);
          await recover(signal).catch(() => undefined);
        }
      }
      throw error;
    }
  }

  async function reconcile(signal: AbortSignal) {
    if (!target) return;
    const current = await managedPost(send, target.post, signal);
    const latest = current.latest_submission_id
      ? await latestRevision(send, target.post, current.latest_submission_id, signal) : undefined;
    if (signal.aborted) return;
    const version = current.display_version ? "V" + current.display_version : "待审或驳回提交";
    Alert.alert("核对当前短帖", current.title + " · " + version +
      "。继续会保留当前编辑，并按最新状态生成一份新的预览。", [
      { text: "暂不继续", style: "cancel" },
      { text: "继续修订", onPress: () => {
        setTarget({ post: current.id, expectedRevision: current.state_revision });
        setReplacesPending(latest?.state === "pending" ||
          (!current.display_version && current.review_status === "pending"));
        setConflict(false);
      } },
    ]);
  }

  async function loadBooks(signal: AbortSignal, cursor = "") {
    setChoosing(true);
    const page = await books.shortPostOptions(cursor, signal);
    if (!signal.aborted) setOptions((old) => ({
      ...page, items: cursor && old ? mergeReadingItems(old.items, page.items) : page.items,
    }));
  }

  async function finish(signal: AbortSignal, target: "feed" | "public" | "manage") {
    if (!receipt) return;
    await publication.acknowledge(receipt);
    if (signal.aborted) return;
    // Leave on the next render, once the navigation guard sees no active request.
    setDestination({ target, post: receipt.post_id });
  }
  const [destination, setDestination] = useState<{ target: "feed" | "public" | "manage"; post: string }>();
  useEffect(() => {
    if (busy || destination === undefined) return;
    if (destination.target === "public") {
      router.replace({ pathname: "/short-posts/[id]", params: { id: destination.post } });
    } else if (destination.target === "manage") {
      router.dismissTo({ pathname: "/my-short-posts/[id]", params: { id: destination.post } });
    } else back(target?.post, history);
  }, [busy, destination, history, target?.post]);

  const move = (index: number, delta: number) => {
    const next = [...photos];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    setPhotos(next);
    invalidate();
  };

  return (
    <SafeAreaView style={s.screen}>
      <View style={s.header}>
        <TextAction label={history ? "返回提交记录" : target ? "返回短帖管理" : "返回短内容"} onPress={() => back(target?.post, history)} disabled={busy} />
        <Text accessibilityRole="header" style={s.heading}>
          {receipt ? "提交结果" : preview ? "发布预览" : target ? "修订短帖" : "发短帖"}
        </Text>
      </View>
      <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={s.form} keyboardShouldPersistTaps="handled">
          {error ? <Text accessibilityRole="alert" style={s.error}>{composeMessage(error)}</Text> : null}
          {receipt ? (
            <>
              <Text style={s.heading}>{receipt.status === "published" ? "短帖已发布" : "已提交审核"}</Text>
              {receipt.status === "pre_review" ? <Text style={s.meta}>当前审核进度可在短帖管理查看。</Text> : null}
              {receipt.status === "published" ? <Action label="阅读已发布短帖" disabled={busy} onPress={() => void run((signal) => finish(signal, "public"))} /> : null}
              <TextAction label="查看短帖管理" disabled={busy} onPress={() => void run((signal) => finish(signal, "manage"))} />
              <TextAction label="返回短内容" disabled={busy} onPress={() => void run((signal) => finish(signal, "feed"))} />
            </>
          ) : !ready || pending ? (
            <>
              <Text style={s.meta}>{pending ? "上次提交结果待确认。" : "先核对上次提交，避免重复发帖。"}</Text>
              <Action label={busy ? "正在核对" : "查询发布结果"} disabled={busy} onPress={() => void run(recover)} />
              {pending ? <TextAction label="重试原提交" disabled={busy} onPress={() => void run((signal) => submit(signal, true))} /> : null}
            </>
          ) : preview ? (
            <>
              <Text style={s.heading}>{preview.title}</Text>
              <Text style={s.body}>{preview.content}</Text>
              {preview.images.map((image) => {
                const photo = photos.find((item) => item.id === image.id);
                return photo?.asset
                  ? <Image key={image.id} source={{ uri: photo.asset.uri }} style={s.previewPhoto} resizeMode="contain" accessible accessibilityLabel="待发布图片" />
                  : <PrivateImages key={image.id} ids={[image.id]} send={send} />;
              })}
              {book && preview.novel_id === book.id ? <Text style={s.meta}>关联长文 · {book.title}</Text> : null}
              <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: rights, disabled: busy }}
                disabled={busy} onPress={() => setRights(!rights)} style={s.control}>
                <Text style={rights ? s.link : s.body}>{rights ? "已确认" : "确认"}内容为原创或已获授权</Text>
              </Pressable>
              {replacesPending ? <Text style={s.meta}>确认后，这份内容会替换当前的待审提交。</Text> : null}
              <Action label={busy ? "正在提交" : replacesPending ? "提交并替换待审稿" : target ? "提交修订" : "确认发布"}
                disabled={busy || !rights}
                onPress={() => void run((signal) => submit(signal))} />
              <TextAction label="返回编辑" disabled={busy} onPress={invalidate} />
            </>
          ) : (
            <>
              <Text style={s.label}>标题（最多 80 字）</Text>
              <TextInput accessibilityLabel="标题" editable={!busy} value={title} style={s.input} maxLength={160}
                onChangeText={(value) => { setTitle(value); invalidate(); }} />
              <Text style={s.label}>正文（最多 2000 字）</Text>
              <TextInput accessibilityLabel="正文" editable={!busy} value={content} style={[s.input, s.editor]} multiline maxLength={4000}
                onChangeText={(value) => { setContent(value); invalidate(); }} />
              <Text style={s.label}>图片 {photos.length}/{maxImages}</Text>
              {photos.map((photo, index) => (
                <View key={photo.id} style={s.row}>
                  {photo.asset
                    ? <Image source={{ uri: photo.asset.uri }} style={s.thumbnail} accessible accessibilityLabel={"第 " + (index + 1) + " 张图片"} />
                    : <Text style={s.meta}>原图 {index + 1}</Text>}
                  <Text style={s.meta}>{photo.uploaded ? "已上传" : "待上传"}</Text>
                  <TextAction label="前移" disabled={busy || index === 0} onPress={() => move(index, -1)} />
                  <TextAction label="后移" disabled={busy || index === photos.length - 1} onPress={() => move(index, 1)} />
                  <TextAction label="移除" disabled={busy} onPress={() => {
                    setPhotos((old) => old.filter((item) => item.id !== photo.id)); invalidate();
                  }} />
                </View>
              ))}
              <TextAction label="选择图片" disabled={busy || photos.length >= maxImages} onPress={() => void run(pick)} />
              <Text style={s.label}>关联长文（可选）</Text>
              {book ? <Text style={s.body}>{book.title}</Text> : null}
              <View style={s.row}>
                <TextAction label={choosing ? "收起长文列表" : "选择本人长文"} disabled={busy}
                  onPress={() => choosing ? setChoosing(false) : void run((signal) => loadBooks(signal))} />
                {book ? <TextAction label="移除关联" disabled={busy} onPress={() => { setBook(undefined); invalidate(); }} /> : null}
              </View>
              {choosing ? (
                <View style={s.choices}>
                  {options?.items.map((item) => (
                    <TextAction key={item.id} label={item.title} disabled={busy} onPress={() => {
                      setBook(item); setChoosing(false); invalidate();
                    }} />
                  ))}
                  {options?.items.length === 0 ? <Text style={s.meta}>暂无可关联的公开长文。</Text> : null}
                  {!options || options.next_cursor ? <TextAction label={options ? "加载更多长文" : "重新加载长文"}
                    disabled={busy} onPress={() => void run((signal) => loadBooks(signal, options?.next_cursor))} /> : null}
                </View>
              ) : null}
              {conflict
                ? <Action label="核对最新状态" disabled={busy} onPress={() => void run(reconcile)} />
                : <Action label={busy ? "正在处理" : "准备发布预览"} disabled={busy}
                    onPress={() => void run(openPreview)} />}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: t.surface },
  header: { paddingHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 16 },
  form: { width: "100%", maxWidth: 680, alignSelf: "center", padding: 16, gap: 12 },
  control: { minHeight: 44, justifyContent: "center", paddingHorizontal: 8 },
  pressed: { opacity: 0.68 },
  heading: { color: t.ink, fontSize: 20, fontWeight: "600" },
  label: { color: t.ink, fontSize: 14, fontWeight: "600" },
  body: { color: t.ink, fontSize: 16, lineHeight: 24 },
  meta: { color: t.muted, fontSize: 14, lineHeight: 22 },
  link: { color: t.brand, fontSize: 14, fontWeight: "600" },
  error: { color: t.danger, fontSize: 14, lineHeight: 22 },
  input: { color: t.ink, fontSize: 16, padding: 12, borderWidth: 1, borderColor: t.line, borderRadius: 8 },
  editor: { minHeight: 160, textAlignVertical: "top" },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  thumbnail: { width: 48, height: 48, borderRadius: 4, backgroundColor: t.background },
  previewPhoto: { width: "100%", aspectRatio: 4 / 3, backgroundColor: t.background, borderRadius: 8 },
  choices: { padding: 8, borderWidth: 1, borderColor: t.line, borderRadius: 8 },
});
