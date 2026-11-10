<script setup lang="ts">
import { checkedRectification, checkedRectificationPreview } from '../../lib/novel-operations'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { request as transportRequest, APIError } from '../../lib/api'
import {
  NovelOperationJournal,
  checkedNovelOperation,
  confirmNovelOperation,
  novelOperationPaths,
  type NovelOperation,
  type NovelSchema,
} from '../../lib/novel-operations'
useHead({
  title: '小说治理 · Tako',
  meta: [{ name: 'robots', content: 'noindex,nofollow,noarchive' }],
})
type Mode = 'chapters' | 'post' | 'metadata' | 'metadata-post' | 'cases' | 'appeals'
type Row = {
  id: string
  book: string
  title: string
  note: string
  mode: Mode
  chapter?: string
  version: number
}
type Detail = {
  title: string
  body: string
  version: number
  chapter?: string
  source?: NovelSchema<'ChapterSubmissionDetail'>
  metadata?: NovelSchema<'NovelMetadataSubmission'>
  caseDetail?: NovelSchema<'NovelCaseDetail'>
  bookState?: NovelSchema<'NovelFormalState'>
  chapterState?: NovelSchema<'NovelChapterState'>
}
const modes: { value: Mode; label: string }[] = [
  { value: 'chapters', label: '章节待审' },
  { value: 'post', label: '章节后审' },
  { value: 'metadata', label: '资料待审' },
  { value: 'metadata-post', label: '资料后审' },
  { value: 'cases', label: '处置记录' },
  { value: 'appeals', label: '待复核' },
]
const authorPolicy = ref<NovelSchema<'AuthorPolicyPage'> | null>(null)
const mode = ref<Mode>('chapters'),
  rows = ref<Row[]>([]),
  next = ref(''),
  selected = ref<Row | null>(null),
  detail = ref<Detail | null>(null)
const busy = ref(false),
  ready = ref(false),
  message = ref(''),
  reason = ref(''),
  decision = ref('approve'),
  proposed = ref<{ label: string; command: NovelOperation } | null>(null)
const pending = ref<NovelOperation | null>(null),
  confirmed = ref(false),
  canRetry = ref(false)
const rectificationCase = ref<NovelSchema<'NovelCaseDetail'> | null>(null)
const rectifications = ref<NovelSchema<'NovelRectification'>[]>([]),
  rectNext = ref(0),
  rectLoaded = ref(false),
  rectificationSelected = ref<NovelSchema<'NovelRectificationDetail'> | null>(null),
  formalChapters = ref<NovelSchema<'OperatorFormalChapter'>[]>([]),
  chapterNext = ref(0),
  rectChapter = ref(''),
  revokeRectificationCase = ref(false)
const rectStatus = (state: string) =>
  ({
    available: '可准备整改',
    submitted: '等待人工审核',
    approved: '已通过',
    rejected: '已驳回',
    cancelled: '已取消',
    withdrawn: '已撤回',
  })[state] ?? '需重新核对'
function resetRectification() {
  rectificationCase.value = null
  rectifications.value = []
  rectNext.value = 0
  rectLoaded.value = false
  rectificationSelected.value = null
  formalChapters.value = []
  chapterNext.value = 0
  rectChapter.value = ''
  revokeRectificationCase.value = false
}
async function readRectifications(more = false) {
  if (!selected.value || busy.value || pending.value || proposed.value) return
  const row = selected.value,
    gen = generation
  busy.value = true
  message.value = ''
  try {
    await verify()
    const p = await request<NovelSchema<'NovelRectificationPage'>>(
      `/ops/novels/${row.book}/rectifications${more ? '?before=' + rectNext.value : ''}`,
    )
    if (
      !p ||
      !Array.isArray(p.items) ||
      p.items.length > 20 ||
      !Number.isSafeInteger(p.next) ||
      p.next < 0
    )
      throw Error('invalid_receipt')
    p.items.forEach((v) => checkedRectification(v, row.book))
    await verify()
    if (gen !== generation || selected.value?.id !== row.id) return
    rectifications.value = more
      ? [
          ...rectifications.value,
          ...p.items.filter((v) => !rectifications.value.some((x) => x.id === v.id)),
        ]
      : p.items
    rectNext.value = p.next
    rectLoaded.value = true
  } catch (e) {
    if (gen === generation) message.value = describe(e)
  } finally {
    if (gen === generation) busy.value = false
  }
}
async function chooseRectification(id: string) {
  if (!selected.value || busy.value || pending.value || proposed.value) return
  if (reason.value.trim() && !window.confirm('处理原因尚未提交，确认选择整改记录？')) return
  const row = selected.value,
    gen = generation
  busy.value = true
  message.value = ''
  try {
    await verify()
    const d = await request<NovelSchema<'NovelRectificationDetail'>>(
      `/ops/novels/${row.book}/rectifications/${id}`,
    )
    checkedRectification(d.grant, row.book, id)
    if (d.source !== null || (d.grant.preview_id === null) !== (d.submitted === null))
      throw Error('invalid_receipt')
    if (d.submitted)
      checkedRectificationPreview(d.submitted, row.book, d.grant.preview_id!, d.grant)
    const associated = await request<NovelSchema<'NovelCaseDetail'>>(
      `/ops/novels/${row.book}/moderation/${d.grant.case_id}`,
    )
    if (associated.case.id !== d.grant.case_id || associated.case.novel_id !== row.book)
      throw Error('invalid_receipt')
    await verify()
    if (gen !== generation || selected.value?.id !== row.id) return
    rectificationSelected.value = d
    rectificationCase.value = associated
    reason.value = ''
    revokeRectificationCase.value = false
    decision.value =
      d.grant.state === 'submitted'
        ? d.grant.target_current
          ? 'rect-approve'
          : 'rect-reject'
        : 'rect-cancel'
  } catch (e) {
    if (gen === generation) message.value = describe(e)
  } finally {
    if (gen === generation) busy.value = false
  }
}
async function readFormalChapters(more = false) {
  if (!selected.value || busy.value || pending.value || proposed.value) return
  const row = selected.value,
    gen = generation,
    after = more ? chapterNext.value : 0
  busy.value = true
  message.value = ''
  try {
    await verify()
    const p = await request<NovelSchema<'OperatorFormalChapterPage'>>(
      `/ops/novels/${row.book}/chapters?after=${after}`,
    )
    if (
      !p ||
      !Array.isArray(p.items) ||
      p.items.length > 20 ||
      !Number.isSafeInteger(p.next) ||
      p.next < 0
    )
      throw Error('invalid_receipt')
    let last = after
    for (const c of p.items) {
      if (
        !/^[0-9a-f-]{36}$/i.test(c.chapter_id) ||
        !Number.isSafeInteger(c.ordinal) ||
        c.ordinal <= last ||
        !Number.isSafeInteger(c.version) ||
        c.version < 1 ||
        typeof c.title !== 'string'
      )
        throw Error('invalid_receipt')
      last = c.ordinal
    }
    if (p.next !== 0 && (p.next !== last || p.items.length !== 20)) throw Error('invalid_receipt')
    await verify()
    if (gen !== generation || selected.value?.id !== row.id) return
    formalChapters.value = more
      ? [
          ...formalChapters.value,
          ...p.items.filter(
            (v) => !formalChapters.value.some((x) => x.chapter_id === v.chapter_id),
          ),
        ]
      : p.items
    chapterNext.value = p.next
  } catch (e) {
    if (gen === generation) message.value = describe(e)
  } finally {
    if (gen === generation) busy.value = false
  }
}
const rectificationChapter = computed(() =>
  formalChapters.value.find((v) => v.chapter_id === rectChapter.value),
)
let owner = '',
  generation = 0,
  journal: NovelOperationJournal | null = null,
  channel: BroadcastChannel | undefined
