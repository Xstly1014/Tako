import { router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import AuthorFeedbackScreen from "../../screens/AuthorFeedbackScreen";
import { UUID } from "../../api/reader";
import { Status } from "../../components/Ui";

export default function AuthorFeedbackRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  if (
    typeof id !== "string" ||
    !UUID.test(id) ||
    id === "00000000-0000-0000-0000-000000000000"
  )
    return (
      <SafeAreaView>
        <Status
          title="反馈入口无效"
          actionLabel="返回作品列表"
          onRetry={() => router.dismissTo("/my-works")}
        />
      </SafeAreaView>
    );
  return <AuthorFeedbackScreen id={id} />;
}
