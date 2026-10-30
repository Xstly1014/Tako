<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { APIError, request } from '../lib/api'
import type { Account } from '../lib/types'
useHead({
  title: '账号设置 · Tako',
  meta: [{ name: 'robots', content: 'noindex,nofollow,noarchive' }],
})
const account = ref<Account | null>(null),
  configured = ref<boolean | null>(null)
const busy = ref(false),
  loading = ref(true),
  password = ref(''),
  confirmation = ref(''),
  notice = ref(''),
  needLogin = ref(false)
async function load() {
  loading.value = true
  notice.value = ''
  needLogin.value = false
  try {
    account.value = await request<Account>('/me')
    configured.value = (await request<{ configured: boolean }>('/me/password')).configured
  } catch (error) {
    needLogin.value = error instanceof APIError && error.status === 401
    notice.value = needLogin.value ? '请先登录，再设置自己的密码。' : '账号设置加载失败，请重试。'
  } finally {
    loading.value = false
  }
}
async function save() {
  if (busy.value) return
  if (password.value !== confirmation.value) {
    notice.value = '两次密码不一致，请检查。'
    return
  }
  busy.value = true
  notice.value = ''
  try {
    await request('/me/password', 'POST', { password: password.value })
    password.value = ''
    confirmation.value = ''
    configured.value = true
    notice.value = '密码已设置，原账号、草稿和权限均保留。'
  } catch (error) {
    const labels: Record<string, string> = {
      invalid_password: '密码至少 8 个字符，最多 72 个英文字母或 24 个汉字。',
      password_already_set: '这个账号已经设置密码，不能用首次设置覆盖。请刷新查看状态。',
      network_unconfirmed: '设置结果未确认，请保留原密码并重试。相同密码重试不会覆盖账号。',
      rate_limited: '请求较频繁，请稍后重试。',
    }
    notice.value =
      error instanceof APIError
        ? (labels[error.code] ?? '设置失败，请确认仍已登录后重试。')
        : '设置失败，请稍后重试。'
  } finally {
    busy.value = false
  }
}
onMounted(load)
</script>
<template>
  <div class="app-page">
    <AppHeader />
    <main class="account-page">
      <section class="account-settings">
        <h1>账号设置</h1>
        <p v-if="loading" role="status">正在加载…</p>
        <template v-else-if="configured !== null">
          <h2>登录密码</h2>
          <p v-if="configured">已设置密码。内测期间暂不提供改密或邮件找回，请妥善保存密码。</p>
          <form v-else @submit.prevent="save">
            <p>为当前账号设置密码，之后可用原邮箱登录。原账号的内容和权限不变。</p>
            <label for="setup-password">密码（至少 8 个字符）</label>
            <input
              id="setup-password"
              v-model="password"
              type="password"
              autocomplete="new-password"
              required
              maxlength="72"
              :disabled="busy"
            />
            <label for="setup-confirmation">再次输入密码</label>
            <input
              id="setup-confirmation"
              v-model="confirmation"
              type="password"
              autocomplete="new-password"
              required
              maxlength="72"
              :disabled="busy"
            />
            <button type="submit" :disabled="busy">{{ busy ? '设置中…' : '设置密码' }}</button>
          </form>
        </template>
        <p v-if="notice" role="status">{{ notice }}</p>
        <NuxtLink v-if="needLogin" to="/workspace">前往登录</NuxtLink>
        <button v-else-if="!loading && configured === null" type="button" @click="load">
          重新加载
        </button>
      </section>
    </main>
  </div>
</template>
<style scoped>
.account-page {
  max-width: 1280px;
  margin: 0 auto;
  padding: 0 24px 48px;
}
.account-settings {
  max-width: 560px;
  padding-top: 32px;
}
h1 {
  font-size: 28px;
  margin: 0 0 32px;
}
h2 {
  font-size: 20px;
}
p {
  line-height: 24px;
  color: var(--color-muted);
}
form {
  display: grid;
  gap: 16px;
}
input {
  width: 100%;
}
button {
  justify-self: start;
}
nav {
  display: flex;
  gap: 24px;
}
@media (max-width: 767px) {
  .account-page {
    padding-inline: 16px;
  }
  nav {
    gap: 16px;
  }
}
</style>
