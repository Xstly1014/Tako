<script setup lang="ts">
import { computed, ref } from 'vue'
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
const versionInfo = ref(false),
  showEvents = ref(false)
const selectedVersion = ref(work.value?.version)
const selectedEntry = computed(() =>
  timeline.value?.versions.find((v) => v.version === selectedVersion.value),
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
      <NuxtLink to="/" aria-label="Tako 首页"><TakoLogo /></NuxtLink
      ><NuxtLink to="/workspace">我的草稿</NuxtLink>
    </header>
    <section v-if="work" class="reader-paper">
      <header class="reader-work-heading">
        <div class="reader-meta">
          <span v-for="tag in work.tags" :key="tag">{{ tag }}</span>
        </div>
        <h1>{{ work.title }}</h1>
        <p class="reader-byline">{{ work.author_nickname }}</p>
      </header>
      <article class="publication-body">{{ work.content }}</article>
      <footer class="reader-footer">本次阅读保持当前加载内容；再次访问按最新权限判断。</footer>
    </section>
    <section v-else class="reader-unavailable">
      <h1>{{ status === 404 ? '内容暂不可访问' : '暂时无法读取内容' }}</h1>
      <p>可能尚未公开，或当前访问不可用。页面不提供隐藏及受限内容。</p>
      <NuxtLink v-if="number" :to="`/works/${id}`">尝试阅读当前版本</NuxtLink
      ><NuxtLink v-else to="/">返回首页</NuxtLink>
    </section>
    <section v-if="timeline" class="reader-timeline">
      <h2>版本记录</h2>
      <p class="fine">
        {{
          timeline.history_open
            ? '作者已开放正常历史版本阅读。'
            : '作者未开放历史正文；版本号和发布时间仍可查看。'
        }}
      </p>
      <p v-if="timelineNotice" class="fine" role="status">{{ timelineNotice }}</p>
      <VersionRail
        :versions="timeline.versions"
        :selected="selectedVersion"
        :displayed="timeline.versions.find((v) => v.is_current)?.version"
        :busy="timelineBusy"
        :more="!!timeline.next_version_before"
        @select="selectedVersion = $event"
        @load="moreTimeline('versions')"
      />
      <div v-if="selectedEntry" class="reader-version-detail">
        <p class="fine">
          {{
            selectedEntry.version === work?.version
              ? '正在阅读此版本'
              : selectedEntry.is_current
                ? '作者当前展示的版本'
                : '已选择历史版本'
          }}
        </p>
        <NuxtLink
          v-if="selectedEntry.readable && selectedEntry.version !== work?.version"
          :to="`/works/${id}/versions/${selectedEntry.version}`"
          >阅读所选版本</NuxtLink
        >
        <p v-else-if="!selectedEntry.readable" class="fine">历史正文未开放</p>
        <button
          class="text-button"
          :aria-expanded="versionInfo"
          @click="versionInfo = !versionInfo"
        >
          {{ versionInfo ? '收起版本信息' : '查看版本信息' }}
        </button>
        <div v-if="versionInfo" class="reader-version-info">
          <p class="fine">
            V{{ selectedEntry.version }} ·
            {{
              new Date(selectedEntry.published_at).toLocaleString('zh-CN', {
                timeZone: 'Asia/Shanghai',
              })
            }}
          </p>
        </div>
      </div>
      <div class="reader-event-details">
        <button class="text-button" :aria-expanded="showEvents" @click="showEvents = !showEvents">
          {{ showEvents ? '收起展示记录' : '查看展示记录' }}
        </button>
        <div v-if="showEvents">
          <p v-if="!timeline.events.length" class="fine">暂无展示调整记录。</p>
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
        </div>
      </div>
    </section>
  </main>
</template>

<style scoped>
.work-reader {
  max-width: 960px;
  padding: 0 32px 48px;
}
.work-reader .publication-header {
  height: 80px;
  margin: 0 0 32px;
}
.reader-paper,
.reader-timeline {
  background: #fff;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  padding: 32px 48px;
}
.reader-work-heading {
  margin-bottom: 32px;
}
.reader-meta {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.reader-meta span {
  font-size: 12px;
  color: var(--color-muted);
  margin: 0;
}
.reader-work-heading h1 {
  font-size: 28px;
  line-height: 1.5;
  font-weight: 600;
  margin: 0 0 12px;
  overflow-wrap: anywhere;
}
.reader-byline {
  font-size: 14px;
  color: var(--color-muted);
  margin: 0;
}
.publication-body {
  font-size: 16px;
  line-height: 1.9;
  color: var(--color-ink);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.reader-footer {
  font-size: 12px;
  color: var(--color-muted);
  line-height: 1.8;
  margin: 24px 0 0;
  padding: 16px 0 0;
  border-top: 1px solid var(--color-line);
}
.reader-timeline {
  margin: 24px 0 0;
  padding: 24px 48px;
}
.reader-timeline h2 {
  font-size: 16px;
  line-height: 24px;
  font-weight: 600;
  margin: 0 0 8px;
}
.reader-timeline > .fine {
  margin: 0;
  font-size: 12px;
}
.reader-version-detail {
  margin: 24px 0 0;
  padding-top: 16px;
  border-top: 1px solid var(--color-line);
}
.reader-version-detail > .fine {
  margin: 0 0 8px;
}
.reader-version-detail > a {
  display: inline-block;
  color: var(--color-brand);
  font-size: 14px;
  margin: 0 16px 8px 0;
}
.reader-version-detail > .text-button,
.reader-event-details > .text-button {
  display: block;
  font-size: 12px;
  padding: 8px 0;
  color: var(--color-muted);
}
.reader-version-info {
  padding: 8px 0;
}
.reader-version-info p {
  margin: 0;
}
.reader-event-details {
  margin: 12px 0 0;
}
.reader-change {
  font-size: 12px;
  color: var(--color-muted);
  margin: 8px 0;
}
.reader-unavailable {
  background: white;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  padding: 32px;
}
.reader-unavailable h1 {
  font-size: 24px;
  font-weight: 600;
}
.reader-unavailable p {
  font-size: 14px;
  line-height: 1.8;
}
.reader-unavailable a {
  font-size: 14px;
  color: var(--color-brand);
}
@media (max-width: 767px) {
  .work-reader {
    padding: 0 16px 32px;
  }
  .work-reader .publication-header {
    height: 72px;
    margin-bottom: 24px;
  }
  .reader-paper {
    padding: 24px;
  }
  .reader-work-heading {
    margin-bottom: 24px;
  }
  .reader-work-heading h1 {
    font-size: 24px;
  }
  .publication-body {
    font-size: 16px;
  }
  .reader-timeline {
    padding: 24px;
  }
  .reader-footer {
    font-size: 12px;
  }
}
</style>
