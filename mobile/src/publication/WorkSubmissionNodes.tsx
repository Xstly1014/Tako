import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useSession } from "../auth/context";
import { WorkSubmissionsApi, type WorkSubmission } from "./submissions";
import { theme as t } from "../theme";
const label = (s: string) =>
  s === "pending" ? "待审核" : s === "rejected" ? "已驳回" : "已撤回";
export function WorkSubmissionNodes({ work }: { work: string }) {
  const { session, account, generation, phase, busy } = useSession();
  const scope = (account?.id ?? "") + ":" + generation + ":" + work;
  const [data, setData] = useState<{
      scope: string;
      items: WorkSubmission[];
      more: boolean;
      error: boolean;
    }>({ scope: "", items: [], more: false, error: false }),
    [attempt, setAttempt] = useState(0);
  useFocusEffect(
    useCallback(() => {
      void attempt;
      if (phase !== "ready" || !account || busy) return;
      let active = true;
      const owner = account.id;
      const valid = () => {
        const s = session.snapshot();
        return (
          active &&
          s.phase === "ready" &&
          !s.busy &&
          s.account?.id === owner &&
          s.generation === generation
        );
      };
      const api = new WorkSubmissionsApi((p, o) => session.authorized(p, o));
      void api
        .list(work)
        .then((p) => {
          if (valid())
            setData({
              scope,
              items: p.items.filter(x=>!["published","superseded"].includes(x.state)).reverse(),
              more: !!p.next_cursor,
              error: false,
            });
        })
        .catch(() => {
          if (valid())
            setData((old) =>
              old.scope === scope
                ? { ...old, error: true }
                : { scope, items: [], more: false, error: true },
            );
        });
      return () => {
        active = false;
      };
    }, [session, account, generation, work, attempt, phase, busy, scope]),
  );
  const { items, more, error } =
    data.scope === scope ? data : { items: [], more: false, error: false };
  if (phase !== "ready" || !account || busy) return null;
  const open = (submission?: string) => {
    const now=session.snapshot();if(now.phase!=="ready"||now.busy||now.generation!==generation||now.account?.id!==account?.id)return;
    return router.push({
      pathname: "/work-submissions",
      params: { work, ...(submission ? { submission } : {}) },
    });
  };
  if (!items.length && !more && !error) return null;
  return (
    <View style={s.section}>
      <Text style={s.meta}>待审与处理记录</Text>
      {error ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="重读提交节点"
          onPress={() => setAttempt((x) => x + 1)}
        >
          <Text style={s.meta}>
            节点读取未完成，点击重试。原正式版不受影响。
          </Text>
        </Pressable>
      ) : null}
      <ScrollView horizontal contentContainerStyle={s.nodes}>
        {items.map((item, i) => (
          <View style={s.node} key={item.id}>
            {i > 0 ? <View style={s.line} /> : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                "查看" + label(item.state) + "提交 " + item.title
              }
              onPress={() => open(item.id)}
              style={s.target}
            >
              <View
                style={[
                  s.dot,
                  {
                    backgroundColor:
                      item.state === "pending"
                        ? "#c18b20"
                        : item.state === "rejected"
                          ? t.danger
                          : t.muted,
                  },
                ]}
              />
            </Pressable>
          </View>
        ))}
      </ScrollView>
      <Text style={s.meta}>
        待审核 / 已驳回 / 已撤回 · 点击节点核对固定内容
      </Text>
      {more ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="更多提交记录"
          onPress={() => open()}
        >
          <Text style={s.link}>更多提交记录</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
const s = StyleSheet.create({
  section: { gap: 8, marginVertical: 16 },
  meta: { fontSize: 12, lineHeight: 20, color: t.muted },
  nodes: { alignItems: "center" },
  node: { flexDirection: "row", alignItems: "center" },
  target: {
    minHeight: 44,
    minWidth: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  line: { width: 16, height: 1, backgroundColor: t.line },
  link: { fontSize: 14, lineHeight: 24, color: t.brand },
});
