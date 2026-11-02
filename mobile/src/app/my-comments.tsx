import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { MyCommentList, commentStyles as s } from "../components/CommentsPanel";
export default function MyComments() {
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
      <MyCommentList />
    </SafeAreaView>
  );
}
