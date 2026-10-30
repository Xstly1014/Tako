<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { APIError, request } from '../../lib/api'
import type { Account } from '../../lib/types'
import type { CurationCandidate, CurationChange, CurationState } from '../../lib/discovery'
useHead({
  title: '精选编排 · Tako',
  meta: [{ name: 'robots', content: 'noindex,nofollow,noarchive' }],
})
const state = ref<CurationState | null>(null),
  candidate = ref<CurationCandidate | null>(null)
const input = ref(''),
  slot = ref(1),
  busy = ref(false),
  notice = ref(''),
  loading = ref(true)
const pending = ref<CurationChange | null>(null),
  confirmation = ref<CurationChange | null>(null)
let owner = ''
const key = () => `tako-curation:${owner}`
function message(error: unknown) {
  if (!(error instanceof APIError)) return '操作未完成，请稍后重试。'
  const messages: Record<string, string> = {
    operator_required: '当前账号没有运营权限。',
    authentication_required: '登录已过期，请先登录。',
    resource_not_found: '这篇作品当前不可公开，不能选入精选。',
    invalid_input: '作品链接或操作参数不正确，请检查。',
    curation_conflict: '编排已被其他操作更新，请重新加载后选择。',
    work_state_conflict: '作品已修改或改变公开状态，请重新检查候选作品。',
    mutation_id_reused: '操作标识已用于不同内容，请重新加载后检查原操作。',
    network_unconfirmed: '网络未确认结果。请检查原操作，不要重新创建编排请求。',
  }
  return (
    (messages[error.code] ?? '结果暂未确认，可以检查原操作。') +
    (error.requestId ? ` 参考编号：${error.requestId}` : '')
  )
}
function keepPending(value: CurationChange | null) {
  pending.value = value
  try {
    if (value) sessionStorage.setItem(key(), JSON.stringify(value))
    else sessionStorage.removeItem(key())
  } catch {
    /* Original request still retained in page memory. */
  }
}
async function reload() {
  if (busy.value) return
  loading.value = true
  notice.value = ''
  state.value = null
  candidate.value = null
  confirmation.value = null
  try {
    const me = await request<Account>('/me')
    if (owner && me.id !== owner) {
      pending.value = null
    }
    owner = me.id
    state.value = await request<CurationState>('/ops/curation')
    try {
      const previous = sessionStorage.getItem(key())
      if (previous) pending.value = JSON.parse(previous)
    } catch {
      pending.value = null
    }
  } catch (error) {
    notice.value = message(error)
  } finally {
    loading.value = false
  }
}
watch(input, () => {
  candidate.value = null
  confirmation.value = null
})
watch(slot, () => {
  confirmation.value = null
})
async function inspect() {
  if (busy.value || pending.value) return
  const text = input.value.trim()
  const id = text.match(/^(?:https?:\/\/[^/]+)?\/works\/([0-9a-f-]{36})\/?$/i)?.[1] ?? text
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    notice.value = '请输入完整作品链接或作品 ID。'
    return
  }
  busy.value = true
  notice.value = ''
  candidate.value = null
  try {
    candidate.value = await request<CurationCandidate>(`/ops/curation/${id}`)
  } catch (error) {
    notice.value = message(error)
  } finally {
    busy.value = false
  }
}
function prepare(targetSlot: number, clear = false) {
  if (busy.value || pending.value || !state.value || (!clear && !candidate.value)) return
  notice.value = ''
  confirmation.value = {
    mutation_id: crypto.randomUUID(),
    expected_revision: state.value.revision,
    slot: targetSlot,
    work_id: clear ? null : candidate.value!.work.id,
    expected_work_revision: clear ? 0 : candidate.value!.state_revision,
  }
}
async function execute() {
  const action = pending.value ?? confirmation.value
  if (busy.value || !action) return
  busy.value = true
  notice.value = ''
  let confirmed = false
  try {
    const me = await request<Account>('/me')
    if (me.id !== owner) {
      state.value = null
      candidate.value = null
      pending.value = null
      confirmation.value = null
      notice.value = '账号已变化，请重新加载后操作。'
      return
    }
    keepPending(action)
    confirmation.value = null
    await request<{ revision: number }>('/ops/curation', 'POST', action)
    confirmed = true
    keepPending(null)
    state.value = await request<CurationState>('/ops/curation')
    candidate.value = null
    input.value = ''
    notice.value = '原操作已确认，已刷新当前编排。'
  } catch (error) {
    notice.value = confirmed ? '原操作已确认，但当前编排读取失败，请重新加载查看。' : message(error)
    if (confirmed) state.value = null
    if (error instanceof APIError && error.status >= 400 && error.status < 500) {
      keepPending(null)
      confirmation.value = null
      candidate.value = null
      state.value = null
    }
  } finally {
    busy.value = false
  }
}
onMounted(reload)
</script>
<template>
  <div class="app-page">
    <AppHeader />
    <main class="curation-page">
      <header class="curation-heading">
        <div>
          <h1>精选编排</h1>
          <p>选择当前公开作品。隐藏或受限后撤出，恢复需要重新选入。</p>
        </div>
        <button type="button" class="secondary" :disabled="busy || !!pending" @click="reload">
          重新加载
        </button>
      </header>
      <p v-if="loading" role="status">正在加载编排…</p>
      <p v-if="notice" role="status" class="notice">{{ notice }}</p>
      <div v-if="state" class="curation-layout">
        <section class="curation-slots" aria-label="精选位置">
          <h2>当前精选</h2>
          <ol>
            <li v-for="item in state.slots" :key="item.slot">
              <span class="slot-number">{{ item.slot }}</span>
              <div>
                <NuxtLink v-if="item.work" :to="`/works/${item.work.id}`">{{
                  item.work.title
                }}</NuxtLink
                ><span v-else>{{ item.work_id ? '已撤出，需重新选入' : '空位' }}</span>
                <p v-if="item.work" class="fine">{{ item.work.author_nickname }}</p>
              </div>
              <button
                v-if="item.work_id"
                type="button"
                class="text-button"
                :disabled="busy || !!pending"
                @click="prepare(item.slot, true)"
              >
                清空
              </button>
            </li>
          </ol>
        </section>
        <section class="curation-editor">
          <h2>选入作品</h2>
          <form @submit.prevent="inspect">
            <label for="curation-work">作品链接或 ID</label
            ><input
              id="curation-work"
              v-model="input"
              required
              :disabled="busy || !!pending"
            /><button type="submit" class="secondary" :disabled="busy || !!pending">
              检查作品
            </button>
          </form>
          <template v-if="candidate"
            ><DiscoveryCard :work="candidate.work" /><label for="curation-slot">放入位置</label
            ><select id="curation-slot" v-model.number="slot" :disabled="busy || !!pending">
              <option v-for="number in 6" :key="number" :value="number">
                第 {{ number }} 位
              </option></select
            ><button type="button" :disabled="busy || !!pending" @click="prepare(slot)">
              选入精选
            </button></template
          >
          <section
            v-if="confirmation"
            class="curation-confirmation"
            role="alertdialog"
            aria-labelledby="curation-confirm-heading"
          >
            <h3 id="curation-confirm-heading">
              {{ confirmation.work_id ? '确认精选位置' : '确认清空位置' }}
            </h3>
            <p>
              第 {{ confirmation.slot }} 位{{
                confirmation.work_id
                  ? `将展示《${candidate?.work.title}》。同作品的原位置会清空。`
                  : '将不再展示作品。'
              }}
            </p>
            <p v-if="confirmation.work_id && state.slots[confirmation.slot - 1]?.work">
              将替换《{{ state.slots[confirmation.slot - 1]?.work?.title }}》。
            </p>
            <div class="curation-buttons">
              <button type="button" :disabled="busy" @click="execute">
                {{ busy ? '处理中…' : confirmation.work_id ? '确认选入' : '确认清空' }}</button
              ><button
                type="button"
                class="secondary"
                :disabled="busy"
                @click="confirmation = null"
              >
                取消
              </button>
            </div>
          </section>
        </section>
      </div>
      <section v-if="pending" class="curation-confirmation">
        <h2>有一项操作结果未确认</h2>
        <p>检查会沿用原请求，不会重复编排，也不会自动把已撤出的作品重新选入。</p>
        <button type="button" :disabled="busy" @click="execute">检查原操作</button>
      </section>
      <NuxtLink to="/community" class="curation-back">返回社区查看</NuxtLink>
    </main>
  </div>
