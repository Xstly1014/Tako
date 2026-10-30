<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'
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
const section = ref<'content' | 'settings' | 'events'>('content')
const sectionPane = ref<HTMLElement | null>(null)
watch(
  section,
  () => {
    if (sectionPane.value) sectionPane.value.scrollTop = 0
  },
  { flush: 'post' },
)
const versionInfo = ref(false)
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
  section.value = 'content'
  versionInfo.value = false
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
  <main class="publication-page manager-page">
    <header class="manager-nav">
      <NuxtLink to="/" aria-label="Tako 首页"><TakoLogo /></NuxtLink>
      <nav aria-label="创作导航">
        <NuxtLink to="/workspace">写作空间</NuxtLink><span aria-current="page">作品管理</span>
      </nav>
      <button class="secondary" :disabled="busy" @click="refresh">刷新</button>
    </header>
    <div class="manager-page-heading">
      <h1>作品管理</h1>
      <p>查看已发布内容，管理版本和公开范围。</p>
    </div>
    <p v-if="message" class="notice" role="status">{{ message }}</p>
    <p v-if="!ready && !message" class="manager-loading" role="status">正在读取作品…</p>
    <section v-if="ready && !works.length" class="manager-empty">
      <h2>还没有发布的作品</h2>
      <p>在写作空间保存草稿后，可以准备发布。</p>
      <NuxtLink to="/workspace" class="primary">打开写作空间</NuxtLink>
    </section>
    <div v-if="ready && works.length" class="manager-grid">
      <aside class="manager-library">
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
            >{{ item.author_hidden ? '已隐藏' : '已发布'
            }}{{ item.platform_limited ? ' · 受限' : '' }}</small
          ></button
        ><button v-if="cursor" class="text-button" :disabled="busy" @click="moreWorks">
          更多作品
        </button>
      </aside>
      <section v-if="timeline" class="manager-workspace" :aria-busy="busy">
        <header class="manager-work-header">
          <div>
            <h2 class="manager-body-title">
              {{ body?.title ?? works.find((w) => w.id === selected)?.title }}
            </h2>
            <p>
              {{ timeline.state.author_hidden ? '已隐藏，读者不可访问' : '已发布'
              }}<span v-if="timeline.state.platform_limited"> · 作品受限</span>
            </p>
          </div>
          <div class="manager-actions">
            <NuxtLink :to="`/works/${selected}`" target="_blank" class="secondary"
              >打开读者链接</NuxtLink
            ><NuxtLink
              :to="{ path: '/publish', query: { draft: timeline.state.draft_id, fresh: '1' } }"
              class="primary"
              >准备新修订</NuxtLink
            >
          </div>
        </header>
        <nav class="manager-tabs" aria-label="作品管理区域">
          <button :aria-pressed="section === 'content'" @click="section = 'content'">
            内容与版本</button
          ><button :aria-pressed="section === 'settings'" @click="section = 'settings'">
            作品设置</button
          ><button :aria-pressed="section === 'events'" @click="section = 'events'">
            管理记录
          </button>
        </nav>
        <div ref="sectionPane" class="manager-section-body">
          <p v-if="timeline.state.platform_limited" class="notice">
            作品整体受限。作者设置不能解除平台限制。
          </p>
          <section v-if="pending" class="notice">
            <p>有一次操作的结果尚未确认。检查原请求不会重复执行。</p>
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

          <section v-if="section === 'content'" class="manager-content">
            <div class="manager-section-label">
              <h3>发布版本</h3>
              <p>选择节点预览内容</p>
            </div>
            <VersionRail
              :versions="timeline.versions"
              :selected="body?.version"
              :displayed="timeline.state.display_version"
              :busy="busy"
              :more="!!timeline.next_version_before"
              @select="previewVersion"
              @load="more('versions')"
            />
            <p v-if="timeline.versions.some((v) => v.platform_limited)" class="manager-limited">
              菱形节点为受限版本，仅作者可查看和导出。
            </p>
            <article v-if="body" class="manager-preview">
              <header class="manager-preview-header">
                <div>
                  <h3>正文预览</h3>
                  <span>{{
                    body.version === timeline.state.display_version
                      ? '读者正在看的版本'
                      : '历史版本'
                  }}</span>
                </div>
                <div class="manager-actions">
                  <button
                    v-if="body.version !== timeline.state.display_version"
                    class="secondary"
                    :disabled="
                      busy ||
                      !!pending ||
                      !!timeline.versions.find((v) => v.version === body?.version)?.platform_limited
                    "
                    @click="propose('switch_display', body.version)"
                  >
                    设为读者展示</button
                  ><button class="text-button" @click="exportVersion">导出此版本</button>
                </div>
              </header>
              <div class="manager-reading publication-body">{{ body.content }}</div>
              <footer class="manager-version-footer">
                <button
                  class="text-button"
                  :aria-expanded="versionInfo"
                  @click="versionInfo = !versionInfo"
                >
                  {{ versionInfo ? '收起版本信息' : '查看版本信息' }}
                </button>
                <div v-if="versionInfo" class="manager-version-info">
                  <dl>
                    <dt>版本</dt>
                    <dd>V{{ body.version }}</dd>
                    <dt>发布时间</dt>
                    <dd>{{ new Date(body.published_at).toLocaleString('zh-CN') }}</dd>
                    <dt>状态</dt>
                    <dd>
                      {{
                        timeline.versions.find((v) => v.version === body?.version)?.platform_limited
                          ? '受限 · 仅作者可见'
                          : '已发布'
                      }}{{
                        timeline.versions.find((v) => v.version === body?.version)
                          ?.review_status === 'pending'
                          ? ' · 待后审'
                          : ''
                      }}
                    </dd>
                  </dl>
                  <p>更换公开展示不会覆盖工作稿。</p>
                </div>
              </footer>
            </article>
          </section>
          <section v-if="section === 'settings'" class="manager-settings">
            <h3>公开与历史阅读</h3>
            <p class="manager-help">控制新访问能否阅读作品，以及是否开放旧版正文。</p>
            <label class="manager-history"
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
          </section>
          <section v-if="section === 'events'" class="manager-log">
            <h3>管理记录</h3>
            <p v-if="!timeline.events.length" class="manager-help">
              还没有更换展示或调整公开范围的记录。
            </p>
            <ol v-else>
              <li v-for="event in timeline.events" :key="event.sequence">
                <span>{{ eventText(event.kind) }}</span
                ><span class="manager-log-meta"
                  >V{{ event.version }} ·
                  {{ new Date(event.created_at).toLocaleString('zh-CN') }}</span
                >
              </li>
            </ol>
            <button
              v-if="timeline.next_event_before"
              class="text-button"
              :disabled="busy"
              @click="more('events')"
            >
              更多记录
            </button>
          </section>
        </div>
      </section>
      <section v-else class="manager-workspace manager-loading">
        {{ busy ? '正在读取作品内容…' : '请选择作品，或刷新重试。' }}
      </section>
    </div>
  </main>
