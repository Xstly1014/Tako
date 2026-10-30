<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { APIError, request } from '../lib/api'
import type { Account, ServerDraft } from '../lib/types'
import {
  publicationTags,
  type PublicationPreview,
  type PublicationResult,
  type WorkState,
} from '../lib/publication'
useHead({
  title: '准备发布 · Tako',
  meta: [{ name: 'robots', content: 'noindex,nofollow,noarchive' }],
})
const route = useRoute(),
  config = useRuntimeConfig()
const draftId = typeof route.query.draft === 'string' ? route.query.draft : ''
const draft = ref<ServerDraft | null>(null),
  preview = ref<PublicationPreview | null>(null)
const introduction = ref(''),
  tags = ref<string[]>([]),
  rights = ref(false),
  busy = ref(false)
const message = ref(''),
  result = ref<PublicationResult | null>(null),
  ready = ref(false)
const enabled = String(config.public.publicationEnabled) === 'true'
let owner = '',
  epoch = 0,
  channel: BroadcastChannel | undefined
let pendingPrepare: {
  mutation_id: string
  draft_id: string
  source_revision: number
  introduction: string
  tags: string[]
  rights_confirmed: boolean
} | null = null
let publishMutation = '',
  key = '',
  confirmAttempted = false
const short = computed(() =>
  preview.value
    ? Array.from(preview.value.content).filter((c) => !/\p{White_Space}/u.test(c)).length < 300
    : false,
)
const expired = ref(false)
const publishedState = ref<WorkState | null>(null)
let clock: ReturnType<typeof setInterval> | undefined
function describe(e: unknown) {
  if (!(e instanceof APIError)) return '暂时无法完成，请保留当前页面并稍后重试。'
  const texts: Record<string, string> = {
    preview_expired: '这份未提交预览已过期，请重新准备；工作稿仍然保留。',
    source_revision_unavailable: '这份草稿修订已不再保留，请重新读取并准备预览。',
    publication_conflict:
      '已有其他发布推进了作品版本。请查看最新状态后重新准备，系统没有自动追加版本。',
    unsupported_publication_state:
      '当前作品或账号需要审核处理，B1 暂不支持此路径，内容没有直接公开。',
    publication_disabled: '发布功能尚未启用，工作稿不受影响。',
    rate_limited: '准备预览较频繁，请稍后再试。',
    authentication_required: '需要重新登录，当前页面尚未确认的内容不会自动公开。',
    invalid_input: '请检查标题、正文、标签、简介和授权确认。',
    resource_not_found: '内容不存在或当前账号无权访问。',
    network_unconfirmed: '网络未确认结果。再次检查会沿用本次请求，不重复发布。',
  }
  return (
    (texts[e.code] ?? '暂时无法完成，请稍后检查。') +
    (e.requestId ? ` 参考编号：${e.requestId}` : '')
  )
}
function persist() {
  try {
    sessionStorage.setItem(
      key,
      JSON.stringify({
        owner,
        pendingPrepare,
        previewId: preview.value?.id,
        publishMutation,
        confirmAttempted,
      }),
    )
  } catch {
    message.value = '浏览器无法保留本次操作标识。请保持页面打开，结果确认前不要刷新。'
  }
}
function invalidate() {
  epoch++
  draft.value = null
  preview.value = null
  result.value = null
  publishedState.value = null
  introduction.value = ''
  tags.value = []
  rights.value = false
  pendingPrepare = null
  publishMutation = ''
  confirmAttempted = false
  ready.value = false
  message.value = '会话已变化，已隐藏当前账号内容。请回写作空间重新进入。'
}
async function verifyOwner() {
  if (!owner) return
  const me = await request<Account>('/me')
  if (me.id !== owner) {
    invalidate()
    throw new Error('account_changed')
  }
}
function checkExpiry() {
  expired.value =
    !!preview.value && !result.value && Date.parse(preview.value.expires_at) <= Date.now()
}
async function prepare() {
  if (busy.value || !draft.value) return
  if (
    !pendingPrepare &&
    (!rights.value ||
      tags.value.length < 1 ||
      tags.value.length > 3 ||
      Array.from(introduction.value).length > 300)
  ) {
    message.value = '请选择 1～3 个标签、检查简介，并确认发布授权。'
    return
  }
  const generation = epoch
  busy.value = true
  message.value = ''
  try {
    await verifyOwner()
    if (generation !== epoch) return
    if (!pendingPrepare) {
      pendingPrepare = {
        mutation_id: crypto.randomUUID(),
        draft_id: draftId,
        source_revision: draft.value.revision,
        introduction: introduction.value,
        tags: [...tags.value],
        rights_confirmed: rights.value,
      }
      persist()
    }
    const out = await request<PublicationPreview>('/publication-previews', 'POST', pendingPrepare)
    if (generation !== epoch) return
    preview.value = out
    publishMutation = crypto.randomUUID()
    persist()
    checkExpiry()
  } catch (e) {
    if (generation === epoch) message.value = describe(e)
  } finally {
    busy.value = false
  }
}
async function confirm() {
  if (busy.value || !preview.value) return
  const generation = epoch
  busy.value = true
  message.value = ''
  try {
    await verifyOwner()
    if (generation !== epoch) return
    if (!publishMutation) {
      publishMutation = crypto.randomUUID()
      persist()
    }
    confirmAttempted = true
    persist()
    const out = await request<PublicationResult>('/publications', 'POST', {
      mutation_id: publishMutation,
      preview_id: preview.value.id,
      expected_version: preview.value.expected_version,
    })
    if (generation !== epoch) return
    result.value = out
    try {
      const state = await request<WorkState>(`/my/works/${out.work_id}`)
      if (generation === epoch) publishedState.value = state
    } catch {
      /* Commit is confirmed even if current-state refresh is unavailable. */
    }
    persist()
    checkExpiry()
  } catch (e) {
    if (generation === epoch) message.value = describe(e)
  } finally {
    busy.value = false
  }
}
async function reset() {
  if (busy.value) return
  // Do not silently abandon an unknown final publication result.
  if (
    confirmAttempted &&
    !result.value &&
    preview.value &&
    !window.confirm(
      '重新准备不会撤销可能已经提交成功的发布。若之前确认发布时网络中断，请先检查原请求结果。仍要重新准备吗？',
    )
  )
    return
  const generation = epoch
  busy.value = true
  try {
    await verifyOwner()
    const current = await request<ServerDraft>(`/drafts/${encodeURIComponent(draftId)}`)
    if (generation !== epoch) return
    draft.value = current
    preview.value = null
    pendingPrepare = null
    publishMutation = ''
    confirmAttempted = false
    result.value = null
    publishedState.value = null
    rights.value = false
    message.value = '已读取当前工作稿；这不会修改它的内容。'
    persist()
  } catch (e) {
    if (generation === epoch) message.value = describe(e)
  } finally {
    busy.value = false
  }
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
  window.addEventListener('storage', storageChanged)
  window.addEventListener('focus', sessionChanged)
  clock = setInterval(checkExpiry, 1000)
  const initialEpoch = epoch
  if (!enabled) {
    message.value = '发布功能尚未启用。'
    return
  }
  if (!/^[0-9a-f-]{36}$/i.test(draftId)) {
    message.value = '请从写作空间选择一份已保存草稿进入。'
    return
  }
  busy.value = true
  try {
    const account = await request<Account>('/me')
    if (initialEpoch !== epoch) return
    owner = account.id
    key = `tako-publication:${owner}:${draftId}`
    const initialDraft = await request<ServerDraft>(`/drafts/${encodeURIComponent(draftId)}`)
    if (initialEpoch !== epoch) return
    draft.value = initialDraft
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) ?? 'null')
      if (saved?.owner === owner) {
        pendingPrepare = saved.pendingPrepare ?? null
        publishMutation = typeof saved.publishMutation === 'string' ? saved.publishMutation : ''
        confirmAttempted = saved.confirmAttempted === true
        if (pendingPrepare) {
          introduction.value = pendingPrepare.introduction
          tags.value = pendingPrepare.tags
          rights.value = pendingPrepare.rights_confirmed
        }
        if (typeof saved.previewId === 'string') {
          const restored = await request<PublicationPreview>(
            `/publication-previews/${encodeURIComponent(saved.previewId)}`,
          )
          if (initialEpoch !== epoch) return
          if (restored.published && route.query.fresh === '1') {
            pendingPrepare = null
            publishMutation = ''
            confirmAttempted = false
            preview.value = null
            publishedState.value = null
            rights.value = false
            sessionStorage.removeItem(key)
            message.value = '上次发布已确认。现在可以基于当前工作稿准备新修订。'
          } else {
            preview.value = restored
            if (restored.published) result.value = restored.published
          }
        }
      }
    } catch (e) {
      if (e instanceof APIError) message.value = describe(e)
    }
    if (initialEpoch !== epoch) return
    ready.value = true
    checkExpiry()
  } catch (e) {
    message.value = describe(e)
  } finally {
    busy.value = false
  }
})
onUnmounted(() => {
  epoch++
  channel?.close()
  if (clock) clearInterval(clock)
  window.removeEventListener('storage', storageChanged)
  window.removeEventListener('focus', sessionChanged)
})
</script>
<template>
  <main class="publication-page publish-page">
    <header class="publication-header">
      <NuxtLink to="/" aria-label="Tako 首页"><TakoLogo /></NuxtLink>
      <nav aria-label="创作导航">
        <NuxtLink to="/workspace">写作空间</NuxtLink><NuxtLink to="/my-works">作品管理</NuxtLink
        ><span aria-current="page">准备发布</span>
      </nav>
    </header>
    <div class="publish-heading">
      <h1>{{ result ? '发布结果' : preview ? '确认发布内容' : '准备发布' }}</h1>
      <p>填写发布信息，检查预览，再确认公开。</p>
      <ol v-if="!result" class="publish-steps" aria-label="发布步骤">
        <li :aria-current="!preview ? 'step' : undefined">填写信息</li>
        <li :aria-current="preview ? 'step' : undefined">预览与确认</li>
      </ol>
    </div>
    <p v-if="message" class="notice" role="status">{{ message }}</p>
    <div v-if="result" class="publication-result">
      <h2>发布已确认 · V{{ result.version }}</h2>
      <p v-if="publishedState?.author_hidden" class="notice">新版本已发布，作品仍处于隐藏状态。</p>
      <p v-if="publishedState?.platform_limited" class="notice">
        新版本已保存，作品的平台限制仍生效。
      </p>
      <NuxtLink :to="{ path: '/my-works', query: { work: result.work_id } }">进入作品管理</NuxtLink>
      <p>正式版本和后审待办已一并保存。“已发布”不等于审核通过，也不代表作品当前一定可读。</p>
      <NuxtLink :to="`/works/${result.work_id}`" class="primary">打开作品链接</NuxtLink
      ><button class="text-button" @click="reset">读取工作稿，准备下一次修订</button>
    </div>
    <div
      v-if="ready && draft && !result"
      class="publication-grid"
      :class="{ 'publication-grid--form': !preview }"
    >
      <section>
        <template v-if="!preview"
          ><h2>{{ draft.title || '尚未填写标题' }}</h2>
          <p class="fine">已保存修订 R{{ draft.revision }}。修改标题和正文请返回工作稿。</p>
          <label for="publication-intro">简介（可选，最多 300 字）</label
          ><textarea
            id="publication-intro"
            v-model="introduction"
            :disabled="busy || !!pendingPrepare"
            maxlength="600"
          />
          <fieldset class="publication-tags" :disabled="busy || !!pendingPrepare">
            <legend>风格标签（选 1～3 个）</legend>
            <label v-for="tag in publicationTags" :key="tag"
              ><input v-model="tags" type="checkbox" :value="tag" />{{ tag }}</label
            >
          </fieldset>
          <label class="publication-rights"
            ><input
              v-model="rights"
              type="checkbox"
              :disabled="busy || !!pendingPrepare"
            />我确认本次内容为原创，或已取得发布授权。</label
          >
          <p v-if="pendingPrepare" class="fine">
            本次请求已固定；检查时沿用相同内容。需要修改请明确重新准备。
          </p>
          <button class="primary" :disabled="busy" @click="prepare">
            {{ busy ? '处理中…' : pendingPrepare ? '检查本次预览请求' : '生成发布预览' }}</button
          ><button v-if="pendingPrepare" class="text-button" :disabled="busy" @click="reset">
            重新准备
          </button></template
        >
        <template v-else
          ><div class="row">
            <h2>{{ preview.title }}</h2>
            <span class="fine">固定修订 R{{ preview.source_revision }}</span>
          </div>
          <p v-if="draft.revision !== preview.source_revision" class="notice">
            工作稿已有 R{{ draft.revision }}。当前仍可发布预览中的 R{{
              preview.source_revision
            }}，新稿保持不变。
          </p>
          <article class="publication-body">{{ preview.content }}</article></template
        >
      </section>
      <aside v-if="preview">
        <h2>发布确认</h2>
        <p class="fine">读者将看到这份标题、简介与正文。</p>
        <div class="publication-share">
          <small>TAKO / 中篇</small>
          <h3>{{ preview.title }}</h3>
          <p v-if="preview.introduction">{{ preview.introduction }}</p>
          <p v-else class="fine">作者未填写简介</p>
          <span v-for="tag in preview.tags" :key="tag" class="publication-tag">{{ tag }}</span>
        </div>
        <p v-if="short" class="notice">
          正文不足 300 字，这个篇幅可能更适合短内容。你仍可以作为完整中篇发布。
        </p>
        <p class="fine">
          未提交预览有效至
          {{
            new Date(preview.expires_at).toLocaleString('zh-CN')
          }}。到期不影响草稿和已经提交的作品。
        </p>
        <p v-if="expired" class="notice">
          预览已到期。如曾在网络中断前确认发布，仍可检查原请求结果。
        </p>
        <button class="primary full" :disabled="busy" @click="confirm">
          {{
            busy
              ? '正在确认…'
              : expired
                ? '检查原发布请求结果'
                : `确认发布 R${preview.source_revision}`
          }}</button
        ><button class="text-button" :disabled="busy" @click="reset">重新读取工作稿并准备</button>
      </aside>
    </div>
  </main>
