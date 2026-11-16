import type { Transport } from '../auth/session.ts';
import { ApiError } from '../api/client.ts';
import { UUID } from '../api/reader.ts';
export type ContentReport = {
    id: number;
    work_id: string;
    version: number;
    reason: string;
    state: 'pending' | 'resolved';
    revision: number;
    outcome: '' | 'dismissed' | 'handled';
    response: string;
    created_at: string;
    decided_at: string | null;
};
export function checkedReport(value: unknown): ContentReport {
    const v = value as ContentReport;
    if (!v || !Number.isSafeInteger(v.id) || v.id < 1 || !UUID.test(v.work_id) || !Number.isSafeInteger(v.version) || v.version < 1 ||
        !Number.isSafeInteger(v.revision) || v.revision < 1 || !['pending', 'resolved'].includes(v.state) || !['', 'dismissed', 'handled'].includes(v.outcome) ||
        typeof v.reason !== 'string' || typeof v.response !== 'string' || !Number.isFinite(Date.parse(v.created_at)) ||
        (v.state === 'pending' ? (v.decided_at !== null || v.outcome !== '' || v.response !== '') :
            (!v.decided_at || !Number.isFinite(Date.parse(v.decided_at)) || v.outcome === '' || !v.response.trim())))
        throw new ApiError('contract');
    return v;
}
export class ReportsAPI {
    private read: Transport;
    constructor(read: Transport) { this.read = read; }
    async detail(id:number){
        if(!Number.isSafeInteger(id)||id<1)throw new ApiError('invalid_input');
        const report=checkedReport(await this.read(`/my/content-reports/${id}`,{method:'GET'}));
        if(report.id!==id)throw new ApiError('contract');return report;
    }
    async list(before = 0) {
        const out = await this.read<{
            items: unknown[];
            next: number;
        }>(`/my/content-reports?before=${before}`, { method: 'GET' });
        if (!out || !Array.isArray(out.items) || out.items.length > 20 || !Number.isSafeInteger(out.next) || out.next < 0)
            throw new ApiError('contract');
        const items = out.items.map(checkedReport);
        if (items.some((item, i) => before > 0 && item.id >= before || i > 0 && item.id >= items[i - 1].id) || out.next && out.next !== items.at(-1)?.id)
            throw new ApiError('contract');
        return { items, next: out.next };
    }
    async submit(work: string, version: number, reason: string) {
        if (!UUID.test(work) || !Number.isSafeInteger(version) || version < 1)
            throw new ApiError('invalid_input');
        const out = checkedReport(await this.read(`/works/${work}/versions/${version}/reports`, { method: 'POST', body: { reason } }));
        if (out.work_id !== work || out.version !== version)
            throw new ApiError('contract');
        return out;
    }
}
