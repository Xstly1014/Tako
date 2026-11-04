import { useEffect, useRef, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import * as Crypto from "expo-crypto";
import { useSession } from "../../auth/context";
import type { Session } from "../../auth/session";
import { ApiError } from "../../api/client";
import { NovelsApi } from "../../api/novels";
import { id, integer } from "../../drafts/model";
import { Action, Status } from "../../components/Ui";
import { theme as t } from "../../theme";
import { readingChunks } from "../reading-model";
import { nativeChapterPublicationJournal } from "../native";
import { ChapterPublicationApi, type ChapterPreview } from "./publication-api";
import { ChapterPublisher, type ChapterPublicationRecord } from "./publisher";
function message(e: unknown) {
  if (e instanceof ApiError) {
    const text: Record<string, string> = {
      storage: "安全记录未能确认保存。请保留原记录，重新读取后再操作。",
      novel_request_pending: "已有原请求待处理，请先确认它。",
      chapter_preview_expired:
        "预览已过期。尚未提交的预览可放弃后重新生成；已提交请求请先查原结果。",
      novel_revision_conflict: "书籍资料已被另一端修改，请重新读取后生成预览。",
      source_revision_unavailable:
        "来源修订已不可用，请回章节草稿同步后重新准备。",
      novel_restricted: "当前内容受平台限制，请先处理整改或复核。",
      novel_state_conflict:
        "书籍状态已变化，本次未受理。请重新核对资料并生成预览。",
      chapter_publication_conflict:
        "章节或章号已变化，本次未受理。请重新生成预览。",
      resource_not_found:
        "暂未查到原请求。它仍可能在处理，可稍后再查或重试同一原请求。",
      stale_session: "会话已变化，请用原账号重新打开并确认原请求。",
      contract: "服务响应与原请求不一致。记录已保留，请勿重新提交。",
    };
    return (
      text[e.code] ?? "暂时无法完成。原请求已保留，先查询结果，不要重复提交。"
    );
  }
  return "暂时无法完成，请重新读取原记录。";
}
type Source = { book: string; draft: string; revision: number; local: string };
export default function ChapterPublishRoute() {
  const params = useLocalSearchParams<{
    book?: string;
    draft?: string;
    revision?: string;
    local?: string;
  }>();
  const { session, phase, account, generation, busy } = useSession();
  const book = typeof params.book === "string" ? params.book : "",
    draft = typeof params.draft === "string" ? params.draft : "",
    revision = Number(params.revision),
    local = typeof params.local === "string" ? params.local : "";
  if (!id(book) || !id(draft) || !id(local) || !integer(revision, 1))
    return (
      <SafeAreaView style={s.screen}>
        <Status
          title="发布地址无效"
          actionLabel="返回长文创作"
          onRetry={() => router.dismissTo("/novels")}
        />
      </SafeAreaView>
    );
  if (phase !== "ready" || !account || busy)
    return (
      <SafeAreaView style={s.screen}>
        <Status
          loading={phase === "loading" || busy}
          title="登录后核对发布"
          message="原请求按账号保存在本机，不会转交给其他账号。"
          actionLabel="去登录"
          onRetry={() => router.push("/account")}
        />
      </SafeAreaView>
    );
  return (
    <Publish
      key={
        account.id +
        ":" +
        generation +
        ":" +
        book +
        ":" +
        draft +
        ":" +
        revision
      }
      session={session}
      source={{ book, draft, revision, local }}
    />
  );
}
function Publish({ session, source }: { session: Session; source: Source }) {
  const [publisher] = useState(() => {
    const initial = session.snapshot();
    return new ChapterPublisher(
      new ChapterPublicationApi((p, o) => session.authorized(p, o)),
      nativeChapterPublicationJournal(session),
      () => {
        const now = session.snapshot();
        return (
          now.phase === "ready" &&
          !now.busy &&
          now.generation === initial.generation &&
          now.account?.id === initial.account?.id
        );
      },
      Crypto.randomUUID,
    );
  });
  const [record, setRecord] = useState<ChapterPublicationRecord | null>(),
    [preview, setPreview] = useState<ChapterPreview>(),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(true),
    [rights, setRights] = useState(false);
  const active = useRef(true),
    lock = useRef(false);
  const initialLoad = useRef<Promise<ChapterPublicationRecord | null> | null>(
    null,
  );
  useEffect(() => {
    active.current = true;
    let cancelled = false;
    initialLoad.current ??= publisher.load();
    initialLoad.current
      .then((value) => {
        if (!cancelled) setRecord(value);
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
  }, [publisher]);
  async function run(action: () => Promise<unknown>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (e) {
      if (active.current) setError(e);
    } finally {
      if (active.current) {
        try {
          setRecord(publisher.snapshot());
        } catch {}
        setBusy(false);
      }
      lock.current = false;
    }
  }
  const book = record?.book ?? source.book;
  const back = () =>
    source.book === book
      ? router.dismissTo({
          pathname: "/chapter-edit",
          params: { book: source.book, id: source.local },
        })
      : router.dismissTo({ pathname: "/novel-drafts", params: { book } });
  async function generate() {
    const metadata = await new NovelsApi((p, o) =>
      session.authorized(p, o),
    ).read(source.book);
    await publisher.begin(source.book, {
      draft: source.draft,
      revision: source.revision,
      bookRevision: metadata.revision,
    });
    const value = await publisher.readPreview();
    if (active.current) {
      setPreview(value);
      setRights(false);
    }
  }
  async function read() {
    const value = await publisher.readPreview();
    if (active.current) {
      setPreview(value);
      setRights(false);
    }
  }
  async function clear() {
    await publisher.clear();
    if (active.current) {
      setPreview(undefined);
      setRights(false);
    }
  }
  const unresolved =
    !!record &&
    !record.result &&
    !record.rejection &&
    (!!record.submit || !record.prepared);
  const chunks =
    preview && !record?.submit && !record?.rejection
      ? readingChunks(preview.content)
      : [];
  const controls = (
    <View style={s.controls}>
      {error ? (
        <Text accessibilityRole="alert" style={s.error}>
          {message(error)}
        </Text>
      ) : null}
      {record === undefined ? (
        <Action
          label="重新读取安全记录"
          disabled={busy}
          onPress={() =>
            void run(async () => {
              await publisher.load();
            })
          }
        />
      ) : null}
      {record === null ? (
        <>
          <Text style={s.note}>
            生成本次固定内容后，工作稿的后续修改不会替换它。预览24小时内有效。
          </Text>
          <Action
            label="生成固定预览"
            disabled={busy}
            onPress={() => void run(generate)}
          />
        </>
      ) : null}
      {record && record.book !== source.book ? (
        <Text style={s.note}>
          先处理上次另一本书的原请求，不能用本次草稿替换它。
        </Text>
      ) : null}
      {unresolved ? (
        <>
          <Text style={s.title}>原请求尚未确认</Text>
          <Text style={s.note}>
            先查询是否已受理。重试只发送同一标识和同一内容，不创建第二次提交。
          </Text>
          <Action
            label="查询原结果"
            disabled={busy}
            onPress={() =>
              void run(async () => {
                await publisher.confirmOriginal();
              })
            }
          />
          <Action
            label="重试同一原请求"
            disabled={busy}
            onPress={() =>
              void run(async () => {
                await publisher.retryOriginal();
              })
            }
          />
        </>
      ) : null}
      {record?.result ? (
        <>
          <Text style={s.title}>
            {record.result.state === "pending"
              ? "先审提交已受理"
              : "已发布正式章节"}
          </Text>
          <Text style={s.note}>
            这是原提交受理结果，不代表当前审核状态；当前可见性仍按作品最新权限判断。
          </Text>
          {record.result.state === "published" ? (
            <Action
              label="查看读者章节"
              disabled={busy}
              onPress={() =>
                router.push({
                  pathname: "/novel-chapter",
                  params: {
                    book: record.book,
                    chapter: record.result!.chapter_id,
                  },
                })
              }
            />
          ) : null}
          <Action
            label="完成本次处理"
            disabled={busy}
            onPress={() => void run(clear)}
          />
        </>
      ) : null}
      {record?.rejection ? (
        <>
          <Text style={s.note}>
            服务端明确未受理本次请求，可放弃该记录后重新核对。
          </Text>
          <Action
            label="放弃已拒绝请求"
            disabled={busy}
            onPress={() => void run(clear)}
          />
        </>
      ) : null}
      {record?.prepared && !record.submit && !record.rejection ? (
        <>
          {!preview ? (
            <Action
              label="读取固定全文"
              disabled={busy}
              onPress={() => void run(read)}
            />
          ) : (
            <>
              {preview.review_required ? (
                <Text style={s.note}>
                  当前提交须先审核，通过后才能被读者阅读。
                </Text>
              ) : null}
              {preview.book_hidden ||
              preview.chapter_hidden ||
              preview.restricted ? (
                <Text style={s.note}>
                  作品存在隐藏或限制；提交不会自动恢复公开。
                </Text>
              ) : null}
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: rights, disabled: busy }}
                accessibilityLabel="确认原创或已获发布授权"
                disabled={busy}
                onPress={() => setRights((v) => !v)}
                style={s.rights}
              >
                <Text style={s.note}>
                  {rights ? "已确认" : "未确认"}　内容为原创，或已取得发布授权。
                </Text>
              </Pressable>
              <Action
                label="提交发布"
                disabled={busy || !rights}
                onPress={() =>
                  void run(async () => {
                    await publisher.submit(preview, true);
                    if (active.current) {
                      setPreview(undefined);
                      setRights(false);
                    }
                  })
                }
              />
            </>
          )}
          <Action
            label="放弃本次预览"
            disabled={busy}
            onPress={() => void run(clear)}
          />
        </>
      ) : null}
    </View>
  );
  return (
    <SafeAreaView style={s.screen}>
      <View style={s.header}>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={back}
          style={s.back}
        >
          <Text style={s.link}>章节草稿</Text>
        </Pressable>
        <Text style={s.title}>核对发布</Text>
      </View>
      {busy && record === undefined ? (
        <Status loading title="正在读取安全记录" />
      ) : (
        <FlatList
          data={chunks}
          keyExtractor={(_, i) => String(i)}
          contentContainerStyle={s.content}
          initialNumToRender={8}
          windowSize={7}
          extraData={{ record, rights, busy, error }}
          ListHeaderComponent={
            preview && !record?.submit && !record?.rejection ? (
              <View style={s.summary}>
                <Text style={s.note}>
                  {preview.book_title} · 第{preview.ordinal}章
                </Text>
                <Text style={s.chapterTitle}>{preview.title}</Text>
                <Text style={s.note}>
                  已保存修订 {preview.source_revision} · 本次固定内容
                </Text>
                <Text style={s.note}>
                  首个实际发布的章节建立书籍正式资料；后续章节不自动替换已发布的书籍资料。
                </Text>
              </View>
            ) : undefined
          }
          renderItem={({ item }) => (
            <Text selectable style={s.body}>
              {item}
            </Text>
          )}
          ListFooterComponent={controls}
        />
      )}
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: t.surface },
  header: {
    minHeight: 56,
    paddingHorizontal: 16,
    flexDirection: "row",
    gap: 24,
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: t.line,
  },
  back: { minHeight: 48, justifyContent: "center" },
  link: { color: t.brand, fontSize: 14 },
  title: { color: t.ink, fontSize: 16, lineHeight: 24, fontWeight: "600" },
  content: { paddingHorizontal: 24, paddingBottom: 24 },
  summary: { paddingVertical: 24, gap: 8 },
  chapterTitle: {
    fontSize: 24,
    lineHeight: 32,
    fontWeight: "600",
    color: t.ink,
  },
  body: { fontSize: 18, lineHeight: 32, color: t.ink },
  note: { fontSize: 14, lineHeight: 24, color: t.secondary },
  controls: { paddingVertical: 24, gap: 16 },
  error: { fontSize: 14, lineHeight: 24, color: t.danger },
  rights: { minHeight: 48, justifyContent: "center" },
});