</template>

<style scoped>
.publish-page {
  max-width: 1120px;
  padding: 0 32px 48px;
}
.publish-page .publication-header {
  height: 80px;
  margin: 0 0 32px;
  justify-content: flex-start;
  gap: 32px;
}
.publication-header nav {
  display: flex;
  align-items: center;
  gap: 24px;
  font-size: 14px;
  color: var(--color-muted);
}
.publication-header nav span {
  color: var(--color-ink);
  font-weight: 600;
}
.publish-heading {
  margin-bottom: 24px;
}
.publish-heading h1 {
  font-size: 24px;
  line-height: 32px;
  font-weight: 600;
  margin: 0 0 8px;
}
.publish-heading > p {
  font-size: 14px;
  color: var(--color-muted);
  margin: 0;
}
.publish-steps {
  display: flex;
  gap: 32px;
  list-style: none;
  padding: 0;
  margin: 24px 0 0;
  font-size: 12px;
  color: var(--color-muted);
  counter-reset: steps;
}
.publish-steps li {
  display: flex;
  align-items: center;
  gap: 8px;
  counter-increment: steps;
}
.publish-steps li:before {
  content: counter(steps);
  width: 24px;
  height: 24px;
  display: inline-grid;
  place-items: center;
  border: 1px solid var(--color-line);
  border-radius: 50%;
  background: #fff;
}
.publish-steps li[aria-current='step'] {
  color: var(--color-brand);
  font-weight: 600;
}
.publish-steps li[aria-current='step']:before {
  border-color: var(--color-brand);
}
.publication-grid {
  margin: 24px 0 0;
  grid-template-columns: minmax(0, 1fr) 304px;
  gap: 24px;
  align-items: start;
}
.publication-grid--form {
  display: block;
  max-width: 760px;
}
.publication-grid > section,
.publication-grid > aside,
.publication-result {
  background: #fff;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  padding: 24px;
  min-width: 0;
}
.publication-grid > section h2,
.publication-grid > aside h2 {
  font-size: 20px;
  line-height: 28px;
  font-weight: 600;
  margin: 0 0 8px;
  overflow-wrap: anywhere;
}
.publication-grid > section > .fine {
  margin: 0 0 24px;
}
.publication-grid label {
  font-size: 14px;
  margin: 24px 0 8px;
}
.publication-grid textarea {
  display: block;
  width: 100%;
  min-height: 120px;
  resize: vertical;
  padding: 12px;
  border-radius: 6px;
}
.publication-tags {
  margin: 24px 0;
  padding: 0;
}
.publication-tags legend {
  font-size: 14px;
  padding: 0;
}
.publication-tags label {
  margin: 12px 16px 0 0;
  display: inline-flex;
  gap: 8px;
  align-items: center;
}
.publication-tags input,
.publication-rights input {
  width: 16px;
  height: 16px;
  accent-color: var(--color-brand);
  flex-shrink: 0;
}
.publication-grid .publication-rights {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 24px 0;
  line-height: 24px;
}
.publication-grid .publication-rights input {
  margin-top: 4px;
}
.publication-grid button {
  font-size: 14px;
}
.publication-grid > aside {
  position: sticky;
  top: 24px;
}
.publication-share {
  padding: 16px;
  background: #f7f8fa;
  border: 0;
  border-radius: 6px;
  margin: 16px 0;
}
.publication-share h3 {
  font-size: 16px;
  font-weight: 600;
  line-height: 24px;
  margin: 8px 0;
}
.publication-share p {
  font-size: 14px;
  line-height: 1.8;
  margin: 8px 0 12px;
}
.publication-tag {
  font-size: 12px;
  background: transparent;
  padding: 0;
  margin-right: 12px;
}
.publication-grid .publication-body {
  margin-top: 24px;
  font-size: 16px;
  line-height: 1.9;
}
.publish-page .notice {
  margin: 16px 0;
  font-size: 12px;
}
.publication-grid > aside > .fine {
  font-size: 12px;
  line-height: 1.8;
  margin: 16px 0;
}
.publication-grid > aside > button:last-child {
  display: block;
  margin-top: 12px;
  width: 100%;
  white-space: normal;
}
.publication-result {
  margin-top: 24px;
}
.publication-result h2 {
  font-size: 20px;
  font-weight: 600;
}
.publication-result p {
  font-size: 14px;
  line-height: 1.8;
  margin: 16px 0;
}
.publication-result > a,
.publication-result > button {
  margin: 8px 12px 8px 0;
  font-size: 14px;
}
.publish-page :focus-visible {
  outline: 2px solid var(--color-brand);
  outline-offset: 3px;
}
@media (max-width: 767px) {
  .publish-page {
    padding: 0 16px 32px;
  }
  .publish-page .publication-header {
    height: 72px;
    gap: 16px;
    margin-bottom: 24px;
  }
  .publication-header nav {
    gap: 12px;
    font-size: 12px;
  }
  .publication-header nav > a:first-child {
    display: none;
  }
  .publication-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .publication-grid > section,
  .publication-grid > aside,
  .publication-result {
    padding: 24px 16px;
  }
  .publication-grid > aside {
    position: static;
  }
  .publish-heading h1 {
    font-size: 20px;
  }
  .publish-heading > p {
    font-size: 12px;
  }
}
</style>
