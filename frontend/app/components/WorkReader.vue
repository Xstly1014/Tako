<script setup lang="ts">
import type { PublicWork } from '../lib/publication'
const route = useRoute(),
  config = useRuntimeConfig()
const id = String(route.params.id ?? ''),
  number = route.params.number ? String(route.params.number) : ''
const valid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) &&
  (!number || (/^[1-9][0-9]*$/.test(number) && Number.isSafeInteger(Number(number))))
const path = `/api/works/${encodeURIComponent(id)}${number ? `/versions/${encodeURIComponent(number)}` : ''}`
if (import.meta.server) useResponseHeader('Cache-Control').value = 'no-store'
const { data: work, error } = await useAsyncData<PublicWork>(`work:${id}:${number}`, () => {
  if (!valid) throw createError({ statusCode: 404, message: '内容暂不可访问' })
  return $fetch<PublicWork>(import.meta.server ? `${config.publicationApiBase}${path}` : path)
})
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
  </main>
</template>
