<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { APIError, request } from '../lib/api'
import type { Account } from '../lib/types'
defineProps<{ compact?: boolean }>()
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
  <div class="auth-shell" :class="{ 'auth-shell--compact': compact }">
    <aside v-if="!compact" class="auth-art" aria-label="Tako 品牌形象">
      <div class="auth-art-copy"><span class="auth-wordmark">tako<span>✦</span></span><p>有脑洞，就开写。</p></div>
      <img src="/images/tako-mascot-welcome-v2.png" alt="Tako 看板娘，蓝白固定服饰，持本欢迎姿态" width="1024" height="1536" />
      <span class="auth-art-foot">TAKO / WRITE YOUR NEXT STORY</span>
    </aside>
  <section class="login-card" aria-labelledby="login-heading">
    <img v-if="!compact" class="auth-mobile-mascot" src="/images/tako-mascot-working-chibi-v2.png" alt="Tako Q 版看板娘，使用电脑的工作姿态" width="110" height="110" />
    <h2 id="login-heading">登录 Tako</h2>
    <p class="muted">邮箱验证码登录，首次验证自动创建账号。</p>
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
  </div>
</template>

<style scoped>
.auth-shell{display:grid;grid-template-columns:44% minmax(0,1fr);min-height:640px;background:#fff;border:1px solid #e5e6e9;border-radius:8px;overflow:hidden;color:#24272e}
.auth-art{background:#1b2a47;position:relative;display:flex;align-items:flex-end;justify-content:center;overflow:hidden;min-width:0}
.auth-art-copy{position:absolute;top:32px;left:32px;color:#fff;z-index:1}.auth-wordmark{font-size:33px;font-weight:800;letter-spacing:-2px}.auth-wordmark span{color:#ff9a83;font-size:15px;vertical-align:top;margin-left:4px}.auth-art-copy p{font-size:14px;letter-spacing:1px;color:#c2cce0;margin-top:5px}
.auth-art>img{width:100%;height:495px;object-fit:contain;object-position:center bottom;margin-bottom:40px}.auth-art-foot{position:absolute;bottom:19px;left:32px;color:#a6b3cd;font-size:10px;letter-spacing:1.5px}
.auth-shell .login-card{border:0;border-radius:0;padding:52px 48px 32px;min-width:0;background:#fff}.login-card h2{font-size:27px;font-weight:650;letter-spacing:-.5px;color:#23262d;margin-bottom:9px}.login-card p.muted{font-size:13px;color:#72767e;margin-bottom:27px}.login-card label{color:#343840;font-size:13px;margin-top:19px}.login-card input{background:#fff;border-color:#dcdfe4;border-radius:5px;padding:11px 12px}.login-card button{border-radius:5px}.login-card .primary{background:#315bd4;border-color:#315bd4;font-size:14px;padding:12px}.login-card .secondary{color:#414c60;border-color:#dcdfe4;background:#fff;font-size:13px;padding:8px 13px}.login-card .fine{color:#858a93;line-height:1.8;font-size:11px;margin-top:24px}.login-card .notice{border:0;border-left:2px solid #8394b3;border-radius:0;background:#f5f6f8;color:#454d5e}.login-card .buttons{gap:8px;flex-wrap:wrap}.login-card .text-button{font-size:12px;color:#315bd4}.auth-mobile-mascot{display:none}
.auth-shell--compact{display:block;min-height:0;border:1px solid #e5e6e9;max-width:520px;margin-top:22px}.auth-shell--compact .login-card{padding:24px}.auth-shell--compact .login-card h2{font-size:20px}.auth-shell--compact .login-card p.muted{margin-bottom:15px}
@media(max-width:720px){.auth-shell{display:block;min-height:0;border:0;overflow:visible}.auth-art{display:none}.auth-shell .login-card{position:relative;padding:30px 8px 25px}.auth-mobile-mascot{display:block;width:100px;height:100px;object-fit:contain;margin-bottom:18px}.login-card h2{font-size:25px}.auth-shell--compact{border:1px solid #e5e6e9}.auth-shell--compact .login-card{padding:22px}}
</style>
