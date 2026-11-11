<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { APIError, request } from '../../lib/api'
import type { Account } from '../../lib/types'

useHead({
  title: '短帖审核 · Tako',
  meta: [{ name: 'robots', content: 'noindex,nofollow,noarchive' }],
})

type Lane = 'initial' | 'revision' | 'appeal'
type QueueItem = { id: string; title: string; pre_review: boolean; submitted_at: string }
type RevisionItem = QueueItem & { post_id: string; version: number | null }
type Task = QueueItem & { post_id: string; version: number | null; lane: Lane }
type Page<T> = { items: T[]; next_cursor: string }
type Appeal = { id: string; post_id: string; case_revision: number; version: number | null;
  state: string; reason: string; case_reason: string; submitted_at: string }
type AppealPage = { items: Appeal[]; next_before: number }
type ImageInfo = { id: string; width: number; height: number }
type Post = { id: string; state_revision: number; review_status: string; published_at: string | null;
  platform_limited: boolean; title: string; content: string; images: ImageInfo[] }
type Revision = { id: string; post_id: string; state: string; version: number | null;
  post_review_pending: boolean; title: string; content: string; images: ImageInfo[] }
type Snapshot = Pick<Post, 'title' | 'content' | 'images'>
type Evidence = Snapshot & { version: number | null }
type Detail = { task: Task; post: Post; snapshot: Snapshot; actionable: boolean;
  appeal?: Appeal; evidenceVersion?: number | null }
type Decision = 'approve' | 'reject' | 'limit' | 'limit_version' | 'appeal_uphold' | 'appeal_revoke'
type Pending = { post: string; mutation_id: string; expected_revision: number; action: Decision;
  reason: string; version?: number; revision_id?: string; appeal_id?: string }
const labels: Record<Decision, string> = {
  approve: '通过审核', reject: '驳回提交', limit: '限制短帖', limit_version: '限制此版本',
  appeal_uphold: '维持处置', appeal_revoke: '撤销处置',
}
const config = useRuntimeConfig()
const enabled = String(config.public.environment) === 'test' && String(config.public.publicationEnabled) === 'true'
const lane = ref<Lane>('initial')
const tasks = ref<Task[]>([])
const next = ref('')
const ready = ref(false)
const loaded = ref(false)
const busy = ref(false)
const detail = ref<Detail>()
const reason = ref('')
const decision = ref<Decision>('approve')
const pending = ref<Pending>()
const error = ref('')
const result = ref('')
let owner = ''
let generation = 0
let channel: BroadcastChannel | undefined

const choices = computed<Decision[]>(() => {
  const task = detail.value?.task
  if (!task) return []
  if (task.lane === 'appeal') return ['appeal_uphold', 'appeal_revoke']
  if (task.pre_review) return ['approve', 'reject']
  return task.lane === 'initial' ? ['approve', 'limit'] : ['approve', 'limit_version']
})
const hasReason = computed(() => Array.from(reason.value.trim()).length <= 500 &&
  (decision.value === 'approve' || reason.value.trim().length > 0))

