import { router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import AuthorWorksScreen from "../../screens/AuthorWorksScreen";
import { Status } from "../../components/Ui";
import { UUID } from "../../api/reader";

export default function DirectedAuthorWork() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const backToList = () => router.dismissTo("/my-works");
  if (typeof id !== "string" || !UUID.test(id) || id === "00000000-0000-0000-0000-000000000000")
    return <SafeAreaView><Status title="作品入口无效" actionLabel="返回作品列表" onRetry={backToList} /></SafeAreaView>;
  return <AuthorWorksScreen workId={id} onCloseWork={backToList} />;
}
