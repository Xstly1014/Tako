import type { Transport } from '../auth/session.ts';
import { ApiError } from '../api/client.ts';
import { UUID } from '../api/reader.ts';
export type ReportKind = 'work' | 'short-post';
export type ContentReport = {
    id: number;
    version: number;
    reason: string;
    state: 'pending' | 'resolved';
    revision: number;
    outcome: '' | 'dismissed' | 'handled';
    response: string;
    created_at: string;
    decided_at: string | null;
} & ({ work_id: string; post_id?: never } | { post_id: string; work_id?: never });
export function checkedReport(value: unknown, kind: ReportKind = 'work'): ContentReport {
    const v = value as ContentReport;
    const target = v && (kind === 'work' ? v.work_id : v.post_id);
    if (!v || !Number.isSafeInteger(v.id) || v.id < 1 || typeof target !== 'string' || !UUID.test(target) || (kind === 'work' ? 'post_id' in v : 'work_id' in v) || !Number.isSafeInteger(v.version) || v.version < 1 ||
        !Number.isSafeInteger(v.revision) || v.revision < 1 || !['pending', 'resolved'].includes(v.state) || !['', 'dismissed', 'handled'].includes(v.outcome) ||
        typeof v.reason !== 'string' || typeof v.response !== 'string' || !Number.isFinite(Date.parse(v.created_at)) ||
        (v.state === 'pending' ? (v.decided_at !== null || v.outcome !== '' || v.response !== '') :
            (!v.decided_at || !Number.isFinite(Date.parse(v.decided_at)) || v.outcome === '' || !v.response.trim())))
        throw new ApiError('contract');
    return v;
}
export class ReportsAPI {
    private read: Transport;
    private kind: ReportKind;
    private base: string;
    constructor(read: Transport, kind: ReportKind = 'work') { this.read = read; this.kind = kind; this.base = kind === 'work' ? '/my/content-reports' : '/my/short-post-reports'; }
    async detail(id:number){
        if(!Number.isSafeInteger(id)||id<1)throw new ApiError('invalid_input');
        const report=checkedReport(await this.read(`${this.base}/${id}`,{method:'GET'}), this.kind);
        if(report.id!==id)throw new ApiError('contract');return report;
    }
    async list(before = 0) {
        const out = await this.read<{
            items: unknown[];
            next: number;
        }>(`${this.base}?before=${before}`, { method: 'GET' });
        if (!out || !Array.isArray(out.items) || out.items.length > 20 || !Number.isSafeInteger(out.next) || out.next < 0)
            throw new ApiError('contract');
        const items = out.items.map(value => checkedReport(value, this.kind));
        if (items.some((item, i) => before > 0 && item.id >= before || i > 0 && item.id >= items[i - 1].id) || out.next && out.next !== items.at(-1)?.id)
            throw new ApiError('contract');
        return { items, next: out.next };
    }
    async submit(work: string, version: number, reason: string) {
        if (!UUID.test(work) || !Number.isSafeInteger(version) || version < 1)
            throw new ApiError('invalid_input');
        const out = checkedReport(await this.read(`/${this.kind === 'work' ? 'works' : 'short-posts'}/${work}/versions/${version}/reports`, { method: 'POST', body: { reason } }), this.kind);
        if ((this.kind === 'work' ? out.work_id : out.post_id) !== work || out.version !== version)
            throw new ApiError('contract');
        return out;
    }
}
