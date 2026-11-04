<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { request, APIError } from '../lib/api'
import {
  NovelOperationJournal,
  novelOperationPaths,
  confirmNovelOperation,
  checkedNovelOperation,
  type NovelOperation,
  type NovelSchema,
} from '../lib/novel-operations'
const props = defineProps<{ operator?: boolean }>(),
  route = useRoute()
const filter =
  typeof route.query.work === 'string' && /^[a-f0-9-]{36}$/i.test(route.query.work)
    ? route.query.work
    : ''
const requestedSubmission =
  typeof route.query.submission === 'string' && /^[a-f0-9-]{36}$/i.test(route.query.submission)
    ? route.query.submission
    : ''
type Submission = NovelSchema<'WorkSubmission'>
type Detail = NovelSchema<'WorkSubmissionDetail'>
const items = ref<Submission[]>([]),
  cursor = ref(''),
  detail = ref<Detail | null>(null),
  busy = ref(false),
  ready = ref(false),
  message = ref(''),
  reason = ref(''),
  policyReason = ref(''),
  policy = ref<NovelSchema<'AuthorPolicyPage'> | null>(null),
  pending = ref<NovelOperation | null>(null),
  proposed = ref<NovelOperation | null>(null),
  confirmed = ref(false),
  canRetry = ref(false)
let owner = '',
  generation = 0,
  journal: NovelOperationJournal | null = null,
  channel: BroadcastChannel | undefined
const context = computed(() => detail.value?.submission.work_id ?? filter),
  base = computed(() => (props.operator ? '/ops/work-submissions' : '/my/work-submissions'))
const label = (state: string) =>
  ({
    pending: '等待审核',
    published: '已发布',
    rejected: '已驳回',
    withdrawn: '已撤回',
    superseded: '已被新提交替换',
  })[state] ?? '状态待确认'
const actionLabel = (v: unknown) =>
  ({
    approve: '通过固定提交',
    reject: '驳回固定提交',
    start: '开始7天观察期',
    extend: '从原结束时间延长7天',
    revoke: '提前结束观察期',
  })[String(v)] ?? '撤回这次待审提交'
