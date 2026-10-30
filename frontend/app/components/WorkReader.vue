<script setup lang="ts">
import { ref } from 'vue'
import { request } from '../lib/api'
import type { PublicWork, PublicTimeline } from '../lib/publication'
const route = useRoute(),
  config = useRuntimeConfig()
const id = String(route.params.id ?? ''),
  number = route.params.number ? String(route.params.number) : ''
const valid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) &&
  (!number || (/^[1-9][0-9]*$/.test(number) && Number.isSafeInteger(Number(number))))
const path = `/api/works/${encodeURIComponent(id)}${number ? `/versions/${encodeURIComponent(number)}` : ''}`
if (import.meta.server) useResponseHeader('Cache-Control').value = 'no-store'
const { data: work, error } = await useAsyncData<PublicWork>(
  `work:${id}:${number}`,
  () => {
    if (!valid) throw createError({ statusCode: 404, message: '内容暂不可访问' })
    return $fetch<PublicWork>(import.meta.server ? `${config.publicationApiBase}${path}` : path)
  },
  { getCachedData: () => undefined },
)
const { data: timeline } = await useAsyncData<PublicTimeline>(
  `timeline:${id}`,
  () =>
    $fetch<PublicTimeline>(
      import.meta.server
        ? `${config.publicationApiBase}/api/works/${encodeURIComponent(id)}/timeline`
        : `/api/works/${encodeURIComponent(id)}/timeline`,
    ),
  { getCachedData: () => undefined },
)
const timelineBusy = ref(false),
  timelineNotice = ref('')
async function moreTimeline(kind: 'versions' | 'events') {
  if (!timeline.value || timelineBusy.value) return
  const beforeVersion = kind === 'versions' ? timeline.value.next_version_before : 0
  const beforeEvent = kind === 'events' ? timeline.value.next_event_before : 0
  if (!(beforeVersion || beforeEvent)) return
  timelineBusy.value = true
  try {
    const next = await request<PublicTimeline>(
      `/works/${encodeURIComponent(id)}/timeline?before_version=${beforeVersion}&before_event=${beforeEvent}`,
    )
    if (next.history_open !== timeline.value.history_open) {
      timeline.value = await request<PublicTimeline>(`/works/${encodeURIComponent(id)}/timeline`)
      timelineNotice.value = '历史阅读设置已变化，已更新版本列表；当前正文未替换。'
      return
    }
    if (kind === 'versions') {
      timeline.value.versions.push(...next.versions)
      timeline.value.next_version_before = next.next_version_before
    } else {
      timeline.value.events.push(...next.events)
      timeline.value.next_event_before = next.next_event_before
    }
  } catch {
    timelineNotice.value = '版本列表暂不可继续读取。当前已加载正文保持不变。'
  } finally {
    timelineBusy.value = false
  }
}
const status = error.value?.statusCode === 404 ? 404 : 503
if (import.meta.server && error.value) {
  const event = useRequestEvent()
  if (event) setResponseStatus(event, status)
}
useHead(() => ({
  title: work.value ? `${work.value.title} · Tako` : '内容暂不可访问 · Tako',
  meta: [
    { name: 'robots', content: 'noindex,nofollow,noarchive' },
    { name: 'description', content: work.value?.introduction ?? '' },
  ],
}))
</script>
<template>
  <main class="work-reader">
    <header class="publication-header">
      <NuxtLink to="/">tako</NuxtLink><NuxtLink to="/workspace">我的草稿</NuxtLink>
    </header>
    <template v-if="work"
      ><div class="reader-meta">
        <span v-for="tag in work.tags" :key="tag">{{ tag }}</span>
      </div>
      <h1>{{ work.title }}</h1>
      <p class="reader-byline">
        {{ work.author_nickname }} · V{{ work.version }} ·
        {{ new Date(work.published_at).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' }) }}
      </p>
      <article class="publication-body">{{ work.content }}</article>
      <footer class="reader-footer">
        本次阅读保持当前加载内容；再次访问按最新权限判断。
      </footer></template
    >
    <section v-else class="reader-unavailable">
      <h1>{{ status === 404 ? '内容暂不可访问' : '暂时无法读取内容' }}</h1>
      <p>可能尚未公开，或当前访问不可用。页面不提供隐藏及受限内容。</p>
      <NuxtLink v-if="number" :to="`/works/${id}`">尝试阅读当前版本</NuxtLink
      ><NuxtLink v-else to="/">返回首页</NuxtLink>
    </section>
    <section v-if="timeline" class="reader-timeline">
      <h2>版本时间线</h2>
      <p class="fine">
        {{
          timeline.history_open
            ? '作者已开放正常历史版本阅读。'
            : '作者未开放历史正文；版本号和发布时间仍可查看。'
        }}
      </p>
      <p v-if="timelineNotice" class="fine" role="status">{{ timelineNotice }}</p>
      <div v-for="version in timeline.versions" :key="version.version" class="reader-version">
        <div>
          V{{ version.version }} <span v-if="version.is_current">当前展示</span
          ><span>
            ·
            {{
              new Date(version.published_at).toLocaleDateString('zh-CN', {
                timeZone: 'Asia/Shanghai',
              })
            }}</span
          >
        </div>
        <NuxtLink v-if="version.readable" :to="`/works/${id}/versions/${version.version}`"
          >阅读 V{{ version.version }}</NuxtLink
        ><span v-else>历史正文未开放</span>
      </div>
      <button
        v-if="timeline.next_version_before"
        class="text-button"
        :disabled="timelineBusy"
        @click="moreTimeline('versions')"
      >
        更多版本
      </button>
      <p v-for="event in timeline.events" :key="event.sequence" class="reader-change">
        {{ event.kind === 'restored' ? '恢复公开并展示' : '切换展示至' }} V{{ event.version }} ·
        {{ new Date(event.created_at).toLocaleString('zh-CN') }}
      </p>
      <button
        v-if="timeline.next_event_before"
        class="text-button"
        :disabled="timelineBusy"
        @click="moreTimeline('events')"
      >
        更多展示记录
      </button>
    </section>
  </main>
</template>
