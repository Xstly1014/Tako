<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { APIError, request } from '../lib/api'
import type { Account } from '../lib/types'
defineProps<{ compact?: boolean }>()
const fieldFocus = ref<'email' | 'code' | ''>('')
const mascotState = ref<'idle' | 'sending' | 'checking' | 'sent' | 'error' | 'success'>('idle')
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
  if (busy.value) return
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
  mascotState.value = 'sending'
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
    mascotState.value =
      result.status === 'sent'
        ? 'sent'
        : ['failed', 'expired'].includes(result.status)
          ? 'error'
          : 'sending'
    notice.value = labels[result.status] ?? '请稍后检查发送状态。'
    if (Date.parse(result.expires_at) <= Date.now()) notice.value = '本次验证码已过期，请重新申请。'
  } catch (error) {
    mascotState.value = 'error'
    notice.value = showError(error)
  } finally {
    busy.value = false
  }
}
async function login() {
  if (busy.value) return
  busy.value = true
  mascotState.value = 'checking'
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
    mascotState.value = 'success'
    emit('signedIn', account)
  } catch (error) {
    mascotState.value = 'error'
    notice.value = showError(error)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="auth-shell" :class="{ 'auth-shell--compact': compact }">
    <aside v-if="!compact" class="auth-intro">
      <h1>脑洞、日常，<br />都有人想看。</h1>
      <p>追一部长篇，读一段故事，<br />也可以分享今天的吐槽。</p>
    </aside>
    <div class="auth-form-wrap">
      <LoginMascot v-if="!compact" :focus="fieldFocus" :state="mascotState" />
      <section class="login-card" aria-labelledby="login-heading">
        <h2 id="login-heading">登录 Tako</h2>
        <p class="muted">邮箱验证码登录，首次验证自动创建账号。</p>
        <form @submit.prevent="login">
          <label for="login-email">邮箱</label>
          <input
            id="login-email"
            @focus="fieldFocus = 'email'"
            @blur="fieldFocus = ''"
            v-model="email"
            type="email"
            autocomplete="email"
            required
            placeholder="you@example.com"
          />
          <div class="row buttons">
            <button type="button" :disabled="busy" class="secondary" @click="send(false)">
              {{
                deliveryId && deliveryEmail === email.trim() ? '检查这次发送' : '获取验证码'
              }}</button
            ><button
              v-if="deliveryId"
              type="button"
              class="text-button"
              :disabled="busy || now < nextSend"
              @click="send(true)"
            >
              {{
                now < nextSend
                  ? `${Math.ceil((nextSend - now) / 1000)} 秒后可重发`
                  : '重新发送验证码'
              }}
            </button>
          </div>
          <label for="login-code">验证码</label>
          <input
            id="login-code"
            @focus="fieldFocus = 'code'"
            @blur="fieldFocus = ''"
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
    </div>
  </div>
</template>

<style scoped>
.auth-shell {
  display: grid;
  grid-template-columns: 1fr 400px;
  gap: 64px;
  align-items: center;
  padding: 32px 48px 48px;
  background: var(--color-paper);
  color: var(--color-ink);
  border: 0;
  overflow: visible;
}
.auth-intro h1 {
  font-size: 36px;
  font-weight: 600;
  line-height: 1.5;
  margin: 40px 0 24px;
}
.auth-intro p {
  font-size: 14px;
  color: var(--color-muted);
  line-height: 2;
}
.auth-form-wrap {
  position: relative;
  padding-top: 172px;
  min-width: 0;
}
.auth-shell .login-card {
  position: relative;
  z-index: 1;
  border: 1px solid var(--color-line);
  border-top: 2px solid var(--color-brand);
  border-radius: 0 0 8px 8px;
  padding: 32px;
  background: var(--color-paper);
  margin: 0;
  max-width: none;
}
.login-card h2 {
  font-size: 24px;
  font-weight: 600;
  margin: 0 0 8px;
}
.login-card p.muted {
  font-size: 12px;
  margin: 0 0 24px;
  color: var(--color-muted);
}
.login-card label {
  font-size: 14px;
  margin-top: 16px;
}
.login-card input {
  border: 1px solid #b5bdc9;
  border-radius: 4px;
  padding: 12px;
  min-height: 48px;
  background: #fff;
}
.login-card button {
  border-radius: 6px;
  font-weight: 600;
}
.login-card .primary {
  background: var(--color-brand);
  border-color: var(--color-brand);
  padding: 12px;
  font-size: 14px;
}
.login-card .primary:hover {
  background: #244cc9;
}
.login-card .secondary {
  background: #fff;
  border-color: var(--color-line);
  font-size: 12px;
  color: var(--color-brand);
  padding: 8px 12px;
}
.login-card .fine {
  font-size: 12px;
  line-height: 1.8;
  color: var(--color-muted);
  margin-top: 24px;
}
.login-card .notice {
  font-size: 12px;
  background: #f5f6f8;
  border: 0;
  border-left: 2px solid var(--color-brand);
  border-radius: 0;
  color: var(--color-ink);
}
.login-card .buttons {
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 12px;
}
.login-card .text-button {
  font-size: 12px;
  color: var(--color-brand);
}
.auth-shell--compact {
  display: block;
  padding: 0;
  max-width: 520px;
  margin-top: 24px;
}
.auth-shell--compact .auth-form-wrap {
  padding: 0;
}
.auth-shell--compact .login-card {
  padding: 24px;
  border-radius: 6px;
}
.auth-shell--compact h2 {
  font-size: 20px;
}
.auth-shell :focus-visible {
  outline: 2px solid var(--color-brand);
  outline-offset: 3px;
}
@media (min-width: 768px) and (max-width: 1024px) {
  .auth-shell {
    grid-template-columns: 1fr 360px;
    gap: 32px;
    padding: 24px;
  }
  .auth-intro h1 {
    font-size: 28px;
  }
}
@media (max-width: 767px) {
  .auth-shell {
    display: block;
    padding: 8px 0 24px;
    background: transparent;
  }
  .auth-intro {
    display: none;
  }
  .auth-form-wrap {
    max-width: 400px;
    margin: auto;
    padding-top: 148px;
  }
  .auth-shell .login-card {
    padding: 24px;
  }
  .auth-shell--compact {
    padding: 0;
  }
  .auth-shell--compact .auth-form-wrap {
    padding: 0;
  }
}
</style>
