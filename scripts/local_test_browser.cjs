// Real service, normal password login; exclusively the dedicated local test stack.
const {chromium}=require('/app/node_modules/playwright');
const fs=require('node:fs'), assert=require('node:assert/strict');
(async()=>{
 const cfg=Object.fromEntries(fs.readFileSync('/materials/.runtime/local-test/.env','utf8').split(/\r?\n/).filter(x=>x&&!x.startsWith('#')).map(x=>{const i=x.indexOf('=');return[x.slice(0,i),x.slice(i+1)]}));
 const origin='http://127.0.0.1:3300', browser=await chromium.launch({headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000}}), page=await context.newPage(), errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/community');
 assert.equal((await context.request.get(origin+'/api/community')).headers()['x-tako-environment'],'test');
 await page.getByText('测试环境 · 合成数据，仅供验收',{exact:true}).waitFor();
 assert.equal(await page.locator('.community-featured .discovery-card').count(),6);
 assert.equal(await page.locator('.community-latest .discovery-card').count(),12);
 await page.getByRole('button',{name:'加载更多作品',exact:true}).click();
 await page.waitForFunction(()=>document.querySelectorAll('.community-latest .discovery-card').length===24);
 const links=await page.locator('.community-latest h3 a').evaluateAll(xs=>xs.map(x=>x.getAttribute('href')));
 assert.equal(new Set(links).size,24);
 for(const width of [1440,820,390]){
  await page.setViewportSize({width,height:1000});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'community overflow '+width);
  await page.screenshot({path:'/materials/docs/design/community-large-'+width+'.png',fullPage:true});
 }
 await page.setViewportSize({width:1440,height:1000});
 await page.getByRole('navigation',{name:'作品风格'}).getByRole('link',{name:/^幻想/}).click();
 await page.getByRole('heading',{name:'幻想 · 最新发布',exact:true}).waitFor();
 await page.locator('.community-latest h3 a').first().click();
 await page.locator('.publication-body').waitFor();
 await page.getByRole('navigation',{name:'主导航'}).getByRole('link',{name:'社区',exact:true}).click();
 await page.goto(origin+'/workspace');
 await page.getByLabel('邮箱',{exact:true}).fill('author@tako-test.invalid');
 await page.getByLabel('密码',{exact:true}).fill(cfg.TEST_AUTHOR_PASSWORD);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.getByRole('button',{name:'新建草稿',exact:true}).waitFor();
 const exitStyle=await page.getByRole('button',{name:'退出登录',exact:true}).evaluate(el=>{const s=getComputedStyle(el);return [s.fontSize,s.fontWeight,s.lineHeight,s.padding,s.color,s.backgroundColor,s.borderWidth]});
 assert((await context.cookies()).some(c=>c.name==='tako_test_session'));
 await page.screenshot({path:'/materials/docs/design/test-workspace-large.png',fullPage:true});
 await page.goto(origin+'/my-works');
 await page.getByRole('heading',{name:'作品管理',exact:true}).waitFor();
 await page.locator('.manager-reading').waitFor();
 await page.waitForFunction(()=>document.querySelector('.manager-workspace')?.getAttribute('aria-busy')==='false');
 const bounds=await page.locator('.manager-workspace').boundingBox();
 for(const name of ['作品设置','管理记录','内容与版本']){
  await page.getByRole('button',{name,exact:true}).click();
  const after=await page.locator('.manager-workspace').boundingBox();
  assert.equal(after.x,bounds.x);assert.equal(after.y,bounds.y);assert.equal(after.width,bounds.width);assert.equal(after.height,bounds.height);
 }
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'manager overflow '+width);
  await page.screenshot({path:'/materials/docs/design/test-manager-large-'+width+'.png',fullPage:true});
 }
 await page.setViewportSize({width:1440,height:1000});
 await page.goto(origin+'/account');
 await page.getByRole('button',{name:'退出登录',exact:true}).waitFor();
 assert.deepEqual(await page.getByRole('button',{name:'退出登录',exact:true}).evaluate(el=>{const s=getComputedStyle(el);return [s.fontSize,s.fontWeight,s.lineHeight,s.padding,s.color,s.backgroundColor,s.borderWidth]}),exitStyle);
 await page.route('**/api/auth/logout',route=>route.abort('connectionreset'));
 await page.getByRole('button',{name:'退出登录',exact:true}).click();
 await page.getByRole('alert').filter({hasText:'未能确认退出，请重试。'}).waitFor();
 await page.unroute('**/api/auth/logout');
 await page.getByRole('button',{name:'退出登录',exact:true}).click();
 await page.getByLabel('邮箱',{exact:true}).waitFor();
 assert.equal((await context.request.get(origin+'/api/me')).status(),401);
 await page.getByLabel('邮箱',{exact:true}).fill('author@tako-test.invalid');
 await page.getByLabel('密码',{exact:true}).fill(cfg.TEST_AUTHOR_PASSWORD);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.getByRole('button',{name:'新建草稿',exact:true}).waitFor();
 await page.goto(origin+'/community');await page.setViewportSize({width:390,height:844});
 await page.getByRole('button',{name:'菜单',exact:true}).click();
 await page.getByRole('button',{name:'退出登录',exact:true}).click();
 await page.getByLabel('邮箱',{exact:true}).waitFor();
 assert.equal((await context.request.get(origin+'/api/me')).status(),401);
 assert.deepEqual(errors,[]);
 await browser.close();
 console.log('PASS: test identity; 6 featured / 24 unique paged works; tag -> reader -> community; normal login; desktop/tablet/mobile no horizontal overflow.');
})().catch(()=>{console.error('Local test browser acceptance failed; inspect test-only screenshots and selectors.');process.exit(1)});
