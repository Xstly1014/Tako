<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { request, APIError } from '../../lib/api';
import type { Account } from '../../lib/types';
type Report = {
    id: number;
    work_id: string;
    version: number;
    reason: string;
    state: string;
    revision: number;
    response: string;
    outcome: string;
    case_id?: number;
    created_at: string;
};
type Pending = {
    report: Report;
    decision: string;
    reason: string;
    moderation_reason?: string;
    mutation_id: string;
    task_revision: number;
    case_id?: number;
};
const account = ref<Account | null>(null), items = ref<Report[]>([]), detail = ref<Report | null>(null), content = ref(''), next = ref(0), state = ref('pending'), busy = ref(false), message = ref(''), response = ref(''), decision = ref('dismissed'), moderationReason=ref(''), existingCase = ref(''), pending = ref<Pending | null>(null);
let alive = true, generation = 0, channel: BroadcastChannel | undefined;
const storage = () => `tako-report-resolution:${account.value?.id}`;
function persist() { if (pending.value)
    localStorage.setItem(storage(), JSON.stringify(pending.value));
else
    localStorage.removeItem(storage()); }
function clear() { generation++; account.value = null; items.value = []; detail.value = null; content.value = ''; response.value = ''; pending.value = null; }
async function verify() { const current = await request<Account>('/me'); if (account.value && current.id !== account.value.id) {
    clear();
    throw Error('account_changed');
} account.value = current; }
function describe(e: unknown) {
    if(e instanceof Error&&e.message==='restriction_case_missing')return '原处置编号尚未确认，请核对内容治理记录，勿重复创建处置。';
    if(e instanceof Error&&e.message==='moderation_reason_required')return '请填写给作者的处置原因，勿包含举报人信息。';
    if(e instanceof Error&&e.message==='invalid_case')return '请输入有效的已有处置编号。'; return e instanceof APIError ? ({ operator_required: '当前账号无运营权限。', resource_not_found: '记录不存在或无权访问。', review_conflict: '状态已变化。请刷新原记录，原处置可能已完成，勿重复创建。', mutation_id_reused: '原重试标识和内容不一致，请核对原操作。', network_unconfirmed: '结果未确认，原操作已保留，请重试原操作。' }[e.code] ?? '服务暂不可用，请重试原操作。') : '账号或连接已变化，请重新登录后核对。'; }
