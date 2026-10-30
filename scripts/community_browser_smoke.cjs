// Only the disposable writing_test stack. All content/session fixtures are synthetic.
const {chromium} = require('/app/node_modules/playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
(async()=>{
 const folder=process.env.B1_FIXTURE_DIR, origin='http://localhost:3200';
 const fixture=JSON.parse(fs.readFileSync(folder+'/session.json','utf8'));
 const published=JSON.parse(fs.readFileSync(folder+'/result.json','utf8'));
 const browser=await chromium.launch({headless:true});
 const anonymous=await browser.newContext({viewport:{width:1440,height:1000}});
 const page=await anonymous.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(origin+'/');await page.getByRole('link',{name:'进入社区',exact:true}).click();
 await page.getByRole('heading',{name:'社区',exact:true}).waitFor();
 await page.locator('.community-latest').locator('a[href="/works/'+published.work_id+'"]').waitFor();
 const brandX=await page.locator('.app-brand').evaluate(el=>el.getBoundingClientRect().x);
 const operator=await browser.newContext({viewport:{width:1440,height:1000}});
 await operator.addCookies([{name:'tako_session',value:fixture.operator_token,url:origin,httpOnly:true,sameSite:'Lax'}]);
 const ops=await operator.newPage();ops.on('pageerror',error=>errors.push(error.message));
 await ops.goto(origin+'/ops/curation');
 await ops.getByRole('heading',{name:'当前精选',exact:true}).waitFor();
 const initial=await (await operator.request.get(origin+'/api/ops/curation')).json();
 await ops.getByLabel('作品链接或 ID').fill(origin+'/works/'+published.work_id);
 await ops.getByRole('button',{name:'检查作品',exact:true}).click();
 await ops.getByRole('heading',{name:'浏览器旧版作品',exact:true}).waitFor();
 await ops.getByRole('button',{name:'选入精选',exact:true}).click();
 let mutation='';
 await ops.route('**/api/ops/curation',async route=>{
  if(route.request().method()!=='POST'){await route.continue();return}
  mutation=route.request().postDataJSON().mutation_id;
  await route.fetch();await route.abort('connectionreset');
 });
 await ops.getByRole('button',{name:'确认选入',exact:true}).click();
 await ops.getByRole('status').filter({hasText:'网络未确认结果'}).waitFor();
 await ops.unroute('**/api/ops/curation');
 await ops.getByRole('button',{name:'检查原操作',exact:true}).click();
 await ops.getByRole('status').filter({hasText:'原操作已确认'}).waitFor();
 const current=await (await operator.request.get(origin+'/api/ops/curation')).json();
 assert.equal(current.revision,initial.revision+1);assert.equal(current.slots.filter(slot=>slot.work?.id===published.work_id).length,1);
 await page.reload();
 await page.locator('.community-featured').getByRole('link',{name:'浏览器旧版作品',exact:true}).waitFor();
 await page.screenshot({path:'/materials/docs/design/community-desktop.png',fullPage:true});
 await page.locator('.community-featured').getByRole('link',{name:'浏览器旧版作品',exact:true}).click();
 await page.getByRole('heading',{name:'浏览器旧版作品',level:1,exact:true}).waitFor();
 assert.equal(await page.locator('.app-brand').evaluate(el=>el.getBoundingClientRect().x),brandX);
 await page.getByRole('navigation',{name:'主导航'}).getByRole('link',{name:'社区',exact:true}).click();
 await page.getByRole('heading',{name:'社区',exact:true}).waitFor();
 // Query failure is a UI state, not a successful empty list. Restore the actual API and retry.
 await page.route('**/api/community?tag=*',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'service_unavailable',request_id:crypto.randomUUID()})}));
 await page.getByRole('navigation',{name:'作品风格'}).getByRole('link',{name:/^幻想/}).click();
 await page.getByRole('heading',{name:'暂时无法浏览作品',exact:true}).waitFor();
 await page.unroute('**/api/community?tag=*');await page.getByRole('button',{name:'重新加载',exact:true}).click();
 await page.getByRole('heading',{name:'幻想 · 最新发布',exact:true}).waitFor();
 const owner=await browser.newContext({viewport:{width:1440,height:1000}});
 await owner.addCookies([{name:'tako_session',value:fixture.token,url:origin,httpOnly:true,sameSite:'Lax'}]);
 const authorPage=await owner.newPage();
 for(const path of ['/workspace','/my-works','/publish?draft='+published.draft_id,'/moderation','/account']){
  await authorPage.goto(origin+path);await authorPage.locator('.app-brand').waitFor();
  assert.equal(await authorPage.locator('.app-brand').evaluate(el=>el.getBoundingClientRect().x),brandX,'header moved on '+path);
  assert.equal(await authorPage.getByRole('navigation',{name:'主导航'}).getByRole('link',{name:'社区',exact:true}).count(),1);
 }
 const change=async action=>{
  const state=await (await owner.request.get(origin+'/api/my/works/'+published.work_id)).json();
  const response=await owner.request.post(origin+'/api/my/works/'+published.work_id+'/actions',{headers:{Origin:origin},data:{mutation_id:crypto.randomUUID(),expected_state_revision:state.state_revision,action}});assert.equal(response.status(),200);
 };
 await change('hide');
 const noJS=await browser.newContext({javaScriptEnabled:false});const document=await noJS.newPage();
 const hidden=await document.goto(origin+'/community');assert.equal(hidden.status(),200);assert.equal(hidden.headers()['cache-control'],'no-store');assert.equal(await document.locator('a[href="/works/'+published.work_id+'"]').count(),0);
 await change('restore');await document.reload();assert.equal(await document.locator('a[href="/works/'+published.work_id+'"]').count(),1);
 const catalog=await (await anonymous.request.get(origin+'/api/community')).json();assert(!catalog.featured.some(work=>work.id===published.work_id),'restoring auto-selected work');
 await page.goto(origin+'/community');await page.setViewportSize({width:390,height:844});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.getByRole('button',{name:'菜单',exact:true}).click();
 await page.getByRole('navigation',{name:'主导航'}).getByRole('link',{name:'写作空间',exact:true}).waitFor();
 await page.getByRole('button',{name:'收起菜单',exact:true}).click();
 await page.screenshot({path:'/materials/docs/design/community-mobile.png',fullPage:true});
 await ops.reload();await ops.getByText('已撤出，需重新选入',{exact:true}).waitFor();
 await ops.screenshot({path:'/materials/docs/design/community-curation-desktop.png',fullPage:true});
 assert.deepEqual(errors,[]);
 fs.writeFileSync(folder+'/community-result.json',JSON.stringify({mutation_id:mutation}));
 await browser.close();
 console.log('PASS: official -> community -> reader -> community; real curation lost-response retry once; hide/restore never auto-selects; anonymous SSR no metadata leak; tag error/retry; shared header anchors and mobile menu.');
})().catch(error=>{console.error(error.stack);process.exit(1)});
