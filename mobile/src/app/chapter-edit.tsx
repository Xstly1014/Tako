import { useMemo, useState, useSyncExternalStore } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { router, useLocalSearchParams, usePreventRemove } from "expo-router";
import { useSession } from "../auth/context";
import { DraftAccessGate } from "../drafts/DraftAccessGate";
import { DraftEditorScreen } from "../drafts/DraftEditorScreen";
import { nativeChapterTools } from "../novels/chapters/native";
import { DraftEditor, localAllowed } from "../drafts/workspace";
import { id } from "../drafts/model";
export default function ChapterEditorRoute() {
  const params = useLocalSearchParams<{
    id?: string | string[];
    book?: string | string[];
  }>();
  if (
    typeof params.id !== "string" ||
    !id(params.id) ||
    typeof params.book !== "string" ||
    !id(params.book)
  )
    return (
      <View>
        <Text>章节草稿链接无效。</Text>
        <Pressable onPress={() => router.replace("/drafts")}>
          <Text>返回草稿箱</Text>
        </Pressable>
      </View>
    );
  return (
    <Workspace
      key={params.book + params.id}
      book={params.book}
      localId={params.id}
    />
  );
}
function Workspace({ book, localId }: { book: string; localId: string }) {
  const state = useSession(),
    tools = useMemo(
      () => nativeChapterTools(state.session, book),
      [state.session, book],
    );
  const [editor, setEditor] = useState<DraftEditor | null>(null);
  if (!editor && localAllowed(state))
    setEditor(new DraftEditor(state.drafts.owner!, localId, tools));
  return editor ? (
    <Boundary editor={editor} book={book} />
  ) : (
    <DraftAccessGate>{null}</DraftAccessGate>
  );
}
function Boundary({ editor, book }: { editor: DraftEditor; book: string }) {
  const value = useSyncExternalStore(editor.subscribe, editor.snapshot);
  const disablePrevention = usePreventRemove(
    editor.hasUnstored() || value.saving,
    () =>
      Alert.alert(
        "文字尚未暂存",
        "先重试本机暂存，成功后再返回。草稿锁定时，请先用原账号登录恢复。",
        [
          { text: "继续编辑", style: "cancel" },
          {
            text: "重试暂存",
            onPress: () => void editor.save().catch(() => undefined),
          },
        ],
      ),
  );
  return (
    <DraftAccessGate owner={editor.owner}>
      <DraftEditorScreen
        chapterBook={book}
        editor={editor}
        onCopied={(key) => {
          if (!editor.hasUnstored() && !editor.snapshot().saving) {
            disablePrevention();
            router.replace(`/chapter-edit?book=${book}&id=${key}`);
          }
        }}
      />
    </DraftAccessGate>
  );
}
