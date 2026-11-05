import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import * as Crypto from "expo-crypto";
import { Action } from "../components/Ui";
import { ApiError } from "../api/client";
import { theme as t } from "../theme";
import {
  NovelLifecycleApi,
  type CompletionCheck,
  type RectificationDetail,
  type RectificationPreview,
  type Rectification,
} from "./lifecycle-api";
import type { NovelFormalState } from "./management-api";
import {
  isLifecycleCommand,
  type NovelCommand,
  type NovelManagementRecord,
} from "./management-requests";

export const rectificationState = (v: Rectification["state"]) =>
  ({
    available: "可准备整改",
    submitted: "等待人工审核",
    approved: "整改已通过",
    rejected: "整改被驳回",
    cancelled: "授权已取消",
    withdrawn: "已撤回整改",
  })[v];
function explain(e: unknown) {
  if (e instanceof ApiError) {
    if (e.status === 410) return "核对内容已过期，请确认原操作记录后重新准备。";
    if (e.status === 401) return "登录已失效，请同账号重新登录后查询原结果。";
    if (e.status === 404) return "暂时无法读取这条记录，原操作仍保留。";
    if (e.code === "contract") return "返回的记录无法可靠核对，未继续提交。";
  }
  return "读取未完成，请稍后重试；工作稿和原操作记录保留。";
}
export function useLifecycleManagement({
  book,
  api,
  state,
  record,
  busy,
  blocked,
  current,
  confirm,
}: {
  book: string;
  api: NovelLifecycleApi;
  state?: NovelFormalState;
  record: NovelManagementRecord | null;
  busy: boolean;
  blocked: boolean;
  current: () => boolean;
  confirm: (label: string, c: NovelCommand, message?: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [check, setCheck] = useState<CompletionCheck>(),
    [selected, setSelected] = useState<RectificationDetail>(),
    [fixed, setFixed] = useState<RectificationPreview>(),
    [items, setItems] = useState<Rectification[]>([]),
    [before, setBefore] = useState(0),
    [loaded, setLoaded] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [rights, setRights] = useState(false),
    [irreversible, setIrreversible] = useState(false);
  const [staleGrant, setStaleGrant] = useState<string>();
  const [checkedAt, setCheckedAt] = useState(() => Date.now());
  const active = useRef(true),
    serial = useRef(0),
    lock = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    const timers = [check?.expires_at, fixed?.expires_at]
      .filter((v): v is string => !!v)
      .map(Date.parse)
      .filter(Number.isFinite)
      .map((deadline) =>
        setTimeout(
          () => setCheckedAt(Date.now()),
          Math.max(0, Math.min(deadline - Date.now() + 1, 2147483647)),
        ),
      );
    return () => timers.forEach(clearTimeout);
  }, [check?.expires_at, fixed?.expires_at]);
  const valid = (request: number) =>
    active.current && current() && request === serial.current;
  async function read(fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setLoading(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      if (active.current && current()) setError(explain(e));
    } finally {
      lock.current = false;
      if (active.current && current()) setLoading(false);
    }
  }
  async function list(more = false) {
    const request = ++serial.current;
    const p = await api.list(book, more ? before : 0);
    if (!valid(request)) return;
    setItems((old) =>
      more
        ? [...old, ...p.items.filter((v) => !old.some((x) => x.id === v.id))]
        : p.items,
    );
    setBefore(p.next);
    setLoaded(true);
  }
  async function detail(grant: string) {
    const request = ++serial.current;
    const d = await api.detail(book, grant);
    if (!valid(request)) return;
    setStaleGrant(undefined);
    setSelected(d);
    setFixed(d.submitted ?? undefined);
    setRights(false);
    setError("");
  }
  // A recovered original operation only reads its fixed target. Never POST in an effect.
  useEffect(() => {
    if (
      !record?.result ||
      record.command.book !== book ||
      !isLifecycleCommand(record.command)
    )
      return;
    let cancelled = false;
    const request = ++serial.current;
    const command = record.command,
      r = record.result;
    setTimeout(() => {
      if (!cancelled && current()) setOpen(true);
    }, 0);
    void (async () => {
      try {
        if (command.kind === "completion-check") {
          const value = await api.check(book, r.target_id);
          if (cancelled || !current() || serial.current !== request) return;
          setCheck(value);
          setIrreversible(false);
        } else if (command.kind === "rectification-prepare") {
          const [p, d] = await Promise.all([
            api.preview(book, r.target_id),
            api.detail(book, command.grant),
          ]);
          if (
            p.grant_id !== command.grant ||
            p.draft_id !== command.input.draft_id ||
            p.source_revision !== command.input.source_revision ||
            p.grant_revision !== command.input.expected_revision
          )
            throw new ApiError("contract");
          if (cancelled || !current() || serial.current !== request) return;
          setSelected(d);
          setFixed(p);
          setRights(false);
        } else if (
          command.kind === "rectification-submit" ||
          command.kind === "rectification-withdraw"
        ) {
          const d = await api.detail(book, command.grant);
          if (cancelled || !current() || serial.current !== request) return;
          setSelected(d);
          setFixed(d.submitted ?? undefined);
          setRights(false);
        }
      } catch (e) {
        if (!cancelled && current() && serial.current === request) {
          if (
            command.kind === "rectification-submit" ||
            command.kind === "rectification-withdraw"
          )
            setStaleGrant(command.grant);
          setError(explain(e));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, book, record, current]);
  const completed =
    state?.completed ||
    (record?.command.book === book && record?.result?.operation === "complete");
  const disabled = busy || blocked || loading || !!staleGrant;
  const command = (label: string, c: NovelCommand, message?: string) => {
    if (!disabled) confirm(label, c, message);
  };
  const prepare = () => {
    const g = selected?.grant,
      source = selected?.source;
    if (!g || !source || g.state !== "available" || !g.target_current) return;
    command(
      "核对这份服务器工作稿？",
      {
        kind: "rectification-prepare",
        book,
        grant: g.id,
        input: {
          mutation_id: Crypto.randomUUID(),
          expected_revision: g.revision,
          draft_id: source.draft_id,
          source_revision: source.revision,
        },
      },
      "这次只准备固定预览，不消耗整改授权。未同步的本机修改不会带入。",
    );
  };
  const header = open ? (
    <View style={s.section}>
      <QuietAction
        label="返回书籍资料"
        disabled={busy || loading}
        onPress={() => setOpen(false)}
      />
      <Text style={s.title}>
        {completed ? "已完结 · 指定整改" : "完结前核对"}
      </Text>
      <Text style={s.note}>
        完结后不能恢复连载，也不能普通修改旧章。工作稿仍保留；平台要求整改时，只能处理授权指定的章节。
      </Text>
      {!completed ? (
        <QuietAction
          label="准备完结核对"
          disabled={disabled || !state?.formal}
          onPress={() =>
            command("准备完结核对？", {
              kind: "completion-check",
              book,
              input: { mutation_id: Crypto.randomUUID() },
            })
          }
        />
      ) : null}
      {check ? (
        <View style={s.group}>
          <Text style={s.label}>这次核对的章节</Text>
          <Text style={s.note}>
            正式 {check.formal_chapters} 章 · 最后正式第{" "}
            {check.last_formal_ordinal} 章 · 最后预约第{" "}
            {check.last_reserved_ordinal} 章
          </Text>
          <Text style={s.note}>
            隐藏 {check.hidden_chapters} 章 · 受限 {check.restricted_chapters}{" "}
            章 · 待审 {check.pending_chapters} 章 · 未发布工作稿{" "}
            {check.unpublished_drafts} 份
          </Text>
          <Text style={s.meta}>
            有效至 {new Date(check.expires_at).toLocaleString("zh-CN")}
            。确认时服务器会重新核对；期间正式内容变化需重新准备。
          </Text>
          <Text style={s.note}>已有正式章节的后续工作稿也不会自动发布；请先自行确认想发布的内容。</Text>
          {!check.eligible ? (
            <Text style={s.note}>
              {check.completed
                ? "作品已完结。"
                : check.formal_chapters === 0
                  ? "至少发布一章后才能完结。"
                  : "请先处理或撤回所有普通待审章节。"}
            </Text>
          ) : !completed ? (
            <>
              <Toggle
                value={irreversible}
                disabled={disabled}
                onPress={() => setIrreversible((v) => !v)}
                label="我理解完结后不能恢复连载，也不能普通修改旧章"
              />
              <Action
                label="确认不可逆完结"
                disabled={
                  disabled ||
                  !irreversible ||
                  checkedAt >= Date.parse(check.expires_at)
                }
                onPress={() =>
                  command(
                    "确认不可逆完结？",
                    {
                      kind: "complete",
                      book,
                      input: {
                        mutation_id: Crypto.randomUUID(),
                        check_id: check.id,
                        irreversible_confirmed: true,
                      },
                    },
                    "完结后不能恢复连载、不能新增正式章节或普通修订旧章。后续故事需另开作品；工作稿不会删除。",
                  )
                }
              />
            </>
          ) : null}
        </View>
      ) : null}
      <Text style={s.label}>平台指定整改</Text>
      <QuietAction
        label={loaded ? "刷新整改记录" : "读取整改记录"}
        disabled={
          busy || loading || (!!record && !record.outcome && !record.rejection)
        }
        onPress={() => void read(() => list())}
      />
      {loaded && !items.length ? (
        <Text style={s.note}>
          暂无整改授权。原处置的复核入口仍在“处置与复核”。
        </Text>
      ) : null}
      {items.map((g) => (
        <Pressable
          key={g.id}
          disabled={busy || loading}
          onPress={() => void read(() => detail(g.id))}
          accessibilityRole="button"
          accessibilityLabel={"查看整改 " + g.reason}
          style={s.item}
        >
          <Text style={s.label}>{g.reason}</Text>
          <Text style={s.meta}>{rectificationState(g.state)}</Text>
        </Pressable>
      ))}
      {before ? (
        <QuietAction
          label="更早的整改记录"
          disabled={busy || loading}
          onPress={() => void read(() => list(true))}
        />
      ) : null}
      {selected ? (
        <View style={s.group}>
          <Text style={s.label}>
            {rectificationState(selected.grant.state)}
          </Text>
          <Text style={s.note}>{selected.grant.reason}</Text>
          {selected.grant.decision_reason ? (
            <Text style={s.note}>
              处理说明：{selected.grant.decision_reason}
            </Text>
          ) : null}
          {!selected.grant.target_current &&
          ["available", "submitted"].includes(selected.grant.state) ? (
            <Text style={s.note}>
              关联处置或正式版本已变化，请等待运营重新核对；不能沿旧授权提交或通过。
            </Text>
          ) : null}
          <QuietAction
            label="重新核对这条授权"
            disabled={busy || loading}
            onPress={() => void read(() => detail(selected.grant.id))}
          />
          {selected.grant.state === "available" &&
          selected.grant.target_current ? (
            <>
              {selected.source ? (
                <>
                  <Text style={s.note}>
                    服务器工作稿：{selected.source.title || "未命名章节"} · 修订{" "}
                    {selected.source.revision}
                  </Text>
                  <QuietAction
                    label="编辑对应工作稿"
                    disabled={disabled}
                    onPress={() =>
                      router.push(
                        `/chapter-edit?book=${book}&id=${selected.source!.draft_id}`,
                      )
                    }
                  />
                  <QuietAction
                    label="准备这份工作稿的固定整改预览"
                    disabled={disabled}
                    onPress={prepare}
                  />
                </>
              ) : (
                <Text style={s.note}>
                  暂时没有对应工作稿，请在章节写作中核对；不会自动复制或覆盖原稿。
                </Text>
              )}
            </>
          ) : null}
          {selected.grant.state === "submitted" ? (
            <QuietAction
              label="撤回这次整改提交"
              disabled={disabled}
              onPress={() =>
                command(
                  "撤回这次整改？",
                  {
                    kind: "rectification-withdraw",
                    book,
                    grant: selected.grant.id,
                    input: {
                      mutation_id: Crypto.randomUUID(),
                      expected_revision: selected.grant.revision,
                      reason: "作者主动撤回本次整改",
                      revoke_case: false,
                    },
                  },
                  "撤回后这次授权不能再提交，需要运营重新授权。当前正式正文和工作稿保留。",
                )
              }
            />
          ) : null}
          {fixed ? (
            <>
              <Text style={s.label}>{fixed.title}</Text>
              <Text style={s.meta}>
                {selected.grant.preview_id === fixed.id
                  ? "本次已提交的固定正文"
                  : "本次固定预览，后续工作稿修改不会自动带入"}
              </Text>
            </>
          ) : null}
        </View>
      ) : null}
      {staleGrant ? (
        <Text style={s.note}>
          原提交已确认，但授权现状未刷新；请先重新核对这条授权。
        </Text>
      ) : null}
      {loading ? <Text style={s.note}>正在读取…</Text> : null}
      {error ? (
        <Text style={s.note} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  ) : (
    <QuietAction
      label="完结与指定整改"
      disabled={busy}
      onPress={() => setOpen(true)}
    />
  );
  const footer =
    open && fixed && selected?.grant.state === "available" ? (
      <View style={s.section}>
        <Text style={s.note}>
          请核对上方完整正文。提交后本次授权用完，不能替换待审内容。
        </Text>
        <Toggle
          label="我确认本次内容为原创，或已取得发布授权"
          value={rights}
          disabled={disabled}
          onPress={() => setRights((v) => !v)}
        />
        <Action
          label="提交这份固定整改"
          disabled={
            disabled ||
            !rights ||
            !selected.grant.target_current ||
            checkedAt >= Date.parse(fixed.expires_at)
          }
          onPress={() =>
            command(
              "提交这份固定整改？",
              {
                kind: "rectification-submit",
                book,
                grant: fixed.grant_id,
                input: {
                  mutation_id: Crypto.randomUUID(),
                  expected_revision: fixed.grant_revision,
                  preview_id: fixed.id,
                  rights_confirmed: true,
                },
              },
              "只提交刚才核对的正文，一次授权只能提交一次。提交后等待人工审核，原正式正文保持不变。",
            )
          }
        />
      </View>
    ) : null;
  return {
    open,
    close: () => setOpen(false),
    header,
    footer,
    body: open ? fixed?.content : undefined,
  };
}
function QuietAction({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        alignSelf: "flex-start",
        minHeight: 44,
        justifyContent: "center",
        paddingVertical: 8,
        opacity: disabled ? 0.4 : pressed ? 0.65 : 1,
      })}
    >
      <Text style={{ fontSize: 14, lineHeight: 22, color: t.brand }}>
        {label}
      </Text>
    </Pressable>
  );
}

function Toggle({
  value,
  label,
  disabled,
  onPress,
}: {
  value: boolean;
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={s.toggle}
    >
      <View style={[s.box, value && s.checked]} />
      <Text style={s.note}>{label}</Text>
    </Pressable>
  );
}
const s = StyleSheet.create({
  section: { paddingVertical: 16, gap: 16 },
  group: { gap: 8, paddingVertical: 8 },
  title: { fontSize: 20, lineHeight: 28, fontWeight: "600", color: t.ink },
  label: { fontSize: 16, lineHeight: 24, fontWeight: "600", color: t.ink },
  note: { fontSize: 14, lineHeight: 22, color: t.muted },
  meta: { fontSize: 12, lineHeight: 20, color: t.muted },
  item: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: t.line,
    gap: 4,
  },
  toggle: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingRight: 24,
  },
  box: { width: 16, height: 16, borderWidth: 1, borderColor: t.muted },
  checked: { backgroundColor: t.brand, borderColor: t.brand },
});
