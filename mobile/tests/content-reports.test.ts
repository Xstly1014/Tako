import test from 'node:test';
import assert from 'node:assert/strict';
import { ReportsAPI, checkedReport } from '../src/reports/api.ts';
import type { Transport } from '../src/auth/session.ts';
const work = '11111111-1111-4111-8111-111111111111';
const report = { id: 2, work_id: work, version: 1, reason: '原说明', state: 'pending', revision: 1, outcome: '', response: '', created_at: '2026-11-16T00:00:00Z', decided_at: null };
test('report retries target the same immutable version and display the original server record', async () => {
    const calls: {
        path: string;
        options: unknown;
    }[] = [];
    const api = new ReportsAPI((async (path, options) => { calls.push({ path, options }); return report; }) as Transport);
    assert.deepEqual(await api.submit(work, 1, '第一次说明'), report);
    assert.deepEqual(await api.submit(work, 1, '本次重试说明'), report);
    assert.equal(calls[0].path, calls[1].path);
    assert.ok(!JSON.stringify(calls).includes('owner_id'));
    assert.deepEqual((calls[0].options as {
        body: unknown;
    }).body, { reason: '第一次说明' });
    await assert.rejects(api.submit('foreign-url', 1, '说明'));
});
test('list rejects repeated cursors, out-of-order ids and records from outside its cursor', async () => {
    for (const page of [{ items: [report], next: 9 }, { items: [report, report], next: 0 }, { items: [report], next: 0 }]) {
        const api = new ReportsAPI((async () => page) as Transport);
        await assert.rejects(api.list(2));
    }
    const api = new ReportsAPI((async () => ({ items: [report], next: 0 })) as Transport);
    assert.equal((await api.list()).items.length, 1);
});
test('resolved responses require a real decision and timestamp; unknown status is not completion', () => {
    for (const value of [{ ...report, state: 'finished' }, { ...report, state: 'resolved' }, { ...report, outcome: 'handled' }])
        assert.throws(() => checkedReport(value));
    assert.equal(checkedReport({ ...report, state: 'resolved', revision: 2, outcome: 'dismissed', response: '核查后无需处置', decided_at: '2026-11-16T01:00:00Z' }).state, 'resolved');
});

test('short-post inbox binds post/version and cannot accept a work report with the same report number', async () => {
    const { work_id: target, ...fields } = report;
    const short = { ...fields, post_id: target };
    const paths: string[] = [];
    const api = new ReportsAPI((async (path: string) => { paths.push(path); return path.includes('?') ? {items:[short],next:0} : short; }) as Transport, 'short-post');
    assert.deepEqual(await api.submit(work, 1, '原图文问题'), short);
    assert.equal((await api.detail(short.id)).post_id, work);
    assert.equal((await api.list()).items[0].post_id, work);
    assert.deepEqual(paths, [`/short-posts/${work}/versions/1/reports`, '/my/short-post-reports/2', '/my/short-post-reports?before=0']);
    assert.throws(() => checkedReport(report, 'short-post'));
    assert.throws(() => checkedReport(short));
    assert.throws(() => checkedReport({...short,work_id:work}, 'short-post'));
    await assert.rejects(new ReportsAPI((async()=>({...short,version:2})) as Transport, 'short-post').submit(work,1,'不可串版'));
});
