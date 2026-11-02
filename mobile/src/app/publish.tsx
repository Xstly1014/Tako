import { useMemo } from "react";
import { View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSession } from "../auth/context";
import { PublicationWorkspace } from "../publication/PublicationWorkspace";
import { publicationJournal } from "../publication/journal";
import { Status } from "../components/Ui";
import { theme } from "../theme";
import { publicationInput } from "../api/publications";
export default function PublishRoute() {
  const { phase, generation, account, session } = useSession();
  const params = useLocalSearchParams<{
    draft_id?: string;
    source_revision?: string;
  }>();
  const accountId = account?.id;
  const store = useMemo(
    () => (accountId ? publicationJournal(accountId) : null),
    [accountId],
  );
  let input: ReturnType<typeof publicationInput> | null = null;
  try {
    input = publicationInput(params);
  } catch {
    /* Invalid handoff never selects a revision. */
  }
  if (!input)
    return (
      <SafeAreaView>
        <Status
          title="发布入口参数无效"
          message="请从本人作品管理或草稿箱重新选择服务器修订。"
          actionLabel="返回作品管理"
          onRetry={() => router.replace("/my-works")}
        />
      </SafeAreaView>
    );
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.surface }}>
      {phase === "ready" && account && store ? (
        <PublicationWorkspace
          key={`${generation}:${input.draftId}:${input.revision}`}
          store={store}
          accountId={account.id}
          generation={generation}
          draftId={input.draftId}
          revision={input.revision}
        />
      ) : (
        <View>
          <Status
            loading={phase === "loading"}
            title="确认账号后发布"
            message="发布只使用本人服务器修订，不会自动提交。"
            actionLabel={phase === "offline" ? "重试确认账号" : "去我的登录"}
            onRetry={() =>
              phase === "offline"
                ? void session.restore()
                : router.replace("/account")
            }
          />
        </View>
      )}
    </SafeAreaView>
  );
}