function describe(failure: unknown) {
  if (!(failure instanceof APIError)) return '暂时无法完成，请重试。'
  const messages: Record<string, string> = {
    operator_required: '当前账号没有运营权限。',
    authentication_required: '请先在写作空间登录。',
    publication_disabled: '短帖审核尚未启用。',
    resource_not_found: '这项记录已不可访问，请刷新队列。',
    work_state_conflict: '审核状态已变化，请重新打开任务。',
    work_restricted: '短帖当前受限，请刷新后核对状态。',
    network_unconfirmed: '暂未确认结果，请重试原操作。',
    invalid_input: '请检查处置原因和操作目标。',
  }
  return messages[failure.code] ?? '服务暂不可用，请重试。'
}
function invalidate(message: string) {
  generation++
  owner = ''
  ready.value = false
  loaded.value = false
  tasks.value = []
  detail.value = undefined
  pending.value = undefined
  reason.value = ''
  next.value = ''
  result.value = ''
  error.value = message
}
async function verify() {
  const me = await request<Account>('/me')
  if (owner && me.id !== owner) {
    invalidate('会话已变化，请重新进入。')
    throw new APIError(401, 'authentication_required')
  }
  const { operator } = await request<{ operator: boolean }>('/me/access')
  if (!operator) throw new APIError(403, 'operator_required')
  return me.id
}
async function run(task: (epoch: number) => Promise<void>) {
  if (busy.value || !enabled) return
  busy.value = true
  error.value = ''
  const epoch = generation
  try { await task(epoch) }
  catch (failure) {
    if (epoch !== generation) return
    if (failure instanceof APIError && [401, 403].includes(failure.status)) {
      invalidate(describe(failure))
    } else {
      error.value = describe(failure)
    }
  } finally { busy.value = false }
}
async function readQueue(epoch: number, selected: Lane, cursor = '') {
  const actor = await verify()
  if (epoch !== generation) return
  owner = actor
  ready.value = true
  let rows: Task[]
  let anchor: string
  if (selected === 'appeal') {
    const page = await request<AppealPage>('/ops/short-post-appeals' + (cursor ? '?before=' + encodeURIComponent(cursor) : ''))
    rows = page.items.map((item) => ({ id: item.id, post_id: item.post_id, version: item.version,
      title: item.reason, pre_review: false, submitted_at: item.submitted_at, lane: selected }))
    anchor = page.next_before ? String(page.next_before) : ''
  } else {
    const query = cursor ? '?cursor=' + encodeURIComponent(cursor) : ''
    const page = selected === 'initial'
      ? await request<Page<QueueItem>>('/ops/short-posts' + query)
      : await request<Page<RevisionItem>>('/ops/short-post-revisions' + query)
    rows = page.items.map((item): Task => 'post_id' in item
      ? { ...(item as RevisionItem), lane: selected }
      : { ...item, post_id: item.id, version: null, lane: selected })
    anchor = page.next_cursor
  }
  await verify()
  if (epoch !== generation) return
  const seen = new Set(cursor ? tasks.value.map((item) => item.id) : [])
  const fresh = rows.filter((item) => !seen.has(item.id))
  tasks.value = cursor ? [...tasks.value, ...fresh] : fresh
  next.value = anchor
  loaded.value = true
}
function selectLane(nextLane: Lane) {
  if (busy.value || pending.value || lane.value === nextLane) return
  lane.value = nextLane
  detail.value = undefined
  tasks.value = []
  next.value = ''
  loaded.value = false
  result.value = ''
  void run((epoch) => readQueue(epoch, nextLane))
}
function open(task: Task) {
  result.value = ''
  detail.value = undefined
  reason.value = ''
  decision.value = task.lane === 'appeal' ? 'appeal_uphold' : 'approve'
  void run(async (epoch) => {
    await verify()
    const base = '/ops/short-posts/' + task.post_id
    const post = await request<Post>(base)
    if (task.lane === 'appeal') {
      const path = base + '/appeals/' + task.id
      const [appeal, evidence] = await Promise.all([
        request<Appeal>(path), request<Evidence>(path + '/evidence'),
      ])
      await verify()
      if (epoch !== generation) return
      if (post.id !== task.post_id || appeal.post_id !== task.post_id || appeal.id !== task.id ||
          (appeal.version !== null && appeal.version !== evidence.version))
        throw new APIError(409, 'work_state_conflict')
      detail.value = { task, post, snapshot: evidence, appeal, evidenceVersion: evidence.version,
        actionable: appeal.state === 'pending' }
      return
    }
    const revision = task.lane === 'revision'
      ? await request<Revision>(base + '/revisions/' + task.id) : undefined
    await verify()
    if (epoch !== generation) return
    if (post.id !== task.post_id || (revision && (revision.id !== task.id || revision.post_id !== task.post_id)))
      throw new APIError(409, 'work_state_conflict')
    const actionable = !post.platform_limited && (revision
      ? task.pre_review ? revision.state === 'pending'
        : revision.post_review_pending && revision.version === task.version
      : post.review_status === 'pending' && (post.published_at === null) === task.pre_review)
    detail.value = { task, post, snapshot: revision ?? post, actionable }
  })
}
function imagePath(detail: Detail, image: string) {
  const { task } = detail
  const base = '/api/ops/short-posts/' + encodeURIComponent(task.post_id)
  if (task.lane === 'appeal') {
    return base + '/appeals/' + encodeURIComponent(task.id) + '/evidence/images/' +
      encodeURIComponent(image) + '?version=' + (detail.evidenceVersion ?? 0)
  }
  return base + (task.lane === 'revision' ? '/revisions/' + encodeURIComponent(task.id) : '') +
    '/images/' + encodeURIComponent(image)
}
function confirm() {
  const selected = detail.value
  if (!selected?.actionable || !hasReason.value || pending.value || busy.value ||
      !choices.value.includes(decision.value)) return
  const task = selected.task
  const action = decision.value
  const revisionDecision = task.lane === 'revision' && (action === 'approve' || action === 'reject')
  const body: Pending = {
    post: task.post_id, expected_revision: selected.post.state_revision,
    mutation_id: crypto.randomUUID(), action, reason: reason.value.trim(),
    ...(revisionDecision ? { revision_id: task.id } : {}),
    ...(task.lane === 'appeal' ? { appeal_id: task.id } : {}),
    ...(action === 'limit_version' && task.version ? { version: task.version } : {}),
  }
  void run((epoch) => apply(epoch, body))
}
async function apply(epoch: number, body: Pending) {
  await verify()
  if (epoch !== generation) return
  pending.value = body
  const { post, ...input } = body
  try {
    await request('/ops/short-posts/' + post + '/actions', 'POST', input)
  } catch (failure) {
    if (epoch === generation && failure instanceof APIError && [400, 404, 409].includes(failure.status)) {
      pending.value = undefined
      detail.value = undefined
    }
    throw failure
  }
  await verify()
  if (epoch !== generation) return
  pending.value = undefined
  detail.value = undefined
  reason.value = ''
  result.value = body.appeal_id ? '复核结果已记录。' : '审核结果已记录。'
  await readQueue(epoch, lane.value)
}
function recheck() {
  if (!owner || busy.value) return
  void run(async () => { await verify() })
}
onMounted(() => {
  if (!enabled) return
  void run((epoch) => readQueue(epoch, lane.value))
  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel('tako-session')
    channel.onmessage = () => invalidate('会话已变化，请重新进入。')
  }
  window.addEventListener('focus', recheck)
})
onUnmounted(() => {
  generation++
  channel?.close()
  window.removeEventListener('focus', recheck)
})
</script>