async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  try {
    return await transportRequest<T>(path, method, body)
  } catch (e) {
    if (owner && e instanceof APIError && [401, 403].includes(e.status)) invalidate()
    throw e
  }
}
function describe(e: unknown) {
  if (e instanceof Error && e.message === 'session_changed') return '会话已变化，请重新验证登录。'
  if (e instanceof APIError)
    return (
      (
        {
          authentication_required: '请先登录运营账号。',
          operator_required: '当前账号没有运营权限。',
          novel_state_conflict: '状态已变化，请重新读取后确认。',
          chapter_publication_conflict: '待审内容已变化，请重新读取后确认。',
          mutation_id_reused: '原标识与处理内容不符，请核对原操作。',
          resource_not_found: '记录不存在或当前账号无法访问。',
          appeal_pending: '已有一条处理中申请。',
          appeal_cooldown: '仍在复核冷静期。',
        } as Record<string, string>
      )[e.code] ?? '连接暂不可用。已提交的操作请先查询原结果。'
    )
  return '无法完成当前步骤。请保留原操作并重试读取。'
}
function invalidate() {
  generation++
  ready.value = false
  rows.value = []
  authorPolicy.value = null
  resetRectification()
  selected.value = null
  detail.value = null
  reason.value = ''
  proposed.value = null
  pending.value = null
  confirmed.value = false
  journal = null
  owner = ''
  message.value = '会话已变化，请重新验证登录。'
}
async function verify() {
  const me = await request<{ id: string }>('/me')
  if (me.id !== owner) {
    invalidate()
    throw Error('session_changed')
  }
}
function queuePath(more: boolean) {
  const token = more ? next.value : ''
  switch (mode.value) {
    case 'chapters':
      return (
        '/ops/novels/chapter-review-queue' + (token ? '?cursor=' + encodeURIComponent(token) : '')
      )
    case 'post':
      return '/ops/novels/post-reviews' + (token ? '?cursor=' + encodeURIComponent(token) : '')
    case 'metadata':
    case 'metadata-post':
      return (
        '/ops/novels/metadata-review-queue?mode=' +
        (mode.value === 'metadata' ? 'pre' : 'post') +
        (token ? '&cursor=' + encodeURIComponent(token) : '')
      )
    case 'cases':
      return '/ops/novels/moderation?state=all' + (token ? '&before=' + token : '')
    case 'appeals':
      return '/ops/novels/appeals' + (token ? '?after=' + token : '')
  }
}
async function load(more = false) {
  const gen = generation,
    m = mode.value
  const page = await request<{ items: unknown[]; next_cursor?: string; next?: number }>(
    queuePath(more),
  )
  await verify()
  if (gen !== generation || m !== mode.value) return
  const mapped = page.items.map((raw): Row => {
    if (m === 'chapters') {
      const v = raw as NovelSchema<'ChapterSubmissionSummary'>
      return {
        id: v.id,
        book: v.novel_id,
        title: v.title,
        note: `第${v.ordinal}章 · 待审`,
        mode: m,
        chapter: v.chapter_id,
        version: v.candidate_version,
      }
    }
    if (m === 'post') {
      const v = raw as NovelSchema<'NovelPostReview'>
      return {
        id: v.submission_id,
        book: v.novel_id,
        title: v.title,
        note: v.current ? '当前展示指针' : '旧正式版本',
        mode: m,
        chapter: v.chapter_id,
        version: v.version,
      }
    }
    if (m === 'metadata' || m === 'metadata-post') {
      const v = raw as NovelSchema<'NovelMetadataSubmission'>
      return {
        id: v.id,
        book: v.novel_id,
        title: v.title,
        note: m === 'metadata' ? '书籍资料待审' : '书籍资料后审',
        mode: m,
        version: v.candidate_revision,
      }
    }
    if (m === 'cases') {
      const v = raw as NovelSchema<'NovelCase'>
      return {
        id: String(v.id),
        book: v.novel_id,
        title:
          v.scope === 'book' ? '整书限制' : v.scope === 'chapter' ? '整章限制' : '章节版本限制',
        note: v.state === 'active' ? '限制生效' : '已撤销',
        mode: m,
        version: v.version,
      }
    }
    const v = raw as NovelSchema<'NovelAppeal'>
    return {
      id: String(v.case_id),
      book: v.novel_id,
      title: '作者复核申请',
      note: new Date(v.created_at).toLocaleString(),
      mode: m,
      version: 0,
    }
  })
  rows.value = more
    ? [...rows.value, ...mapped.filter((v) => !rows.value.some((x) => x.id === v.id))]
    : mapped
  next.value = page.next_cursor ?? (page.next ? String(page.next) : '')
}
async function refresh(more = false) {
  if (busy.value || !ready.value || pending.value) return
  busy.value = true
  message.value = ''
  try {
    await verify()
    await load(more)
  } catch (e) {
    message.value = describe(e)
  } finally {
    busy.value = false
  }
}
async function changeMode(value: Mode) {
  if (busy.value || pending.value || proposed.value) return
  if (reason.value.trim() && !window.confirm('处理原因尚未提交，确认切换？')) return
  mode.value = value
  authorPolicy.value = null
  resetRectification()
  selected.value = null
  detail.value = null
  reason.value = ''
  next.value = ''
  rows.value = []
  await refresh()
}
async function readDetail(row: Row, before = 0): Promise<Detail> {
  const base = `/ops/novels/${row.book}`
  if (row.mode === 'chapters' || row.mode === 'post') {
    const source = await request<NovelSchema<'ChapterSubmissionDetail'>>(
      `${base}/chapter-submissions/${row.id}`,
    )
    const [bookState, chapterState] = await Promise.all([
      request<NovelSchema<'NovelFormalState'>>(`${base}/formal-state`).catch((e) => {
        if (row.mode === 'chapters' && e instanceof APIError && e.status === 404) return undefined
        throw e
      }),
      row.mode === 'post'
        ? request<NovelSchema<'NovelChapterState'>>(
            `${base}/chapters/${source.preview.chapter_id}/state`,
          )
        : Promise.resolve(undefined),
    ])
    return {
      title: source.preview.title,
      body: source.preview.content,
      version: source.submission.candidate_version,
      chapter: source.preview.chapter_id,
      source,
      bookState,
      chapterState,
    }
  }
  if (row.mode === 'metadata' || row.mode === 'metadata-post') {
    const metadata = await request<NovelSchema<'NovelMetadataSubmission'>>(
        `${base}/metadata-submissions/${row.id}`,
      ),
      bookState = await request<NovelSchema<'NovelFormalState'>>(`${base}/formal-state`)
    return {
      title: metadata.title,
      body: metadata.introduction,
      version: metadata.candidate_revision,
      metadata,
      bookState,
    }
  }
  const caseDetail = await request<NovelSchema<'NovelCaseDetail'>>(
      `${base}/moderation/${row.id}?before_appeal=${before}`,
    ),
    c = caseDetail.case,
    bookState = await request<NovelSchema<'NovelFormalState'>>(`${base}/formal-state`)
  if (c.scope === 'book')
    return {
      title: bookState.formal?.title ?? '书籍资料',
      body: bookState.formal?.introduction ?? '',
      version: 0,
      caseDetail,
      bookState,
    }
  const chapterState = await request<NovelSchema<'NovelChapterState'>>(
      `${base}/chapters/${c.target_id}/state`,
    ),
    version = c.scope === 'version' ? c.version : chapterState.display_version
  const text = await request<NovelSchema<'NovelChapterVersion'>>(
    `${base}/chapters/${c.target_id}/versions/${version}`,
  )
  return {
    title: text.title,
    body: text.content,
    version,
    chapter: c.target_id,
    chapterState,
    caseDetail,
    bookState,
  }
}
async function choose(row: Row) {
  if (busy.value || pending.value || proposed.value) return
  if (reason.value.trim() && !window.confirm('处理原因尚未提交，确认选择另一条？')) return
  const gen = generation
  busy.value = true
  authorPolicy.value = null
  resetRectification()
  selected.value = row
  detail.value = null
  reason.value = ''
  message.value = ''
  try {
    await verify()
    const value = await readDetail(row)
    await verify()
    if (gen !== generation) return
    detail.value = value
    decision.value = value.caseDetail ? 'revoke' : 'approve'
  } catch (e) {
    message.value = describe(e)
  } finally {
    busy.value = false
  }
}
const currentAppeal = computed(() =>
  detail.value?.caseDetail?.appeals.items.find((v) => v.state === 'pending'),
)
const actions = computed(() => {
  const row = selected.value,
    d = detail.value
  if (!row || !d) return []
  if (rectificationSelected.value) {
    const g = rectificationSelected.value.grant
    return g.state === 'submitted'
      ? g.target_current
        ? ['rect-approve', 'rect-reject', 'rect-cancel']
        : ['rect-reject', 'rect-cancel']
      : g.state === 'available'
        ? ['rect-cancel']
        : []
  }
  if (d.caseDetail) {
    if (d.caseDetail.case.state !== 'active') return []
    const normal = currentAppeal.value ? ['uphold', 'revoke'] : ['revoke']
    return [
      ...normal,
      ...(d.bookState?.completed &&
      rectificationChapter.value &&
      (!['chapter', 'version'].includes(d.caseDetail.case.scope) ||
        d.caseDetail.case.target_id === rectificationChapter.value.chapter_id) &&
      (d.caseDetail.case.scope !== 'version' ||
        d.caseDetail.case.version === rectificationChapter.value.version)
        ? ['rect-grant']
        : []),
    ]
  }
  if (row.mode === 'chapters') return d.source?.submission.current ? ['approve', 'reject'] : []
  if (row.mode === 'metadata') return d.metadata?.current ? ['approve', 'reject'] : []
  if (row.mode === 'metadata-post')
    return d.metadata?.post_reviewed_at ? [] : ['approve', 'limit_book']
  return ['approve', 'limit_version', 'limit_chapter', 'limit_book']
})
const labels: Record<string, string> = {
  'rect-grant': '授权所选正式章一次整改',
  'rect-approve': '通过这份固定整改',
  'rect-reject': '驳回这次整改',
  'rect-cancel': '取消本次授权或候选',
  approve: '审核通过 / 完成后审',
  reject: '驳回本次提交',
  limit_version: '限制这份章节版本',
  limit_chapter: '限制整章',
  limit_book: '限制整书',
  uphold: '维持处置，进入24小时冷静期',
  revoke: '仅撤销这项限制',
}
function leaveRectification() {
  if (busy.value || pending.value || proposed.value) return
  if (reason.value.trim() && !window.confirm('处理原因尚未提交，确认返回处置原文？')) return
  rectificationSelected.value = null
  rectificationCase.value = null
  decision.value = 'revoke'
  revokeRectificationCase.value = false
  reason.value = ''
}
function actionLabel(action: string) {
  return action === 'approve'
    ? selected.value?.mode === 'post' || selected.value?.mode === 'metadata-post'
      ? '完成这份内容的后审'
      : '通过本次待审提交'
    : (labels[action] ?? action)
}
function propose() {
  const row = selected.value,
    d = detail.value,
    a = decision.value
  if (!row || !d || !actions.value.includes(a) || busy.value || pending.value) return
  if (Array.from(reason.value).length > 2000 || (a !== 'approve' && !reason.value.trim())) {
    message.value = '请填写不超过2000字的处理原因。'
    return
  }
  const command: NovelOperation = {
    owner,
    book: row.book,
    kind: 'chapter',
    target: row.id,
    version: d.version,
    body: { mutation_id: crypto.randomUUID() },
  }
  if (a === 'rect-grant') {
    const c = rectificationChapter.value,
      item = d.caseDetail?.case
    if (!c || !item) return
    command.kind = 'rect-grant'
    command.target = c.chapter_id
    command.version = c.version
    command.body = {
      ...command.body,
      chapter_id: c.chapter_id,
      base_version: c.version,
      case_id: item.id,
      case_revision: item.revision,
      reason: reason.value,
    }
  } else if (a.startsWith('rect-')) {
    const g = rectificationSelected.value?.grant
    if (!g) return
    command.kind = a as 'rect-approve' | 'rect-reject' | 'rect-cancel'
    command.target = g.id
    command.version = g.base_version
    command.body = {
      ...command.body,
      expected_revision: g.revision,
      reason: reason.value,
      revoke_case: a === 'rect-approve' && revokeRectificationCase.value,
    }
  } else if (a.startsWith('limit_')) {
    const scope = a.slice(6),
      state = scope === 'book' ? d.bookState : d.chapterState
    if (!state) {
      message.value = '无法读取当前状态，请重新选择记录。'
      return
    }
    command.kind = 'limit'
    command.target = scope === 'book' ? row.book : d.chapter!
    command.body = {
      ...command.body,
      scope,
      chapter_id: scope === 'book' ? null : d.chapter,
      version: scope === 'version' ? d.version : 0,
      expected_revision: state.state_revision,
      reason: reason.value,
    }
  } else if (d.caseDetail) {
    command.kind = 'case'
    command.body = {
      ...command.body,
      expected_revision: d.caseDetail.case.revision,
      decision: a,
      reason: reason.value,
      appeal_id: currentAppeal.value?.id ?? 0,
    }
  } else if (row.mode === 'post') {
    command.kind = 'post'
  } else {
    command.kind = row.mode.startsWith('metadata') ? 'metadata' : 'chapter'
    command.body = { ...command.body, decision: a, reason: reason.value }
  }
  checkedNovelOperation(command, owner)
  proposed.value = { label: actionLabel(a), command }
}
async function readAuthorPolicy(more = false) {
  if (!selected.value || busy.value || pending.value || proposed.value) return
  busy.value = true
  const gen = generation
  try {
    await verify()
    const value = await request<NovelSchema<'AuthorPolicyPage'>>(
      `/ops/novels/${selected.value.book}/author-policy${more && authorPolicy.value?.next ? `?before=${authorPolicy.value.next}` : ''}`,
    )
    if (gen === generation)
      authorPolicy.value =
        more && authorPolicy.value
          ? {
              ...value,
              items: [
                ...authorPolicy.value.items,
                ...value.items.filter(
                  (e) => !authorPolicy.value!.items.some((x) => x.revision === e.revision),
                ),
              ],
            }
          : value
  } catch (e) {
    message.value = describe(e)
  } finally {
    if (gen === generation) busy.value = false
  }
}
function proposePolicy(action: 'start' | 'extend' | 'revoke') {
  if (!authorPolicy.value || !selected.value || busy.value || pending.value || proposed.value)
    return
  if (!reason.value.trim() || Array.from(reason.value).length > 2000) {
    message.value = '请填写本次观察期决定的原因（1～2000字）。'
    return
  }
  const command: NovelOperation = {
    owner,
    book: selected.value.book,
    kind: 'policy',
    target: selected.value.book,
    version: 0,
    body: {
      mutation_id: crypto.randomUUID(),
      expected_revision: authorPolicy.value.policy.revision,
      action,
      reason: reason.value.trim(),
    },
  }
  checkedNovelOperation(command, owner)
  proposed.value = {
    label:
      action === 'start'
        ? '开始账号观察期7天'
        : action === 'extend'
          ? '延长账号观察期7天'
          : '提前结束账号观察期',
    command,
  }
}
async function finish() {
  const p = pending.value
  if (!p || !journal) return
  journal.clear(p.body.mutation_id)
  pending.value = null
  confirmed.value = false
  canRetry.value = false
  proposed.value = null
  authorPolicy.value = null
  resetRectification()
  selected.value = null
  detail.value = null
  reason.value = ''
  message.value = '处理已确认。请选择记录读取当前状态。'
  try {
    await load()
  } catch (e) {
    message.value = '处理已确认，队列暂时读取失败。' + describe(e)
  }
}
async function perform(retry = false) {
  if (busy.value || !ready.value || (!retry && !proposed.value) || (retry && !pending.value)) return
  const gen = generation
  busy.value = true
  message.value = ''
  let fresh = false
  try {
    await verify()
    if (gen !== generation) return
    if (!pending.value) {
      const p = proposed.value!.command
      try {
        journal!.save(p)
      } catch {
        message.value = '无法保存原处理记录，请求未发出。请检查存储后重试。'
        return
      }
      pending.value = p
      proposed.value = null
      fresh = true
    }
    const p = pending.value!,
      result = await request(novelOperationPaths(p).write, 'POST', p.body)
    if (gen !== generation) return
    confirmNovelOperation(p, result)
    confirmed.value = true
    await finish()
  } catch (e) {
    if (gen !== generation) return
    if (confirmed.value) {
      message.value = '处理已确认，但本机记录尚未清除。请重试清理。'
    } else if (
      e instanceof APIError &&
      pending.value &&
      ((fresh && [400, 404, 409].includes(e.status)) ||
        (e.status === 409 &&
          ['novel_state_conflict', 'chapter_publication_conflict'].includes(e.code)))
    ) {
      try {
        journal!.clear(pending.value.body.mutation_id)
        pending.value = null
        authorPolicy.value = null
        resetRectification()
        selected.value = null
        detail.value = null
      } catch {
        message.value = '无法清理未受理的记录，请保持页面。'
        return
      }
      message.value = '本次处理未受理。' + describe(e)
    } else message.value = describe(e)
  } finally {
    busy.value = false
  }
}
async function recover() {
  if (busy.value || !pending.value) return
  const gen = generation
  busy.value = true
  message.value = ''
  try {
    await verify()
    if (gen !== generation) return
    if (!confirmed.value) {
      const p = pending.value,
        result = await request(novelOperationPaths(p).receipt)
      if (gen !== generation) return
      confirmNovelOperation(p, result)
      confirmed.value = true
    }
    await finish()
  } catch (e) {
    if (gen !== generation) return
    if (confirmed.value) message.value = '处理已确认，但本机记录尚未清除。请重试清理。'
    else if (e instanceof APIError && e.status === 404) {
      canRetry.value = true
      message.value = '尚未查到原结果。可以原样重试，不会生成新的处理标识。'
    } else message.value = describe(e)
  } finally {
    busy.value = false
  }
}
async function moreAppeals() {
  const row = selected.value,
    d = detail.value
  if (!row || !d?.caseDetail?.appeals.next || busy.value || pending.value) return
  const gen = generation
  busy.value = true
  try {
    await verify()
    const value = await readDetail(row, d.caseDetail.appeals.next)
    await verify()
    if (gen !== generation) return
    if (value.caseDetail!.case.revision !== d.caseDetail.case.revision) {
      detail.value = value
      message.value = '处置已变化，请重新核对。'
      return
    }
    d.caseDetail.appeals.items.push(...value.caseDetail!.appeals.items)
    d.caseDetail.appeals.next = value.caseDetail!.appeals.next
  } catch (e) {
    message.value = describe(e)
  } finally {
    busy.value = false
  }
}
async function initialize() {
  if (busy.value) return
  busy.value = true
  message.value = ''
  const gen = generation
  try {
    const me = await request<{ id: string }>('/me'),
      access = await request<{ operator: boolean }>('/me/access')
    if (gen !== generation) return
    if (!access.operator) throw new APIError(403, 'operator_required')
    owner = me.id
    await verify()
    if (gen !== generation) return
    journal = new NovelOperationJournal(sessionStorage, owner)
    pending.value = journal.load()
    ready.value = true
    if (pending.value) {
      reason.value = String(pending.value.body.reason ?? '')
      message.value = '存在未确认的原处理，请先查询结果。'
    } else await load()
  } catch (e) {
    ready.value = false
    message.value = describe(e)
  } finally {
    busy.value = false
  }
}
async function sessionChanged() {
  if (!owner) return
  try {
    await verify()
  } catch (e) {
    if (e instanceof APIError && e.status === 401) invalidate()
    else message.value = describe(e)
  }
}
function storageChanged(e: StorageEvent) {
  if (e.key === 'tako-session-locked' && e.newValue) invalidate()
}
onMounted(() => {
  void initialize()
  window.addEventListener('focus', sessionChanged)
  window.addEventListener('storage', storageChanged)
  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel('tako-session')
    channel.onmessage = (e) => {
      if (e.data === 'logout') invalidate()
      else if (e.data === 'session-changed') void sessionChanged()
    }
  }
})
onUnmounted(() => {
  generation++
  channel?.close()
  window.removeEventListener('focus', sessionChanged)
  window.removeEventListener('storage', storageChanged)
})
onBeforeRouteLeave(
  () =>
    (!pending.value && !reason.value.trim()) ||
    window.confirm(
      pending.value
        ? '还有待确认处理，离开后可在本标签页返回继续查询。确认离开？'
        : '处理原因尚未提交，确认离开？',
    ),
)
</script>
<template>
  <div>
    <AppHeader />
    <main class="novel-desk">
      <header class="desk-heading">
        <div>
          <h1>小说治理</h1>
          <p>审核固定内容，处理明确问题与作者复核。</p>
        </div>
        <NuxtLink to="/ops/reviews">中篇内容治理</NuxtLink>
      </header>
      <p v-if="message" role="status" class="notice">{{ message }}</p>
      <button v-if="!ready" :disabled="busy" @click="initialize">
        {{ busy ? '正在验证…' : '重新验证登录' }}
      </button>
      <section v-if="pending" class="pending">
        <h2>{{ confirmed ? '清理已确认记录' : '原处理尚未确认' }}</h2>
        <p>确认原结果前不能执行另一条处理。正文未保存在操作记录中。</p>
        <button :disabled="busy" @click="recover">
          {{ confirmed ? '重试清理' : '查询原结果' }}</button
        ><button v-if="canRetry && !confirmed" :disabled="busy" @click="perform(true)">
          原样重试处理
        </button>
      </section>
      <template v-if="ready"
        ><nav class="desk-tabs" aria-label="小说治理队列">
          <button
            v-for="item in modes"
            :key="item.value"
            :aria-current="mode === item.value ? 'page' : undefined"
            :disabled="busy || !!pending || !!proposed"
            @click="changeMode(item.value)"
          >
            {{ item.label }}
          </button>
        </nav>
        <div class="desk-grid">
          <aside>
            <div class="list-heading">
              <h2>{{ modes.find((v) => v.value === mode)?.label }}</h2>
              <button :disabled="busy || !!pending || !!proposed" @click="refresh()">刷新</button>
            </div>
            <p v-if="!rows.length">{{ busy ? '正在读取…' : '暂无记录。' }}</p>
            <button
              v-for="row in rows"
              :key="row.id"
              class="queue-row"
              :class="{ selected: selected?.id === row.id }"
              :disabled="busy || !!pending || !!proposed"
              @click="choose(row)"
            >
              <span>{{ row.title }}</span
              ><small>{{ row.note }}</small></button
            ><button v-if="next" :disabled="busy || !!pending" @click="refresh(true)">
              加载更多
            </button>
          </aside>
          <section class="detail" aria-label="小说处理详情">
            <p v-if="!detail">
              {{ busy ? '正在读取内容…' : '选择一条记录查看固定内容与当前状态。' }}
            </p>
            <template v-else
              ><h2>{{ rectificationSelected?.submitted?.title ?? detail.title }}</h2>
              <p class="muted">
                {{ selected?.note }}<span v-if="detail.bookState?.author_hidden"> · 整书已隐藏</span
                ><span v-if="detail.bookState?.platform_limited"> · 整书受限</span>
              </p>
              <details class="case-history">
                <summary>作者账号观察期</summary>
                <p class="muted">
                  影响这个作者之后的中篇和长文章节提交，不只影响本书。已待审内容仍须人工审核；已有公开内容不自动隐藏。
                </p>
                <button :disabled="busy || !!pending || !!proposed" @click="readAuthorPolicy()">
                  读取作者观察期
                </button>
                <template v-if="authorPolicy">
                  <p>
                    {{ authorPolicy.policy.active ? '观察中：新提交先审后发' : '当前不在观察期'
                    }}<span v-if="authorPolicy.policy.observation_until">
                      · 结束时间
                      {{ new Date(authorPolicy.policy.observation_until).toLocaleString() }}</span
                    >
                  </p>
                  <p>{{ authorPolicy.policy.reason }}</p>
                  <label
                    >本次决定原因<textarea
                      v-model="reason"
                      rows="3"
                      :disabled="busy || !!pending || !!proposed"
                    />
                  </label>
                  <button
                    v-if="!authorPolicy.policy.active"
                    :disabled="busy || !!pending || !!proposed"
                    @click="proposePolicy('start')"
                  >
                    开始7天观察期
                  </button>
                  <template v-else
                    ><button
                      :disabled="busy || !!pending || !!proposed"
                      @click="proposePolicy('extend')"
                    >
                      从原结束时间延长7天</button
                    ><button
                      :disabled="busy || !!pending || !!proposed"
                      @click="proposePolicy('revoke')"
                    >
                      提前结束观察期
                    </button></template
                  >
                  <article v-for="event in authorPolicy.items" :key="event.revision">
                    <strong>{{
                      event.action === 'start'
                        ? '开始观察期'
                        : event.action === 'extend'
                          ? '延长7天'
                          : '提前结束'
                    }}</strong>
                    <p>{{ event.reason }}</p>
                    <small>{{ new Date(event.created_at).toLocaleString() }}</small>
                  </article>
                  <button
                    v-if="authorPolicy.next"
                    :disabled="busy || !!pending || !!proposed"
                    @click="readAuthorPolicy(true)"
                  >
                    更早的观察期决定
                  </button>
                </template>
              </details>
              <details :open="!!rectificationSelected?.submitted">
                <summary>查看固定内容</summary>
                <div class="fixed-text">
                  {{
                    rectificationSelected
                      ? (rectificationSelected.submitted?.content ??
                        '尚未提交整改正文，运营不能查看工作稿。')
                      : detail.body || '无简介。'
                  }}
                </div>
                <p v-if="detail.metadata" class="muted">{{ detail.metadata.tags.join(' / ') }}</p>
              </details>
              <section v-if="detail.caseDetail" class="case-history">
                <h3>处置与复核</h3>
                <p>{{ detail.caseDetail.case.reason }}</p>
                <p v-if="detail.caseDetail.case.decision_reason">
                  最近处理原因：{{ detail.caseDetail.case.decision_reason }}
                </p>
                <p v-if="detail.caseDetail.case.next_appeal_at" class="muted">
                  可再次申请：{{ new Date(detail.caseDetail.case.next_appeal_at).toLocaleString() }}
                </p>
                <article v-for="appeal in detail.caseDetail.appeals.items" :key="appeal.id">
                  <strong>{{
                    appeal.state === 'pending'
                      ? '复核处理中'
                      : appeal.state === 'upheld'
                        ? '维持处置'
                        : '已撤销'
                  }}</strong>
                  <p>{{ appeal.reason }}</p>
                  <p v-if="appeal.decision_reason" class="muted">{{ appeal.decision_reason }}</p>
                </article>
                <button
                  v-if="detail.caseDetail.appeals.next"
                  :disabled="busy || !!pending || !!proposed"
                  @click="moreAppeals"
                >
                  更早的复核记录
                </button>
              </section>
              <section
                v-if="detail.caseDetail && detail.bookState?.completed"
                class="case-history rectification-section"
              >
                <h3>指定章节整改</h3>
                <p class="muted">
                  只处理授权指定章，完结状态不变。运营看不到未提交工作稿；新章提醒与其他限制不联动。
                </p>
                <button :disabled="busy || !!pending || !!proposed" @click="readRectifications()">
                  读取本书整改记录
                </button>
                <p v-if="rectLoaded && !rectifications.length" class="muted">暂无整改授权。</p>
                <button
                  v-for="g in rectifications"
                  :key="g.id"
                  class="queue-row"
                  :disabled="busy || !!pending || !!proposed"
                  @click="chooseRectification(g.id)"
                >
                  <span>{{ g.reason }}</span
                  ><small>{{ rectStatus(g.state) }}</small>
                </button>
                <button
                  v-if="rectNext"
                  :disabled="busy || !!pending || !!proposed"
                  @click="readRectifications(true)"
                >
                  更早的整改记录
                </button>
                <template v-if="rectificationSelected">
                  <h3>{{ rectStatus(rectificationSelected.grant.state) }}</h3>
                  <p v-if="rectificationCase" class="muted">
                    关联{{
                      rectificationCase.case.scope === 'book'
                        ? '整书限制'
                        : rectificationCase.case.scope === 'chapter'
                          ? '整章限制'
                          : '版本限制'
                    }}：{{ rectificationCase.case.reason }}
                  </p>
                  <p>{{ rectificationSelected.grant.reason }}</p>
                  <p v-if="rectificationSelected.grant.decision_reason" class="muted">
                    处理说明：{{ rectificationSelected.grant.decision_reason }}
                  </p>
                  <p
                    v-if="
                      !rectificationSelected.grant.target_current &&
                      ['available', 'submitted'].includes(rectificationSelected.grant.state)
                    "
                    class="muted"
                  >
                    关联处置或正式版本已变化；请取消旧授权后重新核对，不能直接通过。
                  </p>
                  <label
                    v-if="
                      rectificationSelected.grant.state === 'submitted' &&
                      decision === 'rect-approve'
                    "
                    ><input
                      type="checkbox"
                      v-model="revokeRectificationCase"
                      :disabled="busy || !!pending || !!proposed"
                    />
                    同时撤销这次整改关联的那一条处置</label
                  >
                  <p class="muted">默认保留关联处置，作者隐藏与其他独立限制始终保留。</p>
                  <button
                    :disabled="busy || !!pending || !!proposed"
                    @click="chooseRectification(rectificationSelected.grant.id)"
                  >
                    重新读取这条整改
                  </button>
                  <button :disabled="busy || !!pending || !!proposed" @click="leaveRectification">
                    返回处置原文
                  </button>
                </template>
                <template v-else-if="detail.caseDetail.case.state === 'active'">
                  <button :disabled="busy || !!pending || !!proposed" @click="readFormalChapters()">
                    读取可选正式章
                  </button>
                  <label v-if="formalChapters.length"
                    >整改目标<select
                      v-model="rectChapter"
                      :disabled="busy || !!pending || !!proposed"
                    >
                      <option value="">选择正式章</option>
                      <option
                        v-for="c in formalChapters"
                        :key="c.chapter_id"
                        :value="c.chapter_id"
                        :disabled="
                          (detail.caseDetail.case.scope !== 'book' &&
                            detail.caseDetail.case.target_id !== c.chapter_id) ||
                          (detail.caseDetail.case.scope === 'version' &&
                            detail.caseDetail.case.version !== c.version)
                        "
                      >
                        第{{ c.ordinal }}章 · {{ c.title }}
                      </option>
                    </select></label
                  >
                  <button
                    v-if="chapterNext"
                    :disabled="busy || !!pending || !!proposed"
                    @click="readFormalChapters(true)"
                  >
                    后续正式章
                  </button>
                  <p class="muted">
                    选择后，在下方处理方式中选“授权所选正式章一次整改”。仅当前最新正式版可授权。
                  </p>
                </template>
              </section>
              <form
                v-if="actions.length && !pending && !proposed"
                class="decision-form"
                @submit.prevent="propose"
              >
                <label
                  >处理方式<select v-model="decision" :disabled="busy">
                    <option v-for="action in actions" :key="action" :value="action">
                      {{ actionLabel(action) }}
                    </option>
                  </select></label
                ><label>处理原因<textarea v-model="reason" :disabled="busy" rows="4" /></label>
                <p class="muted">
                  {{ Array.from(reason).length }} / 2000 字。驳回、限制、维持或撤销须填写原因。
                </p>
                <button :disabled="busy" type="submit">核对本次处理</button>
              </form>
              <section v-if="proposed" class="confirmation">
                <h3>确认{{ proposed.label }}</h3>
                <p>
                  {{
                    proposed.command.kind === 'policy'
                      ? '本次作用于作者账号，影响之后的中篇与长文提交；既有待审继续人工审核，既有公开内容不自动隐藏。'
                      : '仅处理当前选定对象。隐藏、其他层级限制与工作稿保持独立。'
                  }}
                </p>
                <p v-if="proposed.command.kind.startsWith('rect-')" class="muted">
                  {{
                    proposed.command.kind === 'rect-grant'
                      ? '指定章只能提交一次固定整改；此操作不改正式正文。'
                      : proposed.command.body.revoke_case
                        ? '仅同时撤销本次整改关联的处置；作者隐藏和其他限制保留。'
                        : '保留关联处置、作者隐藏与其他独立限制。'
                  }}
                </p>
                <p v-if="proposed.command.body.reason">原因：{{ proposed.command.body.reason }}</p>
                <button class="primary" :disabled="busy" @click="perform()">确认执行</button
                ><button :disabled="busy" @click="proposed = null">返回修改</button>
              </section>
            </template>
          </section>
        </div>
      </template>
    </main>
  </div>
