<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch, toRaw } from 'vue'
import { APIError, listDrafts, request, syncAPI } from '../lib/api'
import { LocalDB, type DraftRepository } from '../lib/local-db'
import { existingFallback, memoryFallback } from '../lib/memory-db'
import { syncOne, type SyncResult } from '../lib/sync'
import type { Account, Ack, LocalDraft, ServerDraft, Summary } from '../lib/types'
useHead({
  title: '写作空间 · Tako',
  meta: [{ name: 'robots', content: 'noindex,nofollow,noarchive' }],
})

const account = ref<Account | null>(null),
  loading = ref(true),
  needsLogin = ref(false),
  drafts = ref<Summary[]>([]),
  localDrafts = ref<LocalDraft[]>([])
const title = ref(''),
  content = ref(''),
  message = ref(''),
  status = ref('选择一份草稿，或开始新的文字。'),
  savedAt = ref(''),
  selectedKey = ref(''),
  nickname = ref(''),
  nextCursor = ref(''),
  creating = ref(false),
  storageOK = ref(true)
const memoryMode = ref(false)
const workspaceId = globalThis.crypto?.randomUUID?.() ?? ''
let db: DraftRepository,
  persistentDB: LocalDB | undefined,
  channel: BroadcastChannel | undefined,
  timer: ReturnType<typeof setInterval>,
  pumpBusy = false,
  suppressEdit = false,
  saveTimer: ReturnType<typeof setTimeout> | undefined,
  lastPump = 0,
  disposed = false
let active: { key: string; seq: number; owner: string; cached: LocalDraft } | null = null
let writeChain = Promise.resolve()
let sessionEpoch = 0
let openingEpoch = 0,
  listEpoch = 0