<template>
  <AppHeader />
  <main class="short-desk">
    <header class="desk-heading">
      <h1>短帖审核</h1>
      <NuxtLink to="/ops/reviews">返回内容治理</NuxtLink>
    </header>
    <p v-if="!enabled">短帖审核仅在测试环境开放。</p>
    <template v-else>
      <p v-if="error" class="notice" role="alert">{{ error }}</p>
      <p v-if="result" class="notice" role="status">{{ result }}</p>
      <div class="desk-tools">
        <button type="button" :aria-pressed="lane === 'initial'" :disabled="busy || !!pending" @click="selectLane('initial')">首发</button>
        <button type="button" :aria-pressed="lane === 'revision'" :disabled="busy || !!pending" @click="selectLane('revision')">修订</button>
        <button type="button" :aria-pressed="lane === 'appeal'" :disabled="busy || !!pending" @click="selectLane('appeal')">复核</button>
        <button type="button" :disabled="busy || !!pending" @click="run((epoch) => readQueue(epoch, lane))">刷新队列</button>
      </div>
      <p v-if="busy && !loaded" role="status">正在加载审核队列</p>
      <div v-if="ready && loaded" class="desk-grid">
        <section aria-label="审核任务">
          <p v-if="!tasks.length">当前没有待处理的{{ lane === 'initial' ? '首发' : lane === 'revision' ? '修订' : '复核' }}。</p>
          <ul v-else class="tasks">
            <li v-for="task in tasks" :key="task.id">
              <button type="button" class="task" :aria-pressed="detail?.task.id === task.id"
                :disabled="busy || !!pending" @click="open(task)">
                <strong>{{ task.title }}</strong>
                <span v-if="task.lane === 'appeal'">{{ task.version ? '版本 V' + task.version : '整帖' }} · {{ new Date(task.submitted_at).toLocaleString('zh-CN') }}</span>
                <span v-else>{{ task.pre_review ? '待先审' : '待后审' }}{{ task.version ? ' · V' + task.version : '' }}</span>
              </button>
            </li>
          </ul>
          <button v-if="next" type="button" :disabled="busy || !!pending"
            @click="run((epoch) => readQueue(epoch, lane, next))">加载更多</button>
        </section>
        <section v-if="detail" class="snapshot" aria-label="提交内容">
          <h2>{{ detail.snapshot.title }}</h2>
          <p class="submitted">{{ new Date(detail.task.submitted_at).toLocaleString('zh-CN') }}</p>
          <div v-if="detail.appeal" class="appeal-info">
            <p>处置原因 · {{ detail.appeal.case_reason }}</p>
            <p>申请说明 · {{ detail.appeal.reason }}</p>
            <p class="submitted">{{ detail.appeal.version ? '处置所指版本 V' + detail.appeal.version :
              detail.evidenceVersion ? '整帖当前展示版 V' + detail.evidenceVersion : '整帖首发稿' }}</p>
          </div>
          <p class="post-body">{{ detail.snapshot.content }}</p>
          <ul v-if="detail.snapshot.images.length" class="images" aria-label="提交图片">
            <li v-for="(image, index) in detail.snapshot.images" :key="image.id">
              <a :href="imagePath(detail, image.id)" target="_blank" rel="noopener noreferrer">
                <img :src="imagePath(detail, image.id)" :alt="'提交图片 ' + (index + 1)" loading="lazy">
              </a>
            </li>
          </ul>
          <p v-if="!detail.actionable">这项任务的状态已变化，请刷新队列。</p>
          <form v-else class="decision" @submit.prevent="confirm">
            <label>处理方式
              <select v-model="decision" :disabled="busy || !!pending">
                <option v-for="choice in choices" :key="choice" :value="choice">{{ labels[choice] }}</option>
              </select>
            </label>
            <label>处理原因{{ decision === 'approve' ? '（可选）' : '' }}
              <textarea v-model="reason" rows="3" maxlength="1000" :disabled="busy || !!pending" />
            </label>
            <button v-if="pending" type="button" class="primary" :disabled="busy"
              @click="run((epoch) => apply(epoch, pending!))">重试原操作</button>
            <button v-else type="submit" class="primary" :disabled="busy || !hasReason">确认{{ labels[decision] }}</button>
          </form>
        </section>
        <p v-else-if="tasks.length">选择一项任务查看提交内容。</p>
      </div>
    </template>
  </main>
