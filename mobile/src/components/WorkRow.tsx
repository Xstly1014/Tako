import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import type { WorkCard } from "../api/reader";
import { theme as t } from "../theme";
import { FavoriteButton } from "./FavoriteButton";
import { FutureAction } from "./PrototypeUi";
export function WorkRow({ item }: { item: WorkCard }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`阅读 ${item.title}`}
      onPress={() =>
        router.push({ pathname: "/works/[id]", params: { id: item.id } })
      }
      style={({ pressed }) => [
        s.row,
        pressed && { backgroundColor: t.background },
      ]}
    >
      <View style={s.byline}>
        <View style={s.avatar} />
        <Text style={s.author} numberOfLines={1}>
          {item.author_nickname}
        </Text>
      </View>
      <Text style={s.title} numberOfLines={2}>
        {item.title}
      </Text>
      {item.introduction ? (
        <Text style={s.excerpt} numberOfLines={3}>
          {item.introduction}
        </Text>
      ) : null}
      <View style={s.meta}>
        <View style={s.metaLeft}>
          <Text style={s.genre}>{item.tags[0]}</Text>
          <Text style={s.metadata}>测试内容</Text>
        </View>
        <FutureAction name="赞" icon="heart" />
        <FutureAction name="评论" icon="message" />
        <FavoriteButton workId={item.id} />
      </View>
    </Pressable>
  );
}
const s = StyleSheet.create({
  row: {
    backgroundColor: "white",
    paddingTop: 12,
    paddingHorizontal: 16,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: t.line,
  },
  byline: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    marginBottom: 7,
  },
  avatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#bdccef",
  },
  author: { fontSize: 12, color: t.ink, fontWeight: "600", flex: 1 },
  title: { fontSize: 16, lineHeight: 24, fontWeight: "600", color: t.ink },
  excerpt: { fontSize: 13, lineHeight: 22, color: "#4a5162", marginTop: 5 },
  meta: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 9 },
  metaLeft: { flex: 1, flexDirection: "row", gap: 6, alignItems: "center" },
  genre: {
    fontSize: 11,
    color: t.brand,
    paddingVertical: 1,
    paddingHorizontal: 6,
    backgroundColor: "#eef3ff",
    borderRadius: 4,
  },
  metadata: { fontSize: 11, lineHeight: 18, color: t.muted },
});
