<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { APIError, request } from '../lib/api'
import type { Account } from '../lib/types'
const emit = defineEmits<{ signedIn: [account: Account] }>()
const email = ref(''),
  code = ref(''),
  notice = ref(''),
  busy = ref(false),
  deliveryId = ref(''),
  deliveryEmail = ref(''),
  nextSend = ref(0),
  now = ref(Date.now())
let timer: ReturnType<typeof setInterval>
onMounted(() => {
  try {
    const previous = JSON.parse(sessionStorage.getItem('tako-delivery') ?? 'null')
    if (previous) {
      email.value = previous.email
      deliveryEmail.value = previous.email
      deliveryId.value = previous.id
      nextSend.value = previous.nextSend ?? 0
    }
  } catch {
    /* Delivery retry still works in this page's memory. */
  }
  timer = setInterval(() => {
    now.value = Date.now()
  }, 1000)
})
onUnmounted(() => clearInterval(timer))
function showError(error: unknown) {
  if (!(error instanceof APIError)) return '暂时无法完成，请稍后重试。'
  const message =
    error.code === 'rate_limited'
      ? '请求较频繁，请稍后重试。'
      : error.code === 'mail_unavailable'
        ? '邮件服务暂不可用，请稍后再试。'
        : error.code === 'network_unconfirmed'
          ? '网络未确认结果。再次检查会沿用同一次请求。'
          : error.status === 400
            ? '邮箱或验证码不正确，验证码也可能已经过期。'
            : '服务暂时不可用，请稍后重试。'
  return message + (error.requestId ? ` 参考编号：${error.requestId}` : '')
}
async function send(fresh = false) {
  const address = email.value.trim()
  if (!address) {
    notice.value = '请先填写邮箱。'
    return
  }
  if (fresh && Date.now() < nextSend.value) return
  if (!deliveryId.value || deliveryEmail.value !== address || fresh) {
    deliveryId.value = crypto.randomUUID()
    deliveryEmail.value = address
    nextSend.value = Date.now() + 60_000
  }
  try {
    sessionStorage.setItem(
      'tako-delivery',
      JSON.stringify({ email: address, id: deliveryId.value, nextSend: nextSend.value }),
    )
  } catch {
    /* Never discard the in-memory ID because storage is blocked. */
  }
  busy.value = true
  try {
    const result = await request<{ status: string; expires_at: string }>('/auth/code', 'POST', {
      email: address,
      delivery_id: deliveryId.value,
    })
    const labels: Record<string, string> = {
      queued: '请求已保存，等待发送处理；这还不代表邮件已送达。',
      sending: '正在联系发信服务，请稍后检查。',
      sent: '发信服务已接受，请检查收件箱和垃圾邮件。',
      failed: '本次发送失败，可以稍后重新申请。',
      expired: '本次请求已结束，可以重新申请验证码。',
    }
    notice.value = labels[result.status] ?? '请稍后检查发送状态。'
    if (Date.parse(result.expires_at) <= Date.now()) notice.value = '本次验证码已过期，请重新申请。'
  } catch (error) {
    notice.value = showError(error)
  } finally {
    busy.value = false
  }
}
async function login() {
  busy.value = true
  try {
    const account = await request<Account>('/auth/verify', 'POST', {
      email: email.value.trim(),
      code: code.value,
    })
    code.value = ''
    try {
      localStorage.removeItem('tako-session-locked')
    } catch {
      /* Cookie still controls server authentication. */
    }
    emit('signedIn', account)
  } catch (error) {
    notice.value = showError(error)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="login-card" aria-labelledby="login-heading">
    <span class="eyebrow">TAKO / 我的草稿</span>
    <h2 id="login-heading">登录 Tako，接着写</h2>
    <p class="muted">用邮箱验证码登录或注册。当前草稿仅自己可见。</p>
    <form @submit.prevent="login">
      <label for="login-email">邮箱</label>
      <input
        id="login-email"
        v-model="email"
        type="email"
        autocomplete="email"
        required
        placeholder="you@example.com"
      />
      <div class="row buttons">
        <button type="button" :disabled="busy" class="secondary" @click="send(false)">
          {{ deliveryId && deliveryEmail === email.trim() ? '检查这次发送' : '获取验证码' }}</button
        ><button
          v-if="deliveryId"
          type="button"
          class="text-button"
          :disabled="busy || now < nextSend"
          @click="send(true)"
        >
          {{
            now < nextSend ? `${Math.ceil((nextSend - now) / 1000)} 秒后可重发` : '重新发送验证码'
          }}
        </button>
      </div>
      <label for="login-code">验证码</label>
      <input
        id="login-code"
        v-model="code"
        inputmode="numeric"
        autocomplete="one-time-code"
        pattern="[0-9]{6}"
        maxlength="6"
        required
        placeholder="6 位数字"
      />
      <button :disabled="busy" type="submit" class="primary full">
        {{ busy ? '处理中…' : '进入写作空间' }}
      </button>
    </form>
    <p v-if="notice" role="status" class="notice">{{ notice }}</p>
    <p class="fine">登录过期不会清除本机草稿。共享设备上的浏览器数据不等同于加密保险箱。</p>
  </section>
</template>
