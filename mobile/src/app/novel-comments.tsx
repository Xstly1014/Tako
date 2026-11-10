import { Text, View, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { id } from "../drafts/model";
import { useSession } from "../auth/context";
import { MyChapterComments } from "../novels/MyChapterComments";
import { commentStyles as s } from "../components/CommentsPanel";
export default function AuthorChapterComments() {
  const { book } = useLocalSearchParams<{ book: string }>();
  const { account, generation } = useSession();
  return (
    <SafeAreaView style={s.screen}>
      <View style={s.header}>
        <Pressable
          accessibilityRole="button"
          style={s.button}
          onPress={() =>
            router.canGoBack()
              ? router.back()
              : router.replace({ pathname: "/novel-manage", params: { book } })
          }
        >
          <Text style={s.link}>返回正式管理</Text>
        </Pressable>
        <Text style={s.heading}>本书章节评论</Text>
      </View>
      {id(book) ? (
        <MyChapterComments
          key={book + ":" + account?.id + ":" + generation}
          book={book}
        />
      ) : (
        <Text>书籍地址无效</Text>
      )}
    </SafeAreaView>
  );
}
