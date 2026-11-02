import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { errorMessage, ReaderError, type PublicWork } from "../api/reader";
import { mergeVersions, readVersion, timeline, type PublicTimeline } from "../api/versions";
import { theme as t } from "../theme";

export function VersionTimeline({ work, onRead }: { work: PublicWork; onRead: (work: PublicWork) => void }) {
  const [page, setPage] = useState<PublicTimeline>(),
    [selected, setSelected] = useState<number>(),
    [busy, setBusy] = useState<"refresh" | "more" | undefined>("refresh"),
    [error, setError] = useState<unknown>(),
    [switching, setSwitching] = useState<number>(),
    [switchError, setSwitchError] = useState<unknown>();
  const listRequest = useRef<{ epoch: number; controller?: AbortController }>({ epoch: 0 }),
    bodyRequest = useRef<{ epoch: number; controller?: AbortController }>({ epoch: 0 }),
    failedBefore = useRef(0);

  const load = useCallback(async (before = 0) => {
    const request = listRequest.current, epoch = ++request.epoch;
    request.controller?.abort();
    const controller = new AbortController();
    request.controller = controller;
    setBusy(before ? "more" : "refresh");
    setError(undefined);
    try {
      const value = await timeline(work.id, before, controller.signal);
      if (controller.signal.aborted || epoch !== request.epoch) return;
      setPage((old) => ({ ...value, versions: mergeVersions(before ? old?.versions ?? [] : [], value.versions) }));
    } catch (e) {
      if (!controller.signal.aborted && epoch === request.epoch) {
        failedBefore.current = before;
        setError(e);
        if (e instanceof ReaderError && e.kind === "unavailable") {
          setPage(undefined);
          setSelected(undefined);
        }
      }
    } finally {
      if (!controller.signal.aborted && epoch === request.epoch) setBusy(undefined);
    }
  }, [work.id]);
  useEffect(() => {
    const list = listRequest.current, body = bodyRequest.current;
    const epoch = ++list.epoch, controller = new AbortController();
    list.controller = controller;
    timeline(work.id, 0, controller.signal).then((value) => {
      if (!controller.signal.aborted && epoch === list.epoch)
        setPage({ ...value, versions: mergeVersions([], value.versions) });
    }).catch((e: unknown) => {
      if (!controller.signal.aborted && epoch === list.epoch) setError(e);
    }).finally(() => {
      if (!controller.signal.aborted && epoch === list.epoch) setBusy(undefined);
    });
    return () => {
      ++list.epoch;
      list.controller?.abort();
      ++body.epoch;
      body.controller?.abort();
    };
  }, [work.id]);

  const select = (number: number) => {
    ++bodyRequest.current.epoch;
    bodyRequest.current.controller?.abort();
    setSwitching(undefined);
    setSwitchError(undefined);
    setSelected(number);
  };
  const open = async (number: number) => {
    const request = bodyRequest.current, epoch = ++request.epoch;
    request.controller?.abort();
    const controller = new AbortController();
    request.controller = controller;
    setSwitching(number);
    setSwitchError(undefined);
    try {
      const value = await readVersion(work.id, number, controller.signal);
      if (!controller.signal.aborted && epoch === request.epoch) onRead(value);
    } catch (e) {
      if (!controller.signal.aborted && epoch === request.epoch) {
        setSwitchError(e);
        if (e instanceof ReaderError && e.kind === "unavailable") void load();
      }
    } finally {
      if (!controller.signal.aborted && epoch === request.epoch) setSwitching(undefined);
    }
  };
  const node = page?.versions.find((v) => v.version === selected);
  return (
    <View style={s.section}>
      <View style={s.heading}>
        <Text style={s.caption}>修订记录</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="刷新修订记录" disabled={!!busy || !!switching}
          onPress={() => void load()} style={({ pressed }) => [s.action, pressed && s.pressed, !!busy && s.disabled]}>
          <Text style={s.link}>刷新</Text>
        </Pressable>
      </View>
      {page?.versions.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.rail}>
          {page.versions.map((v, index) => (
            <View key={v.version} style={s.segment}>
              {index > 0 ? <View style={s.line} /> : null}
              <Pressable accessibilityRole="button" accessibilityLabel={`查看版本 ${v.version} 信息`}
                accessibilityState={{ selected: selected === v.version }} onPress={() => select(v.version)}
                style={({ pressed }) => [s.node, pressed && s.pressed]}>
                <View style={[s.ring, selected === v.version && s.selected]}>
                  <View style={[s.dot, v.is_current && s.current]} />
                </View>
              </Pressable>
            </View>
          ))}
        </ScrollView>
      ) : !busy && !error ? <Text style={s.note}>暂时没有可展示的修订记录。</Text> : null}
      {node ? (
        <View style={s.detail}>
          <Text style={s.note}>
            V{node.version} · {new Date(node.published_at).toLocaleString("zh-CN")}
            {node.is_current ? " · 默认展示" : ""}{node.version === work.version ? " · 本次正在阅读" : ""}
          </Text>
          {node.version !== work.version ? node.readable ? (
            <Pressable accessibilityRole="button" disabled={!!switching || !!busy} onPress={() => void open(node.version)}
              style={({ pressed }) => [s.action, pressed && s.pressed, (!!switching || !!busy) && s.disabled]}>
              <Text style={s.link}>{switching === node.version ? "正在打开…" : "阅读此版本"}</Text>
            </Pressable>
          ) : <Text style={s.note}>作者未开放此历史版本的正文。</Text> : null}
        </View>
      ) : page ? <Text style={s.note}>点选节点查看修订信息。</Text> : null}
      {busy ? <ActivityIndicator accessibilityLabel="正在加载修订记录" color={t.brand} /> : null}
      {error ? (
        <View style={s.detail}>
          <Text style={s.note}>修订记录未能加载。{errorMessage(error)}</Text>
          {error instanceof ReaderError && error.requestId ? <Text selectable style={s.note}>请求编号 {error.requestId}</Text> : null}
          <Pressable accessibilityRole="button" disabled={!!busy} onPress={() => void load(failedBefore.current)} style={s.action}>
            <Text style={s.link}>重试修订记录</Text>
          </Pressable>
        </View>
      ) : page?.next_version_before ? (
        <Pressable accessibilityRole="button" disabled={!!busy || !!switching} onPress={() => void load(page.next_version_before)} style={s.action}>
          <Text style={s.link}>更早的修订</Text>
        </Pressable>
      ) : null}
      {switchError ? <Text accessibilityRole="alert" style={s.note}>未能切换，已保留本次正文。{errorMessage(switchError)}</Text> : null}
      {switchError instanceof ReaderError && switchError.requestId ? <Text selectable style={s.note}>请求编号 {switchError.requestId}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  section: { marginTop: 16, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.line },
  heading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  caption: { fontSize: 12, color: t.muted },
  note: { fontSize: 12, lineHeight: 20, color: t.muted },
  action: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start", paddingHorizontal: 4 },
  link: { color: t.brand, fontSize: 12 },
  rail: { alignItems: "center", paddingVertical: 4 },
  segment: { width: 60, height: 44, flexDirection: "row", alignItems: "center", justifyContent: "center" },
  line: { position: "absolute", left: -30, width: 60, height: 1, backgroundColor: t.line },
  node: { width: 44, height: 44, justifyContent: "center", alignItems: "center" },
  ring: { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "transparent", backgroundColor: "white" },
  selected: { borderColor: t.ink },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: t.muted },
  current: { backgroundColor: t.brand, borderRadius: 2 },
  detail: { gap: 4, paddingVertical: 4 },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.4 },
});
