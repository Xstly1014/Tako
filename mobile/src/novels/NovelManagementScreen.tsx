import { useEffect, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { router, useLocalSearchParams, usePreventRemove } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Crypto from "expo-crypto";
import { useSession } from "../auth/context";
import type { Session, Transport } from "../auth/session";
import { ApiError } from "../api/client";
import { NovelsApi, type Novel } from "../api/novels";
import { id } from "../drafts/model";
import { Action, Status } from "../components/Ui";
import { theme as t } from "../theme";
import {
  NovelManagementApi,
  type NovelFormalState,
  type NovelChapterState,
  type NovelChapterVersion,
  type NovelMetadataSubmission,
} from "./management-api";
import {
  NovelGovernanceApi,
  type NovelCase,
  type NovelCaseDetail,
  type NovelAppealInput,
} from "./governance-api";
import {
  ChapterPublicationApi,
  type ChapterSubmissionDetail,
  type ChapterSubmission,
} from "./chapters/publication-api";
import {
  NovelChapterCatalogApi,
  chapterManagementStatus,
  type ManagedChapter,
  type ManagedChapterPage,
} from "./management-catalog";
import { nativeNovelManagementJournal } from "./native";
import {
  NovelOperations,
  type NovelCommand,
  type NovelManagementRecord,
} from "./management-requests";
import { readingChunks } from "./reading-model";
type AppealMemory = {
  caseId: number;
  input: NovelAppealInput;
  confirmed: boolean;
};
type ManagementMemory = {
  owner: string;
  book: string;
  reason: string;
  appeal?: AppealMemory;
  caseId?: number;
};
type Mode = "chapters" | "metadata" | "cases";
type VersionRow = {
  version: number;
  title: string;
  platform_limited: boolean;
  published_at: string;
};
type Row = {
  key: string;
  chapter?: ManagedChapter;
  text?: string;
  version?: VersionRow;
  submission?: ChapterSubmission;
};
function explain(e: unknown) {
  if (e instanceof ApiError) {
    const codes: Record<string, string> = {
      resource_not_found:
        "记录暂不存在或当前账号不可访问。未知操作请保留原记录并稍后重查。",
      novel_state_conflict: "状态已变化，本次未受理。请确认拒绝记录后刷新。",
      novel_revision_conflict:
        "资料已变化，本次未受理。请刷新后核对要发布的资料。",
      novel_restricted: "当前正式内容受限，请先处理整改或复核。",
      chapter_publication_conflict:
        "待审提交已变化，本次未受理。请刷新后核对。",
      storage: "安全记录未能确认保存，请重新读取；原记录不会自动清除。",
      contract: "服务响应与原目标不符，原记录已保留。",
      export_failed: "导出未完成，正文仍保留，可重试选择导出方式。",
      appeal_pending: "已有处理中复核，请先查看结果。",
      appeal_cooldown: "仍在复核冷静期，请查看可再次提交时间。",
      stale_session: "会话已变化，请用原账号重新打开。",
    };
    return (
      codes[e.code] ??
      "暂时无法读取或确认。已加载内容会保留；存在待确认操作时，请先查询结果。"
    );
  }
  return "暂时无法完成，请重试读取。";
}
export default function NovelManagementRoute() {
  const { book } = useLocalSearchParams<{ book?: string }>(),
    { session, account, phase, generation, busy } = useSession();
  const [memory, setMemory] = useState<ManagementMemory>();
  if (
    memory &&
    account &&
    (memory.owner !== account.id || memory.book !== book)
  )
    setMemory(undefined);
  if (typeof book !== "string" || !id(book))
    return (
      <SafeAreaView style={s.screen}>
        <Status
          title="书籍管理地址无效"
          actionLabel="返回书籍"
          onRetry={() => router.dismissTo("/novels")}
        />
      </SafeAreaView>
    );
  if (phase !== "ready" || !account || busy)
    return (
      <SafeAreaView style={s.screen}>
        <Status
          loading={phase === "loading" || busy}
          title="登录后管理本人长文"
          actionLabel="去登录"
          onRetry={() => router.push("/account")}
        />
      </SafeAreaView>
    );
  return (
    <Management
      key={account.id + ":" + generation + ":" + book}
      book={book}
      session={session}
      memory={
        memory?.owner === account.id && memory.book === book
          ? memory
          : undefined
      }
      saveMemory={(value) => {
        if (session.snapshot().account?.id === account.id)
          setMemory({ owner: account.id, book, ...value });
      }}
    />
  );
}
function Management({
  book,
  session,
  memory,
  saveMemory,
}: {
  book: string;
  session: Session;
  memory?: ManagementMemory;
  saveMemory: (
    value: Pick<ManagementMemory, "reason" | "appeal" | "caseId">,
  ) => void;
}) {
  const [tools] = useState(() => {
    const initial = session.snapshot();
    const transport: Transport = (p, o) => session.authorized(p, o);
    const current = () => {
      const now = session.snapshot();
      return (
        now.phase === "ready" &&
        !now.busy &&
        now.generation === initial.generation &&
        now.account?.id === initial.account?.id
      );
    };
    const management = new NovelManagementApi(transport),
      publication = new ChapterPublicationApi(transport);
    return {
      management,
      publication,
      books: new NovelsApi(transport),
      catalog: new NovelChapterCatalogApi(transport),
      governance: new NovelGovernanceApi(transport),
      current,
      ops: new NovelOperations(
        nativeNovelManagementJournal(session),
        management,
        publication,
        current,
        Crypto.randomUUID,
      ),
    };
  });
  const [mode, setMode] = useState<Mode>("chapters"),
    [state, setState] = useState<NovelFormalState>(),
    [privateBook, setPrivateBook] = useState<Novel>(),
    [page, setPage] = useState<ManagedChapterPage>(),
    [record, setRecord] = useState<NovelManagementRecord | null>(),
    [busy, setBusy] = useState(true),
    [error, setError] = useState<unknown>(),
    [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<ManagedChapter>(),
    [chapter, setChapter] = useState<NovelChapterState>(),
    [version, setVersion] = useState<NovelChapterVersion>(),
    [currentVersionLimited, setCurrentVersionLimited] = useState(false),
    [submission, setSubmission] = useState<ChapterSubmissionDetail>(),
    [versions, setVersions] = useState<VersionRow[]>(),
    [versionBefore, setVersionBefore] = useState(0),
    [showVersions, setShowVersions] = useState(false),
    [showSubmissions, setShowSubmissions] = useState(false),
    [submissions, setSubmissions] = useState<ChapterSubmission[]>([]),
    [submissionCursor, setSubmissionCursor] = useState("");
  const [metadata, setMetadata] = useState<NovelMetadataSubmission[]>([]),
    [metaCursor, setMetaCursor] = useState(""),
    [metaLoaded, setMetaLoaded] = useState(false),
    [metaSelected, setMetaSelected] = useState<NovelMetadataSubmission>(),
    [rights, setRights] = useState(false);
  const [cases, setCases] = useState<NovelCase[]>([]),
    [caseBefore, setCaseBefore] = useState(0),
    [casesLoaded, setCasesLoaded] = useState(false),
    [caseDetail, setCaseDetail] = useState<NovelCaseDetail>(),
    [reason, setReasonValue] = useState(""),
    [appeal, setAppealValue] = useState<AppealMemory>();
  const [checkedAt, setCheckedAt] = useState(() => Date.now());
  useEffect(() => {
    if (!caseDetail?.case.next_appeal_at) return;
    const delay = Date.parse(caseDetail.case.next_appeal_at) - Date.now();
    const timer = setTimeout(
      () => setCheckedAt(Date.now()),
      Math.max(0, Math.min(delay + 10, 2147483647)),
    );
    return () => clearTimeout(timer);
  }, [caseDetail]);
  const [recovery, setRecovery] = useState(
    memory && (memory.reason || (memory.appeal && !memory.appeal.confirmed))
      ? memory
      : undefined,
  );
  const memoryValue = useRef<
    Pick<ManagementMemory, "reason" | "appeal" | "caseId">
  >({
    reason: memory?.reason ?? "",
    appeal: memory?.appeal,
    caseId: memory?.caseId,
  });
  function setReason(value: string) {
    setReasonValue(value);
    memoryValue.current = {
      ...memoryValue.current,
      reason: value,
      caseId: caseDetail?.case.id ?? memoryValue.current.caseId,
    };
    saveMemory({ ...memoryValue.current });
  }
  function setAppeal(value: AppealMemory | undefined) {
    setAppealValue(value);
    memoryValue.current = {
      ...memoryValue.current,
      appeal: value,
      caseId: caseDetail?.case.id ?? memoryValue.current.caseId,
    };
    saveMemory({ ...memoryValue.current });
  }
  const active = useRef(true),
    lock = useRef(false),
    initialLoad = useRef<Promise<{
      r: NovelManagementRecord | null;
      b?: Novel;
      state?: NovelFormalState;
      page?: ManagedChapterPage;
      readError?: unknown;
    }> | null>(null);
  const guard = () => {
    if (!active.current || !tools.current())
      throw new ApiError("stale_session");
  };
  useEffect(() => {
    active.current = true;
    let cancelled = false;
    initialLoad.current ??= (async () => {
      const r = await tools.ops.load();
      try {
        const [b, state, page] = await Promise.all([
          tools.books.read(book),
          tools.management.state(book),
          tools.catalog.list(book),
        ]);
        return { r, b, state, page };
      } catch (readError) {
        return { r, readError };
      }
    })();
    initialLoad.current
      .then((v) => {
        if (!cancelled) {
          setRecord(v.r);
          setPrivateBook(v.b);
          setState(v.state);
          setPage(v.page);
          if (v.readError) setError(v.readError);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
      active.current = false;
    };
  }, [tools, book]);
  usePreventRemove(
    !!recovery || !!reason.trim() || (!!appeal && !appeal.confirmed),
    ({ repeat }) =>
      Alert.alert(
        "离开处置复核？",
        "未提交说明和复核原请求只在本页内存中保留。离开不会撤销服务端已受理的复核。",
        [
          { text: "继续处理", style: "cancel" },
          { text: "丢弃并离开", style: "destructive", onPress: repeat },
        ],
      ),
  );
  async function run(fn: () => Promise<unknown>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(undefined);
    try {
      guard();
      await fn();
      guard();
    } catch (e) {
      if (active.current && tools.current()) setError(e);
    } finally {
      if (active.current && tools.current()) {
        try {
          setRecord(tools.ops.snapshot());
        } catch {}
        setBusy(false);
      }
      lock.current = false;
    }
  }
  async function reload() {
    const [b, next, p] = await Promise.all([
      tools.books.read(book),
      tools.management.state(book),
      tools.catalog.list(book),
    ]);
    guard();
    setPrivateBook(b);
    setState(next);
    setPage(p);
    setRights(false);
    if (selected) await select(selected);
    if (mode === "metadata" && metaLoaded) {
      await loadMetadata();
      if (metaSelected) {
        const value = await tools.management.metadata(book, metaSelected.id);
        guard();
        setMetaSelected(value);
      }
    }
  }
  async function moreChapters() {
    if (!page?.next_cursor) return;
    const next = await tools.catalog.list(book, page.next_cursor);
    guard();
    setPage(
      (old) =>
        old && {
          items: [
            ...old.items,
            ...next.items.filter(
              (v) => !old.items.some((x) => x.chapter_id === v.chapter_id),
            ),
          ],
          next_cursor: next.next_cursor,
        },
    );
  }
  async function select(item: ManagedChapter) {
    const cs = await tools.management.chapterState(book, item.chapter_id);
    const value = cs.display_version
      ? await tools.management.version(
          book,
          item.chapter_id,
          cs.display_version,
        )
      : undefined;
    guard();
    setSelected(item);
    setShowSubmissions(false);
    setSubmissions([]);
    setSubmissionCursor("");
    setChapter(cs);
    setSubmission(undefined);
    setVersions(undefined);
    setVersionBefore(0);
    setShowVersions(false);
    setVersion(value);
    setCurrentVersionLimited(value?.platform_limited ?? false);
  }
  async function loadSubmissions(more = false) {
    if (!selected) return;
    const p = await tools.publication.chapterHistory(
      book,
      selected.chapter_id,
      more ? submissionCursor : "",
    );
    guard();
    setSubmissions((old) =>
      more
        ? [...old, ...p.items.filter((x) => !old.some((v) => v.id === x.id))]
        : p.items,
    );
    setSubmissionCursor(p.next_cursor);
    setShowSubmissions(true);
    setShowVersions(false);
  }
  async function readSubmission(item: ChapterSubmission) {
    if (!selected) return;
    const value = await tools.publication.detail(book, item.id);
    guard();
    if (value.submission.chapter_id !== selected.chapter_id)
      throw new ApiError("contract");
    setSubmission(value);
    setShowSubmissions(false);
    setShowVersions(false);
  }
  async function loadVersions(more = false) {
    if (!selected) return;
    const p = await tools.management.versions(
      book,
      selected.chapter_id,
      more ? versionBefore : 0,
    );
    guard();
    setVersions((old) =>
      more
        ? [
            ...(old ?? []),
            ...p.items.filter(
              (x) => !old?.some((v) => v.version === x.version),
            ),
          ]
        : p.items,
    );
    setVersionBefore(p.next_before);
    setShowVersions(true);
    setShowSubmissions(false);
  }
  async function readVersion(v: VersionRow) {
    if (!selected) return;
    const value = await tools.management.version(
      book,
      selected.chapter_id,
      v.version,
    );
    guard();
    setVersion(value);
    setSubmission(undefined);
    setShowVersions(false);
  }
  async function loadMetadata(more = false) {
    const p = await tools.management.metadataList(book, more ? metaCursor : "");
    guard();
    setMetadata((old) =>
      more
        ? [...old, ...p.items.filter((x) => !old.some((v) => v.id === x.id))]
        : p.items,
    );
    setMetaCursor(p.next_cursor);
    setMetaLoaded(true);
  }
  async function loadCases(more = false) {
    const p = await tools.governance.list(book, more ? caseBefore : 0);
    guard();
    setCases((old) =>
      more
        ? [...old, ...p.items.filter((x) => !old.some((v) => v.id === x.id))]
        : p.items,
    );
    setCaseBefore(p.next);
    setCasesLoaded(true);
  }
  function choose(next: Mode) {
    if (busy || recovery || reason.trim() || (appeal && !appeal.confirmed))
      return;
    setMode(next);
    setNotice("");
    setError(undefined);
    if (next === "metadata" && !metaLoaded) void run(() => loadMetadata());
    if (next === "cases" && !casesLoaded) void run(() => loadCases());
  }
  function confirmCommand(label: string, command: NovelCommand) {
    if (record || busy) return;
    Alert.alert(
      label,
      "请核对当前对象。本次操作不会修改私稿，也不会解除其他平台限制。",
      [
        { text: "取消", style: "cancel" },
        {
          text: "执行",
          onPress: () =>
            void run(async () => {
              await tools.ops.start(command);
            }),
        },
      ],
    );
  }
  async function clearOperation() {
    await tools.ops.clear();
    guard();
    setNotice("原操作已确认；若状态尚未刷新，可重试读取。");
    await reload();
    guard();
    setNotice("原操作已确认，当前状态已更新。");
  }
  async function openCase(c: NovelCase) {
    const detail = await tools.governance.detail(book, c.id);
    guard();
    setCaseDetail(detail);
    setReason("");
    setAppeal(undefined);
  }
  async function moreAppeals() {
    if (!caseDetail?.appeals.next) return;
    const p = await tools.governance.detail(
      book,
      caseDetail.case.id,
      caseDetail.appeals.next,
    );
    guard();
    if (p.case.revision !== caseDetail.case.revision) {
      setCaseDetail(p);
      setNotice("处置已变化，请重新核对。");
      return;
    }
    setCaseDetail(
      (old) =>
        old && {
          ...old,
          appeals: {
            items: [
              ...old.appeals.items,
              ...p.appeals.items.filter(
                (a) => !old.appeals.items.some((v) => v.id === a.id),
              ),
            ],
            next: p.appeals.next,
          },
        },
    );
  }
  async function sendAppeal(confirm = false) {
    if (!caseDetail) return;
    let original = appeal;
    if (!original) {
      if (!reason.trim()) return;
      original = {
        caseId: caseDetail.case.id,
        input: {
          mutation_id: Crypto.randomUUID(),
          expected_revision: caseDetail.case.revision,
          reason: reason.trim(),
        },
        confirmed: false,
      };
      setAppeal(original);
    }
    let r;
    try {
      r = confirm
        ? await tools.governance.confirmAppeal(
            book,
            original.caseId,
            original.input,
          )
        : await tools.governance.appeal(book, original.caseId, original.input);
    } catch (e) {
      guard();
      if (
        !confirm &&
        e instanceof ApiError &&
        e.status === 409 &&
        ["appeal_pending", "appeal_cooldown", "novel_state_conflict"].includes(
          e.code,
        )
      )
        setAppeal(undefined);
      throw e;
    }
    guard();
    setAppeal({ ...original, confirmed: true });
    setReason("");
    setNotice("复核已受理。原请求已确认，不会重复提交。");
    if (r.state === "pending") {
      const detail = await tools.governance.detail(book, original.caseId);
      guard();
      setCaseDetail(detail);
    }
  }
  async function recoverMemory() {
    if (!recovery?.caseId) return;
    const detail = await tools.governance.detail(book, recovery.caseId);
    guard();
    setCaseDetail(detail);
    setMode("cases");
    setReason(recovery.reason);
    setAppeal(recovery.appeal);
    setRecovery(undefined);
  }
  function discardMemory() {
    setReason("");
    setAppeal(undefined);
    memoryValue.current = { reason: "" };
    saveMemory({ reason: "" });
    setRecovery(undefined);
  }
  async function exportText(title: string, content: string) {
    try {
      await Share.share({ title, message: title + "\n\n" + content });
    } catch {
      throw new ApiError("export_failed");
    }
  }
  const blocked = busy || !!record || !!recovery;
  const back = () => {
    if (mode === "chapters" && selected) {
      setSelected(undefined);
      setChapter(undefined);
      setVersion(undefined);
      setSubmission(undefined);
      setVersions(undefined);
      setShowVersions(false);
      return;
    }
    if (mode === "cases" && caseDetail) {
      const leave = () => {
        setCaseDetail(undefined);
        setAppeal(undefined);
        setReason("");
      };
      if (reason.trim() || (appeal && !appeal.confirmed)) {
        Alert.alert(
          "离开这项复核？",
          "未提交说明和原复核只在本页保留。离开不会撤销已受理请求。",
          [
            { text: "继续处理", style: "cancel" },
            { text: "丢弃并返回", style: "destructive", onPress: leave },
          ],
        );
      } else leave();
      return;
    }
    router.dismissTo("/novels");
  };
  const commandPanel = record ? (
    <View style={s.section}>
      <Text style={s.title}>
        {record.outcome
          ? "原操作已确认"
          : record.rejection
            ? "原操作未受理"
            : "原管理操作待确认"}
      </Text>
      {record.command.book !== book ? (
        <Text style={s.note}>这是另一本书的原操作，需先处理后再管理本书。</Text>
      ) : null}
      <Text style={s.note}>
        {record.command.kind === "visibility"
          ? (record.command.input.action === "hide" ? "隐藏" : "恢复") +
            (record.command.chapter ? "章节" : "整书")
          : record.command.kind === "metadata"
            ? "发布书籍资料"
            : "撤回待审提交"}
      </Text>
      {record.outcome || record.rejection ? (
        <Action
          label="确认记录并刷新"
          disabled={busy}
          onPress={() => void run(clearOperation)}
        />
      ) : (
        <>
          <Action
            label="查询原管理结果"
            disabled={busy}
            onPress={() => void run(() => tools.ops.confirm())}
          />
          <Action
            label="重试同一管理请求"
            disabled={busy}
            onPress={() => void run(() => tools.ops.retry())}
          />
        </>
      )}
    </View>
  ) : null;
  let rows: Row[] = [];
  if (mode === "chapters" && !selected)
    rows = (page?.items ?? []).map((v) => ({ key: v.chapter_id, chapter: v }));
  if (mode === "chapters" && selected) {
    if (showSubmissions)
      rows = submissions.map((v) => ({ key: "s" + v.id, submission: v }));
    else if (showVersions)
      rows = (versions ?? []).map((v) => ({
        key: "v" + v.version,
        version: v,
      }));
    else {
      const text = submission?.preview.content ?? version?.content;
      if (text)
        rows = readingChunks(text).map((text, i) => ({
          key: "text" + i,
          text,
        }));
    }
  }
  const header = (
    <View>
      {recovery ? (
        <View style={s.section}>
          <Text style={s.title}>恢复本账号在当前页面的复核说明？</Text>
          <Text style={s.note}>
            说明仍只在内存中，重新核对处置后恢复；不会自动提交。
          </Text>
          <Action
            label="保留复核说明"
            disabled={busy}
            onPress={() => void run(recoverMemory)}
          />
          <Action
            label="放弃页面暂存说明"
            disabled={busy}
            onPress={discardMemory}
          />
        </View>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={s.error}>
          {explain(error)}
        </Text>
      ) : null}
      {notice ? (
        <Text accessibilityLiveRegion="polite" style={s.note}>
          {notice}
        </Text>
      ) : null}
      {commandPanel}
      {!state && !busy ? (
        <Action
          label="重新读取管理信息"
          onPress={() =>
            void run(async () => {
              await tools.ops.load();
              await reload();
            })
          }
        />
      ) : null}
      {mode === "chapters" && selected && chapter ? (
        <View style={s.section}>
          <Text style={s.chapterTitle}>
            {submission?.preview.title ??
              version?.title ??
              (selected.title || "未命名章节")}
          </Text>
          <Text style={s.note}>
            {chapterManagementStatus({ ...selected, ...chapter })}
          </Text>
          {submission ? (
            <View>
              <Text style={s.note}>
                提交记录 ·{" "}
                {
                  {
                    pending: "待审核",
                    published: "已发布",
                    rejected: "已驳回",
                    withdrawn: "已撤回",
                    superseded: "已被后续提交替换",
                  }[submission.submission.state]
                }
              </Text>
              {submission.submission.reason ? (
                <Text style={s.error}>{submission.submission.reason}</Text>
              ) : null}
            </View>
          ) : version ? (
            <Text style={s.note}>
              正式版本 {version.version} ·{" "}
              {version.platform_limited
                ? "该版本受限，仅本人查看"
                : "本人固定版本预览"}
            </Text>
          ) : (
            <Text style={s.note}>该章还没有正式正文。</Text>
          )}
        </View>
      ) : null}
      {mode === "metadata" ? (
        <View style={s.section}>
          <Text style={s.title}>当前正式资料</Text>
          {state?.formal ? (
            <>
              <Text style={s.chapterTitle}>{state.formal.title}</Text>
              <Text style={s.note}>{state.formal.introduction}</Text>
              <Text style={s.meta}>{state.formal.tags.join(" · ")}</Text>
            </>
          ) : (
            <Text style={s.note}>首个章节实际发布后建立正式资料。</Text>
          )}
          {state?.formal ? (
            <Action
              label={state.author_hidden ? "恢复整书" : "隐藏整书"}
              disabled={
                blocked || (state.author_hidden && state.platform_limited)
              }
              onPress={() =>
                confirmCommand(
                  state.author_hidden ? "恢复整书？" : "隐藏整书？",
                  {
                    kind: "visibility",
                    book,
                    chapter: null,
                    input: {
                      mutation_id: Crypto.randomUUID(),
                      expected_revision: state.state_revision,
                      action: state.author_hidden ? "restore" : "hide",
                    },
                  },
                )
              }
            />
          ) : null}
          <Text style={s.title}>本次待发布的创作资料</Text>
          {privateBook ? (
            <>
              <Text style={s.label}>{privateBook.title}</Text>
              <Text style={s.note}>{privateBook.introduction}</Text>
              <Text style={s.meta}>
                {privateBook.tags.join(" · ")} · 已保存修订{" "}
                {privateBook.revision}
              </Text>
            </>
          ) : null}
          <Text style={s.note}>
            这里明确提交资料后才影响正式版本；观察期作者需等待审核。改章稿不会自动改正式资料。
          </Text>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: rights, disabled: blocked }}
            accessibilityLabel="确认资料发布授权"
            disabled={blocked}
            onPress={() => setRights((v) => !v)}
            style={s.touch}
          >
            <Text style={s.note}>
              {rights ? "已确认" : "未确认"}　资料为原创或已获授权
            </Text>
          </Pressable>
          <Action
            label="发布这份资料"
            disabled={blocked || !rights || !state?.formal || !privateBook}
            onPress={() => {
              if (state?.formal && privateBook)
                confirmCommand("发布所示创作资料？", {
                  kind: "metadata",
                  book,
                  input: {
                    mutation_id: Crypto.randomUUID(),
                    source_revision: privateBook.revision,
                    expected_revision: state.formal.revision,
                    rights_confirmed: true,
                  },
                });
            }}
          />
          <Action
            label="读取最新资料"
            disabled={blocked}
            onPress={() => void run(reload)}
          />
          <Action
            label="修改创作资料"
            disabled={blocked}
            onPress={() => router.dismissTo("/novels")}
          />
          <Text style={s.title}>资料提交记录</Text>
          {metadata.map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              disabled={busy}
              style={s.item}
              onPress={() =>
                void run(async () => {
                  const v = await tools.management.metadata(book, item.id);
                  guard();
                  setMetaSelected(v);
                })
              }
            >
              <Text style={s.label}>{item.title}</Text>
              <Text style={s.meta}>
                {
                  {
                    pending: "待审核",
                    published: "已发布",
                    rejected: "已驳回",
                    withdrawn: "已撤回",
                    superseded: "已替换",
                  }[item.state]
                }
              </Text>
            </Pressable>
          ))}
          {metaLoaded && !metadata.length ? (
            <Text style={s.note}>还没有后续资料提交。</Text>
          ) : null}
          {metaSelected ? (
            <View style={s.section}>
              <Text style={s.title}>{metaSelected.title}</Text>
              <Text style={s.note}>{metaSelected.introduction}</Text>
              <Text style={s.note}>{metaSelected.reason}</Text>
              {metaSelected.current && metaSelected.state === "pending" ? (
                <Action
                  label="撤回这次资料审核"
                  disabled={blocked}
                  onPress={() =>
                    confirmCommand("撤回这次待审资料？", {
                      kind: "withdraw-metadata",
                      book,
                      submission: metaSelected.id,
                      mutation: Crypto.randomUUID(),
                    })
                  }
                />
              ) : null}
            </View>
          ) : null}
          {metaCursor ? (
            <Action
              label="更多资料记录"
              disabled={busy}
              onPress={() => void run(() => loadMetadata(true))}
            />
          ) : null}
          <Action
            label="刷新资料记录"
            disabled={busy}
            onPress={() => void run(() => loadMetadata())}
          />
        </View>
      ) : null}
      {mode === "cases" ? (
        <View style={s.section}>
          {caseDetail ? (
            <>
              <Text style={s.title}>处置与复核</Text>
              <Text style={s.note}>
                {caseDetail.case.scope === "book"
                  ? "整书"
                  : caseDetail.case.scope === "chapter"
                    ? "章节"
                    : "指定正式版本"}{" "}
                · {caseDetail.case.state === "active" ? "限制生效中" : "已撤销"}
              </Text>
              <Text style={s.label}>{caseDetail.case.reason}</Text>
              {caseDetail.case.decision_reason ? (
                <Text style={s.note}>{caseDetail.case.decision_reason}</Text>
              ) : null}
              {caseDetail.case.next_appeal_at ? (
                <Text style={s.meta}>
                  可再次提交时间：
                  {new Date(caseDetail.case.next_appeal_at).toLocaleString(
                    "zh-CN",
                  )}
                </Text>
              ) : null}
              {caseDetail.appeals.items.map((v) => (
                <View key={v.id} style={s.item}>
                  <Text style={s.note}>{v.reason}</Text>
                  <Text style={s.meta}>
                    {
                      {
                        pending: "处理中",
                        upheld: "维持处置",
                        revoked: "已撤销",
                      }[v.state]
                    }
                  </Text>
                  <Text style={s.note}>{v.decision_reason}</Text>
                </View>
              ))}
              {caseDetail.appeals.next ? (
                <Action
                  label="更多复核记录"
                  disabled={busy}
                  onPress={() => void run(moreAppeals)}
                />
              ) : null}
              {appeal && !appeal.confirmed ? (
                <>
                  <Text style={s.note}>
                    原复核结果尚未确认，先查询结果。原说明只在本页内存中保留。
                  </Text>
                  <Action
                    label="查询原复核结果"
                    disabled={busy}
                    onPress={() => void run(() => sendAppeal(true))}
                  />
                  <Action
                    label="重试同一复核"
                    disabled={busy}
                    onPress={() => void run(() => sendAppeal())}
                  />
                </>
              ) : caseDetail.case.state === "active" &&
                !caseDetail.appeals.items.some((v) => v.state === "pending") ? (
                <>
                  <TextInput
                    accessibilityLabel="复核说明"
                    multiline
                    value={reason}
                    editable={!busy}
                    maxLength={4000}
                    onChangeText={setReason}
                    style={s.input}
                  />
                  <Text style={s.meta}>
                    {Array.from(reason).length}/2000字 · 仅本页内存保留
                  </Text>
                  <Action
                    label="提交文字复核"
                    disabled={
                      busy ||
                      !reason.trim() ||
                      Array.from(reason).length > 2000 ||
                      (!!caseDetail.case.next_appeal_at &&
                        Date.parse(caseDetail.case.next_appeal_at) >
                          checkedAt) ||
                      !!appeal?.confirmed
                    }
                    onPress={() => void run(() => sendAppeal())}
                  />
                </>
              ) : null}
              <Action
                label="刷新这项处置"
                disabled={
                  busy || !!reason.trim() || (!!appeal && !appeal.confirmed)
                }
                onPress={() => void run(() => openCase(caseDetail.case))}
              />
            </>
          ) : (
            <>
              {cases.map((c) => (
                <Pressable
                  key={c.id}
                  accessibilityRole="button"
                  accessibilityLabel={"查看处置 " + c.id}
                  style={s.item}
                  disabled={busy}
                  onPress={() => void run(() => openCase(c))}
                >
                  <Text style={s.label}>
                    {c.scope === "book"
                      ? "整书限制"
                      : c.scope === "chapter"
                        ? "章节限制"
                        : "版本限制"}
                  </Text>
                  <Text style={s.note} numberOfLines={2}>
                    {c.reason}
                  </Text>
                  <Text style={s.meta}>
                    {c.state === "active" ? "生效中" : "已撤销"}
                  </Text>
                </Pressable>
              ))}
              {casesLoaded && !cases.length ? (
                <Text style={s.note}>本书还没有平台处置。</Text>
              ) : null}
              {caseBefore ? (
                <Action
                  label="更多处置"
                  disabled={busy}
                  onPress={() => void run(() => loadCases(true))}
                />
              ) : null}
              <Action
                label="刷新处置"
                disabled={busy}
                onPress={() => void run(() => loadCases())}
              />
            </>
          )}
        </View>
      ) : null}
    </View>
  );
  const footer =
    mode === "chapters" ? (
      <View style={s.section}>
        {selected && chapter ? (
          <>
            {showSubmissions ? (
              <>
                {!submissions.length ? (
                  <Text style={s.note}>该章还没有提交记录。</Text>
                ) : null}
                {submissionCursor ? (
                  <Action
                    label="更多本章提交记录"
                    disabled={busy}
                    onPress={() => void run(() => loadSubmissions(true))}
                  />
                ) : null}
                <Action
                  label="返回当前章节"
                  disabled={busy}
                  onPress={() => void run(() => select(selected))}
                />
              </>
            ) : showVersions ? (
              versionBefore ? (
                <Action
                  label="更多正式版本"
                  disabled={busy}
                  onPress={() => void run(() => loadVersions(true))}
                />
              ) : null
            ) : (
              <>
                {version && !submission ? (
                  <>
                    <Action
                      label="导出当前固定版本"
                      disabled={busy}
                      onPress={() =>
                        void run(async () => {
                          await exportText(version.title, version.content);
                        })
                      }
                    />
                    <Action
                      label="查看历史正式版本"
                      disabled={busy}
                      onPress={() => void run(() => loadVersions())}
                    />
                  </>
                ) : null}
                {submission ? (
                  <>
                    <Action
                      label="导出本次提交内容"
                      disabled={busy}
                      onPress={() =>
                        void run(async () => {
                          await exportText(
                            submission.preview.title,
                            submission.preview.content,
                          );
                        })
                      }
                    />
                    <Action
                      label="返回当前章节"
                      disabled={busy}
                      onPress={() => void run(() => select(selected))}
                    />
                  </>
                ) : null}
                <Action
                  label="查看本章提交记录"
                  disabled={busy}
                  onPress={() => void run(() => loadSubmissions())}
                />
                {chapter.display_version > 0 ? (
                  <Action
                    label={chapter.author_hidden ? "恢复这一章" : "隐藏这一章"}
                    disabled={
                      blocked ||
                      (chapter.author_hidden &&
                        (chapter.platform_limited || currentVersionLimited))
                    }
                    onPress={() =>
                      confirmCommand(
                        chapter.author_hidden ? "恢复这一章？" : "隐藏这一章？",
                        {
                          kind: "visibility",
                          book,
                          chapter: chapter.chapter_id,
                          input: {
                            mutation_id: Crypto.randomUUID(),
                            expected_revision: chapter.state_revision,
                            action: chapter.author_hidden ? "restore" : "hide",
                          },
                        },
                      )
                    }
                  />
                ) : null}
                {chapter.current_submission_id &&
                (!submission ||
                  submission.submission.id ===
                    chapter.current_submission_id) ? (
                  <>
                    <Action
                      label="查看待审固定内容"
                      disabled={busy}
                      onPress={() =>
                        void run(async () => {
                          const v = await tools.publication.detail(
                            book,
                            chapter.current_submission_id!,
                          );
                          guard();
                          setSubmission(v);
                          setShowVersions(false);
                        })
                      }
                    />
                    <Action
                      label="撤回这一章的待审提交"
                      disabled={blocked}
                      onPress={() =>
                        confirmCommand("撤回这一章的待审提交？", {
                          kind: "withdraw-chapter",
                          book,
                          submission: chapter.current_submission_id!,
                          mutation: Crypto.randomUUID(),
                        })
                      }
                    />
                  </>
                ) : null}
                <Action
                  label="继续章节草稿"
                  disabled={blocked}
                  onPress={() =>
                    router.push({ pathname: "/novel-drafts", params: { book } })
                  }
                />
                <Action
                  label="刷新章节状态"
                  disabled={busy}
                  onPress={() => void run(() => select(selected))}
                />
              </>
            )}
          </>
        ) : (
          <>
            {page && !page.items.length ? (
              <Text style={s.note}>还没有章节。可先到章节草稿开始写作。</Text>
            ) : null}
            {page?.next_cursor ? (
              <Action
                label="加载更多章节"
                disabled={busy}
                onPress={() => void run(moreChapters)}
              />
            ) : null}
            <Action
              label="刷新章节列表"
              disabled={busy}
              onPress={() => void run(reload)}
            />
            <Action
              label="章节草稿"
              disabled={busy}
              onPress={() =>
                router.push({ pathname: "/novel-drafts", params: { book } })
              }
            />
          </>
        )}
      </View>
    ) : undefined;
  return (
    <SafeAreaView style={s.screen}>
      <View style={s.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            mode === "chapters" && selected
              ? "返回章节列表"
              : mode === "cases" && caseDetail
                ? "返回处置列表"
                : "返回书籍"
          }
          disabled={busy}
          style={s.touch}
          onPress={back}
        >
          <Text style={s.link}>
            {selected || caseDetail ? "返回列表" : "返回书籍"}
          </Text>
        </Pressable>
        <Text style={s.title}>正式管理</Text>
      </View>
      <View style={s.book}>
        <Text style={s.bookTitle} numberOfLines={2}>
          {state?.formal?.title ?? privateBook?.title ?? "本人长文"}
        </Text>
        <Text style={s.meta}>
          {state?.formal
            ? state.author_hidden
              ? "整书已隐藏"
              : state.platform_limited
                ? "整书受限"
                : "已建立正式内容"
            : "尚无正式内容"}
        </Text>
      </View>
      <View style={s.tabs}>
        {(
          [
            ["chapters", "章节"],
            ["metadata", "书籍资料"],
            ["cases", "处置与复核"],
          ] as const
        ).map(([value, label]) => (
          <Pressable
            key={value}
            accessibilityRole="tab"
            accessibilityState={{ selected: mode === value, disabled: busy }}
            disabled={busy}
            onPress={() => choose(value)}
            style={[s.tab, mode === value && s.selected]}
          >
            <Text style={mode === value ? s.link : s.note}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {!state && busy ? (
        <Status loading title="正在读取管理信息" />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(v) => v.key}
          contentContainerStyle={s.content}
          initialNumToRender={12}
          windowSize={7}
          extraData={{ mode, record, busy, error }}
          ListHeaderComponent={header}
          renderItem={({ item }) =>
            item.chapter ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  "管理章节 " + (item.chapter.title || "未命名章节")
                }
                disabled={busy}
                onPress={() => void run(() => select(item.chapter!))}
                style={s.item}
              >
                <Text style={s.label} numberOfLines={2}>
                  {item.chapter.ordinal
                    ? "第" + item.chapter.ordinal + "章　"
                    : ""}
                  {item.chapter.title || "未命名章节"}
                </Text>
                <Text style={s.meta}>
                  {chapterManagementStatus(item.chapter)}
                </Text>
              </Pressable>
            ) : item.submission ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={"查看本章提交 " + item.submission.id}
                disabled={busy}
                style={s.item}
                onPress={() => void run(() => readSubmission(item.submission!))}
              >
                <Text style={s.label}>{item.submission.title}</Text>
                <Text
                  style={
                    item.submission.state === "rejected" ? s.error : s.meta
                  }
                >
                  {
                    {
                      pending: "待审核",
                      published: "已发布",
                      rejected: "已驳回",
                      withdrawn: "已撤回",
                      superseded: "已替换",
                    }[item.submission.state]
                  }
                </Text>
              </Pressable>
            ) : item.version ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={"查看正式版本 " + item.version.version}
                disabled={busy}
                onPress={() => void run(() => readVersion(item.version!))}
                style={s.item}
              >
                <Text style={s.label}>{item.version.title}</Text>
                <Text style={s.meta}>
                  版本 {item.version.version} ·{" "}
                  {item.version.platform_limited ? "受限" : "正式记录"}
                </Text>
              </Pressable>
            ) : (
              <Text selectable style={s.body}>
                {item.text}
              </Text>
            )
          }
          ListFooterComponent={footer}
        />
      )}
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: t.surface },
  header: {
    paddingHorizontal: 16,
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 24,
  },
  touch: { minHeight: 48, justifyContent: "center" },
  book: { paddingHorizontal: 16, paddingVertical: 8, gap: 8 },
  bookTitle: { fontSize: 20, lineHeight: 28, fontWeight: "600", color: t.ink },
  title: { fontSize: 16, lineHeight: 24, fontWeight: "600", color: t.ink },
  label: { fontSize: 16, lineHeight: 24, color: t.ink },
  note: { fontSize: 14, lineHeight: 24, color: t.secondary },
  meta: { fontSize: 12, lineHeight: 20, color: t.muted },
  link: { fontSize: 14, lineHeight: 24, color: t.brand },
  tabs: {
    flexDirection: "row",
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: t.line,
  },
  tab: {
    flex: 1,
    minHeight: 48,
    justifyContent: "center",
    alignItems: "center",
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  selected: { borderBottomColor: t.brand },
  content: { paddingHorizontal: 16, paddingBottom: 24 },
  section: { paddingVertical: 16, gap: 16 },
  item: {
    paddingVertical: 16,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: t.line,
  },
  chapterTitle: {
    fontSize: 24,
    lineHeight: 32,
    fontWeight: "600",
    color: t.ink,
  },
  body: { fontSize: 18, lineHeight: 32, color: t.ink },
  error: { fontSize: 14, lineHeight: 24, color: t.danger, paddingVertical: 8 },
  input: {
    minHeight: 128,
    borderWidth: 1,
    borderColor: t.line,
    borderRadius: 8,
    padding: 16,
    fontSize: 16,
    color: t.ink,
    textAlignVertical: "top",
  },
});