const createIds = new Map<string, string>()
const stopped = new Map<string, number>()
const count = computed(() => [...content.value].length)
const lastConfirmed = computed(() =>
  savedAt.value ? new Date(savedAt.value).toLocaleString('zh-CN') : '',
)
function describe(error: unknown) {
  return error instanceof APIError
    ? error.status === 401
      ? '登录已过期，本机文字仍保留。'
      : error.code === 'nickname_required'
        ? '请先设置笔名。'
        : error.code === 'network_unconfirmed'
          ? '网络未确认结果，文字留在此设备等待同步。'
          : `暂时无法完成操作。${error.requestId ? `参考编号：${error.requestId}` : ''}`
    : '本机保护暂不可用。请保持页面打开，并导出文字。'
}
function lockVisible() {
  try {
    sessionStorage.removeItem('tako-delivery')
  } catch {
    // Logout keeps drafts, but need not keep an email address in the login form.
  }
  openingEpoch++
  listEpoch++
  suppressEdit = true
  active = null
  selectedKey.value = ''
  title.value = ''
  content.value = ''
  savedAt.value = ''
  drafts.value = []
  localDrafts.value = []
  account.value = null
  needsLogin.value = true
  suppressEdit = false
}
async function refreshLocal() {
  if (account.value && db) {
    const owner = account.value.id
    const rows = await db.all(owner)
    if (account.value?.id === owner)
      localDrafts.value = rows
        .filter((x) => x.dirty || x.pending)
        .sort((a, b) => b.updatedAt - a.updatedAt)
  }
}
async function useMemory() {
  let rows: LocalDraft[] = []
  if (account.value) {
    try {
      rows = await db.all(account.value.id)
    } catch {
      /* Recover at least the active page's last known state. */
    }
  }
  if (active && !rows.some((row) => row.key === active!.key)) rows.push(active.cached)
  db = memoryFallback(rows)
  memoryMode.value = true
  storageOK.value = true
}
async function refreshList(more = false) {
  if (!account.value || needsLogin.value) return
  const owner = account.value.id
  const epoch = ++listEpoch,
    previous = more ? [...drafts.value] : []
  try {
    const result = await listDrafts(more ? nextCursor.value : '')
    if (account.value?.id !== owner || epoch !== listEpoch) return
    drafts.value = [...previous, ...result.items]
    nextCursor.value = result.next_cursor
  } catch (error) {
    if (epoch === listEpoch) message.value = describe(error)
  }
}
async function signedIn(who: Account, announce = true) {
  if (announce) sessionEpoch++
  if (active && active.owner !== who.id) lockVisible()
  account.value = who
  nickname.value = who.nickname
  needsLogin.value = false
  try {
    await refreshLocal()
  } catch {
    await useMemory()
    await refreshLocal()
  }
  await refreshList()
  if (announce) channel?.postMessage('session-changed')
  void pump()
}
async function openRecord(row: LocalDraft, epoch = ++openingEpoch) {
  if (!account.value || row.ownerId !== account.value.id) return
  await writeChain
  if (account.value?.id !== row.ownerId || epoch !== openingEpoch) return
  suppressEdit = true
  selectedKey.value = row.key
  active = { key: row.key, seq: row.seq, owner: row.ownerId, cached: structuredClone(toRaw(row)) }
  title.value = row.title
  content.value = row.content
  savedAt.value = row.savedAt
  suppressEdit = false
  status.value = row.dirty || row.pending ? '本机有待同步文字。' : '已保存'
  message.value = ''
  void pump()
}
async function openServer(id: string) {
  if (!account.value) return
  const epoch = ++openingEpoch
  try {
    const owner = account.value.id
    const server = await syncAPI.read(id)
    if (account.value?.id !== owner || epoch !== openingEpoch) return
    await openRecord(await db.ensure(owner, server, workspaceId), epoch)
  } catch (error) {
    if (epoch === openingEpoch) message.value = describe(error)
  }
}
async function createDraft() {
  if (!account.value || creating.value) return
  creating.value = true
  const owner = account.value.id
  try {
    let id = createIds.get(owner)
    try {
      id = id ?? sessionStorage.getItem(`tako-create:${owner}`) ?? undefined
    } catch {
      /* Keep an in-memory ID if browser preferences are blocked. */
    }
    if (!id) id = crypto.randomUUID()
    createIds.set(owner, id)
    try {
      sessionStorage.setItem(`tako-create:${owner}`, id)
    } catch {
      /* Never replace this ID on a network retry. */
    }
    const ack = await request<Ack>('/drafts/create', 'POST', {
      mutation_id: id,
      title: '',
      content: '',
    })
    createIds.delete(owner)
    try {
      sessionStorage.removeItem(`tako-create:${owner}`)
    } catch {
      /* The server acknowledgement is already durable. */
    }
    if (account.value?.id !== owner) return
    await refreshList()
    await openServer(ack.draft_id)
  } catch (error) {
    message.value = describe(error)
  } finally {
    creating.value = false
  }
}
async function preparePublication() {
  await writeChain
  await pump(true)
  await writeChain
  if (!active || needsLogin.value) return
  const row = await db.get(active.key)
  if (
    !row ||
    row.dirty ||
    row.pending ||
    row.title !== title.value ||
    row.content !== content.value
  ) {
    message.value = '请先等待当前内容获得服务端保存确认，再准备发布。'
    return
  }
  await navigateTo({ path: '/publish', query: { draft: row.serverId, fresh: '1' } })
}
const publicationEnabled = String(useRuntimeConfig().public.publicationEnabled) === 'true'
async function setNickname() {
  try {
    const who = await request<Account>('/me', 'PATCH', { nickname: nickname.value })
    account.value = who
    message.value = '笔名已保存，可以开始写作。'
  } catch (error) {
    message.value = describe(error)
  }
}
watch(
  [title, content],
  ([nextTitle, nextContent]) => {
    if (suppressEdit || !active) return
    const session = active
    status.value = '正在本机暂存…'
    writeChain = writeChain
      .then(async () => {
        let row: LocalDraft
        try {
          row = await db.edit(
            session.key,
            session.owner,
            session.seq,
            nextTitle,
            nextContent,
            workspaceId,
            session.cached,
          )
        } catch {
          await useMemory()
          if (!(await db.get(session.key))) memoryFallback([session.cached])
          row = await db.edit(
            session.key,
            session.owner,
            session.seq,
            nextTitle,
            nextContent,
            workspaceId,
            session.cached,
          )
        }
        session.key = row.key
        session.seq = row.seq
        session.cached = structuredClone(row)
        if (active === session) {
          selectedKey.value = row.key
          status.value = memoryMode.value
            ? '仅此页面暂存，等待服务端同步。'
            : needsLogin.value
              ? '登录已过期，文字仅在本机暂存。'
              : '已在本机暂存，等待同步。'
        }
        storageOK.value = true
        await refreshLocal()
      })
      .catch(() => {
        storageOK.value = false
        message.value = '本机暂存失败。当前文字仍在页面中，请导出；不要关闭页面。'
        status.value = '本机保护失败'
      })
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      void pump()
    }, 2000)
  },
  { flush: 'sync' },
)
function showSync(result: SyncResult) {
  if (!active || !result.record || result.record.key !== active.key) return
  if (result.record.seq !== active.seq) {
    status.value = '另一窗口修改了草稿。当前文字未替换，继续输入将另存保护。'
    return
  }
  savedAt.value = result.record.savedAt
  active.cached = structuredClone(result.record)
  const labels = {
    saved: '已保存',
    pending: '结果尚未确认，本机文字已保留。',
    recovered: '发现另一处修改，双方文字已另存保留。',
    'login-required': '登录已过期，新增文字仅在此设备暂存。',
    'account-mismatch': '账号已变化，原账号文字未转移。',
    rejected: '暂不能同步，请检查内容或导出。',
    busy: '另一窗口正在同步，本机文字仍保留。',
  }
  status.value =
    result.record.dirty && result.state === 'saved' ? '仍有新输入等待同步。' : labels[result.state]
  if (result.state === 'rejected')
    message.value =
      result.errorCode === 'draft_too_large'
        ? '标题最多 200 字，正文最多 1 MiB。请先导出，再调整文字。'
        : `同步被拒绝，文字保留在本机。${result.requestId ? `参考编号：${result.requestId}` : ''}`
}
async function pump(force = false) {
  if (disposed || pumpBusy || !account.value || needsLogin.value || !storageOK.value) return
  pumpBusy = true
  const owner = account.value.id
  try {
    await writeChain
    let changed = false
    const entries = (await db.all(owner)).filter((x) => x.dirty || x.pending)
    for (const row of entries) {
      if (account.value?.id !== owner || needsLogin.value) break
      if (!force && stopped.get(row.key) === row.seq) continue
      const result = await syncOne(db, row.key, owner)
      if (account.value?.id !== owner) break
      showSync(result)
      if (result.state === 'saved' || result.state === 'recovered') changed = true
      if (result.state === 'login-required') {
        needsLogin.value = true
        break
      }
      if (result.state === 'account-mismatch') {
        needsLogin.value = true
        message.value = '会话账号发生变化，请重新登录；原账号草稿仍保留。'
        break
      }
      if (result.state === 'rejected') stopped.set(row.key, result.record?.seq ?? row.seq)
    }
    await refreshLocal()
    if (changed && account.value?.id === owner && !needsLogin.value) await refreshList()
  } catch (error) {
    message.value = describe(error)
    if (!(error instanceof APIError)) await useMemory()
  } finally {
    pumpBusy = false
    lastPump = Date.now()
  }
}
async function logout() {
  sessionEpoch++
  try {
    localStorage.setItem('tako-session-locked', '1')
  } catch {
    /* Best-effort browser UI lock; server Cookie remains authoritative. */
  }
  lockVisible()
  channel?.postMessage('logout')
  try {
    await request<void>('/auth/logout', 'POST', {})
  } catch {
    message.value = '此页面已退出；网络尚未确认服务端会话撤销。本机草稿没有删除。'
  }
}
function exportText() {
  const blob = new Blob([`${title.value}\n\n${content.value}`], {
    type: 'text/plain;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'Tako-草稿.txt'
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
async function loadSession() {
  const epoch = ++sessionEpoch
  try {
    if (localStorage.getItem('tako-session-locked')) {
      needsLogin.value = true
      return
    }
  } catch {
    /* May use this page without browser preferences. */
  }
  try {
    const who = await syncAPI.me()
    if (epoch === sessionEpoch) await signedIn(who, false)
  } catch (error) {
    if (epoch !== sessionEpoch) return
    needsLogin.value = true
    if (!(error instanceof APIError && error.status === 401)) message.value = describe(error)
  } finally {
    loading.value = false
  }
}
onMounted(async () => {
  if (!workspaceId) {
    message.value = '当前连接不支持安全写作。请通过 HTTPS 或 localhost 打开，再继续编辑。'
    loading.value = false
    return
  }
  const previous = existingFallback()
  if (previous) {
    db = previous
    memoryMode.value = true
  } else {
    persistentDB = new LocalDB()
    db = persistentDB
    try {
      await persistentDB.open()
    } catch {
      db = memoryFallback()
      memoryMode.value = true
    }
  }
  channel =
    typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('tako-session') : undefined
  if (channel)
    channel.onmessage = (event) => {
      if (event.data === 'logout') {
        sessionEpoch++
        lockVisible()
      } else if (event.data === 'session-changed') {
        void loadSession()
      }
    }
  await loadSession()
  loading.value = false
  timer = setInterval(() => {
    if (Date.now() - lastPump >= 10_000) void pump()
  }, 3000)
  window.addEventListener('online', online)
  window.addEventListener('storage', storageEvent)
})
function online() {
  void pump(true)
}
function storageEvent(event: StorageEvent) {
  if (event.key !== 'tako-session-locked') return
  if (event.newValue) {
    sessionEpoch++
    lockVisible()
  } else {
    void loadSession()
  }
}
onUnmounted(() => {
  disposed = true
  clearInterval(timer)
  if (saveTimer) clearTimeout(saveTimer)
  channel?.close()
  window.removeEventListener('online', online)
  window.removeEventListener('storage', storageEvent)
  void writeChain.finally(() => {
    const close = () => {
      if (pumpBusy) setTimeout(close, 50)
      else persistentDB?.close()
    }
    close()
  })
})
</script>

<template>
  <div class="app-page">
    <AppHeader
      ><template #account
        ><template v-if="account"
          ><NuxtLink to="/account" :title="account.nickname">{{
            account.nickname || '账号设置'
          }}</NuxtLink
          ><button class="text-button" type="button" @click="logout">退出登录</button></template
        ></template
      ></AppHeader
    >
    <main class="workspace">
      <p v-if="message" class="banner" role="alert">{{ message }}</p>
      <p v-if="memoryMode" class="banner" role="alert">
        浏览器本机存储不可用，服务端仍可保存。未同步文字仅在当前页面内存；刷新或关闭可能丢失，请及时同步或导出。
      </p>
      <div v-if="loading" class="empty">正在确认会话…</div>
      <template v-else>
        <section v-if="needsLogin && !active" class="login-wrap">
          <LoginPanel @signed-in="signedIn" />
        </section>
        <form
          v-if="account && !account.nickname && !needsLogin"
          class="nickname-card"
          @submit.prevent="setNickname"
        >
          <h2>你希望被怎样称呼？</h2>
          <label for="nickname">笔名</label>
          <div class="row">
            <input id="nickname" v-model="nickname" maxlength="64" required /><button
              class="primary"
            >
              保存笔名
            </button>
          </div>
          <p class="fine">可以重名，不需要真实姓名。</p>
        </form>
        <div v-if="account?.nickname || active" class="work-layout">
          <aside class="draft-sidebar">
            <div class="section-heading">
              <h2>我的草稿</h2>
              <button class="text-button" :disabled="needsLogin" @click="refreshList()">
                刷新
              </button>
            </div>
            <button
              class="primary full"
              :disabled="creating || needsLogin || !storageOK"
              @click="createDraft"
            >
              {{ creating ? '正在创建…' : '新建草稿' }}
            </button>
            <p v-if="!drafts.length" class="fine">还没有草稿，点击上方按钮新建。</p>
            <button
              v-for="item in drafts"
              :key="item.id"
              class="draft-item"
              @click="openServer(item.id)"
            >
              <strong>{{ item.title || '未命名草稿' }}</strong
              ><span
                >{{ new Date(item.saved_at).toLocaleDateString('zh-CN') }} · 修订
                {{ item.revision }}</span
              ></button
            ><button v-if="nextCursor" class="secondary full" @click="refreshList(true)">
              加载更多
            </button>
            <section v-if="localDrafts.length" class="local-list">
              <h3>本机待同步</h3>
              <button
                v-for="item in localDrafts"
                :key="item.key"
                class="draft-item"
                @click="openRecord(item)"
              >
                <strong>{{ item.title || '未命名草稿' }}</strong
                ><span>本机保留 · 点击继续</span>
              </button>
            </section>
          </aside>
          <section class="editor-panel">
            <template v-if="selectedKey"
              ><div class="editor-toolbar">
                <span role="status">{{ status }}</span>
                <div class="row">
                  <button
                    v-if="publicationEnabled"
                    class="text-button"
                    :disabled="needsLogin"
                    @click="preparePublication"
                  >
                    准备发布</button
                  ><button class="text-button" @click="exportText">导出文字</button
                  ><button class="secondary" :disabled="needsLogin" @click="pump(true)">
                    立即同步
                  </button>
                </div>
              </div>
              <label class="sr-only" for="draft-title">草稿标题</label
              ><input
                id="draft-title"
                v-model="title"
                class="title-input"
                placeholder="输入草稿标题"
              /><label class="sr-only" for="draft-content">草稿正文</label
              ><textarea
                id="draft-content"
                v-model="content"
                class="content-input"
                placeholder="从你的脑洞、故事或今天的日常开始。"
                spellcheck="false"
              />
              <div class="editor-foot">
                <span>{{ count }} 字</span
                ><span>{{
                  lastConfirmed ? `上次服务端确认：${lastConfirmed}` : '尚无服务端确认'
                }}</span>
              </div>
              <p class="fine">退出不会删除本机草稿。暂不支持完全断网时重新打开网站。</p></template
            >
            <div v-else class="empty editor-empty">
              <h2>选择草稿，继续写。</h2>
              <p>打开一份草稿，或新建一页。</p>
              <p class="fine">草稿不会公开发布。</p>
            </div>
            <LoginPanel v-if="needsLogin && active" compact @signed-in="signedIn" />
          </section>
        </div>
      </template>
    </main>
  </div>
</template>