function invalidate() {
  generation++
  owner = ''
  ready.value = false
  items.value = []
  detail.value = null
  policy.value = null
  pending.value = null
  proposed.value = null
  reason.value = ''
  policyReason.value = ''
  message.value = '会话已变化，请重新验证登录。'
}
function describe(e: unknown) {
  if (e instanceof APIError)
    return (
      {
        review_conflict: '提交已变化，请重新读取；旧操作没有覆盖新内容。',
        novel_state_conflict: '观察期状态已变化，请重新读取。',
        operator_required: '当前账号没有运营权限。',
        authentication_required: '需要重新登录。',
        resource_not_found: '记录不存在或当前账号不可访问。',
      }[e.code] ?? '读取或结果尚未确认，请保留原记录重试。'
    )
  return '读取或结果尚未确认，请保留原记录重试。'
}
async function verify() {
  const me = await request<{ id: string }>('/me')
  if (owner && me.id !== owner) {
    invalidate()
    throw Error('session_changed')
  }
  if (props.operator && !(await request<{ operator: boolean }>('/me/access')).operator) {
    invalidate()
    throw new APIError(403, 'operator_required')
  }
  return me.id
}
async function load(more = false) {
  const q = new URLSearchParams()
  if (filter) q.set('work', filter)
  if (more && cursor.value) q.set('cursor', cursor.value)
  const gen = generation,
    p = await request<NovelSchema<'WorkSubmissionPage'>>(base.value + (q.size ? '?' + q : ''))
  if (gen !== generation) return
  items.value = more
    ? [...items.value, ...p.items.filter((s) => !items.value.some((x) => x.id === s.id))]
    : p.items
  cursor.value = p.next_cursor
}
async function run(f: () => Promise<unknown>) {
  if (busy.value) return
  busy.value = true
  const gen = generation
  message.value = ''
  try {
    await verify()
    if (gen !== generation) return
    await f()
  } catch (e) {
    if (gen === generation) {
      if (e instanceof APIError && [401, 403].includes(e.status)) invalidate()
      else message.value = describe(e)
    }
  } finally {
    busy.value = false
  }
}
async function initialize() {
  if (busy.value) return
  busy.value = true
  const gen = generation
  try {
    const id = await verify()
    if (gen !== generation) return
    owner = id
    journal = new NovelOperationJournal(sessionStorage, owner)
    pending.value = journal.load()
    ready.value = true
    if (pending.value) message.value = '存在原操作，请先查询结果。'
    else {
      await load()
      if (requestedSubmission) {
        const d = await request<Detail>(base.value + '/' + requestedSubmission)
        if (filter && d.submission.work_id !== filter) throw Error('wrong_target')
        if (gen === generation) detail.value = d
      }
    }
    if (!props.operator) {
      const p = await request<NovelSchema<'AuthorPolicyPage'>>('/my/author-policy')
      if (gen === generation) policy.value = p
    }
  } catch (e) {
    if (gen === generation) message.value = describe(e)
  } finally {
    busy.value = false
  }
}
async function choose(item: Submission) {
  const gen = generation
  await run(async () => {
    const d = await request<Detail>(base.value + '/' + item.id)
    if (gen !== generation) return
    if (d.submission.id !== item.id || d.submission.work_id !== item.work_id)
      throw Error('wrong_target')
    detail.value = d
    reason.value = ''
    policy.value = null
    policyReason.value = ''
  })
}
function propose(decision: 'approve' | 'reject' | 'withdraw') {
  if (!detail.value || pending.value || proposed.value || busy.value) return
  if (decision === 'reject' && !reason.value.trim()) {
    message.value = '请填写驳回原因。'
    return
  }
  if (Array.from(reason.value).length > 2000) {
    message.value = '原因最多2000字。'
    return
  }
  const s = detail.value.submission,
    p: NovelOperation = {
      owner,
      book: s.work_id,
      target: s.id,
      kind: props.operator ? 'work-pre' : 'work-withdraw',
      version: props.operator ? s.candidate_version : 0,
      body: props.operator
        ? { mutation_id: crypto.randomUUID(), decision, reason: reason.value }
        : { mutation_id: crypto.randomUUID() },
    }
  checkedNovelOperation(p, owner)
  proposed.value = p
}
async function finish() {
  if (!pending.value || !journal) return
  if (pending.value.owner !== owner) throw Error('session_changed')
  journal.clear(pending.value.body.mutation_id)
  pending.value = null
  proposed.value = null
  confirmed.value = false
  canRetry.value = false
  reason.value = ''
  policyReason.value = ''
  detail.value = null
  policy.value = null
  message.value = '原操作已确认。'
  try {
    await load()
  } catch {
    message.value = '原操作已确认，列表刷新未完成，可重试读取。'
  }
}
async function perform(retry = false) {
  const gen = generation
  if ((!retry && !proposed.value) || (retry && !pending.value)) return
  await run(async () => {
    let fresh = false
    if (!pending.value) {
      try {
        journal!.save(proposed.value!)
      } catch {
        message.value = '无法保存原操作记录，请求未发出。'
        return
      }
      pending.value = proposed.value
      proposed.value = null
      fresh = true
    }
    const p = pending.value!
    try {
      const result = await request(novelOperationPaths(p).write, 'POST', p.body)
      await verify()
      if (gen !== generation || p.owner !== owner) throw Error('session_changed')
      confirmNovelOperation(p, result)
      confirmed.value = true
      await finish()
    } catch (e) {
      if (
        e instanceof APIError &&
        ((fresh && [400, 404, 409].includes(e.status)) ||
          (e.status === 409 && ['review_conflict', 'novel_state_conflict'].includes(e.code)))
      ) {
        journal!.clear(p.body.mutation_id)
        pending.value = null
        proposed.value = null
      }
      throw e
    }
  })
}
async function recover() {
  const gen = generation
  await run(async () => {
    if (!pending.value) return
    const p = pending.value
    if (!confirmed.value) {
      try {
        const r = await request(novelOperationPaths(p).receipt)
        await verify()
        if (gen !== generation || p.owner !== owner) throw Error('session_changed')
        confirmNovelOperation(p, r)
        confirmed.value = true
      } catch (e) {
        if (e instanceof APIError && e.status === 404) canRetry.value = true
        throw e
      }
    }
    await finish()
  })
}
async function readPolicy(more = false) {
  const gen = generation
  if (!props.operator || !context.value) return
  await run(async () => {
    const value = await request<NovelSchema<'AuthorPolicyPage'>>(
      `/ops/works/${context.value}/author-policy${more && policy.value?.next ? `?before=${policy.value.next}` : ''}`,
    )
    if (gen === generation)
      policy.value =
        more && policy.value
          ? {
              ...value,
              items: [
                ...policy.value.items,
                ...value.items.filter(
                  (e) => !policy.value!.items.some((x) => x.revision === e.revision),
                ),
              ],
            }
          : value
  })
}
function proposePolicy(action: 'start' | 'extend' | 'revoke') {
  if (
    !policy.value ||
    !context.value ||
    !policyReason.value.trim() ||
    Array.from(policyReason.value).length > 2000 ||
    busy.value ||
    pending.value ||
    proposed.value
  )
    return
  const p: NovelOperation = {
    owner,
    book: context.value,
    target: context.value,
    kind: 'policy',
    policy_kind: 'work',
    version: 0,
    body: {
      mutation_id: crypto.randomUUID(),
      expected_revision: policy.value.policy.revision,
      action,
      reason: policyReason.value.trim(),
    },
  }
  checkedNovelOperation(p, owner)
  proposed.value = p
}
const changed = () => {
  if (owner) void verify().catch(() => invalidate())
}
onMounted(() => {
  void initialize()
  window.addEventListener('focus', changed)
  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel('tako-session')
    channel.onmessage = changed
  }
})
onUnmounted(() => {
  generation++
  window.removeEventListener('focus', changed)
  channel?.close()
})
onBeforeRouteLeave(
  () =>
    !(reason.value.trim() || policyReason.value.trim()) ||
    !!pending.value ||
    window.confirm('离开将丢弃未提交的处理原因，已受理操作不受影响。'),
)
</script>
<template>
  <div>
    <AppHeader />
    <main class="submission-desk">
      <header>
        <h1>{{ operator ? '中篇先审' : '中篇先审记录' }}</h1>
        <NuxtLink :to="operator ? '/ops/reviews' : '/my-works'">{{
          operator ? '返回正式内容治理' : '返回作品管理'
        }}</NuxtLink
        ><NuxtLink v-if="operator" to="/ops/novels">小说治理</NuxtLink>
      </header>
      <p class="muted">
        待审不产生正式版。替换、驳回与撤回不覆盖工作稿；到期或结束观察期不自动放行。
      </p>
      <p v-if="message" role="status">{{ message }}</p>
      <button v-if="!ready" :disabled="busy" @click="initialize">重新验证登录</button>
      <section v-if="pending">
        <h2>{{ confirmed ? '原操作已确认' : '原操作待确认' }}</h2>
        <button :disabled="busy" @click="recover">
          {{ confirmed ? '清理已确认记录' : '查询原结果' }}</button
        ><button v-if="canRetry && !confirmed" :disabled="busy" @click="perform(true)">
          重试同一操作
        </button>
      </section>
      <section v-if="proposed">
        <h2>核对本次决定</h2>
        <p>
          {{
            proposed.kind === 'policy'
              ? '账号级观察期影响之后的中篇与长文；已待审继续人工审核，已有公开内容不自动隐藏。'
              : '只处理这份已提交的固定内容，不能覆盖后来的替换稿。'
          }}
        </p>
        <p>
          {{ actionLabel(proposed.body.action || proposed.body.decision) }} ·
          {{ proposed.body.reason }}
        </p>
        <button :disabled="busy" @click="perform()">确认执行</button
        ><button :disabled="busy" @click="proposed = null">返回修改</button>
      </section>
      <template v-if="ready"
        ><section v-if="!operator && policy?.policy.active">
          <h2>账号观察中</h2>
          <p>
            新提交先审后发；结束时间
            {{ new Date(policy.policy.observation_until!).toLocaleString('zh-CN') }}。
          </p>
          <p>{{ policy.policy.reason }}</p>
        </section>
        <button :disabled="busy || !!pending || !!proposed" @click="run(() => load())">
          刷新列表
        </button>
        <div class="submission-grid">
          <aside>
            <button
              v-for="item in items"
              :class="{ selected: detail?.submission.id === item.id }"
              :key="item.id"
              :disabled="busy || !!pending || !!proposed"
              @click="choose(item)"
            >
              <strong>{{ item.title }}</strong
              ><small>{{ label(item.state) }}</small>
            </button>
            <p v-if="!items.length">{{ busy ? '正在读取…' : '暂无提交记录。' }}</p>
            <button v-if="cursor" :disabled="busy" @click="run(() => load(true))">更多提交</button>
          </aside>
          <article>
            <template v-if="detail"
              ><h2>{{ detail.submission.title }}</h2>
              <p>{{ label(detail.submission.state) }} · {{ detail.submission.reason }}</p>
              <p class="muted">
                首次等待 {{ new Date(detail.submission.first_waiting_at).toLocaleString('zh-CN') }}
              </p>
              <p>{{ detail.preview.introduction }}</p>
              <div class="fixed-text">{{ detail.preview.content }}</div>
              <template v-if="detail.submission.state === 'pending' && !pending && !proposed"
                ><label v-if="operator"
                  >处理原因<textarea v-model="reason" rows="3" :disabled="busy" /></label
                ><button v-if="operator" :disabled="busy" @click="propose('approve')">
                  核对通过</button
                ><button v-if="operator" :disabled="busy" @click="propose('reject')">
                  核对驳回</button
                ><button v-else :disabled="busy" @click="propose('withdraw')">
                  核对撤回
                </button></template
              ></template
            >
            <p v-else>选择一条提交，查看固定内容和处理结果。</p>
          </article>
        </div>
        <details v-if="operator && context" :open="!!filter">
          <summary>作者账号观察期</summary>
          <p class="muted">作用于账号，不只影响这篇作品。仅可从正式作品定位作者。</p>
          <button :disabled="busy || !!pending || !!proposed" @click="readPolicy()">
            读取账号观察期</button
          ><template v-if="policy"
            ><p>
              {{ policy.policy.active ? '观察中' : '当前不在观察期'
              }}<span v-if="policy.policy.observation_until">
                · 结束时间
                {{ new Date(policy.policy.observation_until).toLocaleString('zh-CN') }}</span
              >
            </p>
            <p>{{ policy.policy.reason }}</p>
            <label
              >观察期决定原因<textarea v-model="policyReason" rows="3" :disabled="busy" /></label
            ><button
              v-if="!policy.policy.active"
              :disabled="busy || !!pending || !!proposed"
              @click="proposePolicy('start')"
            >
              开始7天观察期</button
            ><template v-else
              ><button :disabled="busy || !!pending || !!proposed" @click="proposePolicy('extend')">
                延长原结束时间7天</button
              ><button :disabled="busy || !!pending || !!proposed" @click="proposePolicy('revoke')">
                提前结束观察期
              </button></template
            >
            <button
              v-if="policy.next"
              :disabled="busy || !!pending || !!proposed"
              @click="readPolicy(true)"
            >
              更早的观察期决定
            </button>
            <p v-for="event in policy.items" :key="event.revision">
              {{ actionLabel(event.action) }} · {{ event.reason }}
            </p></template
          >
        </details></template
      >
    </main>
  </div>
