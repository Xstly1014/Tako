<script setup lang="ts">
import { ref, watch } from 'vue'
import { APIError, request } from '../lib/api'
import type { Account } from '../lib/types'
defineProps<{ compact?: boolean }>()
const emit = defineEmits<{ signedIn: [account: Account] }>()
const registering = ref(false),
  email = ref(''),
  password = ref(''),
  confirmation = ref('')
const busy = ref(false),
  notice = ref(''),
  fieldFocus = ref<'email' | 'code' | ''>('')
const mascotState = ref<'idle' | 'checking' | 'error' | 'success'>('idle')
watch(registering, () => {
  notice.value = ''
  password.value = ''
  confirmation.value = ''
  mascotState.value = 'idle'
})
async function submit() {
  if (busy.value) return
  notice.value = ''
  if (registering.value && password.value !== confirmation.value) {
    notice.value = '两次密码不一致，请重新检查。'
    return
  }
  if (
    registering.value &&
    ([...password.value].length < 8 || new TextEncoder().encode(password.value).length > 72)
  ) {
    notice.value = '密码至少 8 个字符；长度不要超过 72 个英文字母或 24 个汉字。'
    return
  }
  busy.value = true
  mascotState.value = 'checking'
  try {
    const account = await request<Account>(
      registering.value ? '/auth/register' : '/auth/login',
      'POST',
      { email: email.value.trim(), password: password.value },
    )
    password.value = ''
    confirmation.value = ''
    try {
      localStorage.removeItem('tako-session-locked')
    } catch {
      /* Cookie remains authoritative. */
    }
    mascotState.value = 'success'
    emit('signedIn', account)
  } catch (error) {
    mascotState.value = 'error'
    const labels: Record<string, string> = {
      invalid_login: '邮箱或密码不正确，请检查后重试。',
      account_exists:
        '这个邮箱已有账号。若刚才注册未确认，请切换登录；已有旧账号需在原登录会话中设置密码。',
      invalid_password: '密码至少 8 个字符，过长时请缩短后重试。',
      rate_limited: '请求较频繁，请稍后重试。',
      auth_method_disabled: '登录方式已变更，请刷新页面。',
      network_unconfirmed: registering.value
        ? '注册结果未确认。请先切换登录，用刚才的邮箱和密码检查，避免重复注册。'
        : '登录结果未确认，请重试登录。',
    }
    notice.value =
      error instanceof APIError
        ? (labels[error.code] ?? '暂时无法登录，请稍后重试。') +
          (error.requestId ? ` 参考编号：${error.requestId}` : '')
        : '暂时无法登录，请稍后重试。'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="auth-shell" :class="{ 'auth-shell--compact': compact }">
    <aside v-if="!compact" class="auth-intro">
      <h1>脑洞、日常，<br />都有人想看。</h1>
      <p>写故事、分享吐槽，<br />也来看看大家在写什么。</p>
    </aside>
    <div class="auth-form-wrap">
      <LoginMascot v-if="!compact" :focus="fieldFocus" :state="mascotState" />
      <section class="login-card" aria-labelledby="password-login-heading">
        <h2 id="password-login-heading">{{ registering ? '注册 Tako' : '登录 Tako' }}</h2>
        <p class="muted">
          {{ registering ? '内测期间无需验证邮箱，注册后即可写作。' : '用邮箱和密码继续。' }}
        </p>
        <form @submit.prevent="submit">
          <label for="password-email">邮箱</label>
          <input
            id="password-email"
            v-model="email"
            type="email"
            autocomplete="username"
            required
            maxlength="254"
            :disabled="busy"
            @focus="fieldFocus = 'email'"
            @blur="fieldFocus = ''"
          />
          <label for="password-secret">密码</label>
          <input
            id="password-secret"
            v-model="password"
            type="password"
            :autocomplete="registering ? 'new-password' : 'current-password'"
            required
            maxlength="72"
            :disabled="busy"
            @focus="fieldFocus = 'code'"
            @blur="fieldFocus = ''"
          />
          <template v-if="registering">
            <label for="password-confirm">再次输入密码</label>
            <input
              id="password-confirm"
              v-model="confirmation"
              type="password"
              autocomplete="new-password"
              required
              maxlength="72"
              :disabled="busy"
              @focus="fieldFocus = 'code'"
              @blur="fieldFocus = ''"
            />
          </template>
          <button class="primary full" type="submit" :disabled="busy">
            {{ busy ? '处理中…' : registering ? '注册并进入' : '登录' }}
          </button>
        </form>
        <p v-if="notice" role="status" class="notice">{{ notice }}</p>
        <button
          class="text-button"
          type="button"
          :disabled="busy"
          @click="registering = !registering"
        >
          {{ registering ? '已有账号，去登录' : '没有账号，去注册' }}
        </button>
        <p class="fine">
          内测账号尚未验证邮箱，暂不支持邮件找回密码，请妥善保存密码。登录过期不会清除本机草稿。
        </p>
      </section>
    </div>
  </div>
</template>

<style scoped src="../assets/auth.css"></style>
