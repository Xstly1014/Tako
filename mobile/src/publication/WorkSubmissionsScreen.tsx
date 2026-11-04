import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { randomUUID } from "expo-crypto";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSession } from "../auth/context";
import { Action, Status } from "../components/Ui";
import { theme as t } from "../theme";
import { ApiError } from "../api/client";
import { id } from "../drafts/model";
import { readingChunks } from "../novels/reading-model";
import {
  AuthorPolicyApi,
  type AuthorPolicyPage,
} from "../novels/author-policy-api";
import { workSubmissionJournal } from "./journal";
import {
  WorkSubmissionsApi,
  WorkSubmissionWithdrawal,
  type WorkSubmission,
  type WorkSubmissionDetail,
  type WithdrawRecord,
} from "./submissions";
const label = (state: string) =>
  ({
    pending: "等待审核",
    published: "已发布",
    rejected: "已驳回",
    withdrawn: "已撤回",
    superseded: "已被新提交替换",
  })[state] ?? "状态待确认";
export default function WorkSubmissionsScreen() {
  const auth = useSession(),
    params = useLocalSearchParams<{ work?: string; submission?: string }>();
  if (
    (params.work !== undefined && !id(params.work)) ||
    (params.submission !== undefined && !id(params.submission))
  )
    return (
      <Status
        title="提交记录地址无效"
        actionLabel="返回我的作品"
        onRetry={() => router.dismissTo("/my-works")}
      />
    );
  if (auth.phase !== "ready" || !auth.account)
    return (
      <Status
        title="登录后查看本人提交"
        actionLabel="去登录"
        onRetry={() => router.push("/account")}
      />
    );
  return (
    <Submissions
      key={auth.account.id + ":" + auth.generation+":"+(params.work??"")+":"+(params.submission??"")}
      owner={auth.account.id}
      work={params.work ?? ""}
      target={params.submission}
    />
  );
}
function Submissions({
  owner,
  work,
  target,
}: {
  owner: string;
  work: string;
  target?: string;
}) {
  const { session } = useSession();
  const [tools] = useState(() => {
    const generation = session.snapshot().generation;
    const current = () => {
      const a = session.snapshot();
      return (
        a.phase === "ready" &&
        !a.busy &&
        a.generation === generation &&
        a.account?.id === owner
      );
    };
    const transport = <T,>(
      p: string,
      o?: Parameters<typeof session.authorized>[1],
    ) => session.authorized<T>(p, o);
    const api = new WorkSubmissionsApi(transport);
    return {
      api,
      current,
      policy: new AuthorPolicyApi(transport),
      withdraw: new WorkSubmissionWithdrawal(
        owner,
        workSubmissionJournal(owner),
        api,
        current,
        randomUUID,
      ),
    };
  });
  const [showPolicy, setShowPolicy] = useState(false);
  const [items, setItems] = useState<WorkSubmission[]>([]),
    [cursor, setCursor] = useState(""),
    [detail, setDetail] = useState<WorkSubmissionDetail>(),
    [record, setRecord] = useState<WithdrawRecord | null>(),
    [policy, setPolicy] = useState<AuthorPolicyPage>(),
    [busy, setBusy] = useState(true),
    [error, setError] = useState("");
  const active = useRef(true),
    lock = useRef(false),
    initial = useRef<Promise<{ r: WithdrawRecord | null }> | undefined>(
      undefined,
    );
  const guard = useCallback(() => {
    if (!active.current || !tools.current())
      throw new ApiError("stale_session");
  }, [tools]);
  async function load(more = false) {
    const p = await tools.api.list(work, more ? cursor : "");
    guard();
    setItems((old) =>
      more
        ? [...old, ...p.items.filter((s) => !old.some((x) => x.id === s.id))]
        : p.items,
    );
    setCursor(p.next_cursor);
  }
  async function readPolicy(more = false) {
    const p = await tools.policy.read(null, more ? policy?.next : 0);
    guard();
    setPolicy((old) =>
      more && old
        ? {
            ...p,
            items: [
              ...old.items,
              ...p.items.filter(
                (e) => !old.items.some((x) => x.revision === e.revision),
              ),
            ],
          }
        : p,
    );
    setShowPolicy(true);
  }
  async function run(f: () => Promise<unknown>) {
    if (lock.current || !active.current || !tools.current()) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await f();
      guard();
    } catch (e) {
      if (active.current && tools.current())
        setError(
          e instanceof ApiError && e.code === "review_conflict"
            ? "待审状态已变化，本次操作未受理；确认记录后刷新。"
            : "暂时无法读取或确认。原内容和操作仍保留，可重试。",
        );
    } finally {
      lock.current = false;
      if (active.current && tools.current()) {
        setRecord(tools.withdraw.record);
        setBusy(false);
      }
    }
  }
  useEffect(() => {
    active.current = true;
    let cancelled = false;
    initial.current ??= (async () => ({ r: await tools.withdraw.restore() }))();
    initial.current
      .then(async ({ r }) => {
        if (cancelled) return;
        setRecord(r);
        const [p, policy] = await Promise.all([
          tools.api.list(work),
          tools.policy.read(null),
        ]);
        if (!cancelled) {
          guard();
          setItems(p.items);
          setCursor(p.next_cursor);
          setPolicy(policy);
          if (target) {
            const d = await tools.api.detail(target);
            guard();
            if (work && d.submission.work_id !== work)
              throw new ApiError("contract");
            if (!cancelled) setDetail(d);
          }
        }
      })
      .catch(() => {
        if (!cancelled) setError("读取未完成，请重试；已加载原操作会保留。");
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
      active.current = false;
    };
  }, [tools, work, target, guard]);
  const header = (
    <View style={s.section}>
      <View style={s.actions}>
        <Action
          label={detail ? "返回提交列表" : "返回我的作品"}
          onPress={() =>
            detail ? setDetail(undefined) : router.dismissTo("/my-works")
          }
        />
        <Text style={s.heading}>中篇先审记录</Text>
      </View>
      <Text style={s.note}>
        这里记录先审提交，通过后才产生正式版。替换、驳回或撤回不覆盖工作稿。
      </Text>
      {policy?.policy.active ? (
        <Text style={s.note}>
          账号观察中：中篇与长文新提交先审后发。结束时间{" "}
          {new Date(policy.policy.observation_until!).toLocaleString("zh-CN")}。
          {policy.policy.reason}
        </Text>
      ) : null}
      <Action
        label={showPolicy ? "收起观察期记录" : "查看账号观察期"}
        disabled={busy}
        onPress={() =>
          showPolicy ? setShowPolicy(false) : void run(() => readPolicy())
        }
      />
      {showPolicy && policy ? (
        <View style={s.section}>
          {policy.items.length ? (
            policy.items.map((e) => (
              <View key={e.revision}>
                <Text style={s.note}>
                  {e.action === "start"
                    ? "开始7天观察期"
                    : e.action === "extend"
                      ? "延长7天"
                      : "提前结束观察期"}{" "}
                  · {e.reason}
                </Text>
                <Text style={s.meta}>
                  {new Date(e.created_at).toLocaleString("zh-CN")}
                  {e.observation_until
                    ? " · 结束 " +
                      new Date(e.observation_until).toLocaleString("zh-CN")
                    : ""}
                </Text>
              </View>
            ))
          ) : (
            <Text style={s.note}>暂无观察期决定记录。</Text>
          )}
          {policy.next ? (
            <Action
              label="更早的观察期记录"
              disabled={busy}
              onPress={() => void run(() => readPolicy(true))}
            />
          ) : null}
        </View>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={s.note}>
          {error}
        </Text>
      ) : null}
      {record ? (
        <View style={s.section}>
          {((work&&record.work!==work)||(detail&&record.work!==detail.submission.work_id))?<Text style={s.note}>这是另一篇作品的原撤回，确认前不会处理当前作品。</Text>:null}
          <Text style={s.heading}>
            {record.state === "done"
              ? "撤回已确认"
              : record.state === "rejected"
                ? "撤回未受理"
                : "原撤回待确认"}
          </Text>
          {record.state === "unknown" ? (
            <>
              <Action
                label="查询原撤回结果"
                disabled={busy}
                onPress={() => void run(() => tools.withdraw.confirm())}
              />
              <Action
                label="重试同一撤回"
                disabled={busy}
                onPress={() => void run(() => tools.withdraw.retry())}
              />
            </>
          ) : (
            <Action
              label="确认记录并刷新"
              disabled={busy}
              onPress={() =>
                void run(async () => {
                  await tools.withdraw.clear();
                  await load();
                  if (detail) {
                    const d = await tools.api.detail(detail.submission.id);
                    guard();
                    setDetail(d);
                  }
                })
              }
            />
          )}
        </View>
      ) : null}
      {detail ? (
        <>
          <Text style={s.heading}>{detail.submission.title}</Text>
          <Text style={s.note}>
            {label(detail.submission.state)} · {detail.submission.reason}
          </Text>
          <Text style={s.note}>{detail.preview.introduction}</Text>
          <Text style={s.meta}>{detail.preview.tags.join(" / ")}</Text>
          {detail.submission.state === "pending" ? (
            <Action
              label="撤回这次待审提交"
              disabled={busy || !!record}
              onPress={() =>
                Alert.alert(
                  "撤回这次待审提交？",
                  "固定提交保留撤回记录，工作稿和已发布版本不变。",
                  [
                    { text: "取消", style: "cancel" },
                    {
                      text: "撤回",
                      onPress: () =>
                        void run(() => tools.withdraw.start(detail.submission)),
                    },
                  ],
                )
              }
            />
          ) : null}
          <Action
            label="刷新这条提交"
            disabled={busy}
            onPress={() =>
              void run(async () => {
                const d = await tools.api.detail(detail.submission.id);
                guard();
                setDetail(d);
              })
            }
          />
        </>
      ) : (
        <Action
          label="刷新提交记录"
          disabled={busy}
          onPress={() => void run(() => load())}
        />
      )}
    </View>
  );
  const rows = detail
    ? readingChunks(detail.preview.content).map((text, i) => ({
        key: String(i),
        text,
        item: undefined as WorkSubmission | undefined,
      }))
    : items.map((item) => ({ key: item.id, text: "", item }));
  return (
    <SafeAreaView style={s.screen}>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.key}
        ListHeaderComponent={header}
        contentContainerStyle={s.content}
        renderItem={({ item: r }) =>
          r.item ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={"查看提交 " + r.item.title}
              disabled={busy}
              style={s.row}
              onPress={() =>
                void run(async () => {
                  const d = await tools.api.detail(r.item!.id);
                  guard();
                  setDetail(d);
                })
              }
            >
              <Text numberOfLines={2} style={s.itemTitle}>
                {r.item.title}
              </Text>
              <Text style={s.meta}>{label(r.item.state)}</Text>
            </Pressable>
          ) : (
            <Text style={s.body}>{r.text}</Text>
          )
        }
        ListEmptyComponent={
          <Text style={s.note}>
            {busy ? "正在读取…" : "还没有已提交记录。"}
          </Text>
        }
        ListFooterComponent={
          !detail && cursor ? (
            <Action
              label="更多提交记录"
              disabled={busy}
              onPress={() => void run(() => load(true))}
            />
          ) : undefined
        }
      />
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: t.background },
  content: { padding: 16, paddingBottom: 32 },
  section: { gap: 16, marginBottom: 24 },
  actions: { gap: 8 },
  heading: { fontSize: 20, lineHeight: 28, fontWeight: "600", color: t.ink },
  note: { fontSize: 14, lineHeight: 24, color: t.muted },
  meta: { fontSize: 12, lineHeight: 20, color: t.muted },
  itemTitle: { fontSize: 16, lineHeight: 24, fontWeight: "600", color: t.ink },
  row: { paddingVertical: 8, minHeight: 64, gap: 8 },
  body: { fontSize: 16, lineHeight: 28, color: t.ink, marginBottom: 16 },
});
