import { useMemo, useState, useSyncExternalStore } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { router, useLocalSearchParams, usePreventRemove } from "expo-router";
import { useSession } from "../../auth/context";
import { DraftAccessGate } from "../../drafts/DraftAccessGate";
import { DraftEditorScreen } from "../../drafts/DraftEditorScreen";
import { nativeDraftTools } from "../../drafts/native";
import { DraftEditor, localAllowed } from "../../drafts/workspace";
import { id } from "../../drafts/model";
export default function EditorRoute() {
  const params = useLocalSearchParams<{ id?: string | string[] }>(), state = useSession();
  const tools = useMemo(() => nativeDraftTools(state.session), [state.session]);
  const [editor, setEditor] = useState<DraftEditor | null>(null);
  // Pure, guarded initialization after the session grants local access. Keep
  // the instance through later locks so its unpersisted input is not discarded.
  if (!editor && typeof params.id === "string" && id(params.id) && localAllowed(state))
    setEditor(new DraftEditor(state.drafts.owner!, params.id, tools));
  if (typeof params.id !== "string" || !id(params.id)) return <View><Text>草稿链接无效。</Text><Pressable onPress={() => router.replace("/drafts")}><Text>返回草稿箱</Text></Pressable></View>;
  return editor ? <EditorBoundary editor={editor} /> : <DraftAccessGate>{null}</DraftAccessGate>;
}
function EditorBoundary({ editor }: { editor: DraftEditor }) {
  const value = useSyncExternalStore(editor.subscribe, editor.snapshot);
  // Keep this guard mounted while the access gate hides private inputs.
  const disablePrevention = usePreventRemove(editor.hasUnstored() || value.saving, () => {
    Alert.alert("文字尚未暂存", "先重试本机暂存，成功后再返回。草稿锁定时，请先用原账号登录恢复。", [
      { text: "继续编辑", style: "cancel" },
      { text: "重试暂存", onPress: () => void editor.save().catch(() => undefined) },
    ]);
  });
  return <DraftAccessGate owner={editor.owner}><DraftEditorScreen editor={editor} onCopied={key => {
    if (!editor.hasUnstored() && !editor.snapshot().saving) { disablePrevention(); router.replace(`/drafts/${key}`); }
  }} /></DraftAccessGate>;
}
