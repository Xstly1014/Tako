// Run only against the isolated writing_test stack described in docs/b1-testing.md.
// The session is a synthetic test fixture, not a production login bypass.
const { chromium } = require('/app/node_modules/playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
(async()=>{
 const folder=process.env.B1_FIXTURE_DIR || '/materials/.runtime/b1-test'; const fixture=JSON.parse(fs.readFileSync(folder+'/session.json','utf8'));
 const browser=await chromium.launch({headless:true}); const context=await browser.newContext();const origin='http://localhost:3200';
 if(process.env.B1_CHECK_HIDDEN==='true'){
  const saved=JSON.parse(fs.readFileSync(folder+'/result.json','utf8')); const anonymous=await browser.newContext({javaScriptEnabled:false});const page=await anonymous.newPage();
  const response=await page.goto(origin+'/works/'+saved.work_id);assert.equal(response.status(),404);assert(! (await page.content()).includes('浏览器旧版作品'));assert((await page.content()).includes('内容暂不可访问'));await anonymous.close();await browser.close();console.log('PASS: hidden work SSR returns 404 without private title/content.');return;
 }
 await context.addCookies([{name:'tako_session',value:fixture.token,url:origin,httpOnly:true,sameSite:'Lax'}]);
 const post=async(path,data)=>{const response=await context.request.post(origin+path,{data,headers:{Origin:origin}});assert.equal(response.status(),200,'HTTP fixture write failed: '+path);return response.json()};
 const created=await post('/api/drafts/create',{mutation_id:crypto.randomUUID(),title:'浏览器旧版作品',content:'这份文字已经完整，作者明确选择发布它。'});
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/workspace');await page.locator('.draft-sidebar .draft-item').filter({hasText:'浏览器旧版作品'}).click();await page.getByRole('button',{name:'准备发布',exact:true}).click();await page.waitForURL('**/publish?**');
 await page.getByLabel('简介（可选，最多 300 字）').fill('作者填写的分享简介');await page.getByLabel('幻想',{exact:true}).check();await page.getByLabel('我确认本次内容为原创，或已取得发布授权。').check();await page.getByRole('button',{name:'生成发布预览',exact:true}).click();await page.getByRole('button',{name:'确认发布 R1',exact:true}).waitFor();
 await post('/api/drafts/save',{mutation_id:crypto.randomUUID(),draft_id:created.draft_id,base_revision:1,title:'尚未发布的新标题',content:'另一个设备更新的工作稿，不能被旧发布覆盖。'});await page.reload();await page.getByText('工作稿已有 R2。',{exact:false}).waitFor();
 // Let the real server commit, then deliberately lose the response at the browser.
 await page.route('**/api/publications',async route=>{await route.fetch();await route.abort('connectionreset')});await page.getByRole('button',{name:'确认发布 R1',exact:true}).click();await page.getByRole('status').filter({hasText:'网络未确认'}).waitFor();await page.unroute('**/api/publications');await page.getByRole('button',{name:'确认发布 R1',exact:true}).click();await page.getByRole('heading',{name:'发布已确认 · V1'}).waitFor();
 const draft=await (await context.request.get(origin+'/api/drafts/'+created.draft_id)).json();assert.equal(draft.revision,2);assert.equal(draft.title,'尚未发布的新标题');
 const link=page.getByRole('link',{name:'打开作品链接'});const target=await link.getAttribute('href');await link.click();await page.getByRole('heading',{name:'浏览器旧版作品',exact:true}).waitFor();assert(!(await page.locator('.publication-body').innerText()).includes('另一个设备'));
 const anon=await browser.newContext({javaScriptEnabled:false});const publicPage=await anon.newPage();const response=await publicPage.goto(origin+target);assert.equal(response.status(),200);assert.equal(response.headers()['cache-control'],'no-store');await publicPage.getByRole('heading',{name:'浏览器旧版作品',exact:true}).waitFor();await publicPage.setViewportSize({width:390,height:844});assert.equal(await publicPage.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
 fs.writeFileSync(folder+'/result.json',JSON.stringify({work_id:target.split('/').at(-1),draft_id:created.draft_id}));await anon.close();await context.close();await browser.close();console.log('PASS: real browser/API/MySQL fixed old preview, lost-response retry -> one V1, newer draft preserved, anonymous SSR/no-store/mobile layout. No email was sent.');
})().catch(e=>{console.error(e.message);process.exitCode=1});