</template>
<style scoped>
.submission-desk {
  max-width: 1280px;
  margin: auto;
  padding: 32px 24px 48px;
  color: var(--color-ink);
}
header {
  display: flex;
  gap: 24px;
  align-items: center;
  margin-bottom: 24px;
}
h1 {
  font-size: 24px;
  line-height: 32px;
  font-weight: 600;
  margin: 0;
}
h2 {
  font-size: 20px;
  line-height: 28px;
  font-weight: 600;
}
p {
  line-height: 24px;
}
.muted,
small {
  color: var(--color-muted);
  font-size: 14px;
}
button {
  appearance: none;
  background: var(--color-surface, #fff);
  color: var(--color-ink);
  border: 1px solid var(--color-line);
  border-radius: 6px;
  font: inherit;
  font-size: 14px;
  cursor: pointer;
  min-height: 44px;
  padding: 8px 16px;
  margin: 8px 8px 8px 0;
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
button:hover:enabled {
  border-color: var(--color-brand);
}
button:focus-visible,
textarea:focus-visible,
summary:focus-visible {
  outline: 2px solid var(--color-brand);
  outline-offset: 3px;
}
button.primary {
  background: var(--color-brand);
  border-color: var(--color-brand);
  color: white;
}
aside button.selected {
  box-shadow: inset 3px 0 var(--color-brand);
}
.submission-grid {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 32px;
  margin: 24px 0;
}
aside button {
  display: flex;
  flex-direction: column;
  gap: 8px;
  text-align: left;
  width: 100%;
}
article {
  min-width: 0;
  background: var(--color-surface, #fff);
  border: 1px solid var(--color-line);
  border-radius: 8px;
  padding: 24px;
  overflow-wrap: anywhere;
}
.fixed-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.9;
  margin: 24px 0;
}
label {
  display: block;
}
textarea {
  display: block;
  width: 100%;
  max-width: 640px;
  margin: 8px 0 16px;
}
details,
section {
  margin: 24px 0;
}
@media (max-width: 700px) {
  .submission-desk {
    padding: 16px;
  }
  header {
    flex-wrap: wrap;
    gap: 16px;
  }
  .submission-grid {
    grid-template-columns: minmax(0, 1fr);
    gap: 24px;
  }
}
</style>
