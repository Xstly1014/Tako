import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useSession } from "../../auth/context";
import { theme as t } from "../../theme";
import { localChapterBooks } from "./native";
import type { CachedChapterBook } from "./storage";
export function LocalChapterBooks() {
  const { session, generation } = useSession();
  const [books, setBooks] = useState<CachedChapterBook[]>([]),
    [error, setError] = useState(false);
  const refresh = useCallback(() => {
    let active = true;
    void localChapterBooks(session.snapshot)
      .then((value) => {
        if (active && session.snapshot().generation === generation) {
          setBooks(value);
          setError(false);
        }
      })
      .catch(() => {
        if (active && session.snapshot().generation === generation)
          setError(true);
      });
    return () => {
      active = false;
    };
  }, [session, generation]);
  useFocusEffect(refresh);
  return error ? (
    <Text style={{ padding: 16, color: t.danger }}>
      本机章节目录暂不可读取，请返回后重试。
    </Text>
  ) : books.length ? (
    <View style={{ paddingHorizontal: 16, paddingVertical: 8, gap: 8 }}>
      <Text style={{ fontSize: 12, color: t.muted }}>
        本机章节 · 可离线续写
      </Text>
      {books.map((book) => (
        <Pressable
          key={book.id}
          accessibilityRole="button"
          accessibilityLabel={"本机章节 " + book.title}
          onPress={() => router.push(`/novel-drafts?book=${book.id}`)}
          style={({ pressed }) => ({
            minHeight: 44,
            paddingVertical: 12,
            backgroundColor: pressed ? t.background : t.surface,
          })}
        >
          <Text style={{ fontSize: 14, color: t.ink }} numberOfLines={1}>
            {book.title}
          </Text>
        </Pressable>
      ))}
    </View>
  ) : null;
}
