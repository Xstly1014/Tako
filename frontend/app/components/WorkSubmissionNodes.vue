<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { request } from '../lib/api'
import type { NovelSchema } from '../lib/novel-operations'
const props = defineProps<{ workId: string; ownerId: string }>(),
  items = ref<NovelSchema<'WorkSubmission'>[]>([]),
  more = ref(false),
  error = ref(false)
let gen = 0,
  stop: (() => void) | undefined
const label = (s: string) => (s === 'pending' ? '待审核' : s === 'rejected' ? '已驳回' : '已撤回')
async function load() {
  const current = ++gen,
    work = props.workId,
    owner = props.ownerId
  try {
    const me = await request<{ id: string }>('/me')
    if (current !== gen || work !== props.workId || owner !== props.ownerId) return
    if (me.id !== owner) {
      items.value = []
      more.value = false
      return
    }
    const p = await request<NovelSchema<'WorkSubmissionPage'>>(
      '/my/work-submissions?work=' + encodeURIComponent(work),
    )
    if (current !== gen || work !== props.workId || owner !== props.ownerId) return
    items.value = p.items.filter((x) => !['published', 'superseded'].includes(x.state)).reverse()
    more.value = !!p.next_cursor
    error.value = false
  } catch {
    if (current === gen) error.value = true
  }
}
onMounted(() => {
  stop = watch(
    () => [props.workId, props.ownerId],
    () => {
      items.value = []
      more.value = false
      error.value = false
      void load()
    },
    { immediate: true },
  )
  window.addEventListener('focus', load)
})
onUnmounted(() => {
  gen++
  stop?.()
  window.removeEventListener('focus', load)
})
</script>
<template>
  <section v-if="items.length || more || error" class="submission-nodes">
    <p>待审与处理记录</p>
    <button v-if="error" @click="load">节点读取未完成，点击重试；原正式版不受影响。</button>
    <div class="node-strip">
      <template v-for="(item, i) in items" :key="item.id"
        ><span v-if="i" class="line" aria-hidden="true" /><NuxtLink
          :to="{ path: '/my-submissions', query: { work: workId, submission: item.id } }"
          :aria-label="'查看' + label(item.state) + '提交 ' + item.title"
          :title="label(item.state)"
          ><span class="dot" :class="item.state" /></NuxtLink
      ></template>
    </div>
    <p>待审核 / 已驳回 / 已撤回 · 点击节点核对固定内容</p>
    <NuxtLink v-if="more" :to="{ path: '/my-submissions', query: { work: workId } }"
      >更多提交记录</NuxtLink
    >
  </section>
</template>
<style scoped>
.submission-nodes {
  margin: 16px 0;
  min-width: 0;
}
.submission-nodes p {
  font-size: 12px;
  line-height: 20px;
  color: var(--color-muted);
  margin: 8px 0;
}
.node-strip {
  display: flex;
  align-items: center;
  overflow-x: auto;
  max-width: 100%;
}
.node-strip a {
  min-width: 44px;
  min-height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.node-strip a:focus-visible {
  outline: 2px solid var(--color-brand);
  outline-offset: -2px;
}
.line {
  height: 1px;
  min-width: 16px;
  background: var(--color-line);
}
.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--color-muted);
}
.dot.pending {
  background: #c18b20;
}
.dot.rejected {
  background: #b33939;
}
</style>