</template>

<style scoped>
.manager-page {
  max-width: 1280px;
  padding: 0 32px 48px;
}
.manager-nav {
  height: 80px;
  display: flex;
  align-items: center;
  gap: 32px;
  border-bottom: 1px solid var(--color-line);
}
.manager-nav nav {
  display: flex;
  gap: 24px;
  font-size: 14px;
  align-items: center;
}
.manager-nav nav a {
  color: var(--color-muted);
}
.manager-nav nav span {
  font-weight: 600;
}
.manager-nav > button {
  margin-left: auto;
  font-size: 12px;
}
.manager-page-heading {
  padding: 32px 0 24px;
}
.manager-page-heading h1 {
  font-size: 24px;
  line-height: 32px;
  font-weight: 600;
  margin: 0 0 8px;
}
.manager-page-heading p {
  font-size: 14px;
  color: var(--color-muted);
  margin: 0;
}
.manager-grid {
  display: grid;
  grid-template-columns: 224px minmax(0, 1fr);
  gap: 24px;
}
.manager-library {
  padding: 8px 0;
  border: 0;
}
.manager-library h2 {
  font-size: 14px;
  font-weight: 600;
  margin: 0 0 16px;
  padding: 0 12px;
}
.manager-work {
  display: block;
  width: 100%;
  padding: 16px 12px;
  text-align: left;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--color-ink);
  margin-bottom: 8px;
}
.manager-work:hover {
  background: #eef0f3;
}
.manager-work strong {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
  font-size: 14px;
  line-height: 22px;
  font-weight: 600;
}
.manager-work small {
  display: block;
  font-size: 12px;
  color: var(--color-muted);
  margin-top: 8px;
}
.manager-selected {
  background: #fff !important;
  border-color: var(--color-line);
  box-shadow: inset 3px 0 var(--color-brand);
}
.manager-workspace {
  min-width: 0;
  background: #fff;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  overflow: hidden;
}
.manager-work-header {
  padding: 24px;
  display: flex;
  justify-content: space-between;
  gap: 24px;
  align-items: flex-start;
}
.manager-work-header > div:first-child {
  min-width: 0;
  flex: 1;
}
.manager-work-header h2 {
  font-size: 24px;
  line-height: 32px;
  font-weight: 600;
  margin: 0 0 8px;
  overflow-wrap: anywhere;
}
.manager-work-header p {
  font-size: 12px;
  color: var(--color-muted);
  margin: 0;
}
.manager-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.manager-actions > a,
.manager-actions > button {
  font-size: 12px;
  line-height: 20px;
  padding: 8px 12px;
  font-weight: 400;
}
.manager-actions > .primary {
  font-weight: 600;
}
.manager-tabs {
  display: grid;
  grid-template-columns: repeat(3, 112px);
  gap: 24px;
  padding: 0 24px;
  border-bottom: 1px solid var(--color-line);
}
.manager-tabs button {
  position: relative;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--color-muted);
  padding: 12px 0;
  font-size: 14px;
  line-height: 24px;
}
.manager-tabs button[aria-pressed='true'] {
  color: var(--color-ink);
  font-weight: 600;
}
.manager-tabs button[aria-pressed='true']:after {
  content: '';
  height: 2px;
  background: var(--color-brand);
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
}
.manager-section-body {
  padding: 24px;
  height: clamp(360px, calc(100dvh - 400px), 720px);
  overflow-y: auto;
  scrollbar-gutter: stable;
  overscroll-behavior: contain;
}
.manager-section-label {
  display: flex;
  align-items: baseline;
  gap: 12px;
}
.manager-section-body h3 {
  font-size: 14px;
  line-height: 22px;
  font-weight: 600;
  margin: 0;
}
.manager-section-label p {
  font-size: 12px;
  color: var(--color-muted);
  margin: 0;
}
.manager-limited {
  font-size: 12px;
  color: #ae343b;
  margin: 12px 0 24px;
}
.manager-preview {
  margin: 24px 0 0;
  border-top: 1px solid var(--color-line);
  padding-top: 24px;
}
.manager-preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}
.manager-preview-header > div:first-child {
  display: flex;
  gap: 12px;
  align-items: baseline;
  flex-wrap: wrap;
}
.manager-preview-header span {
  font-size: 12px;
  color: var(--color-muted);
}
.manager-reading {
  font-size: 16px;
  line-height: 1.9;
  padding: 24px 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--color-ink);
}
.manager-version-footer {
  border-top: 1px solid var(--color-line);
  padding: 12px 0 0;
}
.manager-version-footer > button {
  font-size: 12px;
  padding: 4px 0;
  color: var(--color-muted);
}
.manager-version-info {
  padding: 16px 0 0;
  font-size: 12px;
  color: var(--color-muted);
}
.manager-version-info dl {
  display: grid;
  grid-template-columns: 80px minmax(0, 1fr);
  gap: 12px;
  margin: 0;
}
.manager-version-info dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.manager-version-info p {
  margin: 16px 0 0;
}
.manager-settings h3,
.manager-log h3 {
  font-size: 16px;
}
.manager-help {
  font-size: 12px;
  color: var(--color-muted);
  margin: 8px 0 24px;
  line-height: 1.8;
}
.manager-history {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 0;
  margin: 0 0 24px;
  font-size: 14px;
}
.manager-history input {
  width: 16px;
  height: 16px;
  accent-color: var(--color-brand);
}
.manager-settings > .row {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}
.manager-settings select {
  display: block;
  max-width: 100%;
  margin-top: 8px;
  padding: 8px;
  border: 1px solid var(--color-line);
  border-radius: 4px;
  background: #fff;
}
.manager-log ol {
  padding: 0;
  margin: 24px 0 0;
  list-style: none;
}
.manager-log li {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  padding: 16px 0;
  border-bottom: 1px solid var(--color-line);
  font-size: 14px;
}
.manager-log-meta {
  font-size: 12px;
  color: var(--color-muted);
}
.manager-confirm {
  padding: 24px;
  margin: 0 0 24px;
  background: #f7f8fa;
  border: 1px solid var(--color-line);
  border-radius: 6px;
}
.manager-confirm h2 {
  font-size: 20px;
  font-weight: 600;
  margin: 0 0 12px;
}
.manager-confirm p {
  font-size: 14px;
  line-height: 1.8;
  margin: 0 0 16px;
}
.manager-confirm .row {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.manager-page > .notice {
  margin: 0 0 24px;
}
.manager-section-body > .notice {
  margin: 0 0 24px;
}
.manager-empty,
.manager-loading {
  padding: 32px;
  font-size: 14px;
}
.manager-empty {
  background: #fff;
  border: 1px solid var(--color-line);
  border-radius: 8px;
}
.manager-empty h2 {
  font-size: 20px;
}
.manager-empty p {
  color: var(--color-muted);
  margin-bottom: 24px;
}
.manager-page :focus-visible {
  outline: 2px solid var(--color-brand);
  outline-offset: 3px;
}
@media (min-width: 768px) and (max-width: 1024px) {
  .manager-grid {
    grid-template-columns: 184px minmax(0, 1fr);
  }
  .manager-work-header {
    flex-direction: column;
    gap: 16px;
  }
}
@media (max-width: 767px) {
  .manager-page {
    padding: 0 16px 32px;
  }
  .manager-nav {
    gap: 16px;
    height: 72px;
  }
  .manager-nav nav {
    gap: 12px;
    font-size: 12px;
  }
  .manager-nav > button {
    padding: 8px;
  }
  .manager-page-heading {
    padding: 24px 0;
  }
  .manager-page-heading h1 {
    font-size: 20px;
  }
  .manager-page-heading p {
    font-size: 12px;
  }
  .manager-grid {
    grid-template-columns: minmax(0, 1fr);
    gap: 16px;
  }
  .manager-library {
    max-height: 208px;
    overflow: auto;
  }
  .manager-work {
    padding: 12px;
  }
  .manager-work-header {
    padding: 24px 16px;
    flex-direction: column;
    gap: 16px;
  }
  .manager-work-header h2 {
    font-size: 20px;
    line-height: 28px;
  }
  .manager-tabs {
    padding: 0 16px;
    gap: 8px;
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .manager-tabs button {
    font-size: 12px;
  }
  .manager-section-body {
    padding: 24px 16px;
  }
  .manager-preview-header {
    align-items: flex-start;
    flex-direction: column;
    gap: 12px;
  }
  .manager-log li {
    flex-direction: column;
    gap: 8px;
  }
  .manager-reading {
    font-size: 14px;
  }
  .manager-confirm {
    padding: 16px;
  }
}
</style>
