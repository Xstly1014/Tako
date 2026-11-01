<script setup lang="ts">
import {ref,onMounted,onUnmounted,computed} from 'vue'
import {request,APIError} from '../lib/api'
import {signedInForFeedback} from '../lib/favorites'
import type {CommentEntry,CommentPage} from '../lib/comments'
const props=defineProps<{workId:string;context:string}>()
const items=ref<CommentEntry[]>([]),next=ref(0),replies=ref<Record<string,CommentPage>>({}),expanded=ref<Record<string,boolean>>({})
const actor=ref(''),text=ref(''),target=ref<CommentEntry|null>(null),anonymous=ref(false),busy=ref(false),loading=ref(false),ready=ref(false),notice=ref(''),failed=ref(false)
type Pending={path:string;body:Record<string,unknown>;kind:'create'|'delete'}
const pending=ref<Pending|null>(null),length=computed(()=>Array.from(text.value).length)
const key=()=>`tako-comment:${actor.value||'guest'}:${props.workId}`
function persist(){try{sessionStorage.setItem(key(),JSON.stringify({text:text.value,pending:pending.value,target:target.value?{id:target.value.id,nickname:target.value.nickname}:null}))}catch{/* Keep current input in memory. */}}
function restore(){try{const raw=sessionStorage.getItem(key());if(raw){const value=JSON.parse(raw);text.value=typeof value.text==='string'?value.text:'';pending.value=value.pending??null;target.value=value.target??null}}catch{/* Corrupt local cache grants no server permission. */}}
async function identify(){try{actor.value=(await request<{id:string}>('/me')).id;anonymous.value=false}catch(e){if(e instanceof APIError&&e.status===401){actor.value='';anonymous.value=true}else throw e}}
async function load(more=false){if(loading.value)return;loading.value=true;failed.value=false
 try{const page=await request<CommentPage>(`/works/${props.workId}/comments${more&&next.value?'?cursor='+next.value:''}`);const seen=new Set(more?items.value.map(x=>x.id):[]);items.value=[...(more?items.value:[]),...page.items.filter(x=>!seen.has(x.id))];next.value=page.next;ready.value=true;if(!more){replies.value={};expanded.value={}}}
 catch{failed.value=true;notice.value='评论暂不可读取，已输入的文字仍保留。'}finally{loading.value=false}}
async function showReplies(root:CommentEntry,more=false){try{const old=replies.value[root.id];const page=await request<CommentPage>(`/works/${props.workId}/comments?root=${root.id}&cursor=${more?old?.next||0:0}`);const seen=new Set(more?old?.items.map(x=>x.id):[]);replies.value[root.id]={items:[...(more?old?.items||[]:[]),...page.items.filter(x=>!seen.has(x.id))],next:page.next};expanded.value[root.id]=true}catch{notice.value='回复暂不可读取，请重试。'}}
function chooseReply(comment:CommentEntry){if(pending.value)return;target.value=comment;persist();document.getElementById('comment-input')?.focus()}
async function perform(){if(busy.value||!pending.value)return;busy.value=true;notice.value=''
 try{
  const me=await request<{id:string}>('/me');if(me.id!==actor.value){persist();text.value='';target.value=null;pending.value=null;await identify();restore();notice.value='账号已变化，原账号的输入未转移，请确认当前内容。';return}
  await request(pending.value.path,'POST',pending.value.body)
  const created=pending.value.kind==='create';pending.value=null;if(created){text.value='';target.value=null}persist();notice.value=created?'评论已发表。':'评论已删除。';await load()
 }catch(e){
  if(e instanceof APIError&&(e.code==='network_unconfirmed'||e.status>=500)){notice.value='结果尚未确认，请保留输入并检查原操作。';persist()}
  else if(e instanceof APIError&&e.status===401){notice.value='登录已过期，原账号的输入仍保留。';anonymous.value=true;persist()}
  else{pending.value=null;persist();const codes:Record<string,string>={comment_conflict:'讨论状态已变化，可能已删除或被屏蔽。请刷新后重试。',reading_context_invalid:'阅读权限上下文已失效，请保留文字后重新打开作品。',version_unavailable:'当前阅读内容已被限制，暂不能发表。',nickname_required:'请先到写作空间设置笔名，当前输入已保留。',rate_limited:'发表较频繁，请一分钟后再试。',resource_not_found:'作品或讨论暂不可用，当前输入已保留。'};notice.value=e instanceof APIError?(codes[e.code]||'操作未完成，请刷新评论后重试。'):'操作未完成，请重试。'}
 }finally{busy.value=false}}
