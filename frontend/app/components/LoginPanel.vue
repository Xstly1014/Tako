<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { request } from '../lib/api'
import type { Account } from '../lib/types'
defineProps<{ compact?: boolean }>()
const emit = defineEmits<{ signedIn: [account: Account] }>()
const mode = ref<'email' | 'password' | ''>('')
const failed = ref(false)
async function load() {
  failed.value = false
  try {
    mode.value = (await request<{ mode: 'email' | 'password' }>('/auth/methods')).mode
  } catch {
    failed.value = true
  }
}
onMounted(load)
</script>
<template>
  <PasswordLoginPanel
    v-if="mode === 'password'"
    :compact="compact"
    @signed-in="emit('signedIn', $event)"
  />
  <EmailLoginPanel
    v-else-if="mode === 'email'"
    :compact="compact"
    @signed-in="emit('signedIn', $event)"
  />
  <section v-else aria-live="polite">
    <p>{{ failed ? '登录方式加载失败，请重试。' : '正在加载登录方式…' }}</p>
    <button v-if="failed" type="button" @click="load">重新加载</button>
  </section>
</template>
