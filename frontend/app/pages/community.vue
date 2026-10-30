<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { request } from '../lib/api'
import type { DiscoveryPage, WorkCard } from '../lib/discovery'
const route = useRoute(),
  config = useRuntimeConfig()
const tag = computed(() => (typeof route.query.tag === 'string' ? route.query.tag : ''))
const endpoint = computed(
  () => `/api/community${tag.value ? `?tag=${encodeURIComponent(tag.value)}` : ''}`,
)
if (import.meta.server) useResponseHeader('Cache-Control').value = 'no-store'
const { data, error, status, refresh } = await useAsyncData<DiscoveryPage>(
  computed(() => `community:${tag.value}`),
  () =>
    $fetch<DiscoveryPage>(
      import.meta.server ? `${config.publicationApiBase}${endpoint.value}` : endpoint.value,
    ),
  { getCachedData: () => undefined },
)
const items = ref<WorkCard[]>(data.value?.items ?? []),
  next = ref(data.value?.next_cursor ?? '')
const moreBusy = ref(false),
  notice = ref('')
let epoch = 0
watch(data, (value) => {
  epoch++
  items.value = value?.items ?? []
  next.value = value?.next_cursor ?? ''
  notice.value = ''
  moreBusy.value = false
})
watch(tag, () => {
  epoch++
  items.value = []
  next.value = ''
  notice.value = ''
  moreBusy.value = false
})
async function more() {
  if (moreBusy.value || !next.value) return
  const current = epoch,
    currentTag = tag.value,
    cursor = next.value
  moreBusy.value = true
  notice.value = ''
  try {
    const page = await request<DiscoveryPage>(
      `/community?cursor=${encodeURIComponent(cursor)}${currentTag ? `&tag=${encodeURIComponent(currentTag)}` : ''}`,
    )
    if (epoch !== current || tag.value !== currentTag) return
    const seen = new Set(items.value.map((work) => work.id))
    items.value.push(...page.items.filter((work) => !seen.has(work.id)))
    next.value = page.next_cursor
  } catch {
    if (epoch === current) notice.value = '未能加载后续作品，已加载内容仍保留，请重试。'
  } finally {
    if (epoch === current) moreBusy.value = false
  }
}
if (import.meta.server && error.value) {
  const event = useRequestEvent()
  if (event) setResponseStatus(event, error.value.statusCode === 400 ? 400 : 503)
}
useHead({ title: '社区 · Tako', meta: [{ name: 'robots', content: 'noindex,nofollow,noarchive' }] })
</script>
<template>
  <div class="app-page">
    <AppHeader />
    <main class="community-page">
      <header class="community-heading">
        <div>
          <h1>社区</h1>
          <p>故事、脑洞和日常，看看大家在写什么。</p>
        </div>
        <NuxtLink to="/workspace" class="primary">开始创作</NuxtLink>
      </header>
      <section v-if="error" class="community-error" role="alert">
        <h2>暂时无法浏览作品</h2>
        <p>
          {{
            error.statusCode === 400
              ? '这个标签或分页地址不可用，请回到全部作品。'
              : '作品列表未能加载，请稍后重试。'
          }}
        </p>
        <NuxtLink v-if="tag" to="/community">查看全部作品</NuxtLink
        ><button type="button" class="secondary" @click="refresh()">重新加载</button>
      </section>
      <div v-else-if="status === 'pending' && !data" class="community-loading" role="status">
        正在加载作品…
      </div>
      <template v-else-if="data">
        <div class="community-top">
          <aside class="community-styles">
            <h2>按风格找</h2>
            <nav aria-label="作品风格">
              <NuxtLink to="/community" :aria-current="!tag ? 'page' : undefined">全部作品</NuxtLink
              ><NuxtLink
                v-for="item in data.tags"
                :key="item.name"
                :to="{ path: '/community', query: { tag: item.name } }"
                :aria-current="tag === item.name ? 'page' : undefined"
                ><span>{{ item.name }}</span
                ><span class="tag-count">{{ item.count }}</span></NuxtLink
              >
            </nav>
            <p v-if="!data.tags.length" class="fine">有公开作品后，这里会显示它们的风格。</p>
          </aside>
          <section class="community-featured" aria-labelledby="featured-heading">
            <header>
              <h2 id="featured-heading">人工精选</h2>
              <p>运营选读 · 不限风格</p>
            </header>
            <div
              v-if="data.featured.length"
              class="featured-grid"
              :class="{ 'is-single': data.featured.length === 1 }"
            >
              <DiscoveryCard v-for="work in data.featured" :key="work.id" :work="work" />
            </div>
            <div v-else class="section-empty">
              <p>还没有选入的作品。</p>
              <p>先看看下方的新作，也欢迎发布你的第一篇。</p>
            </div>
          </section>
        </div>
        <section class="community-latest" aria-labelledby="latest-heading">
          <header>
            <div>
              <h2 id="latest-heading">{{ tag ? `${tag} · 最新发布` : '最新发布' }}</h2>
              <p>按首次发布时间排序</p>
            </div>
            <NuxtLink v-if="tag" to="/community">查看全部</NuxtLink>
          </header>
          <div v-if="items.length" class="latest-grid" :class="{ 'is-small': items.length < 3 }">
            <DiscoveryCard v-for="work in items" :key="work.id" :work="work" />
          </div>
          <div v-else class="section-empty">
            <h3>{{ tag ? '这个风格还没有可读作品' : '第一篇故事，等你来写' }}</h3>
            <p>目前没有公开作品。发布后，其他人就能在这里找到它。</p>
            <NuxtLink to="/workspace">去写作空间</NuxtLink>
          </div>
          <p v-if="notice" role="status">{{ notice }}</p>
          <button
            v-if="next"
            type="button"
            class="secondary load-more"
            :disabled="moreBusy"
            @click="more"
          >
            {{ moreBusy ? '加载中…' : '加载更多作品' }}
          </button>
        </section>
      </template>
    </main>
  </div>
