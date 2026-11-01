import { useCallback, useEffect, useState } from "react";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import {
  Alert,
  BackHandler,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  errorMessage,
  ReaderError,
  work as loadWork,
  type PublicWork,
} from "../api/reader";
import { Brand, Status } from "../components/Ui";
import { FutureAction, Icon, unavailable } from "../components/PrototypeUi";
import { theme as t } from "../theme";
import { FavoriteButton } from "../components/FavoriteButton";
export default function Reader() {
  const params = useLocalSearchParams<{ id: string }>();
  return (
    <ReaderContent
      key={params.id}
      id={typeof params.id === "string" ? params.id : ""}
    />
  );
}
function ReaderContent({ id }: { id: string }) {
  const [work, setWork] = useState<PublicWork>(),
    [error, setError] = useState<unknown>(),
    [retry, setRetry] = useState(0);
  const back = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/community");
  }, []);
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener(
        "hardwareBackPress",
        () => {
          back();
          return true;
        },
      );
      return () => subscription.remove();
    }, [back]),
  );
  useEffect(() => {
    const controller = new AbortController();
    loadWork(id, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setWork(value);
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted) setError(e);
      });
    return () => controller.abort();
  }, [id, retry]);
  return (
    <SafeAreaView style={s.screen}>
      <View style={s.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="返回作品列表"
          onPress={back}
          style={({ pressed }) => [s.back, pressed && { opacity: 0.5 }]}
        >
          <Icon name="back" size={24} color={t.ink} />
        </Pressable>
        <Brand />
        <View style={s.back} />
      </View>
      <View style={s.content}>
        {work ? (
          <ScrollView contentContainerStyle={s.paper}>
            <View style={s.authorRow}>
              <View style={s.avatar} />
              <Text style={s.author}>{work.author_nickname}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="关注，尚未开放"
                onPress={() => unavailable("关注")}
                style={s.follow}
              >
                <Text style={s.followText}>关注</Text>
              </Pressable>
            </View>
            <Text selectable accessibilityRole="header" style={s.title}>
              {work.title}
            </Text>
            <Text selectable style={s.body}>
              {work.content}
            </Text>
            <View style={s.meta}>
              {work.tags.map((tag) => (
                <Text key={tag} style={s.genre}>
                  {tag}
                </Text>
              ))}
              <Text style={s.metadata}>
                {new Date(work.published_at).toLocaleDateString("zh-CN")}
              </Text>
            </View>
            <View style={s.versions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="查看当前版本信息"
                onPress={() =>
                  Alert.alert(
                    "版本信息",
                    `当前公开版本 V${work.version}\n${new Date(work.published_at).toLocaleString("zh-CN")}\n其他历史版本尚未接入手机端。`,
                    [{ text: "关闭" }],
                  )
                }
                style={s.versionNode}
              >
                <View style={s.versionDot} />
              </Pressable>
              <Text style={s.metadata}>当前阅读版本 · 历史版本尚未接入</Text>
            </View>
            <View style={s.comments}>
              <Text style={s.commentsTitle}>评论</Text>
              <View style={s.commentsPending}>
                <Image
                  source={require("../../assets/tako-chibi.png")}
                  style={s.chibi}
                  resizeMode="contain"
                  accessible={false}
                />
                <Text style={s.metadata}>评论功能尚未开放</Text>
              </View>
            </View>
          </ScrollView>
        ) : error ? (
          <Status
            title={
              error instanceof ReaderError && error.kind === "unavailable"
                ? "作品暂不可读"
                : "正文未能加载"
            }
            message={errorMessage(error)}
            requestId={error instanceof ReaderError ? error.requestId : ""}
            onRetry={() => {
              setWork(undefined);
              setError(undefined);
              setRetry((n) => n + 1);
            }}
          />
        ) : (
          <Status loading title="正在打开作品" />
        )}
      </View>
      <View style={s.bottom}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="评论输入，尚未开放"
          onPress={() => unavailable("评论")}
          style={s.commentInput}
        >
          <Text style={s.inputHint}>说点友好的…</Text>
        </Pressable>
        <FutureAction name="评论" icon="message" />
        <FutureAction name="赞" icon="heart" />
        <FavoriteButton workId={id} disabled={!work} />
        <FutureAction name="更多操作" icon="more" />
      </View>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "white" },
  header: {
    height: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: t.line,
  },
  back: {
    width: 44,
    height: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  content: { flex: 1 },
  paper: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
  },
  authorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 12,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#7ea0f5",
  },
  author: { flex: 1, fontSize: 14, fontWeight: "600", color: t.ink },
  follow: {
    borderWidth: 1,
    borderColor: t.line,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  followText: { fontSize: 12, color: t.brand },
  title: {
    fontSize: 18,
    lineHeight: 27,
    color: t.ink,
    fontWeight: "600",
    marginTop: 14,
    marginBottom: 8,
  },
  body: { fontSize: 15, lineHeight: 28.5, color: "#333a47" },
  meta: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    alignItems: "center",
    marginTop: 14,
    marginBottom: 4,
  },
  genre: {
    fontSize: 11,
    color: t.brand,
    backgroundColor: "#eef3ff",
    borderRadius: 4,
    paddingVertical: 1,
    paddingHorizontal: 6,
  },
  metadata: { fontSize: 11, lineHeight: 18, color: t.muted },
  versions: {
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: t.line,
  },
  versionNode: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  versionDot: {
    width: 8,
    height: 8,
    borderRadius: 2,
    backgroundColor: t.brand,
  },
  comments: {
    marginTop: 16,
    borderTopWidth: 8,
    borderColor: t.background,
    paddingTop: 12,
  },
  commentsTitle: { fontSize: 15, fontWeight: "600", color: t.ink },
  commentsPending: { paddingVertical: 26, gap: 8, alignItems: "center" },
  chibi: { width: 88, height: 88 },
  bottom: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: t.line,
  },
  commentInput: {
    flex: 1,
    borderRadius: 30,
    paddingVertical: 9,
    paddingHorizontal: 14,
    backgroundColor: t.background,
  },
  inputHint: { color: t.muted, fontSize: 13 },
});
