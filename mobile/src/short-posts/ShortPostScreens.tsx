import { type ComponentRef, useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { randomUUID } from "expo-crypto";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  listShortPostVersions,
  readShortPost,
  shortPostFeed,
  shortPostImageUri,
  shortPostMessage,
  type ShortPost,
  type ShortPostFeed,
  type ShortPostImage,
  type ShortPostVersion,
} from "../api/short-posts";
import { ApiError } from "../api/client";
import { UUID } from "../api/reader";
import { BottomNavigation } from "../components/PrototypeUi";
import { Action, Status } from "../components/Ui";
import { mergeReadingItems } from "../novels/reading-model";
import { theme as t } from "../theme";
import { shortPostsTrial } from "./trial";

function useRequest() {
  const active = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const run = useCallback(async <T,>(
    load: (signal: AbortSignal) => Promise<T>,
    accept: (value: T) => void,
  ) => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError(undefined);
    try {
      const value = await load(controller.signal);
      if (!controller.signal.aborted) accept(value);
    } catch (e) {
      if (!controller.signal.aborted) setError(e);
    } finally {
      if (!controller.signal.aborted) {
        active.current = null;
        setBusy(false);
      }
    }
  }, []);
  useEffect(() => () => {
    active.current?.abort();
    active.current = null;
  }, []);
  return { run, busy, error };
}

function InlineAction({
  label, onPress, disabled = false, selected,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  selected?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [s.control, selected && s.selected, pressed && s.pressed]}
    >
      <Text style={disabled ? s.muted : selected ? s.link : s.label}>{label}</Text>
    </Pressable>
  );
}

function Failure({ error }: { error: unknown }) {
  return (
    <Text accessibilityRole="alert" style={s.failure}>
      {shortPostMessage(error)}
    </Text>
  );
}

function PostImage({ post, version, image, readId, cover = false }: {
  post: string;
  version: number;
  image: ShortPostImage;
  readId: string;
  cover?: boolean;
}) {
  const [retry, setRetry] = useState("");
  const [failed, setFailed] = useState(false);
  const uri = shortPostImageUri(post, version, image.id, retry || readId);
  const aspectRatio = cover ? 4 / 3 : Math.max(0.7, Math.min(2, image.width / image.height));
  if (failed) return (
    <View style={[s.image, s.imageFallback, { aspectRatio }]}>
      {cover ? <Text style={s.muted}>图片暂不可用</Text> : (
        <InlineAction label="重试加载图片" onPress={() => {
          setRetry(randomUUID());
          setFailed(false);
        }} />
      )}
    </View>
  );
  return (
    <Image
      source={{ uri }}
      style={[s.image, { aspectRatio }]}
      resizeMode={cover ? "cover" : "contain"}
      accessible={!cover}
      accessibilityLabel={cover ? undefined : "短帖配图"}
      onError={() => setFailed(true)}
    />
  );
}

export function ShortPostFeedScreen() {
  return shortPostsTrial ? <ShortPostFeedContent /> : <Redirect href="/community" />;
}

