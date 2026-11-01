<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { request, APIError } from '../lib/api'
import type { FavoriteState, FavoriteChange } from '../lib/favorites'
import { signedInForFeedback } from '../lib/favorites'
const props = defineProps<{ workId: string; initial?: FavoriteState; accountId?: string; cancelOnly?: boolean }>()
const emit = defineEmits<{ changed: [] }>()
const state = ref<FavoriteState | null>(null), actor = ref(''), anonymous = ref(false), busy = ref(false), notice = ref(''), login = ref(false), pending = ref<FavoriteChange | null>(null)
const key = () => `tako-favorite:${actor.value}:${props.workId}`
function retain() { try { if (pending.value) sessionStorage.setItem(key(), JSON.stringify(pending.value)); else sessionStorage.removeItem(key()) } catch { /* Current tab keeps pending operation in memory. */ } }
function restore() { try { const raw = sessionStorage.getItem(key()); if (raw) { const value=JSON.parse(raw); if (typeof value.favorite==='boolean' && Number.isSafeInteger(value.expected_revision) && typeof value.mutation_id==='string') pending.value=value } } catch { /* Invalid local cache does not authorize writes. */ } }
async function load() {
  busy.value=true; notice.value=''
  try {
    const me = await request<{id:string}>('/me')
    actor.value=me.id; anonymous.value=false; pending.value=null;restore()
    state.value=await request<FavoriteState>(`/my/favorites/${props.workId}`)
    if(pending.value) notice.value='有一次收藏操作尚未确认，请检查原操作。'
  } catch(e) { state.value=null; anonymous.value=e instanceof APIError&&e.status===401; if(!anonymous.value) notice.value='收藏状态加载失败，请重试。' }
  finally { busy.value=false }
}
async function change() {
  if(busy.value||!state.value)return
  busy.value=true;notice.value=''
  let confirmed=false
  try {
    const me=await request<{id:string}>('/me')
    if(me.id!==actor.value){state.value=null;pending.value=null;notice.value='账号已变化，请重新加载收藏状态。';return}
    if(!pending.value){pending.value={mutation_id:crypto.randomUUID(),expected_account_id:actor.value,expected_revision:state.value.revision,favorite:props.cancelOnly?false:!state.value.favorite};retain()}
    await request<FavoriteState>(`/my/favorites/${props.workId}`,'POST',pending.value)
    confirmed=true
    pending.value=null;retain()
    state.value=null
    notice.value='原操作已确认，正在读取当前状态。'
    state.value=await request<FavoriteState>(`/my/favorites/${props.workId}`)
    notice.value='';emit('changed')
  }catch(e){
    if(e instanceof APIError&&(e.code==='network_unconfirmed'||e.status>=500)) notice.value=pending.value?'网络尚未确认结果，请检查原操作。':confirmed?'操作已确认，当前状态未能刷新，请重新加载。':'登录状态暂未确认，请重试。'
    else if(e instanceof APIError&&e.status===401){anonymous.value=true;state.value=null;notice.value='请重新登录，原账号的操作记录仍保留。'}
    else { pending.value=null;retain();state.value=null;notice.value=e instanceof APIError&&e.status===404?'作品暂不可收藏，已有收藏仍可在“我的收藏”取消。':e instanceof APIError&&e.status===409?'收藏状态已在别处变化，请重新加载后再操作。':'暂时无法操作，请重新加载。' }
  }finally{busy.value=false}
}
async function loggedIn(){signedInForFeedback();login.value=false;await load()}
onMounted(()=>{window.addEventListener('tako-session-updated',load);if(props.initial&&props.accountId){state.value=props.initial;actor.value=props.accountId;restore()}else void load()})
onUnmounted(()=>window.removeEventListener('tako-session-updated',load))
</script>
<template>
  <div class="favorite-control">
    <button v-if="anonymous" type="button" class="secondary" @click="login=!login">登录后收藏</button>
    <button v-else-if="state" type="button" class="secondary" :disabled="busy" :aria-pressed="state.favorite" @click="change">{{busy?'处理中…':pending?'检查原操作':cancelOnly?'取消收藏':state.favorite?'已收藏':'收藏作品'}}</button>
    <span v-else-if="busy" role="status">正在读取收藏状态…</span>
    <button v-else type="button" class="secondary" @click="load">重新加载收藏状态</button>
    <NuxtLink v-if="!cancelOnly" to="/favorites">我的收藏</NuxtLink>
    <p v-if="notice" role="status">{{notice}}</p>
    <LoginPanel v-if="login" compact @signed-in="loggedIn" />
  </div>
</template>
<style scoped>
.favorite-control{display:flex;align-items:center;flex-wrap:wrap;gap:16px;font-size:14px;line-height:24px}
.favorite-control>p,.favorite-control :deep(.login-panel){flex-basis:100%}
.favorite-control>p{margin:0;color:var(--color-muted)}
</style>
