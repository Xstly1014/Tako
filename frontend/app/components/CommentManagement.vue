<script setup lang="ts">
import {ref,onMounted} from 'vue'
import {request,APIError} from '../lib/api'
import {signedInForFeedback} from '../lib/favorites'
import type {CommentEntry,CommentPage} from '../lib/comments'
const props=defineProps<{operator?:boolean}>()
const actor=ref(''),items=ref<CommentEntry[]>([]),next=ref(0),loading=ref(false),busy=ref(false),anonymous=ref(false),notice=ref(''),ready=ref(false)
const selected=ref<CommentEntry|null>(null),action=ref('block'),reason=ref('')
type Pending={id:string;body:Record<string,unknown>};const pending=ref<Pending|null>(null)
const key=()=>`tako-comment-management:${actor.value}:${props.operator?'ops':'self'}`
function persist(){try{if(pending.value)sessionStorage.setItem(key(),JSON.stringify(pending.value));else sessionStorage.removeItem(key())}catch{/* Current tab retains pending operation. */}}
async function load(more=false){if(loading.value)return;loading.value=true
 try{const me=await request<{id:string}>('/me');if(actor.value&&actor.value!==me.id){items.value=[];pending.value=null;ready.value=false;more=false}actor.value=me.id;anonymous.value=false
  try{const raw=sessionStorage.getItem(key());if(raw)pending.value=JSON.parse(raw)}catch{/* Cache cannot grant permissions. */}
  const page=await request<CommentPage>(`${props.operator?'/ops/comments':'/my/comments'}?cursor=${more?next.value:0}`);const seen=new Set(more?items.value.map(x=>x.id):[]);items.value=[...(more?items.value:[]),...page.items.filter(x=>!seen.has(x.id))];next.value=page.next;ready.value=true
 }catch(e){if(e instanceof APIError&&e.status===401){anonymous.value=true;items.value=[];ready.value=false}else notice.value=e instanceof APIError&&e.status===403?'需要运营身份才能处理评论。':'列表加载失败，请重试。'}finally{loading.value=false}}
function choose(comment:CommentEntry,kind:string){if(pending.value)return;selected.value=comment;action.value=kind;reason.value=''}
async function execute(){if(busy.value)return;busy.value=true;notice.value=''
 try{const me=await request<{id:string}>('/me');if(me.id!==actor.value){notice.value='账号已变化，请重新加载。';return}
  if(!pending.value){if(!selected.value)return;if(action.value==='delete'&&!window.confirm(selected.value.root_id?'删除这条回复？':'删除这条主评论及全部回复？'))return;if(action.value!=='delete'&&!reason.value.trim()){notice.value='请填写处置原因。';return};pending.value={id:selected.value.id,body:{mutation_id:crypto.randomUUID(),expected_account_id:actor.value,expected_revision:selected.value.revision,action:action.value,reason:reason.value.trim()}};persist()}
  await request(`${props.operator?'/ops':''}/comments/${pending.value.id}/actions`,'POST',pending.value.body);pending.value=null;persist();selected.value=null;reason.value='';notice.value='操作已确认。';await load()
 }catch(e){if(e instanceof APIError&&(e.code==='network_unconfirmed'||e.status>=500)){notice.value='结果尚未确认，请检查原操作。';persist()}else{pending.value=null;persist();notice.value=e instanceof APIError&&e.status===409?'评论状态已变化，请重新加载后处理。':'操作未完成，请检查登录身份和当前状态。'}}finally{busy.value=false}}
async function loggedIn(){signedInForFeedback();await load()}
onMounted(()=>void load())
</script>
<template>
 <div class="app-page"><AppHeader/><main class="comment-management"><header><h1>{{operator?'评论治理':'我的评论与处置'}}</h1><button class="secondary" type="button" :disabled="loading" @click="load()">刷新列表</button></header>
  <p v-if="notice" role="status">{{notice}}</p><p v-if="loading&&!ready" role="status">正在加载…</p><LoginPanel v-if="anonymous" @signed-in="loggedIn"/>
  <form v-if="selected&&!pending" class="action-form" @submit.prevent="execute"><h2>{{action==='delete'?'删除评论':action==='block'?'屏蔽评论':'撤销屏蔽'}}</h2><p v-if="!selected.root_id">{{action==='delete'?'主评论删除后，其下全部回复一起删除。':action==='block'?'主评论屏蔽后，整串讨论暂不可见。':'只恢复未被删除或独立屏蔽的内容。'}}</p><template v-if="action!=='delete'"><label for="comment-reason">原因</label><textarea id="comment-reason" v-model="reason" maxlength="500" rows="3" required/></template><div><button class="primary" :disabled="busy" type="submit">{{action==='delete'?'删除':action==='block'?'执行屏蔽':'撤销屏蔽'}}</button><button type="button" class="secondary" @click="selected=null">取消</button></div></form>
  <button v-if="pending" type="button" class="secondary" :disabled="busy" @click="execute">检查原操作</button>
  <p v-if="ready&&!items.length">还没有{{operator?'可处理的':'已提交的'}}评论。<NuxtLink to="/community">浏览社区</NuxtLink></p>
  <ul><li v-for="comment in items" :key="comment.id"><div class="status"><strong>{{comment.root_id?'回复':'主评论'}}</strong><span>{{comment.deleted?'已删除':comment.blocked?'已屏蔽':'已提交'}}</span><time>{{new Date(comment.created_at).toLocaleString()}}</time></div><p v-if="!comment.deleted" class="body">{{comment.content}}</p><p v-if="comment.reason" class="reason">最近处置原因：{{comment.reason}}</p><div class="actions"><NuxtLink :to="`/works/${comment.work_id}`">查看作品</NuxtLink><template v-if="operator&&!comment.deleted"><button type="button" :disabled="busy||!!pending" @click="choose(comment,comment.blocked?'unblock':'block')">{{comment.blocked?'撤销屏蔽':'屏蔽评论'}}</button></template><button v-if="!operator&&!comment.deleted" type="button" :disabled="busy||!!pending" @click="choose(comment,'delete')">删除</button></div></li></ul>
  <button v-if="next" class="secondary" type="button" :disabled="loading" @click="load(true)">加载更多</button>
 </main></div>
</template>
<style scoped>
.comment-management{max-width:1024px;margin:auto;padding:32px 24px 48px;font-size:14px;line-height:24px}header,.status,.actions{display:flex;align-items:center;gap:16px;flex-wrap:wrap}header{justify-content:space-between;margin-bottom:24px}h1{font-size:24px;line-height:32px;font-weight:600;margin:0}h2{font-size:20px;font-weight:600}ul{list-style:none;padding:0;margin:0}li,.action-form{background:#fff;border:1px solid var(--color-line);border-radius:6px;margin-bottom:16px;padding:24px}.status span,.status time,.reason{color:var(--color-muted);font-size:12px}.body{white-space:pre-wrap;overflow-wrap:anywhere}.action-form textarea{width:100%;margin:8px 0 16px}.action-form button{margin-right:12px}.actions button{background:transparent;border:0;padding:4px 0;color:var(--color-ink)}@media(max-width:767px){.comment-management{padding:24px 16px}li,.action-form{padding:16px}}
</style>