function ShortPostFeedContent() {
  const [page, setPage] = useState<ShortPostFeed>();
  const [readId, setReadId] = useState(randomUUID);
  const [failedCursor, setFailedCursor] = useState("");
  const { run, busy, error } = useRequest();
  const load = useCallback((cursor = "") => {
    return run(
      (signal) => {
        setFailedCursor(cursor);
        return shortPostFeed(cursor, signal);
      },
      (value) => {
        if (!cursor) setReadId(randomUUID());
        setPage((old) => ({
          ...value,
          items: cursor && old ? mergeReadingItems(old.items, value.items) : value.items,
        }));
      },
    );
  }, [run]);
  useEffect(() => { void load(); }, [load]);
  return (
    <SafeAreaView style={s.screen}>
      <View style={s.channels}>
        <InlineAction label="短内容" selected onPress={() => void load()} disabled={busy} />
        <InlineAction label="中篇" onPress={() => router.dismissTo("/community")} />
        <InlineAction label="长文" onPress={() => router.navigate({ pathname: "/novel-community", params: { from: "short" } })} />
      </View>
      {page ? (
        <FlatList
          data={page.items}
          keyExtractor={(item) => item.id}
          numColumns={2}
          columnWrapperStyle={s.row}
          contentContainerStyle={s.feed}
          refreshing={busy && !failedCursor}
          onRefresh={() => void load()}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push({ pathname: "/short-posts/[id]", params: { id: item.id } })}
              style={({ pressed }) => [s.card, pressed && s.pressed]}
            >
              {item.cover ? (
                <PostImage key={readId + item.cover.id + item.version} post={item.id} version={item.version} image={item.cover} readId={readId} cover />
              ) : null}
              <View style={s.cardContent}>
                <Text numberOfLines={2} style={s.cardTitle}>{item.title}</Text>
                {!item.cover && item.excerpt ? (
                  <Text numberOfLines={3} style={s.meta}>{item.excerpt}</Text>
                ) : null}
                <Text numberOfLines={1} style={s.muted}>{item.author}</Text>
              </View>
            </Pressable>
          )}
          ListEmptyComponent={
            <Status title="还没有公开短帖" message="下拉刷新，查看之后发布的新帖。" />
          }
          ListFooterComponent={
            <View style={s.footer}>
              {error ? <Failure error={error} /> : null}
              {page.next_cursor || error ? (
                <Action
                  label={busy ? "正在加载" : error ? "重试" : "加载更多"}
                  disabled={busy}
                  onPress={() => void load(error ? failedCursor : page.next_cursor)}
                />
              ) : null}
            </View>
          }
        />
      ) : (
        <Status
          loading={!error}
          title={error ? "短内容未能加载" : "正在加载短内容"}
          message={error ? shortPostMessage(error) : undefined}
          onRetry={error ? () => void load() : undefined}
        />
      )}
      <BottomNavigation onHome={() => router.dismissTo("/community")} />
    </SafeAreaView>
  );
}

export function ShortPostDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  if (!shortPostsTrial) return <Redirect href="/community" />;
  return <ShortPostDetail key={id} id={typeof id === "string" ? id : ""} />;
}

function ShortPostDetail({ id }: { id: string }) {
  const scroller = useRef<ComponentRef<typeof ScrollView>>(null);
  const [read, setRead] = useState<{ post: ShortPost; imageReadId: string }>();
  const { run, busy, error } = useRequest();
  const load = useCallback((version?: number) =>
    run(
      (signal) => readShortPost(id.toLowerCase(), version, signal),
      (post) => {
        setRead({ post, imageReadId: randomUUID() });
        scroller.current?.scrollTo({ y: 0, animated: false });
      },
    ), [id, run]);
  useEffect(() => { if (UUID.test(id)) void load(); }, [id, load]);
  const post = read?.post;
  const related = post?.novel;
  return (
    <SafeAreaView style={s.screen}>
      <View style={s.toolbar}>
        <InlineAction label="返回短内容" onPress={() => router.dismissTo("/short-community")} />
      </View>
      {post && read ? (
        <ScrollView ref={scroller} contentContainerStyle={s.detail}>
          <View style={s.byline}>
            <Text style={s.label}>{post.author}</Text>
            <Text style={s.muted}>{new Date(post.published_at).toLocaleDateString("zh-CN")}</Text>
          </View>
          <Text accessibilityRole="header" style={s.title}>{post.title}</Text>
          <Text selectable style={s.body}>{post.content}</Text>
          {post.images.map((image) => (
            <PostImage key={read.imageReadId + image.id} post={post.id}
              version={post.version} image={image} readId={read.imageReadId} />
          ))}
          {related ? (
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [s.related, pressed && s.pressed]}
              onPress={() => router.push({
                pathname: "/novel/[id]",
                params: { id: related.id, from: "short", post: post.id },
              })}
            >
              <Text style={s.muted}>关联长文</Text>
              <Text style={s.link}>{related.title}</Text>
            </Pressable>
          ) : null}
          <ShortPostHistory post={post} onRead={load} busy={busy} readError={error} />
        </ScrollView>
      ) : (
        <Status
          loading={UUID.test(id) && !error}
          title={!UUID.test(id) || error ? "短帖未能打开" : "正在打开短帖"}
          message={error ? shortPostMessage(error) : !UUID.test(id) ? "短帖地址无效。" : undefined}
          onRetry={error && !(error instanceof ApiError && error.status === 404) ? () => void load() : undefined}
        />
      )}
    </SafeAreaView>
  );
}

