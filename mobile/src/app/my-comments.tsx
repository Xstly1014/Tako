import { useState } from "react";
import { MyChapterComments } from "../novels/MyChapterComments";
import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { MyCommentList, commentStyles as s } from "../components/CommentsPanel";
export default function MyComments() {
  const [kind, setKind] = useState<"work" | "chapter">("work");
  return (
    <SafeAreaView style={s.screen}>
      <View style={s.header}>
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            router.canGoBack() ? router.back() : router.replace("/account")
          }
          style={s.button}
        >
          <Text style={s.link}>返回</Text>
        </Pressable>
        <Text style={s.heading}>我的评论与处置原因</Text>
        <View style={{ width: 44 }} />
      </View>
      <View style={{ flexDirection: "row", gap: 16, paddingHorizontal: 16 }}>
        {(["work", "chapter"] as const).map((value) => (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityState={{ selected: kind === value }}
            onPress={() => setKind(value)}
            style={s.button}
          >
            <Text style={kind === value ? s.link : s.muted}>
              {value === "work" ? "中篇评论" : "长文章节评论"}
            </Text>
          </Pressable>
        ))}
      </View>
      {kind === "work" ? <MyCommentList /> : <MyChapterComments />}
    </SafeAreaView>
  );
}
