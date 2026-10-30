<script setup lang="ts">
import type { WorkCard } from '../lib/discovery'
defineProps<{ work: WorkCard }>()
</script>
<template>
  <article class="discovery-card">
    <p class="card-tags">
      <span v-for="tag in work.tags" :key="tag">{{ tag }}</span>
    </p>
    <h3>
      <NuxtLink :to="`/works/${work.id}`" :title="work.title">{{ work.title }}</NuxtLink>
    </h3>
    <p v-if="work.introduction" class="card-introduction">{{ work.introduction }}</p>
    <p v-else class="card-introduction card-no-intro">作者没有填写简介，打开读读正文。</p>
    <p class="card-author" :title="work.author_nickname">
      {{ work.author_nickname || '未命名作者' }}
    </p>
  </article>
</template>
<style scoped>
.discovery-card {
  min-width: 0;
  padding: 24px;
  border: 1px solid var(--color-line);
  border-radius: 6px;
  background: #fff;
}
.card-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  color: var(--color-muted);
  font-size: 12px;
  line-height: 20px;
  margin: 0 0 12px;
}
h3 {
  font-size: 20px;
  font-weight: 600;
  line-height: 28px;
  margin: 0 0 12px;
}
h3 a {
  color: var(--color-ink);
  text-decoration: none;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
}
h3 a:hover {
  color: var(--color-brand);
}
h3 a:focus-visible {
  outline: 2px solid var(--color-brand);
  outline-offset: 4px;
}
.card-introduction {
  min-height: 72px;
  font-size: 14px;
  line-height: 24px;
  margin: 0 0 24px;
  color: var(--color-ink);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
}
.card-no-intro {
  color: var(--color-muted);
}
.card-author {
  font-size: 12px;
  line-height: 20px;
  color: var(--color-muted);
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
@media (max-width: 767px) {
  .discovery-card {
    padding: 16px;
  }
  h3 {
    font-size: 16px;
    line-height: 24px;
  }
  .card-introduction {
    -webkit-line-clamp: 4;
    min-height: 96px;
    margin-bottom: 16px;
  }
}
</style>