</template>

<style scoped>
.short-desk { max-width: 1184px; margin: 0 auto; padding: 24px; color: var(--color-ink, #202631); }
.desk-heading, .desk-tools { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; }
.desk-heading { justify-content: space-between; margin-bottom: 16px; }
h1, h2 { margin: 0; font-weight: 600; overflow-wrap: anywhere; }
h1 { font-size: 24px; }
h2 { font-size: 20px; }
.desk-grid { display: grid; grid-template-columns: minmax(0, 280px) minmax(0, 1fr); gap: 24px; margin-top: 16px; }
button, select, textarea { border: 1px solid #dce0e8; border-radius: 6px; background: #fff; color: inherit; font: inherit; padding: 8px 12px; }
button { cursor: pointer; min-height: 40px; }
button[aria-pressed='true'] { border-color: var(--color-brand, #315de8); color: var(--color-brand, #315de8); }
button:disabled { cursor: default; opacity: .6; }
.tasks, .images { list-style: none; margin: 0 0 12px; padding: 0; display: grid; gap: 8px; }
.task { width: 100%; text-align: left; display: grid; gap: 4px; overflow-wrap: anywhere; }
.task span, .submitted { font-size: 14px; color: #535d70; }
.snapshot { padding: 16px; border: 1px solid #e3e6ec; border-radius: 8px; }
.appeal-info { margin: 12px 0; overflow-wrap: anywhere; }
.post-body { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.65; }
.images { grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); }
.images img { display: block; width: 100%; aspect-ratio: 4/3; object-fit: contain; background: #f6f7f9; }
.decision, .decision label { display: grid; gap: 8px; }
.decision { margin-top: 16px; max-width: 32rem; }
.primary { justify-self: start; background: var(--color-brand, #315de8); color: #fff; }
.notice { padding: 8px 12px; background: #f6f7f9; }
@media (max-width: 640px) { .short-desk { padding: 16px; } .desk-grid { grid-template-columns: 1fr; gap: 16px; } }
</style>
