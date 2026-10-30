// Runs the real Nuxt pages. Auth responses are isolated browser fixtures: no email is sent.
const {chromium}=require('/app/node_modules/playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true});
 const context=await browser.newContext();const page=await context.newPage();const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 let sending=false;
 await page.route('**/api/**',async route=>{const path=new URL(route.request().url()).pathname;if(path==='/api/auth/code'){sending=true;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'mail_unavailable',request_id:'ui-fixture'})})}return route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({error:'authentication_required',request_id:'ui-fixture'})});});
 await page.goto('http://localhost/workspace');await page.getByRole('heading',{name:'登录 Tako',exact:true}).waitFor();
 await page.locator('.login-mascot img').first().evaluate(i=>i.decode());await page.waitForFunction(()=>document.querySelectorAll('.login-mascot img').length===2);
 for(const width of [1440,820,390]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);if(width!==820)await page.screenshot({path:`/materials/docs/design/real-login-v3-${width}.png`,fullPage:true});}
 await page.getByLabel('验证码',{exact:true}).focus();assert.equal(await page.locator('.login-mascot').getAttribute('data-expression'),'closed');await page.screenshot({path:'/materials/docs/design/real-login-v3-closed.png',fullPage:true});
 await page.emulateMedia({reducedMotion:'reduce'});await page.waitForFunction(()=>document.querySelector('.login-mascot').dataset.expression==='open');
 await page.getByLabel('邮箱',{exact:true}).fill('review@example.com');await page.getByRole('button',{name:'获取验证码',exact:true}).click();await page.getByRole('status').filter({hasText:'邮件服务暂不可用'}).waitFor();assert(sending);assert.equal(await page.locator('.login-mascot').getAttribute('data-state'),'error');
 const fallback=await browser.newPage();await fallback.route('**/images/tako-login-chibi-*.png',r=>r.abort());await fallback.route('**/api/me',r=>r.fulfill({status:401,contentType:'application/json',body:'{"error":"authentication_required"}'}));await fallback.goto('http://localhost/workspace');await fallback.getByLabel('邮箱',{exact:true}).fill('fallback@example.com');assert(await fallback.getByRole('button',{name:'获取验证码',exact:true}).isEnabled());
 assert.deepEqual(errors,[]);console.log('PASS real Nuxt UI: Q mascot focus, reduced motion, mail failure state, asset failure fallback, 390/820/1440 overflow check. Provider response is a fixture; no mail sent.');await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
