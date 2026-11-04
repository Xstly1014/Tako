import {mkdirSync} from 'node:fs'
import { test, expect, type Page } from '@playwright/test'
const actor = '11111111-1111-4111-8111-111111111111',
  other = '99999999-9999-4999-8999-999999999999',
  work = '22222222-2222-4222-8222-222222222222',
  submission = '33333333-3333-4333-8333-333333333333',
  preview = '44444444-4444-4444-8444-444444444444',
  draft = '55555555-5555-4555-8555-555555555555',
  at = '2026-11-04T00:00:00Z'
async function fixture(page: Page) {
  const f = {
    actor,
    writes: [] as Record<string, unknown>[],
    receipt: null as Record<string, unknown> | null,
    state: 'pending',
    drop: true,
  }
  await page.route('**/api/**', async (r) => {
    const req = r.request(),
      p = new URL(req.url()).pathname
    const reply = (body: unknown, status = 200) =>
      r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (p === '/api/me') return reply({ id: f.actor, nickname: '合成运营' })
    if (p === '/api/me/access') return reply({ operator: true })
    if (p.endsWith('/author-policy'))
      return reply({
        policy: { revision: 0, active: false, reason: '', observation_until: null },
        items: [],
        next: 0,
      })
    if (p.includes('/work-submission-requests/'))
      return f.receipt ? reply(f.receipt) : reply({ error: 'resource_not_found' }, 404)
    const item = {
      id: submission,
      work_id: work,
      preview_id: preview,
      candidate_version: 2,
      state: f.state,
      title: '已提交的固定中篇',
      reason: '',
      accepted_at: at,
      first_waiting_at: at,
      decided_at: f.state === 'pending' ? null : at,
    }
    if (req.method() === 'POST') {
      const body = req.postDataJSON()
      f.writes.push(body)
      f.state = p.endsWith('/withdraw')
        ? 'withdrawn'
        : body.decision === 'approve'
          ? 'published'
          : 'rejected'
      f.receipt = {
        mutation_id: body.mutation_id,
        work_id: work,
        submission_id: submission,
        state: f.state,
        version: f.state === 'published' ? 2 : 0,
      }
      if (f.drop) {
        f.drop = false
        return r.abort()
      }
      return reply(f.receipt)
    }
    if (p.endsWith('/work-submissions'))
      return reply({ items: f.state === 'pending' ? [item] : [], next_cursor: '' })
    if (p.endsWith('/' + submission))
      return reply({
        submission: item,
        preview: {
          id: preview,
          draft_id: draft,
          source_revision: 3,
          expected_version: 1,
          title: item.title,
          content: '明确提交后才给运营核对的固定正文。',
          introduction: '固定简介',
          tags: ['幻想'],
          created_at: at,
          expires_at: '2026-11-05T00:00:00Z',
        },
      })
    return reply({ error: 'resource_not_found' }, 404)
  })
  return f
}

test('中篇先审丢响应重开只查原结果，不把固定正文放入操作记录', async ({ page }) => {
  const f = await fixture(page)
  await page.goto('/ops/work-submissions')
  await page.getByRole('button', { name: '已提交的固定中篇 等待审核' }).click()
  await expect(page.locator('.fixed-text')).toContainText('明确提交后才给运营核对')
mkdirSync('../.runtime/work-pre-review',{recursive:true});await page.screenshot({path:'../.runtime/work-pre-review/desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'../.runtime/work-pre-review/mobile.png',fullPage:true});
  await page.getByRole('button', { name: '核对通过', exact: true }).click()
  await page.getByRole('button', { name: '确认执行', exact: true }).click()
  await expect(page.getByRole('heading', { name: '原操作待确认', exact: true })).toBeVisible()
  expect(f.writes.length).toBe(1)
  expect(
    await page.evaluate(() =>
      Object.values(sessionStorage).join('').includes('明确提交后才给运营核对'),
    ),
  ).toBe(false)
  await page.reload()
  await page.getByRole('button', { name: '查询原结果', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('原操作已确认')
  expect(f.writes.length).toBe(1)
  await expect(page.getByRole('link', { name: '返回正式内容治理' })).toHaveAttribute(
    'href',
    '/ops/reviews',
  )
})

test('作者撤回和运营驳回只操作选中的固定提交', async ({ page }) => {
  const f = await fixture(page)
  f.drop = false
  await page.goto('/my-submissions')
  await page.getByRole('button', { name: '已提交的固定中篇 等待审核' }).click()
  await page.getByRole('button', { name: '核对撤回', exact: true }).click()
  await page.getByRole('button', { name: '确认执行', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('原操作已确认')
  expect(Object.keys(f.writes[0]!)).toEqual(['mutation_id'])
  f.state = 'pending'
  await page.goto('/ops/work-submissions')
  await page.getByRole('button', { name: '已提交的固定中篇 等待审核' }).click()
  await page.getByRole('button', { name: '核对驳回', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('填写驳回原因')
  await page.getByLabel('处理原因').fill('请补全结尾')
  await page.getByRole('button', { name: '核对驳回', exact: true }).click()
  await page.getByRole('button', { name: '确认执行', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('原操作已确认')
  expect(f.writes[1]).toMatchObject({ decision: 'reject', reason: '请补全结尾' })
})

test('存储失败不发送；账号变化隐藏旧固定正文和原操作', async ({ page }) => {
  const f = await fixture(page)
  await page.goto('/ops/work-submissions')
  await page.getByRole('button', { name: '已提交的固定中篇 等待审核' }).click()
  await page.getByRole('button', { name: '核对通过', exact: true }).click()
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('test', 'QuotaExceededError')
    }
  })
  await page.getByRole('button', { name: '确认执行', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('请求未发出')
  expect(f.writes.length).toBe(0)
  f.actor = other
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByRole('status')).toContainText('会话已变化')
  await expect(page.locator('.fixed-text')).toHaveCount(0)
})