async function load(more = false) { if (busy.value)
    return; busy.value = true; message.value = ''; const gen = generation; try {
    await verify();
    const out = await request<{
        items: Report[];
        next: number;
    }>(`/ops/content-reports?state=${state.value}&before=${more ? next.value : 0}`);
    if (alive && gen === generation) {
        items.value = more ? [...items.value, ...out.items] : out.items;
        next.value = out.next;
    }
}
catch (e) {
    message.value = describe(e);
}
finally {
    busy.value = false;
} }
async function open(id: number) { if (busy.value)
    return; busy.value = true; message.value = ''; const gen = generation; try {
    await verify();
    const row = await request<Report>(`/ops/content-reports/${id}`);
    const raw = await request<{
        work: {
            content: string;
        };
    }>(`/ops/reviews/${row.work_id}/versions/${row.version}`);
    if (alive && gen === generation) {
        detail.value = row;
        content.value = raw.work.content;
        response.value = row.response;
        decision.value = 'dismissed';
    }
}
catch (e) {
    message.value = describe(e);
}
finally {
    busy.value = false;
} }
async function resolve() {
    if (busy.value || !detail.value || !response.value.trim())
        return;
    busy.value = true;
    message.value = '';
    const gen = generation;
    try {
        await verify();
        if (!pending.value) {
            if(['restrict_version','restrict_work'].includes(decision.value)&&!moderationReason.value.trim())throw Error('moderation_reason_required');
            if (decision.value === 'handled_existing' && (!Number.isSafeInteger(Number(existingCase.value)) || Number(existingCase.value) < 1))
                throw Error('invalid_case');
            const row = detail.value;
            const review = await request<{
                task: {
                    revision: number;
                };
            }>(`/ops/reviews/${row.work_id}/versions/${row.version}`);
            if (gen !== generation)
                return;
            pending.value = { report: row, decision: decision.value, reason: response.value, moderation_reason:moderationReason.value, mutation_id: crypto.randomUUID(), task_revision: review.task.revision, ...(decision.value === 'handled_existing' ? { case_id: Number(existingCase.value) } : {}) };
            persist();
        }
        const op = pending.value;
        const row = op.report;
        if (op.decision !== 'dismissed' && !op.case_id) {
            if(!op.moderation_reason)throw Error('restriction_case_missing');
            const result = await request<{
                id: number;
                case_id?: number;
            }>(`/ops/reviews/${row.work_id}/versions/${row.version}`, 'POST', { mutation_id: op.mutation_id, expected_revision: op.task_revision, decision: op.decision, reason: op.moderation_reason });
            if (!alive || gen !== generation)
                return;
            if (!result.case_id)
                throw Error('restriction_case_missing');
            op.case_id = result.case_id;
            persist();
        }
        await verify();
        if (gen !== generation)
            return;
        const result = await request<Report>(`/ops/content-reports/${row.id}`, 'POST', { expected_revision: row.revision, outcome: op.decision === 'dismissed' ? 'dismissed' : 'handled', response: op.reason, case_id: op.case_id ?? null });
        if (!alive || gen !== generation)
            return;
        pending.value = null;
        persist();
        detail.value = result;
        items.value = state.value === 'pending' ? items.value.filter(item => item.id !== result.id) : items.value.map(item => item.id === result.id ? result : item);
        message.value = '处理回执已保存。';
    }
    catch (e) {
        message.value = describe(e);
    }
    finally {
        busy.value = false;
    }
}
function linkExisting(){const id=Number(existingCase.value);if(!pending.value||busy.value||!Number.isSafeInteger(id)||id<1)return;pending.value.case_id=id;persist();void resolve();}
onMounted(async () => { await load(); if (account.value) {
    try {
        const saved = JSON.parse(localStorage.getItem(storage()) ?? 'null') as Pending | null;
        if (saved && saved.report?.id && ['dismissed', 'restrict_version', 'restrict_work', 'handled_existing'].includes(saved.decision)) {
            pending.value = saved;
            detail.value = saved.report;
            response.value = saved.reason;
            decision.value = saved.decision;
            message.value = '有待确认的原操作，请核对后重试。';
        }
    }
    catch {
        message.value = '本地待确认记录无法读取，请核对服务端原状态。';
    }
} channel = new BroadcastChannel('tako-session'); channel.onmessage = clear; });
onUnmounted(() => { alive = false; generation++; channel?.close(); });
useHead({ title: '举报治理 · Tako', meta: [{ name: 'robots', content: 'noindex,nofollow,noarchive' }] });
</script>
<template><AppHeader :account="account" operator/><main class="reports"><h1>举报治理</h1><p v-if="message" role="status">{{message}}</p>
<div class="toolbar"><label>处理状态 <select v-model="state" :disabled="busy" @change="load()"><option value="pending">待核查</option><option value="resolved">已结案</option><option value="all">全部</option></select></label><button :disabled="busy" @click="load()">刷新</button></div>
<div class="layout"><aside><p v-if="!items.length">{{busy?'正在读取…':'当前没有匹配的举报。'}}</p><button v-for="item in items" :key="item.id" :disabled="busy||!!pending" @click="open(item.id)">#{{item.id}} · {{item.state==='pending'?'待核查':'已结案'}}<small>{{item.reason}}</small></button><button v-if="next" :disabled="busy" @click="load(true)">加载更多</button></aside>
<article v-if="detail"><h2>举报 #{{detail.id}}</h2><p>{{detail.reason}}</p><p>原正式版 V{{detail.version}} · {{detail.created_at}}</p><details><summary>核查原文</summary><p class="body">{{content||'待确认操作恢复后，可先从内容治理核对原版本。'}}</p></details>
<template v-if="detail.state==='pending'"><p v-if="pending?.case_id">已关联处置 #{{pending.case_id}}，等待举报回执确认。</p><label>处理方式<select v-model="decision" :disabled="busy||!!pending"><option value="dismissed">核查后无需处置</option><option value="restrict_version">限制原版本并结案</option><option value="restrict_work">限制整件作品并结案</option><option value="handled_existing">关联已有生效处置并结案</option></select></label><label v-if="decision==='handled_existing'">已有处置编号<input v-model="existingCase" type="number" min="1" :disabled="busy||!!pending"/></label><label v-if="['restrict_version','restrict_work'].includes(decision)">给作者的处置原因<textarea v-model="moderationReason" maxlength="2000" :disabled="busy||!!pending"/></label><p v-if="['restrict_version','restrict_work'].includes(decision)">处置原因会展示给作者，请勿包含举报人身份。</p><label>给举报人的处理回执<textarea v-model="response" maxlength="2000" :disabled="busy||!!pending"/></label><p>限制使用现有治理机制；举报人不会获知其他举报人或作者的私密信息。</p><div v-if="pending&&pending.decision!=='dismissed'"><label>若原处置已完成，填写核实后的生效处置编号<input v-model="existingCase" type="number" min="1" :disabled="busy"/></label><button :disabled="busy||!existingCase" @click="linkExisting">关联原处置并继续结案</button></div><button :disabled="busy||!response.trim()" @click="resolve">{{pending?'重试原操作':'执行处理并保存回执'}}</button></template>
<template v-else><h3>{{detail.outcome==='handled'?'已按治理处置':'核查后无需处置'}}</h3><p>{{detail.response}}</p><NuxtLink :to="`/works/${detail.work_id}`">复查当前公开内容</NuxtLink></template></article><article v-else>选择举报后核查原内容与说明。</article></div></main></template>
<style scoped>.reports{max-width:1120px;margin:auto;padding:24px;color:#202631}.toolbar{display:flex;gap:16px;margin:24px 0}.layout{display:grid;grid-template-columns:280px minmax(0,1fr);gap:24px}aside button{display:block;width:100%;text-align:left;margin-bottom:8px}button,select,textarea{font:inherit;padding:8px;border:1px solid #ddd;border-radius:4px;background:white}button{cursor:pointer}button:disabled{opacity:.5;cursor:default}button:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid #315de8}small{display:block;overflow-wrap:anywhere;white-space:pre-wrap;max-height:60px;overflow:hidden}article{min-width:0}label{display:block;margin:16px 0}textarea{display:block;width:100%;min-height:120px}.body{white-space:pre-wrap;overflow-wrap:anywhere}h1,h2,h3{font-weight:600}@media(max-width:767px){.layout{grid-template-columns:1fr}.reports{padding:16px}}</style>
