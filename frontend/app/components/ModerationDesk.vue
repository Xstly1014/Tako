<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { request, APIError } from '../lib/api'
import type { Account } from '../lib/types'
import type {
  ModerationTask,
  ModerationCase,
  Appeal,
  ModPage,
  ModDetail,
  ModAction,
} from '../lib/moderation'
const props = defineProps<{ operator?: boolean }>()
const tasks = ref<ModerationTask[]>([]),
  cases = ref<ModerationCase[]>([]),
  appeals = ref<Appeal[]>([]),
  detail = ref<ModDetail | null>(null)
const queue = ref<'reviews' | 'appeals' | 'cases'>('reviews'),
  next = ref(0),
  busy = ref(false),
  message = ref(''),
  reason = ref(''),
  decision = ref('approve'),
  appealChoice = ref(0),
  now = ref(Date.now()),
  proposed = ref(false)
const pending = ref<{ path: string; body: ModAction } | null>(null)
let owner = '',
  generation = 0,
  clock: ReturnType<typeof setInterval> | undefined,
  channel: BroadcastChannel | undefined
const key = () => `tako-moderation:${owner}`
const currentCase = computed(() => detail.value?.case)
const inFlight = computed(() => detail.value?.appeals?.items.find((a) => a.state === 'pending'))
const cooldown = computed(
  () =>
    !!currentCase.value?.next_appeal_at && Date.parse(currentCase.value.next_appeal_at) > now.value,
)
const decisionLabels: Record<string, string> = {
  approve: '完成后审',
  restrict_version: '限制此版本',
  restrict_work: '限制整部作品',
  uphold: '维持处置并开始 24 小时冷静期',
  revoke: '撤销此处置',
}
const decisionLabel = computed(() =>
  props.operator ? (decisionLabels[decision.value] ?? decision.value) : '申请复核',
)
const title = computed(() => (props.operator ? '内容治理' : '处置与复核'))
function describe(e: unknown) {
  if (!(e instanceof APIError)) return '暂时无法完成，请保持页面并稍后重试。'
  const messages: Record<string, string> = {
    operator_required: '当前账号没有运营权限。',
    authentication_required: '请先回写作空间登录。',
    review_conflict: '处理状态已变化，请刷新后重新确认。',
    appeal_pending: '已有一条处理中申请，请等待结果。',
    appeal_cooldown: '仍在冷静期，请查看可再次申请时间。',
    mutation_id_reused: '重试标识与内容不匹配，请保留页面并检查原操作。',
    resource_not_found: '记录不存在或当前账号无权访问。',
    network_unconfirmed: '网络未确认结果，请检查原操作，不要重复新建。',
    publication_disabled: '治理入口尚未启用。',
    invalid_input: '请填写完整说明，并检查所选操作。',
  }
  return messages[e.code] ?? '服务暂不可用，请稍后检查。'
}
function invalidate() {
  generation++
  detail.value = null
  tasks.value = []
  cases.value = []
  appeals.value = []
  reason.value = ''
  pending.value = null
  proposed.value = false
  message.value = '会话已变化，已隐藏原账号数据。请重新进入。'
}
async function verify() {
  const me = await request<Account>('/me')
  if (me.id !== owner) {
    invalidate()
    throw new Error('account_changed')
  }
}
function savePending() {
  try {
    if (pending.value) sessionStorage.setItem(key(), JSON.stringify(pending.value))
    else sessionStorage.removeItem(key())
  } catch {
    message.value = '无法保存重试标识，请保持页面打开，确认结果前不要刷新。'
  }
}
async function load(more = false) {
  const gen = generation
  let data: ModPage<ModerationTask | ModerationCase | Appeal>
  if (props.operator && queue.value === 'reviews') {
    data = await request(`/ops/reviews${more ? `?after=${next.value}` : ''}`)
    if (gen !== generation) return
    tasks.value = more
      ? [...tasks.value, ...(data.items as ModerationTask[])]
      : (data.items as ModerationTask[])
  } else if (props.operator && queue.value === 'appeals') {
    data = await request(`/ops/appeals${more ? `?after=${next.value}` : ''}`)
    if (gen !== generation) return
    appeals.value = more
      ? [...appeals.value, ...(data.items as Appeal[])]
      : (data.items as Appeal[])
  } else {
    data = await request(
      `/${props.operator ? 'ops' : 'my'}/moderation${more ? `?before=${next.value}` : ''}`,
    )
    if (gen !== generation) return
    cases.value = more
      ? [...cases.value, ...(data.items as ModerationCase[])]
      : (data.items as ModerationCase[])
  }
  next.value = data.next
}
async function choose(path: string) {
  if (busy.value || pending.value) return
  busy.value = true
  message.value = ''
  const gen = generation
  detail.value = null
  reason.value = ''
  proposed.value = false
  appealChoice.value = 0
  try {
    await verify()
    const data = await request<ModDetail>(path)
    if (gen !== generation) return
    detail.value = data
    decision.value = data.case ? 'revoke' : 'approve'
    appealChoice.value = data.appeals?.items.find((a) => a.state === 'pending')?.id ?? 0
  } catch (e) {
    message.value = describe(e)
  } finally {
    busy.value = false
  }
}
async function refresh(more = false) {
  if (busy.value) return
  busy.value = true
  try {
    await verify()
    await load(more)
  } catch (e) {
    if (e instanceof APIError && e.status === 401) invalidate()
    message.value = describe(e)
  } finally {
    busy.value = false
  }
}
async function changeQueue(value: 'reviews' | 'appeals' | 'cases') {
  if (busy.value || pending.value) return
  queue.value = value
  detail.value = null
  next.value = 0
  await refresh()
}
function prepare() {
  if (!detail.value || !reason.value.trim()) return
  proposed.value = true
}
async function execute() {
  if (busy.value || (!pending.value && !proposed.value) || (!detail.value && !pending.value)) return
  busy.value = true
  message.value = ''
  const gen = generation
  try {
    await verify()
    if (!pending.value) {
      const d = detail.value!
      const c = d.case
      const body: ModAction = {
        mutation_id: crypto.randomUUID(),
        expected_revision: c?.revision ?? d.task!.revision,
        decision: props.operator ? decision.value : 'appeal',
        reason: reason.value,
      }
      if (props.operator && c && appealChoice.value) body.appeal_id = appealChoice.value
      pending.value = {
        path: c
          ? `/${props.operator ? 'ops' : 'my'}/moderation/${c.id}`
          : `/ops/reviews/${d.task!.work_id}/versions/${d.task!.version}`,
        body,
      }
      savePending()
      proposed.value = false
    }
    const operation = pending.value
    await request(operation.path, 'POST', operation.body)
    if (gen !== generation) return
    pending.value = null
    savePending()
    detail.value = null
    reason.value = ''
    message.value = '处理已确认，请重新选择记录查看当前状态。'
    await load()
  } catch (e) {
    if (gen !== generation) return
    if (e instanceof APIError && [400, 403, 404, 409].includes(e.status)) {
      pending.value = null
      savePending()
      detail.value = null
    }
    if (e instanceof APIError && e.status === 401) invalidate()
    message.value = describe(e)
  } finally {
    busy.value = false
  }
}
async function moreAppeals() {
  if (!detail.value?.case || !detail.value.appeals?.next || busy.value) return
  const c = detail.value.case,
    old = detail.value
  busy.value = true
  const gen = generation
  try {
    await verify()
    const data = await request<ModDetail>(
      `/${props.operator ? 'ops' : 'my'}/moderation/${c.id}?before=${old.appeals!.next}`,
    )
    if (gen !== generation) return
    if (data.case?.revision !== c.revision) {
      detail.value = data
      message.value = '处置已变化，已刷新。'
      return
    }
    old.appeals!.items.push(...data.appeals!.items)
    old.appeals!.next = data.appeals!.next
  } catch (e) {
    message.value = describe(e)
  } finally {
    busy.value = false
  }
}
function label(state: string) {
  return (
    (
      {
        pending: '处理中',
        upheld: '维持处置',
        revoked: '已撤销',
        active: '限制生效',
        approved: '审核完成',
        restricted: '已处置',
      } as Record<string, string>
    )[state] ?? state
  )
}
async function sessionChanged() {
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
onMounted(async () => {
  const gen = generation
  try {
    const me = await request<Account>('/me')
    if (gen !== generation) return
    owner = me.id
    try {
      const saved = JSON.parse(sessionStorage.getItem(key()) ?? 'null')
      if (
        saved &&
        typeof saved.path === 'string' &&
        /^\/(ops|my)\//.test(saved.path) &&
        typeof saved.body?.mutation_id === 'string'
      )
        pending.value = saved
    } catch {
      /* Server validates replay. */
    }
    await load()
    clock = setInterval(() => (now.value = Date.now()), 1000)
    channel =
      typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('tako-session') : undefined
    if (channel)
      channel.onmessage = (e) => {
        if (e.data === 'logout') invalidate()
        else if (e.data === 'session-changed') void sessionChanged()
      }
    window.addEventListener('focus', sessionChanged)
    window.addEventListener('storage', storageChanged)
  } catch (e) {
    message.value = describe(e)
  }
})
onUnmounted(() => {
  generation++
  clearInterval(clock)
  channel?.close()
  window.removeEventListener('focus', sessionChanged)
  window.removeEventListener('storage', storageChanged)
})
</script>
<template>
  <main class="mod-page">
    <header class="mod-nav">
      <NuxtLink to="/" aria-label="Tako 首页"><TakoLogo /></NuxtLink>
      <nav>
        <NuxtLink to="/workspace">写作空间</NuxtLink><NuxtLink to="/my-works">作品管理</NuxtLink
        ><span>{{ title }}</span>
      </nav>
      <button class="secondary" :disabled="busy" @click="refresh()">刷新</button>
    </header>
    <h1>{{ title }}</h1>
    <p class="mod-description">
      {{
        operator
          ? '处理正式版本的后审与作者复核。不会读取私人工作稿。'
          : '查看自己作品的处置原因，提交文字复核并跟进结果。'
      }}
    </p>
    <p v-if="message" class="notice" role="status">{{ message }}</p>
    <section v-if="pending" class="notice">
      <p>有一次结果尚未确认的操作。检查会沿用原请求，不重复提交。</p>
      <button class="primary" :disabled="busy" @click="execute">检查原操作结果</button>
    </section>
    <nav v-if="operator" class="mod-tabs">
      <button
        :aria-pressed="queue === 'reviews'"
        :disabled="busy || !!pending"
        @click="changeQueue('reviews')"
      >
        正式版本后审</button
      ><button
        :aria-pressed="queue === 'appeals'"
        :disabled="busy || !!pending"
        @click="changeQueue('appeals')"
      >
        待复核</button
      ><button
        :aria-pressed="queue === 'cases'"
        :disabled="busy || !!pending"
        @click="changeQueue('cases')"
      >
        处置记录
      </button>
    </nav>
    <div class="mod-grid">
      <aside class="mod-list">
        <template v-if="operator && queue === 'reviews'"
          ><button
            v-for="t in tasks"
            :key="t.id"
            :disabled="busy || !!pending"
            @click="choose(`/ops/reviews/${t.work_id}/versions/${t.version}`)"
          >
            <strong>{{ t.title }}</strong
            ><span>V{{ t.version }} · {{ t.is_current ? '当前展示' : '历史版本' }}</span
            ><span
              >{{ now - Date.parse(t.first_waiting_at) > 48 * 3600000 ? '已超过 48 小时 · ' : ''
              }}{{
                new Date(t.first_waiting_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
              }}</span
            >
          </button>
          <p v-if="!tasks.length">没有待处理的后审任务。</p></template
        ><template v-else-if="operator && queue === 'appeals'"
          ><button
            v-for="a in appeals"
            :key="a.id"
            :disabled="busy || !!pending"
            @click="choose(`/ops/moderation/${a.case_id}`)"
          >
            <strong>复核 #{{ a.id }}</strong
            ><span>{{ a.reason }}</span
            ><span>{{
              new Date(a.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
            }}</span>
          </button>
          <p v-if="!appeals.length">没有待处理的复核申请。</p></template
        ><template v-else
          ><button
            v-for="c in cases"
            :key="c.id"
            :disabled="busy || !!pending"
            @click="choose(`/${operator ? 'ops' : 'my'}/moderation/${c.id}`)"
          >
            <strong>{{ c.scope === 'work' ? '作品限制' : '版本限制' }} · V{{ c.version }}</strong
            ><span>{{ c.reason }}</span
            ><span>{{ label(c.state) }}</span>
          </button>
          <p v-if="!cases.length">没有作品处置记录。</p></template
        ><button v-if="next" class="text-button" :disabled="busy" @click="refresh(true)">
          加载更多
        </button>
      </aside>
      <section class="mod-detail">
        <p v-if="!detail">{{ busy ? '正在读取…' : '选择左侧记录查看内容与处理结果。' }}</p>
        <template v-else
          ><header>
            <h2>{{ detail.work.title }}</h2>
            <p>
              正式版本 V{{ detail.work.version
              }}<span v-if="detail.case"> · {{ label(detail.case.state) }}</span>
            </p>
          </header>
          <section v-if="detail.case" class="mod-case">
            <section v-if="detail.revocation" class="notice"><h3>此处置已撤销</h3><p>{{detail.revocation.reason}}</p><p>{{new Date(detail.revocation.created_at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}}</p></section><h3>处置原因</h3>
            <p>{{ detail.case.reason }}</p>
            <p>
              范围：{{ detail.case.scope === 'work' ? '整部作品' : '此正式版本' }} ·
              {{
                new Date(detail.case.created_at).toLocaleString('zh-CN', {
                  timeZone: 'Asia/Shanghai',
                })
              }}
            </p>
            <p v-if="detail.case.state==='active' && detail.case.next_appeal_at">
              可再次申请：{{
                new Date(detail.case.next_appeal_at).toLocaleString('zh-CN', {
                  timeZone: 'Asia/Shanghai',
                })
              }}
            </p>
          </section>
          <article class="mod-body">{{ detail.work.content }}</article>
          <section v-if="detail.appeals" class="mod-history">
            <h3>复核记录</h3>
            <p v-if="!detail.appeals.items.length">暂无复核申请。</p>
            <article v-for="a in detail.appeals.items" :key="a.id">
              <p>
                {{ label(a.state) }} ·
                {{ new Date(a.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) }}
              </p>
              <p>{{ a.reason }}</p>
              <p v-if="a.decision_reason">运营说明：{{ a.decision_reason }}</p>
            </article>
            <button
              v-if="detail.appeals.next"
              class="text-button"
              :disabled="busy"
              @click="moreAppeals"
            >
              更早复核记录
            </button>
          </section>
          <form
            v-if="(operator && detail.task?.state === 'pending') || currentCase?.state === 'active'"
            class="mod-form"
            @submit.prevent="prepare"
          >
            <template v-if="operator"
              ><label for="mod-decision">处理方式</label
              ><select id="mod-decision" v-model="decision" :disabled="busy || !!pending">
                <template v-if="detail.task"
                  ><option value="approve">完成后审，不限制内容</option>
                  <option value="restrict_version">限制此版本</option>
                  <option value="restrict_work">限制整部作品</option></template
                ><template v-else
                  ><option value="revoke">撤销此处置</option>
                  <option v-if="inFlight" value="uphold">维持此处置</option></template
                >
              </select></template
            >
            <p v-else-if="inFlight">已有复核正在处理，请等待结果。</p>
            <p v-else-if="cooldown">
              仍在 24 小时冷静期。如需人工帮助，可<a href="mailto:1125448766@qq.com">联系运营</a>。
            </p>
            <label for="mod-reason">{{ operator ? '处理原因' : '补充复核理由' }}</label
            ><textarea
              id="mod-reason"
              v-model="reason"
              maxlength="2000"
              required
              :disabled="busy || !!pending || (!operator && (!!inFlight || cooldown))"
            /><button
              class="primary"
              type="submit"
              :disabled="
                busy || !!pending || !reason.trim() || (!operator && (!!inFlight || cooldown))
              "
            >
              {{ operator ? '检查处理内容' : '准备申请复核' }}
            </button>
          </form>
          <section v-if="proposed" class="mod-confirm" role="dialog" aria-label="确认治理操作">
            <h3>确认{{ operator ? '处理' : '复核申请' }}</h3>
            <p>目标：{{ detail.work.title }} · V{{ detail.work.version }}</p>
            <p>操作：{{ decisionLabel }}</p>
            <p>{{ reason }}</p>
            <p>不修改工作稿、作者隐藏或展示指针。复核申请不会自动解除限制。</p>
            <div>
              <button class="primary" :disabled="busy" @click="execute">确认提交</button
              ><button class="secondary" :disabled="busy" @click="proposed = false">取消</button>
            </div>
          </section>
        </template>
      </section>
    </div>
  </main>
</template>
<style scoped>
.mod-page {
  max-width: 1280px;
  margin: auto;
  padding: 0 32px 48px;
}
.mod-nav {
  height: 80px;
  display: flex;
  align-items: center;
  gap: 32px;
  border-bottom: 1px solid var(--color-line);
}
.mod-nav nav {
  display: flex;
  gap: 24px;
  font-size: 14px;
}
.mod-nav > button {
  margin-left: auto;
  font-size: 12px;
}
.mod-page h1 {
  font-size: 24px;
  line-height: 32px;
  font-weight: 600;
  margin: 32px 0 8px;
}
.mod-description {
  font-size: 14px;
  color: var(--color-muted);
  margin: 0 0 24px;
}
.mod-tabs {
  display: flex;
  gap: 24px;
  margin-bottom: 24px;
}
.mod-tabs button {
  padding: 12px;
  border: 0;
  background: transparent;
  font-size: 14px;
  color: var(--color-muted);
}
.mod-tabs button[aria-pressed='true'] {
  color: var(--color-brand);
  border-bottom: 2px solid var(--color-brand);
}
.mod-grid {
  display: grid;
  grid-template-columns: 272px minmax(0, 1fr);
  gap: 24px;
}
.mod-list {
  min-width: 0;
}
.mod-list > button {
  display: block;
  width: 100%;
  text-align: left;
  padding: 16px;
  margin-bottom: 12px;
  background: #fff;
  border: 1px solid var(--color-line);
  border-radius: 6px;
}
.mod-list strong {
  font-size: 14px;
  font-weight: 600;
  display: block;
  overflow-wrap: anywhere;
}
.mod-list span {
  font-size: 12px;
  color: var(--color-muted);
  margin-top: 8px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
}
.mod-list > p {
  font-size: 14px;
  color: var(--color-muted);
}
.mod-detail {
  background: #fff;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  padding: 24px;
  min-width: 0;
}
.mod-detail h2 {
  font-size: 24px;
  line-height: 32px;
  font-weight: 600;
  margin: 0 0 8px;
  overflow-wrap: anywhere;
}
.mod-detail h3 {
  font-size: 16px;
  font-weight: 600;
  margin: 0 0 12px;
}
.mod-detail p {
  font-size: 14px;
  line-height: 1.8;
  overflow-wrap: anywhere;
  margin: 8px 0;
}
.mod-detail header > p,
.mod-case > p:last-child {
  font-size: 12px;
  color: var(--color-muted);
}
.mod-body {
  padding: 24px 0;
  font-size: 16px;
  line-height: 1.9;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.mod-case,
.mod-history,
.mod-form,
.mod-confirm {
  margin-top: 24px;
  padding-top: 24px;
  border-top: 1px solid var(--color-line);
}
.mod-history article {
  padding: 12px 0;
  border-bottom: 1px solid var(--color-line);
}
.mod-form label {
  font-size: 14px;
  margin: 0 0 8px;
}
.mod-form textarea {
  display: block;
  width: 100%;
  min-height: 120px;
  margin-bottom: 16px;
}
.mod-form select {
  display: block;
  width: 100%;
  max-width: 400px;
  padding: 12px;
  margin-bottom: 24px;
  background: #fff;
  border: 1px solid var(--color-line);
  border-radius: 6px;
  color: var(--color-ink);
}
.mod-confirm {
  padding: 24px;
  background: #f7f8fa;
}
.mod-confirm > div {
  display: flex;
  gap: 12px;
  margin-top: 24px;
}
.mod-page :focus-visible {
  outline: 2px solid var(--color-brand);
  outline-offset: 3px;
}
@media (max-width: 767px) {
  .mod-page {
    padding: 0 16px 32px;
  }
  .mod-nav {
    gap: 16px;
  }
  .mod-nav nav {
    gap: 12px;
    font-size: 12px;
  }
  .mod-nav nav > a:first-child {
    display: none;
  }
  .mod-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .mod-list {
    max-height: 264px;
    overflow: auto;
  }
  .mod-detail {
    padding: 24px 16px;
  }
  .mod-detail h2 {
    font-size: 20px;
  }
}
</style>

<style scoped>
.mod-form a {
  color: var(--color-brand);
  text-decoration: underline;
}
</style>
