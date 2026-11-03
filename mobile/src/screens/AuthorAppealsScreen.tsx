import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect, usePreventRemove } from "expo-router";
import { randomUUID } from "expo-crypto";
import { useSession } from "../auth/context";
import { AuthorAppealsApi, appealMessage } from "../api/author-appeals";
import { AuthorAppeals } from "../author-works/appeals";
import { Status } from "../components/Ui";
import { theme as t } from "../theme";

function Button({
  label,
  disabled = false,
  onPress,
}: {
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        disabled && s.disabled,
        pressed && s.pressed,
      ]}
    >
      <Text style={s.link}>{label}</Text>
    </Pressable>
  );
}
const time = (value: string) =>
  new Date(value)
    .toISOString()
    .replace("T", " ")
    .replace(".000Z", " UTC")
    .replace("Z", " UTC");
const leavePrompt = (leave: () => void) =>
  Alert.alert(
    "复核内容尚在本页",
    "理由和重试标识仅在本页保留。服务端可能已受理；离开后重新进入只读取，不会自动补发。",
    [
      { text: "留在本页", style: "cancel" },
      { text: "离开本页", onPress: leave },
    ],
  );
export default function AuthorAppealsScreen() {
  const { generation, account, phase, session } = useSession();
  if (phase !== "ready" || !account)
    return (
      <SafeAreaView style={s.screen}>
        <Status
          loading={phase === "loading"}
          title={phase === "offline" ? "连接后确认账号" : "登录后查看本人处置"}
          message="处置、复核理由及固定版本仅向当前账号开放。"
          actionLabel={phase === "offline" ? "重试确认账号" : "返回我的"}
          onRetry={() =>
            phase === "offline"
              ? void session.restore()
              : router.replace("/account")
          }
        />
      </SafeAreaView>
    );
  return (
    <Workspace
      key={generation}
      generation={generation}
      accountId={account.id}
    />
  );
}
function Workspace({
  generation,
  accountId,
}: {
  generation: number;
  accountId: string;
}) {
  const { session } = useSession();
  const flow = useMemo(
    () =>
      new AuthorAppeals(
        new AuthorAppealsApi((path, options) =>
          session.authorized(path, options),
        ),
        () =>
          session.snapshot().generation === generation &&
          session.snapshot().account?.id === accountId,
        randomUUID,
      ),
    [session, generation, accountId],
  );
  const state = useSyncExternalStore(flow.subscribe, flow.snapshot);
  const [reason, setReason] = useState(""),
    [localError, setLocalError] = useState<unknown>(),
    [showBody, setShowBody] = useState(false);
  const {
    detail,
    id,
    page,
    busy,
    loaded,
    error,
    prepared,
    pending,
    confirmed,
    needsRead,
  } = state;
  const dirty = !!pending || !!prepared || !!reason.trim();
  usePreventRemove(dirty, ({ repeat }) => leavePrompt(repeat));
  useEffect(() => () => flow.dispose(), [flow]);
  useFocusEffect(
    useCallback(() => {
      void flow.read();
      return () => flow.suspend();
    }, [flow]),
  );
  const clearLocal = () => {
    setReason("");
    setLocalError(undefined);
    setShowBody(false);
  };
  const back = () => {
    const leave = () => {
      flow.dispose();
      clearLocal();
      if (id) void flow.open(0);
      else router.dismissTo("/my-works");
    };
    if (dirty) leavePrompt(leave);
    else leave();
  };
  const refresh = () => {
    setLocalError(undefined);
    setShowBody(false);
    void flow.read();
  };
  const submit = async () => {
    setLocalError(undefined);
    try {
      await flow.send();
      if (flow.snapshot().confirmed) setReason("");
    } catch (e) {
      setLocalError(e);
    }
  };
  const canPrepare =
    !!detail &&
    !busy &&
    !prepared &&
    !pending &&
    !needsRead &&
    detail.case.state === "active" &&
    !detail.appeals.items.some((x) => x.state === "pending");
  return (
    <SafeAreaView style={s.screen}>
      <View style={s.header}>
        <Button
          label={id ? "返回处置列表" : "返回作品管理"}
          onPress={back}
          disabled={busy}
        />
        <Text style={s.heading}>处置与复核</Text>
        <Button
          label="刷新处置"
          disabled={busy || !!prepared}
          onPress={refresh}
        />
      </View>
      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.note}>
          查看原因与固定正式版本，申请文字复核。复核或撤销不会自动公开作品、切换版本或解除其他处置。
        </Text>
        {confirmed ? (
          <Text style={s.note}>
            {needsRead
              ? "申请已确认，当前处置读取未完成。请重试读取，不会再次提交。"
              : "申请已确认，当前处置与复核记录已重新读取。"}
          </Text>
        ) : null}
        {error || localError ? (
          <Text style={s.error}>{appealMessage(localError ?? error)}</Text>
        ) : null}
        {!id ? (
          <>
            {!page.items.length ? (
              <Status
                loading={busy}
                title={
                  busy
                    ? "正在读取本人处置"
                    : error
                      ? "处置列表未能读取"
                      : loaded
                        ? "没有处置记录"
                        : "读取本人处置"
                }
                message="此处不包含私密工作稿。可返回作品管理继续创作。"
                onRetry={refresh}
              />
            ) : (
              page.items.map((item) => (
                <View key={item.id} style={s.panel}>
                  <Text style={s.heading}>
                    处置 #{item.id} ·{" "}
                    {item.scope === "work"
                      ? "作品整体"
                      : `版本 V${item.version}`}{" "}
                    · {item.state === "active" ? "有效" : "已撤销"}
                  </Text>
                  <Text selectable style={s.note}>
                    {item.reason}
                  </Text>
                  <Text style={s.meta}>{time(item.created_at)}</Text>
                  <Button
                    label={`查看处置 #${item.id}`}
                    disabled={busy}
                    onPress={() => {
                      clearLocal();
                      void flow.open(item.id);
                    }}
                  />
                </View>
              ))
            )}
            {page.next ? (
              <Button
                label={error ? "重试更多处置" : "加载更多处置"}
                disabled={busy}
                onPress={() => void flow.read(true)}
              />
            ) : null}
          </>
        ) : !detail ? (
          <Status
            loading={busy}
            title={busy ? "正在读取处置详情" : "处置详情未能读取"}
            onRetry={refresh}
          />
        ) : (
          <>
            <Text style={s.heading}>
              处置 #{detail.case.id} ·{" "}
              {detail.case.scope === "work"
                ? "作品整体"
                : `固定版本 V${detail.case.version}`}{" "}
              · {detail.case.state === "active" ? "有效" : "已撤销"}
            </Text>
            <Text style={s.heading}>{detail.work.title}</Text>
            <Text style={s.meta}>
              对应正式 V{detail.work.version} · {time(detail.case.created_at)}
            </Text>
            <Text selectable style={s.body}>
              处置原因：{detail.case.reason}
            </Text>
            <Button
              label={showBody ? "收起对应正式正文" : "查看对应正式正文"}
              disabled={busy}
              onPress={() => setShowBody(!showBody)}
            />
            {showBody ? (
              <Text selectable style={s.body}>
                {detail.work.content}
              </Text>
            ) : null}
            {detail.revocation ? (
              <View style={s.panel}>
                <Text style={s.heading}>撤销说明</Text>
                <Text selectable style={s.body}>
                  {detail.revocation.reason}
                </Text>
                <Text style={s.meta}>{time(detail.revocation.created_at)}</Text>
              </View>
            ) : null}
            {detail.case.state === "active" && detail.case.next_appeal_at ? (
              <Text style={s.note}>
                维持结论后的24小时冷静期。服务端记录最早再次申请时间：
                {time(detail.case.next_appeal_at)}
                。申请资格以服务端时间校验，手机时钟不改变规则。
              </Text>
            ) : null}
            <Text style={s.heading}>历次文字复核</Text>
            {!detail.appeals.items.length ? (
              <Text style={s.note}>尚无复核申请。</Text>
            ) : (
              detail.appeals.items.map((item) => (
                <View key={item.id} style={s.panel}>
                  <Text style={s.heading}>
                    复核 #{item.id} ·{" "}
                    {item.state === "pending"
                      ? "处理中"
                      : item.state === "upheld"
                        ? "维持处置"
                        : "已撤销处置"}
                  </Text>
                  <Text selectable style={s.body}>
                    {item.reason}
                  </Text>
                  <Text style={s.meta}>{time(item.created_at)}</Text>
                  {item.state !== "pending" ? (
                    <>
                      <Text selectable style={s.body}>
                        结论理由：{item.decision_reason}
                      </Text>
                      <Text style={s.meta}>{time(item.decided_at!)}</Text>
                    </>
                  ) : null}
                </View>
              ))
            )}
            {detail.appeals.next ? (
              <Button
                label={error ? "重试更多复核记录" : "加载更多复核记录"}
                disabled={busy || !!prepared || !!pending}
                onPress={() => void flow.read(true)}
              />
            ) : null}
            {pending ? (
              <View style={s.panel}>
                <Text style={s.heading}>原申请结果尚未确认</Text>
                <Text selectable style={s.body}>
                  {pending.reason}
                </Text>
                <Text style={s.note}>
                  只检查同一处置、同一标识和原理由；读取到记录不代替原操作确认。
                </Text>
                <Button
                  label="检查原复核申请"
                  disabled={busy}
                  onPress={() => void submit()}
                />
              </View>
            ) : null}
            {prepared ? (
              <View style={s.panel}>
                <Text style={s.heading}>确认申请处置 #{id} 的文字复核</Text>
                <Text style={s.note}>
                  {detail.case.scope === "work" ? "作品整体" : "版本限制"} ·
                  正式 V{detail.case.version}
                </Text>
                <Text selectable style={s.body}>
                  {prepared.reason}
                </Text>
                <Button
                  label="提交这份复核申请"
                  disabled={busy}
                  onPress={() => void submit()}
                />
                <Button
                  label="取消本次申请"
                  disabled={busy}
                  onPress={() => flow.cancelPreparation()}
                />
              </View>
            ) : null}
            {detail.case.state === "active" ? (
              <>
                <Text style={s.heading}>补充复核理由</Text>
                <TextInput
                  accessibilityLabel="文字复核理由"
                  multiline
                  value={reason}
                  editable={canPrepare}
                  onChangeText={setReason}
                  placeholder="说明需要重新检查的位置与理由，最多2000字"
                  style={s.input}
                />
                <Text style={s.meta}>
                  {[...reason].length} / 2000 字；仅在当前页面保留
                </Text>
                <Button
                  label="确认复核理由"
                  disabled={!canPrepare}
                  onPress={() => {
                    try {
                      flow.prepare(reason);
                      setLocalError(undefined);
                    } catch (e) {
                      setLocalError(e);
                    }
                  }}
                />
                {detail.appeals.items.some((x) => x.state === "pending") ? (
                  <Text style={s.note}>
                    已有处理中申请，请等待结论或刷新读取。
                  </Text>
                ) : null}
              </>
            ) : (
              <Text style={s.note}>
                此处置已撤销，不再接受新申请。其他有效限制与作者隐藏仍分别生效。
              </Text>
            )}
            {needsRead && !pending ? (
              <Button
                label="重新读取处置现状"
                disabled={busy || !!prepared}
                onPress={refresh}
              />
            ) : null}
            <Text selectable style={s.note}>
              运营联系邮箱：1125448766@qq.com。联系不承诺即时处理。
            </Text>
            <Button
              label="打开邮件应用联系运营"
              disabled={busy}
              onPress={() => {
                void Linking.openURL("mailto:1125448766@qq.com").catch(() =>
                  setLocalError(new Error("mail_app_unavailable")),
                );
              }}
            />
            {localError instanceof Error &&
            localError.message === "mail_app_unavailable" ? (
              <Text style={s.error}>
                未能打开邮件应用，可复制上方邮箱自行联系。
              </Text>
            ) : null}
            <Button
              label="返回对应作品管理"
              disabled={busy || dirty}
              onPress={() =>
                router.push({
                  pathname: "/my-works/[id]",
                  params: { id: detail.case.work_id },
                })
              }
            />
          </>
        )}
        {busy ? <Status loading title="正在处理" /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: t.surface },
  header: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 8,
  },
  content: { padding: 16, gap: 16, paddingBottom: 32 },
  heading: { fontSize: 16, fontWeight: "600", lineHeight: 24, color: t.ink },
  body: { fontSize: 16, lineHeight: 24, color: t.ink },
  note: { fontSize: 14, lineHeight: 22, color: t.secondary },
  meta: { fontSize: 12, lineHeight: 20, color: t.muted },
  button: { minHeight: 44, justifyContent: "center", padding: 8 },
  link: { fontSize: 14, color: t.brand },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
  panel: {
    padding: 16,
    gap: 8,
    borderRadius: 8,
    backgroundColor: t.background,
  },
  input: {
    minHeight: 120,
    padding: 12,
    borderWidth: 1,
    borderColor: t.line,
    borderRadius: 4,
    color: t.ink,
    fontSize: 16,
    textAlignVertical: "top",
  },
  error: { fontSize: 14, lineHeight: 22, color: t.danger },
});