function ShortPostHistory({ post, onRead, busy, readError }: {
  post: ShortPost;
  onRead: (version?: number) => Promise<void>;
  busy: boolean;
  readError: unknown;
}) {
  const [nodes, setNodes] = useState<ShortPostVersion[]>();
  const [selected, setSelected] = useState<number>();
  const [next, setNext] = useState(0);
  const history = useRequest();
  function load(before = 0) {
    void history.run((signal) => listShortPostVersions(post.id, before, signal), (value) => {
      setNodes((old) => before ? [...(old ?? []), ...value] : value);
      setNext(value.length === 20 ? value[19].version : 0);
      if (!before) setSelected(undefined);
    });
  }
  const node = nodes?.find((item) => item.version === selected);
  return (
    <View style={s.history}>
      <View style={s.byline}>
        <InlineAction
          label={history.busy ? "正在加载版本" : nodes ? "刷新版本记录" : "查看版本记录"}
          disabled={history.busy || busy}
          onPress={() => load()}
        />
        <InlineAction label="读当前展示版" disabled={busy} onPress={() => void onRead()} />
      </View>
      {history.error ? <Failure error={history.error} /> : null}
      {readError ? <Failure error={readError} /> : null}
      {nodes?.length ? (
        <ScrollView horizontal contentContainerStyle={s.rail}>
          {nodes.map((item, index) => (
            <View key={item.version}>
              {index < nodes.length - 1 ? <View style={s.railLine} /> : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={"版本 " + item.version}
                accessibilityState={{ selected: selected === item.version }}
                disabled={busy}
                onPress={() => setSelected(item.version)}
                style={s.dotHit}
              >
                <View style={[s.dot, item.version === post.version && s.currentDot, selected === item.version && s.selectedDot]} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      ) : nodes ? <Text style={s.muted}>暂无公开版本记录</Text> : null}
      {node ? (
        <View style={s.byline}>
          <Text style={s.muted}>V{node.version} · {new Date(node.published_at).toLocaleDateString("zh-CN")}</Text>
          <InlineAction
            label={node.readable ? "阅读此版本" : "正文未开放"}
            disabled={busy || !node.readable || node.version === post.version}
            onPress={() => void onRead(node.version)}
          />
        </View>
      ) : null}
      {next > 0 ? <InlineAction label="加载更早版本" disabled={history.busy} onPress={() => load(next)} /> : null}
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: t.surface },
  channels: { flexDirection: "row", justifyContent: "center", gap: 16, paddingVertical: 8 },
  toolbar: { paddingHorizontal: 16, alignItems: "flex-start" },
  control: { minHeight: 44, minWidth: 44, paddingHorizontal: 8, justifyContent: "center", borderRadius: 8 },
  selected: { backgroundColor: t.selected },
  pressed: { opacity: 0.68 },
  label: { color: t.ink, fontSize: 14, fontWeight: "600" },
  link: { color: t.brand, fontSize: 14, fontWeight: "600" },
  muted: { color: t.muted, fontSize: 12, lineHeight: 20 },
  meta: { color: t.secondary, fontSize: 14, lineHeight: 22 },
  feed: { padding: 16, gap: 12 },
  row: { gap: 12, alignItems: "stretch" },
  card: { flex: 1, maxWidth: "50%", borderRadius: 8, borderWidth: 1, borderColor: t.line, overflow: "hidden" },
  cardContent: { padding: 12, gap: 8 },
  cardTitle: { color: t.ink, fontSize: 16, lineHeight: 24, fontWeight: "600" },
  footer: { gap: 8, paddingVertical: 8 },
  detail: { padding: 16, gap: 16, width: "100%", maxWidth: 680, alignSelf: "center" },
  byline: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  title: { color: t.ink, fontSize: 24, lineHeight: 32, fontWeight: "600" },
  body: { color: t.ink, fontSize: 16, lineHeight: 24 },
  image: { width: "100%", backgroundColor: t.background, borderRadius: 8 },
  imageFallback: { alignItems: "center", justifyContent: "center" },
  related: { padding: 16, gap: 4, borderWidth: 1, borderColor: t.line, borderRadius: 8 },
  history: { borderTopWidth: 1, borderTopColor: t.line, paddingTop: 8 },
  rail: { alignItems: "center" },
  railLine: { position: "absolute", top: 21, left: 22, width: 44, height: 2, backgroundColor: t.line },
  dotHit: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: t.disabled },
  currentDot: { backgroundColor: t.brand },
  selectedDot: { borderColor: t.ink, borderWidth: 2 },
  failure: { color: t.danger, fontSize: 14, lineHeight: 22 },
});