</template>
<style scoped>
.curation-page {
  max-width: 1280px;
  margin: 0 auto;
  padding: 32px 24px 48px;
}
.curation-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 32px;
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
  font-weight: 600;
  margin: 0 0 24px;
}
h3 {
  font-size: 16px;
  font-weight: 600;
}
p {
  font-size: 14px;
  line-height: 24px;
  color: var(--color-muted);
  margin: 0;
}
.curation-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 32px;
}
.curation-slots,
.curation-editor {
  min-width: 0;
  background: #fff;
  border: 1px solid var(--color-line);
  border-radius: 6px;
  padding: 24px;
}
ol {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 24px;
}
li {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  min-width: 0;
}
li > div {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.slot-number {
  font-variant-numeric: tabular-nums;
  color: var(--color-muted);
}
form {
  display: grid;
  gap: 16px;
  margin-bottom: 24px;
}
input,
select {
  width: 100%;
}
form button {
  justify-self: start;
}
.curation-editor > label {
  display: block;
  margin-top: 24px;
}
select {
  margin-bottom: 16px;
}
.curation-confirmation {
  border: 1px solid var(--color-line);
  border-radius: 6px;
  padding: 24px;
  margin-top: 24px;
  background: #fff;
}
.curation-buttons {
  display: flex;
  gap: 16px;
  margin-top: 16px;
}
.curation-back {
  display: inline-block;
  margin-top: 32px;
}
@media (max-width: 767px) {
  .curation-page {
    padding: 24px 16px 32px;
  }
  .curation-layout {
    grid-template-columns: 1fr;
    gap: 24px;
  }
  .curation-heading {
    gap: 16px;
  }
  h1 {
    font-size: 24px;
  }
}
</style>