</template>
<style scoped>
.novel-desk {
  max-width: 1280px;
  margin: 0 auto;
  padding: 32px 24px 48px;
}
.desk-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 24px;
}
h1 {
  font-size: 28px;
  line-height: 36px;
  margin: 0 0 8px;
  font-weight: 600;
}
h2 {
  font-size: 20px;
  line-height: 28px;
  margin: 0 0 16px;
  font-weight: 600;
}
h3 {
  font-size: 16px;
  line-height: 24px;
  font-weight: 600;
}
p {
  margin: 8px 0 16px;
  font-size: 14px;
  line-height: 22px;
}
.muted,
.desk-heading p,
small {
  color: var(--color-muted);
}
button {
  border: 1px solid var(--color-line);
  border-radius: 6px;
  background: var(--color-paper);
  color: var(--color-ink);
  padding: 8px 16px;
  cursor: pointer;
  font-size: 14px;
  line-height: 22px;
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
button:hover:enabled {
  border-color: var(--color-brand);
}
button:focus-visible,
select:focus-visible,
textarea:focus-visible,
summary:focus-visible {
  outline: 2px solid var(--color-brand);
  outline-offset: 3px;
}
.primary {
  background: var(--color-brand);
  border-color: var(--color-brand);
  color: white;
}
.desk-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 24px;
}
.desk-tabs [aria-current='page'] {
  color: var(--color-brand);
  border-color: var(--color-brand);
}
.desk-grid {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 24px;
}
.list-heading {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 16px;
}
.list-heading h2 {
  font-size: 16px;
}
.queue-row {
  display: block;
  width: 100%;
  text-align: left;
  margin-bottom: 8px;
  padding: 16px;
  overflow-wrap: anywhere;
}
.queue-row span {
  display: block;
  font-weight: 600;
  margin-bottom: 4px;
}
.queue-row small {
  font-size: 12px;
  line-height: 20px;
}
.queue-row.selected {
  box-shadow: inset 3px 0 var(--color-brand);
}
.detail {
  min-height: 480px;
  padding: 24px;
  background: var(--color-paper);
  border: 1px solid var(--color-line);
  border-radius: 8px;
  overflow-wrap: anywhere;
}
summary {
  cursor: pointer;
  font-size: 14px;
  line-height: 22px;
  padding: 8px 0;
}
.fixed-text {
  white-space: pre-wrap;
  font-size: 16px;
  line-height: 28px;
  padding: 16px 0;
}
.decision-form,
.case-history,
.confirmation {
  margin-top: 32px;
}
.decision-form label {
  display: block;
  font-size: 14px;
  margin-bottom: 16px;
}
.decision-form select,
.decision-form textarea {
  display: block;
  width: 100%;
  margin-top: 8px;
  padding: 12px;
  border: 1px solid var(--color-line);
  border-radius: 6px;
  background: var(--color-paper);
  color: var(--color-ink);
  font: inherit;
}
.decision-form select {
  max-width: 400px;
}
.case-history article {
  margin: 16px 0;
  padding: 16px 0;
}
.pending,
.notice,
.confirmation {
  background: #f1f2f3;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 24px;
}
.pending button,
.confirmation button {
  margin: 8px 8px 0 0;
}
.confirmation h3 {
  margin-top: 0;
}
@media (max-width: 767px) {
  .novel-desk {
    padding: 24px 16px 32px;
  }
  .desk-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .desk-heading {
    display: block;
  }
  .desk-heading > a {
    display: inline-block;
    margin-top: 8px;
  }
  .detail {
    padding: 24px 16px;
  }
  .desk-grid > aside {
    max-height: 320px;
    overflow: auto;
  }
}
.rectification-section {
  display: grid;
  gap: 12px;
  margin-top: 24px;
}
.rectification-section h3,
.rectification-section p {
  margin: 0;
}
.rectification-section label {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.rectification-section label:has(input[type='checkbox']) {
  flex-direction: row;
  align-items: flex-start;
}
.rectification-section button {
  justify-self: start;
  max-width: 100%;
}
.rectification-section .queue-row {
  width: 100%;
}
.rectification-section select {
  width: 100%;
  max-width: 400px;
  min-height: 44px;
  padding: 8px 12px;
  border: 1px solid #dfe3e8;
  border-radius: 6px;
  background: var(--color-paper);
  color: var(--color-ink);
  font: inherit;
}
</style>