</template>
<style scoped>
.community-page {
  max-width: 1280px;
  margin: 0 auto;
  padding: 32px 24px 48px;
}
.community-heading,
section > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
}
.community-heading {
  margin-bottom: 32px;
}
h1 {
  font-size: 28px;
  line-height: 36px;
  font-weight: 600;
  margin: 0 0 8px;
}
h2 {
  font-size: 20px;
  line-height: 28px;
  font-weight: 600;
  margin: 0;
}
.community-heading p,
section > header p {
  margin: 8px 0 0;
  font-size: 14px;
  line-height: 24px;
  color: var(--color-muted);
}
.community-top {
  display: grid;
  grid-template-columns: 192px minmax(0, 1fr);
  gap: 32px;
  align-items: start;
  margin-bottom: 48px;
}
.community-styles h2 {
  margin-bottom: 16px;
}
.community-styles nav {
  display: grid;
  gap: 4px;
}
.community-styles a {
  display: flex;
  justify-content: space-between;
  padding: 8px 12px;
  color: var(--color-ink);
  font-size: 14px;
  border-radius: 4px;
  text-decoration: none;
}
.community-styles a:hover {
  background: #eef0f3;
}
.community-styles a[aria-current] {
  color: var(--color-brand);
  background: #eef2ff;
  font-weight: 600;
}
.tag-count {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--color-muted);
}
.featured-grid,
.latest-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}
.featured-grid.is-single,
.latest-grid.is-small {
  grid-template-columns: 1fr;
}
.featured-grid.is-single :deep(.card-introduction) {
  min-height: 0;
  max-width: 640px;
}
.featured-grid.is-single :deep(h3) {
  font-size: 24px;
  line-height: 32px;
}
.latest-grid.is-small :deep(.discovery-card) {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 160px);
  gap: 12px 24px;
}
.latest-grid.is-small :deep(.card-tags) {
  grid-column: 1;
  margin: 0;
}
.latest-grid.is-small :deep(.card-author) {
  grid-column: 2;
  grid-row: 1;
  text-align: right;
}
.latest-grid.is-small :deep(h3) {
  grid-column: 1 / -1;
  margin: 0;
}
.latest-grid.is-small :deep(.card-introduction) {
  grid-column: 1 / -1;
  min-height: 0;
  margin: 0;
}
.community-featured > header,
.community-latest > header {
  margin-bottom: 24px;
}
.community-featured > header p {
  margin: 0;
}
.section-empty {
  background: #fff;
  border: 1px solid var(--color-line);
  border-radius: 6px;
  padding: 32px;
}
.section-empty p {
  font-size: 14px;
  line-height: 24px;
  color: var(--color-muted);
  margin: 0 0 8px;
}
.section-empty h3 {
  font-size: 20px;
  font-weight: 600;
  margin: 0 0 16px;
}
.community-error {
  padding: 32px;
  background: #fff;
  border: 1px solid var(--color-line);
}
.community-error button {
  margin-top: 16px;
}
.load-more {
  display: block;
  margin: 24px auto 0;
}
.community-heading .primary {
  font-size: 14px;
  padding: 12px 24px;
  flex: none;
  text-decoration: none;
}
@media (min-width: 768px) and (max-width: 1024px) {
  .community-top {
    grid-template-columns: 160px minmax(0, 1fr);
    gap: 24px;
  }
  .featured-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 767px) {
  .community-page {
    padding: 24px 16px 32px;
  }
  .community-heading {
    gap: 16px;
    align-items: flex-start;
    margin-bottom: 24px;
  }
  h1 {
    font-size: 24px;
    line-height: 32px;
  }
  .community-heading p {
    font-size: 12px;
    line-height: 20px;
  }
  .community-heading .primary {
    padding: 8px 12px;
  }
  .community-top {
    display: block;
    margin-bottom: 32px;
  }
  .community-styles {
    margin-bottom: 24px;
  }
  .community-styles h2 {
    display: none;
  }
  .community-styles nav {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .community-styles a {
    gap: 8px;
    padding: 8px;
  }
  .featured-grid,
  .latest-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }
  .section-empty {
    padding: 24px;
  }
  .community-featured > header,
  .community-latest > header {
    margin-bottom: 16px;
  }
}
</style>
