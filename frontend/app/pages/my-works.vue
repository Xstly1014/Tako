<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { request, APIError } from '../lib/api'
import type { Account } from '../lib/types'
import type {
  AuthorWorkPage,
  AuthorWorkSummary,
  AuthorTimeline,
  PublicWork,
  WorkChange,
} from '../lib/publication'
useHead({
  title: '作品管理 · Tako',
  meta: [{ name: 'robots', content: 'noindex,nofollow,noarchive' }],
})
const route = useRoute(),
  config = useRuntimeConfig()
const enabled = String(config.public.publicationEnabled) === 'true'
const works = ref<AuthorWorkSummary[]>([]),
  cursor = ref(''),
  selected = ref(''),
  timeline = ref<AuthorTimeline | null>(null),
  body = ref<PublicWork | null>(null)
const message = ref(''),
  busy = ref(false),
  ready = ref(false),
  confirmation = ref<WorkChange | null>(null),
  pending = ref<WorkChange | null>(null),
  fallback = ref('')
let owner = '',
  epoch = 0,
  viewEpoch = 0,
  channel: BroadcastChannel | undefined
const key = () => `tako-work-action:${owner}:${selected.value}`
function describe(e: unknown) {
  if (!(e instanceof APIError)) return '暂时无法完成，请保留页面稍后检查。'
  const text: Record<string, string> = {
    work_state_conflict: '作品状态已变化，本次操作未执行。已重新读取，请确认后再操作。',
    version_unavailable: '目标版本不可展示；若最新版本受限，请明确选择正常旧版恢复。',
    work_restricted: '作品整体受限，作者恢复不能解除平台限制。',
    resource_not_found: '作品不存在或当前账号无权访问。',
    authentication_required: '会话已过期，请回写作空间登录。',
    mutation_id_reused: '操作标识与内容不匹配，请重新确认操作。',
    publication_disabled: '作品管理尚未启用。',
    invalid_input: '请检查操作及所选版本。',
    network_unconfirmed: '网络未确认结果，请检查原操作，不要反复创建新操作。',
  }
  return (
    (text[e.code] ?? '服务暂时不可用，请稍后检查原操作。') +
    (e.requestId ? ` 参考编号：${e.requestId}` : '')
  )
}
function persist() {
  try {
    if (pending.value) sessionStorage.setItem(key(), JSON.stringify(pending.value))
    else sessionStorage.removeItem(key())
  } catch {
    message.value = '无法保存重试标识，请保持页面打开，确认结果前不要刷新。'
  }
}
function invalidate() {
  epoch++
  viewEpoch++
  works.value = []
  timeline.value = null
  body.value = null
  selected.value = ''
  confirmation.value = null
  pending.value = null
  ready.value = false
  message.value = '会话已变化，已隐藏原账号作品。请回写作空间重新进入。'
}
async function verifyOwner() {
  if (!owner) return
  const me = await request<Account>('/me')
  if (me.id !== owner) {
    invalidate()
    throw new Error('account_changed')
  }
}
async function reload() {
  if (!selected.value) return
  const run = ++viewEpoch,
    generation = epoch,
    id = selected.value
  const data = await request<AuthorTimeline>(`/my/works/${id}/versions`)
  if (run !== viewEpoch || generation !== epoch) return
  timeline.value = data
  const content = await request<PublicWork>(
    `/my/works/${id}/versions/${data.state.display_version}`,
  )
  if (run !== viewEpoch || generation !== epoch) return
  body.value = content
  fallback.value = ''
}
async function choose(id: string) {
  if (busy.value) return
  busy.value = true
  message.value = ''
  selected.value = id
  timeline.value = null
  body.value = null
  pending.value = null
  confirmation.value = null
  try {
    const saved = sessionStorage.getItem(key())
    if (saved) {
      const parsed = JSON.parse(saved)
      if (
        typeof parsed.mutation_id === 'string' &&
        typeof parsed.action === 'string' &&
        Number.isSafeInteger(parsed.expected_state_revision)
      )
        pending.value = parsed
    }
  } catch {
    /* Keep server authorization authoritative. */
  }
  try {
    await verifyOwner()
    await reload()
  } catch (e) {
    message.value = describe(e)
  } finally {
    busy.value = false
  }
}
async function list(more = false) {
  const generation = epoch
  const data = await request<AuthorWorkPage>(
    `/my/works${more && cursor.value ? `?cursor=${encodeURIComponent(cursor.value)}` : ''}`,
  )
  if (generation !== epoch) return
  works.value = more ? [...works.value, ...data.items] : data.items
  cursor.value = data.next_cursor
}
async function moreWorks() {
  if (busy.value) return
  busy.value = true
  try {
    await verifyOwner()
    await list(true)
  } catch (e) {
    message.value = describe(e)
  } finally {
    busy.value = false
  }
}
async function previewVersion(version: number) {
  if (busy.value || !selected.value) return
  const run = ++viewEpoch,
    generation = epoch,
    id = selected.value
  busy.value = true
  try {
    await verifyOwner()
    const data = await request<PublicWork>(`/my/works/${id}/versions/${version}`)
    if (run === viewEpoch && generation === epoch) body.value = data
  } catch (e) {
    message.value = describe(e)
  } finally {
    busy.value = false
  }
}
function propose(action: WorkChange['action'], version?: number, history?: boolean) {
  if (!timeline.value || busy.value || pending.value) return
  const st = timeline.value.state
  const data: WorkChange = {
    mutation_id: crypto.randomUUID(),
    expected_state_revision: st.state_revision,
    action,
  }
  if (version !== undefined) data.version = version
  if (history !== undefined) data.history_open = history
  if (action === 'restore') {
    const latest = timeline.value.versions.find((v) => v.version === st.last_version)
    if (latest?.platform_limited) {
      if (!fallback.value) {
        message.value = '最新版受限，请明确选择一个正常旧版恢复。'
        return
      }
      data.version = Number(fallback.value)
    }
  }
  confirmation.value = data
}
async function act() {
  if (busy.value || (!pending.value && !confirmation.value)) return
  const generation = epoch,
    id = selected.value
  busy.value = true
  message.value = ''
  try {
    await verifyOwner()
    if (generation !== epoch) return
    if (!pending.value) {
      pending.value = confirmation.value
      confirmation.value = null
      persist()
    }
    await request(`/my/works/${id}/actions`, 'POST', pending.value)
    if (generation !== epoch) return
    pending.value = null
    persist()
    await reload()
    await list()
    message.value = '操作已确认，页面已读取当前状态；工作稿未修改。'
  } catch (e) {
    if (generation !== epoch) return
    message.value = describe(e)
    if (e instanceof APIError && [400, 403, 404, 409].includes(e.status)) {
      pending.value = null
      persist()
      try {
        await reload()
      } catch {
        /* Preserve the actionable original error. */
      }
    }
  } finally {
    busy.value = false
  }
}
async function refresh() {
  if (busy.value) return
  busy.value = true
  try {
    await verifyOwner()
    await list()
    await reload()
  } catch (e) {
    message.value = describe(e)
  } finally {
    busy.value = false
  }
}
async function more(kind: 'versions' | 'events') {
  if (!timeline.value || busy.value) return
  const snapshot = timeline.value,
    version = kind === 'versions' ? snapshot.next_version_before : 0,
    event = kind === 'events' ? snapshot.next_event_before : 0
  if (!(version || event)) return
  const generation = epoch,
    id = selected.value
  busy.value = true
  try {
    await verifyOwner()
    const data = await request<AuthorTimeline>(
      `/my/works/${id}/versions?before_version=${version}&before_event=${event}`,
    )
    if (generation !== epoch || id !== selected.value) return
    if (data.state.state_revision !== snapshot.state.state_revision) {
      await reload()
      message.value = '分页期间作品状态发生变化，已重新读取。'
      return
    }
    if (kind === 'versions') {
      snapshot.versions.push(...data.versions)
      snapshot.next_version_before = data.next_version_before
    } else {
      snapshot.events.push(...data.events)
      snapshot.next_event_before = data.next_event_before
    }
  } catch (e) {
    message.value = describe(e)
  } finally {
    busy.value = false
  }
}
function exportVersion() {
  if (!body.value) return
  const url = URL.createObjectURL(
    new Blob([body.value.title + '\n\n' + body.value.content], {
      type: 'text/plain;charset=utf-8',
    }),
  )
  const a = document.createElement('a')
  a.href = url
  a.download = `tako-${body.value.id}-v${body.value.version}.txt`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function eventText(kind: string) {
  return (
    (
      {
        hidden: '隐藏作品',
        restored: '恢复公开',
        display_changed: '切换展示',
        history_opened: '开放历史阅读',
        history_closed: '关闭历史阅读',
      } as Record<string, string>
    )[kind] ?? kind
  )
}
async function sessionChanged() {
  try {
    await verifyOwner()
  } catch (e) {
    if (e instanceof APIError && e.status === 401) invalidate()
    else if (e instanceof APIError) message.value = describe(e)
  }
}
function storageChanged(e: StorageEvent) {
  if (e.key === 'tako-session-locked' && e.newValue) invalidate()
}
onMounted(async () => {
  channel =
    typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('tako-session') : undefined
  if (channel)
    channel.onmessage = (e) => {
      if (e.data === 'logout') invalidate()
      else if (e.data === 'session-changed') void sessionChanged()
    }
  window.addEventListener('focus', sessionChanged)
  window.addEventListener('storage', storageChanged)
  if (!enabled) {
    message.value = '作品管理尚未启用。'
    return
  }
  const generation = epoch
  try {
    const me = await request<Account>('/me')
    if (generation !== epoch) return
    owner = me.id
    await list()
    if (generation !== epoch) return
    ready.value = true
    const wanted = typeof route.query.work === 'string' ? route.query.work : works.value[0]?.id
    if (wanted && /^[0-9a-f-]{36}$/i.test(wanted)) await choose(wanted)
  } catch (e) {
    message.value = describe(e)
  }
})
onUnmounted(() => {
  epoch++
  viewEpoch++
  channel?.close()
  window.removeEventListener('focus', sessionChanged)
  window.removeEventListener('storage', storageChanged)
})
</script>
<template>
  <main class="publication-page">
    <header class="publication-header">
      <NuxtLink to="/workspace">← 写作空间</NuxtLink><strong>作品管理</strong
      ><button class="text-button" :disabled="busy" @click="refresh">刷新状态</button>
    </header>
    <p v-if="message" class="notice" role="status">{{ message }}</p>
    <p v-if="ready && !works.length" class="muted">
      还没有正式发布的作品。从已保存草稿准备发布后，会出现在这里。
    </p>
    <div v-if="ready" class="manager-grid">
      <aside>
        <h2>我的作品</h2>
        <button
          v-for="item in works"
          :key="item.id"
          class="manager-work"
          :class="{ 'manager-selected': selected === item.id }"
          :disabled="busy"
          @click="choose(item.id)"
        >
          <strong>{{ item.title }}</strong
          ><small
            >展示 V{{ item.display_version }} · 最新 V{{ item.last_version }} ·
            {{ item.author_hidden ? '已隐藏' : '公开设置'
            }}{{ item.platform_limited ? ' · 平台限制' : '' }}</small
          ></button
        ><button v-if="cursor" class="text-button" :disabled="busy" @click="moreWorks">
          更多作品</button
        ><template v-if="timeline"
          ><h2 class="manager-section">正式版本</h2>
          <div v-for="version in timeline.versions" :key="version.version" class="manager-version">
            <div>
              <span :class="version.platform_limited ? 'manager-red' : 'manager-green'">{{
                version.platform_limited ? '! 受限' : '✓ 已发布'
              }}</span>
              · V{{ version.version }}
              <small v-if="version.review_status === 'pending'">待后审</small>
            </div>
            <p>{{ version.title }}</p>
            <div class="row">
              <button class="text-button" :disabled="busy" @click="previewVersion(version.version)">
                查看 V{{ version.version }}</button
              ><button
                v-if="version.version !== timeline.state.display_version"
                class="text-button"
                :disabled="busy || !!pending || version.platform_limited"
                @click="propose('switch_display', version.version)"
              >
                设为展示版本</button
              ><span v-else class="fine">当前展示</span>
            </div>
          </div>
          <button
            v-if="timeline.next_version_before"
            class="text-button"
            :disabled="busy"
            @click="more('versions')"
          >
            更多版本
          </button></template
        >
      </aside>
      <section v-if="timeline">
        <div class="manager-state">
          <h1>作品状态</h1>
          <p>
            当前展示 V{{ timeline.state.display_version }} · 最新正式版 V{{
              timeline.state.last_version
            }}
            · {{ timeline.state.author_hidden ? '作者已隐藏' : '作者公开设置' }}
          </p>
          <p v-if="timeline.state.platform_limited" class="notice">
            作品整体受限。修改展示或历史开关不能解除平台限制。
          </p>
          <NuxtLink :to="`/works/${selected}`" target="_blank">打开读者链接 ↗</NuxtLink
          ><NuxtLink
            :to="{ path: '/publish', query: { draft: timeline.state.draft_id, fresh: '1' } }"
            class="text-button"
            >准备新修订</NuxtLink
          ><label class="manager-history"
            ><input
              type="checkbox"
              :checked="timeline.state.history_open"
              :disabled="busy || !!pending"
              @change="
                propose('set_history', undefined, ($event.target as HTMLInputElement).checked)
                ;($event.target as HTMLInputElement).checked = timeline.state.history_open
              "
            />允许读者查看历史版本</label
          >
          <div class="row">
            <button
              v-if="!timeline.state.author_hidden"
              class="secondary"
              :disabled="busy || !!pending"
              @click="propose('hide')"
            >
              隐藏作品</button
            ><template v-else
              ><button
                class="primary"
                :disabled="busy || !!pending || timeline.state.platform_limited"
                @click="propose('restore')"
              >
                恢复公开</button
              ><label
                v-if="
                  timeline.versions.find((v) => v.version === timeline?.state.last_version)
                    ?.platform_limited
                "
                class="fine"
                >最新版受限，选择正常旧版<select v-model="fallback" aria-label="选择恢复旧版">
                  <option value="">请选择</option>
                  <option
                    v-for="v in timeline.versions.filter((v) => !v.platform_limited)"
                    :key="v.version"
                    :value="String(v.version)"
                  >
                    V{{ v.version }}
                  </option>
                </select></label
              ></template
            >
          </div>
          <p class="fine">
            切换展示不改写工作稿。恢复默认最新正式版；隐藏期间发布的新版本也会被纳入。
          </p>
        </div>
        <section v-if="pending" class="notice">
          <p>有一次结果尚未确认的操作：{{ pending.action }}。检查原请求不会重复执行。</p>
          <button class="primary" :disabled="busy" @click="act">检查原操作结果</button>
        </section>
        <section
          v-if="confirmation"
          class="manager-confirm"
          role="dialog"
          aria-labelledby="manage-confirm-title"
        >
          <h2 id="manage-confirm-title">
            确认{{
              eventText(
                confirmation.action === 'set_history'
                  ? confirmation.history_open
                    ? 'history_opened'
                    : 'history_closed'
                  : confirmation.action === 'hide'
                    ? 'hidden'
                    : confirmation.action === 'restore'
                      ? 'restored'
                      : 'display_changed',
              )
            }}？
          </h2>
          <p v-if="confirmation.action === 'restore'">
            将恢复公开并展示 V{{
              confirmation.version ?? timeline.state.last_version
            }}；历史阅读保持{{ timeline.state.history_open ? '开启' : '关闭' }}。
          </p>
          <p v-else-if="confirmation.action === 'switch_display'">
            读者展示将切换为 V{{ confirmation.version }}，工作稿和正式版本号不回退。
          </p>
          <p v-else-if="confirmation.action === 'hide'">
            新访问将不可读；已经加载的正文允许读完。待审流程不自动撤回。
          </p>
          <p v-else>
            历史阅读{{
              confirmation.history_open
                ? '开启后，全部正常正式版本可读'
                : '关闭后，旧链接重新访问不能获取历史正文'
            }}。
          </p>
          <div class="row">
            <button class="primary" :disabled="busy" @click="act">确认操作</button
            ><button class="secondary" :disabled="busy" @click="confirmation = null">取消</button>
          </div>
        </section>
        <article v-if="body" class="manager-preview">
          <div class="row">
            <h2>预览 V{{ body.version }} · {{ body.title }}</h2>
            <button class="text-button" @click="exportVersion">导出此版本</button>
          </div>
          <p class="fine">作者视角可以查看自己的受限版本；不代表读者可读。</p>
          <div class="publication-body">{{ body.content }}</div>
        </article>
        <section class="manager-events">
          <h2>管理记录</h2>
          <p v-if="!timeline.events.length" class="fine">暂无展示或可见性操作记录。</p>
          <p v-for="event in timeline.events" :key="event.sequence" class="fine">
            {{ eventText(event.kind) }} · V{{ event.version }} ·
            {{ new Date(event.created_at).toLocaleString('zh-CN') }}
          </p>
          <button
            v-if="timeline.next_event_before"
            class="text-button"
            :disabled="busy"
            @click="more('events')"
          >
            更多记录
          </button>
        </section>
      </section>
    </div>
  </main>
</template>
