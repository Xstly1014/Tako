<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { APIError, request } from '../lib/api'
import type { Account } from '../lib/types'
const route = useRoute(),
  config = useRuntimeConfig()
const environment = String(config.public.environment)
const environmentLabel =
  environment === 'test'
    ? '测试环境 · 合成数据，仅供验收'
    : environment === 'production'
      ? '正式环境 · 私有访问'
      : '开发环境 · 原有数据'
const publishing = String(config.public.publicationEnabled) === 'true'
const logoutBusy = ref(false), logoutNotice = ref('')
async function logout() {
  if (logoutBusy.value) return
  logoutBusy.value = true
  logoutNotice.value = ''
  try {
    await request<void>('/auth/logout', 'POST', {})
    try { localStorage.setItem('tako-session-locked', '1') } catch { /* Server session was revoked. */ }
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel('tako-session')
      channel.postMessage('logout')
      channel.close()
    }
    window.location.assign('/workspace')
  } catch {
    logoutBusy.value = false
    logoutNotice.value = '未能确认退出，请重试。'
  }
}
const expanded = ref(false),
  account = ref<Account | null>(null),
  operator = ref(false),
  anonymous = ref(false)
let epoch = 0,
  disposed = false
async function load() {
  const current = ++epoch
  account.value = null
  operator.value = false
  anonymous.value = false
  try {
    const me = await request<Account>('/me')
    if (disposed || current !== epoch) return
    account.value = me
    const access = await request<{ operator: boolean }>('/me/access')
    if (!disposed && current === epoch) operator.value = access.operator
  } catch (error) {
    if (!disposed && current === epoch)
      anonymous.value = error instanceof APIError && error.status === 401
  }
}
watch(
  () => route.fullPath,
  () => {
    expanded.value = false
    void load()
  },
)
onMounted(() => {
  void load()
  window.addEventListener('focus', load)
})
onUnmounted(() => {
  disposed = true
  epoch++
  window.removeEventListener('focus', load)
})
</script>
<template>
  <div class="environment-indicator" :class="{ 'is-test': environment === 'test' }" role="note">
    {{ environmentLabel }}
  </div>
  <header class="app-header">
    <NuxtLink :to="publishing ? '/community' : '/'" class="app-brand" aria-label="Tako 首页"
      ><TakoLogo
    /></NuxtLink>
    <button
      type="button"
      class="app-menu-toggle"
      aria-controls="app-navigation"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      {{ expanded ? '收起菜单' : '菜单' }}
    </button>
    <div id="app-navigation" class="app-navigation" :class="{ 'is-expanded': expanded }">
      <nav class="app-main-nav" aria-label="主导航">
        <NuxtLink v-if="publishing" to="/community">社区</NuxtLink>
        <NuxtLink to="/workspace">写作空间</NuxtLink>
        <NuxtLink v-if="publishing" to="/my-works">作品管理</NuxtLink>
      </nav>
      <nav class="app-account-nav" aria-label="账号导航">
        <NuxtLink to="/">官网</NuxtLink>
        <slot name="account">
          <NuxtLink v-if="account" to="/account" :title="account.nickname || '账号设置'">{{
            account.nickname || '账号设置'
          }}</NuxtLink>
          <NuxtLink v-else :to="anonymous ? '/workspace' : '/account'">{{
            anonymous ? '登录 / 注册' : '账号'
          }}</NuxtLink>
        </slot>
        <button v-if="account && !$slots.account" type="button" class="app-logout" :disabled="logoutBusy" @click="logout">{{ logoutBusy ? '正在退出…' : '退出登录' }}</button>
        <span v-if="logoutNotice" role="alert">{{ logoutNotice }}</span>
        <details v-if="account && publishing" class="app-extra-menu">
          <summary>更多</summary>
          <div>
            <NuxtLink to="/moderation">处理结果</NuxtLink>
            <template v-if="operator"
              ><NuxtLink to="/ops/reviews">内容治理</NuxtLink
              ><NuxtLink to="/ops/curation">精选编排</NuxtLink></template
            >
          </div>
        </details>
      </nav>
    </div>
  </header>
</template>
<style scoped>
.environment-indicator {
  max-width: 1280px;
  margin: 0 auto;
  padding: 4px 24px;
  box-sizing: border-box;
  font-size: 12px;
  line-height: 20px;
  min-height: 28px;
  color: var(--color-muted);
  background: #f1f2f3;
}
.environment-indicator.is-test {
  color: #6a5419;
  background: #fff7df;
}
@media (max-width: 767px) {
  .environment-indicator {
    padding: 4px 16px;
  }
}
.app-header {
  position: relative;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 32px;
  width: 100%;
  max-width: 1280px;
  height: 80px;
  margin: 0 auto;
  padding: 0 24px;
  border-bottom: 1px solid var(--color-line);
  box-sizing: border-box;
}
.app-brand {
  flex: none;
  display: flex;
  align-items: center;
}
.app-navigation {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  min-width: 0;
}
nav {
  display: flex;
  gap: 24px;
  align-items: center;
  font-size: 14px;
}
nav a {
  color: var(--color-muted);
  padding: 8px 0;
  text-decoration: none;
}
nav a:hover {
  color: var(--color-ink);
}
nav a.router-link-exact-active {
  color: var(--color-ink);
  font-weight: 600;
}
.app-account-nav {
  margin-left: auto;
}
.app-logout {
  padding: 8px 0;
  color: var(--color-muted);
  background: transparent;
  border: 0;
  font-size: 14px;
  white-space: nowrap;
}
.app-logout:hover { color: var(--color-ink); }
.app-logout:disabled { opacity: .5; cursor: wait; }
.app-account-nav > a {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.app-extra-menu {
  position: relative;
}
summary {
  cursor: pointer;
  color: var(--color-muted);
  padding: 8px 0;
}
.app-extra-menu > div {
  position: absolute;
  right: 0;
  top: 40px;
  display: grid;
  min-width: 144px;
  padding: 8px 16px;
  background: #fff;
  border: 1px solid var(--color-line);
  border-radius: 6px;
}
.app-menu-toggle {
  display: none;
}
:is(a, button, summary):focus-visible {
  outline: 2px solid var(--color-brand);
  outline-offset: 4px;
}
@media (min-width: 768px) and (max-width: 1024px) {
  .app-header {
    gap: 24px;
  }
  nav {
    gap: 16px;
  }
  .app-account-nav > a {
    max-width: 96px;
  }
}
@media (max-width: 767px) {
  .app-header {
    height: 64px;
    padding: 0 16px;
    justify-content: space-between;
  }
  .app-menu-toggle {
    display: block;
    font-size: 14px;
    padding: 8px 12px;
    background: #fff;
    color: var(--color-ink);
    border: 1px solid var(--color-line);
  }
  .app-navigation {
    display: none;
    position: absolute;
    top: 64px;
    left: 0;
    right: 0;
    padding: 16px;
    background: #fff;
    border-bottom: 1px solid var(--color-line);
  }
  .app-navigation.is-expanded {
    display: grid;
    gap: 16px;
  }
  nav {
    flex-wrap: wrap;
    gap: 16px;
    font-size: 14px;
  }
  .app-account-nav {
    margin-left: 0;
  }
  .app-extra-menu > div {
    position: static;
    border: 0;
    padding: 0 0 0 16px;
    gap: 8px;
  }
}
</style>
