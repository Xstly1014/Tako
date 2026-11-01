<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { APIError, request } from '../lib/api'
import { signedInForFeedback } from '../lib/favorites'
import type { FavoriteEntry, FavoritePage } from '../lib/favorites'
const items=ref<FavoriteEntry[]>([]), next=ref(''), actor=ref(''), busy=ref(false), ready=ref(false), anonymous=ref(false), error=ref('')
let epoch=0
async function load(more=false){
 if(busy.value)return
 const current=++epoch;busy.value=true;error.value=''
 try{
  const me=await request<{id:string}>('/me');anonymous.value=false
  if(actor.value&&me.id!==actor.value){items.value=[];next.value='';ready.value=false;actor.value=me.id;if(more){error.value='账号已变化，请重新加载。';return}}
  actor.value=me.id
  const page=await request<FavoritePage>(`/my/favorites${more&&next.value?'?cursor='+encodeURIComponent(next.value):''}`)
  if(current!==epoch)return
  const seen=new Set(more?items.value.map(x=>x.work_id):[])
  items.value=[...(more?items.value:[]),...page.items.filter(x=>!seen.has(x.work_id))];next.value=page.next_cursor;ready.value=true
 }catch(e){if(e instanceof APIError&&e.status===401){anonymous.value=true;items.value=[];actor.value='';ready.value=false}else error.value=more?'后续收藏未能加载，已加载内容仍保留。':'收藏列表加载失败，请重试。'}
 finally{if(current===epoch)busy.value=false}
}
async function loggedIn(){signedInForFeedback();await load()}
onMounted(()=>void load())
useHead({title:'我的收藏 · Tako',meta:[{name:'robots',content:'noindex,nofollow,noarchive'}]})
</script>
<template>
 <div class="app-page"><AppHeader/><main class="favorites-page">
  <header><div><h1>我的收藏</h1><p>收藏作品，之后回来接着读。</p></div><NuxtLink to="/community">浏览社区</NuxtLink></header>
  <LoginPanel v-if="anonymous" @signed-in="loggedIn"/>
  <p v-if="error" role="alert">{{error}} <button type="button" class="secondary" :disabled="busy" @click="load(ready&&!!next)">重新加载</button></p>
  <p v-if="busy&&!ready" role="status">正在读取收藏…</p>
  <section v-if="ready&&!items.length&&!busy" class="empty"><h2>还没有收藏作品</h2><p>在阅读页收藏喜欢的作品，就能从这里找回来。</p><NuxtLink to="/community">去社区找作品</NuxtLink></section>
  <ul v-if="items.length"><li v-for="item in items" :key="actor+':'+item.work_id">
   <DiscoveryCard v-if="item.work" :work="item.work"/>
   <div v-else class="unavailable"><h2>作品暂不可访问</h2><p>收藏记录已保留，恢复公开后可再次阅读。</p></div>
   <FavoriteButton :work-id="item.work_id" :account-id="actor" :initial="{work_id:item.work_id,favorite:true,revision:item.revision}" cancel-only @changed="load()"/>
  </li></ul>
  <button v-if="next" class="secondary" type="button" :disabled="busy" @click="load(true)">{{busy?'加载中…':'加载更多收藏'}}</button>
 </main></div>
</template>
<style scoped>
.favorites-page{max-width:1024px;margin:0 auto;padding:32px 24px 48px}
header{display:flex;justify-content:space-between;gap:24px;align-items:center;margin-bottom:32px}
h1{font-size:28px;line-height:36px;font-weight:600;margin:0 0 8px}header p,.empty p,.unavailable p{margin:0;color:var(--color-muted);font-size:14px;line-height:24px}
ul{list-style:none;padding:0;margin:0 0 24px;display:grid;gap:24px}li{min-width:0;display:grid;gap:12px}
li :deep(.card-introduction){min-height:0;margin-bottom:16px}
.empty,.unavailable{padding:24px;background:#fff;border:1px solid var(--color-line);border-radius:6px}
h2{font-size:20px;line-height:28px;font-weight:600;margin:0 0 12px}.empty a{display:inline-block;margin-top:16px}
@media(max-width:767px){.favorites-page{padding:24px 16px}header{align-items:flex-start}h1{font-size:24px;line-height:32px}}
</style>
