// Actual reader/timeline/comments components with DOM adapters and offline fixtures.
// This is not a native layout, navigation, keyboard or real-service test.
const esbuild = require('/tools/node_modules/esbuild');
const { chromium } = require('/tools/node_modules/playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '../..'), id = '11111111-1111-4111-8111-111111111111';
let stage = 'bundle';
(async () => {
  const built = await esbuild.build({ entryPoints: [path.join(__dirname, 'entry.jsx')], bundle: true, write: false,
    define: { 'process.env.EXPO_PUBLIC_API_URL': JSON.stringify('http://127.0.0.1:3300/api'), 'process.env.NODE_ENV': JSON.stringify('development') },
    tsconfigRaw: { compilerOptions: { jsx: 'react-jsx', target: 'ES2022' } }, format: 'esm', jsx: 'automatic', loader: { '.png': 'dataurl' }, nodePaths: ['/app/node_modules'],
    plugins: [{ name: 'fixture', setup(build) {
      build.onResolve({ filter: /^react-native$|^react-native-safe-area-context$/ }, () => ({ path: path.join(__dirname, 'native.jsx') }));
      build.onResolve({ filter: /^expo-router$/ }, () => ({ path: path.join(__dirname, 'router.jsx') }));
      build.onResolve({ filter: /^react-native-svg$/ }, () => ({ path: path.join(__dirname, 'svg.jsx') }));
      build.onResolve({ filter: /\/auth\/context$/ }, () => ({ path: path.join(__dirname, '../mobile-comments-ui/context.jsx') }));
      build.onResolve({ filter: /^expo-crypto$/ }, () => ({ path: 'crypto', namespace: 'fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const randomUUID=()=>crypto.randomUUID();', loader: 'js' }));
    } }],
  });
  const browser = await chromium.launch({ headless: true }), page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let history = false, fail = 0, hold = false, held, paging = false, failMore = false, limited = false, reads = 0;
  const body = (version) => ({ id, version, title: '正文标题' + version, content: '正文内容' + version, introduction: '', tags: [version === 1 ? '日常' : '幻想'], author_nickname: '示例作者', published_at: `2026-11-0${version}T00:00:00Z`, comment_context: 'fixture-context-' + version });
  const node = (version) => ({ version, published_at: body(version).published_at, is_current: version === 2, readable: version === 2 || history });
  const json = (route, value, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'X-Tako-Environment': 'test' }, body: JSON.stringify(value) });
  try {
    await page.route('**/__versions', (route) => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div><script type="module">' + built.outputFiles[0].text.replaceAll('</script', '<\\/script') + '</script>' }));
    await page.route('**/api/works/**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/timeline')) {
        const before = Number(url.searchParams.get('before_version'));
        if (before && failMore) { failMore = false; return json(route, { error: 'service_unavailable' }, 503); }
        return json(route, { history_open: history, versions: (limited ? [2] : paging ? before ? [1] : [2] : [2, 1]).map(node), events: [], next_version_before: paging && !before ? 2 : 0, next_event_before: 0 });
      }
      if (url.pathname.includes('/versions/')) {
        reads++;
        const version = Number(url.pathname.split('/').pop());
        if (hold) { held = { route, version }; return; }
        if (fail) { fail--; return json(route, { error: 'service_unavailable' }, 503); }
        return json(route, body(version));
      }
      if (url.pathname.endsWith('/comments')) return json(route, { items: [], next: 0 });
      return json(route, body(2));
    });
    await page.goto('http://127.0.0.1:3300/__versions');
    await page.getByText('正文内容2', { exact: true }).waitFor();
    stage = 'closed-metadata';
    await page.getByRole('button', { name: '查看版本 1 信息' }).click();
    await page.getByText('作者未开放此历史版本的正文。', { exact: true }).waitFor();
    assert.equal(reads, 0);
    await page.getByRole('button', { name: '打开评论输入' }).click();
    const input = page.getByRole('textbox', { name: '评论正文' });
    await input.fill('切换版本时保留的内存文字');
    await page.getByRole('button', { name: '收起评论', exact: true }).click();
    stage = 'read-open-version';
    history = true;
    await page.getByRole('button', { name: '刷新修订记录' }).click();
    await page.getByRole('button', { name: '阅读此版本', exact: true }).click();
    await page.getByText('正文标题1', { exact: true }).waitFor();
    await page.getByText('正文内容1', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.readerTest.scrolls), 1);
    await page.getByRole('button', { name: '打开评论输入' }).click();
    assert.equal(await input.inputValue(), '切换版本时保留的内存文字');
    await page.getByRole('button', { name: '收起评论', exact: true }).click();
    stage = 'failed-switch';
    fail = 1;
    await page.getByRole('button', { name: '查看版本 2 信息' }).click();
    await page.getByRole('button', { name: '阅读此版本', exact: true }).click();
    await page.getByText('未能切换，已保留本次正文。', { exact: false }).waitFor();
    assert.equal(await page.getByText('正文内容1', { exact: true }).count(), 1);
    await page.getByRole('button', { name: '阅读此版本', exact: true }).click();
    await page.getByText('正文内容2', { exact: true }).waitFor();
    stage = 'stale-switch';
    hold = true;
    await page.getByRole('button', { name: '查看版本 1 信息' }).click();
    await page.getByRole('button', { name: '阅读此版本', exact: true }).click();
    await page.waitForFunction(() => document.body.textContent.includes('正在打开'));
    await page.getByRole('button', { name: '查看版本 2 信息' }).click();
    assert.ok(held);
    await json(held.route, body(held.version)).catch(() => {});
    hold = false;
    await page.waitForTimeout(100);
    assert.equal(await page.getByText('正文内容2', { exact: true }).count(), 1);
    stage = 'paging-retry';
    paging = true;
    await page.getByRole('button', { name: '刷新修订记录' }).click();
    await page.getByRole('button', { name: '更早的修订' }).waitFor();
    failMore = true;
    await page.getByRole('button', { name: '更早的修订' }).click();
    await page.getByRole('button', { name: '重试修订记录' }).click();
    await page.getByRole('button', { name: '查看版本 1 信息' }).waitFor();
    assert.equal(await page.getByRole('button', { name: '查看版本 2 信息' }).count(), 1);
    stage = 'restricted-node';
    limited = true;
    paging = false;
    await page.getByRole('button', { name: '刷新修订记录' }).click();
    await page.waitForFunction(() => !document.querySelector('[aria-label="查看版本 1 信息"]'));

    stage = 'search-reader';
    const card=(suffix='111111111111')=>({id:'11111111-1111-4111-8111-'+suffix,version:2,title:suffix==='111111111111'?'正文标题2':'另一篇合成作品',introduction:'合成搜索简介',tags:['幻想'],author_nickname:'示例作者',first_published_at:'2026-11-02T00:00:00Z'});
    const searches=[];let searchHeld,failPage=true;
    await page.route('**/api/community?*',route=>json(route,{items:[card()],featured:[],tags:[{name:'幻想',count:1}],next_cursor:''}));
    await page.route('**/api/search?*',async route=>{
      const url=new URL(route.request().url()),q=url.searchParams.get('q'),cursor=url.searchParams.get('cursor');searches.push({q,cursor});
      if(q==='慢'){searchHeld=route;return;}
      if(q==='空')return json(route,{items:[],next_cursor:''});
      if(q==='坏')return json(route,{items:[]});
      if(q==='新')return json(route,{items:[card('222222222222')],next_cursor:''});
      if(cursor&&failPage){failPage=false;return json(route,{error:'service_unavailable'},503);}
      return json(route,{items:cursor?[card(),card('222222222222')]:[card()],next_cursor:cursor?'':'next'});
    });
    await page.evaluate(()=>window.readerTest.navigate('/community'));
    await page.getByRole('button',{name:'搜索内容或作者',exact:true}).click();
    await page.getByText('搜索中篇作品',{exact:true}).waitFor();
    const searchInput=page.getByRole('textbox',{name:'搜索关键词'});
    await searchInput.fill('中文%_!');assert.equal(searches.length,0);
    await page.getByRole('button',{name:'搜索',exact:true}).click();
    await page.getByRole('button',{name:'阅读 正文标题2',exact:true}).waitFor();
    assert.equal(searches[0].q,'中文%_!');
    await page.getByRole('button',{name:'加载更多',exact:true}).click();
    await page.getByRole('button',{name:'重试加载更多',exact:true}).click();
    await page.getByRole('button',{name:'阅读 另一篇合成作品',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'阅读 正文标题2',exact:true}).count(),1);
    await page.getByRole('button',{name:'阅读 正文标题2',exact:true}).click();
    await page.getByText('正文内容2',{exact:true}).waitFor();
    await page.getByRole('button',{name:'返回作品列表',exact:true}).click();
    assert.equal(await searchInput.inputValue(),'中文%_!');
    await page.getByRole('button',{name:'阅读 另一篇合成作品',exact:true}).waitFor();
    await searchInput.fill('慢');await page.getByRole('button',{name:'搜索',exact:true}).click();
    await page.waitForFunction(()=>document.body.textContent.includes('正在搜索'));
    await searchInput.fill('新');await page.getByRole('button',{name:'搜索',exact:true}).click();
    await page.getByRole('button',{name:'阅读 另一篇合成作品',exact:true}).waitFor();
    if(searchHeld)await json(searchHeld,{items:[card()],next_cursor:''}).catch(()=>{});
    assert.equal(await page.getByRole('button',{name:'阅读 正文标题2',exact:true}).count(),0);
    await page.getByRole('button',{name:'清除搜索',exact:true}).click();
    await page.getByText('搜索中篇作品',{exact:true}).waitFor();
    await searchInput.fill('空');await page.getByRole('button',{name:'搜索',exact:true}).click();
    await page.getByText('没有找到匹配作品',{exact:true}).waitFor();
    await searchInput.fill('坏');await page.getByRole('button',{name:'搜索',exact:true}).click();
    await page.getByText('搜索未完成',{exact:true}).waitFor();
    await page.getByRole('button',{name:'返回社区',exact:true}).click();
    await page.getByRole('button',{name:'搜索内容或作者',exact:true}).waitFor();
    await page.getByRole('button',{name:'搜索内容或作者',exact:true}).click();
    await page.getByText('搜索中篇作品',{exact:true}).waitFor();
    assert.equal(await searchInput.inputValue(),'');
    assert.deepEqual(errors, []);
    console.log('PASS actual reader component fixtures: metadata only; authorized swap updates body; comment input preserved; failed read keeps body; stale response ignored; paging retry deduplicated; restricted node absent. Not native-device evidence.');
  } catch (e) {
    fs.mkdirSync(path.join(root, '.runtime/mobile/qa'), { recursive: true });
    await page.screenshot({ path: path.join(root, '.runtime/mobile/qa/versions-component-failure.png') });
    console.error('Version component stage: ' + stage + '; page errors: ' + JSON.stringify(errors));
    console.error('reader_fixture_line='+(String(e.stack).match(/run\.cjs:(\d+):/)?.[1] ?? '0'));
    throw e;
  } finally { await browser.close(); }
})().catch((e) => { console.error('Version component failed: ' + e.name); process.exit(1); });