function publish(){if(busy.value||pending.value||!text.value.trim()||length.value>1000||!actor.value)return;pending.value={kind:'create',path:`/works/${props.workId}/comments`,body:{mutation_id:crypto.randomUUID(),expected_account_id:actor.value,content:text.value,context:props.context,reply_to:target.value?.id||null}};persist();void perform()}
function remove(comment:CommentEntry){if(busy.value||pending.value)return;if(!window.confirm(comment.root_id?'删除这条回复？':'删除这条主评论及其全部回复？'))return;pending.value={kind:'delete',path:`/comments/${comment.id}/actions`,body:{mutation_id:crypto.randomUUID(),expected_account_id:actor.value,expected_revision:comment.revision,action:'delete',reason:''}};persist();void perform()}
let identityBusy=false
async function syncIdentity(){if(identityBusy)return;identityBusy=true;try{const previous=actor.value;const guestText=previous===''?text.value:'';persist();await identify();if(actor.value!==previous){text.value='';pending.value=null;target.value=null;restore();if(guestText&&!text.value){text.value=guestText;persist()}}await load()}catch{notice.value='登录状态未确认，请刷新重试。'}finally{identityBusy=false}}
async function loggedIn(){signedInForFeedback();await syncIdentity()}
onMounted(async()=>{window.addEventListener('tako-session-updated',syncIdentity);try{await identify();restore();await load()}catch{notice.value='评论登录状态加载失败，请刷新页面；输入不会自动提交。'}})
onUnmounted(()=>window.removeEventListener('tako-session-updated',syncIdentity))
</script>
<template>
 <section class="comments" aria-labelledby="comments-heading">
  <header><h2 id="comments-heading">评论</h2><button class="text-button" type="button" :disabled="loading" @click="load()">刷新评论</button></header>
  <p v-if="notice" role="status">{{notice}}</p>
  <p v-if="loading&&!ready" role="status">正在加载评论…</p>
  <p v-if="failed" role="alert">评论加载失败。<button class="secondary" type="button" @click="load()">重新加载评论</button></p>
  <p v-else-if="ready&&!items.length" class="muted">还没有评论，读完说说你的想法。</p>
  <ol class="comment-list"><li v-for="comment in items" :key="comment.id">
   <div class="comment-head"><strong>{{comment.nickname}}</strong><time>{{new Date(comment.created_at).toLocaleString()}}</time></div><p class="comment-text">{{comment.content}}</p>
   <div class="comment-actions"><button type="button" @click="chooseReply(comment)">回复</button><button v-if="comment.can_delete" type="button" :disabled="busy||!!pending" @click="remove(comment)">删除</button><button v-if="comment.replies&&!expanded[comment.id]" type="button" @click="showReplies(comment)">查看 {{comment.replies}} 条回复</button></div>
   <ol v-if="expanded[comment.id]" class="reply-list"><li v-for="reply in replies[comment.id]?.items" :key="reply.id"><div class="comment-head"><strong>{{reply.nickname}}</strong><span v-if="reply.reply_to!==comment.id">回复 {{reply.reply_name||'已不可见的评论'}}</span></div><p class="comment-text">{{reply.content}}</p><div class="comment-actions"><button type="button" @click="chooseReply(reply)">回复</button><button v-if="reply.can_delete" type="button" :disabled="busy||!!pending" @click="remove(reply)">删除</button></div></li></ol>
   <button v-if="expanded[comment.id]&&replies[comment.id]?.next" class="text-button" type="button" @click="showReplies(comment,true)">加载更多回复</button>
  </li></ol>
  <button v-if="next" class="secondary" type="button" :disabled="loading" @click="load(true)">加载更多评论</button>
  <form class="comment-editor" @submit.prevent="publish">
   <p v-if="target">回复 {{target.nickname}} <button type="button" :disabled="!!pending" @click="target=null;persist()">取消回复</button></p>
   <label for="comment-input">{{anonymous?'写下想法，登录后发表':'发表评论'}}</label><textarea id="comment-input" v-model="text" rows="3" :disabled="!!pending" maxlength="2000" @input="persist()"/><div class="editor-actions"><span>{{length}} / 1000</span><button v-if="!anonymous&&!pending" class="primary" type="submit" :disabled="busy||!text.trim()||length>1000||!actor||!context">发表</button><button v-if="pending&&!anonymous" type="button" class="secondary" :disabled="busy" @click="perform">检查原操作</button></div>
  </form>
  <LoginPanel v-if="anonymous" compact @signed-in="loggedIn"/>
  <NuxtLink to="/my-comments">我的评论与处置原因</NuxtLink>
 </section>
</template>
<style scoped>
.comments{margin:24px 0;padding:24px;background:#fff;border:1px solid var(--color-line);border-radius:6px;font-size:14px;line-height:24px}header,.comment-head,.comment-actions,.editor-actions{display:flex;align-items:center;gap:16px;flex-wrap:wrap}header{justify-content:space-between}h2{font-size:20px;font-weight:600;line-height:28px;margin:0}ol{list-style:none;margin:0;padding:0}.comment-list>li{padding:24px 0;border-bottom:1px solid var(--color-line)}.comment-head strong{font-weight:600}.comment-head time,.comment-head span,.muted{font-size:12px;color:var(--color-muted)}.comment-text{white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0}.comment-actions button{background:transparent;border:0;padding:4px 0;color:var(--color-muted);font-size:12px}.reply-list{margin:16px 0 0;padding-left:24px}.reply-list>li{margin:16px 0}.comment-editor{margin:24px 0 16px}.comment-editor textarea{width:100%;margin:8px 0;resize:vertical;min-height:96px}.editor-actions{justify-content:space-between;color:var(--color-muted)}button:focus-visible{outline:2px solid var(--color-brand);outline-offset:3px}@media(max-width:767px){.comments{padding:16px}.reply-list{padding-left:16px}}
</style>
