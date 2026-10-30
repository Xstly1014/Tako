const {chromium}=require('/app/node_modules/playwright');
const assert=require('node:assert/strict');
(async()=>{
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('file:///materials/docs/prototypes/brand-v3/index.html');
await page.evaluate(()=>document.fonts.ready);await page.locator('#face').evaluate(i=>i.decode());
await page.locator('#reduce').check();
await page.screenshot({path:'/materials/docs/prototypes/brand-v3/login-desktop.png',fullPage:true});
await page.locator('#send').click();assert.match(await page.locator('#form-message').innerText(),/完整邮箱/);
await page.locator('#email').fill('review@example.com');await page.locator('#fail').check();await page.locator('#send').click();await page.waitForTimeout(750);assert.match(await page.locator('#form-message').innerText(),/未能发出/);
await page.locator('#fail').uncheck();await page.locator('#send').click();await page.waitForTimeout(750);await page.locator('#code').fill('123456');await page.locator('#submit').click();assert.match(await page.locator('#form-message').innerText(),/交互完成/);
await page.locator('#no-art').check();assert(await page.locator('#face').isHidden());assert(await page.locator('#submit').isEnabled());await page.locator('#no-art').uncheck();
await page.locator('#reset-login').click();await page.locator('#reduce').uncheck();await page.locator('#code').focus();assert.equal(await page.locator('#face').getAttribute('data-expression'),'closed');await page.locator('#email').focus();assert.equal(await page.locator('#face').getAttribute('data-expression'),'open');await page.locator('#reduce').check();
await page.locator('[data-view=timeline]').click();await page.locator('#node-1').click();assert.equal(await page.locator('.node.public').getAttribute('id'),'node-5');assert.match(await page.locator('#status').innerText(),/历史版本预览/);
await page.locator('#set-display').click();await page.locator('#cancel').click();assert.equal(await page.locator('.node.public').getAttribute('id'),'node-5');
await page.locator('#set-display').click();await page.locator('#confirm-display').click();assert.equal(await page.locator('.node.public').getAttribute('id'),'node-1');
await page.locator('#node-3').click();assert(await page.locator('#set-display').isDisabled());await page.locator('#reader').check();assert.equal(await page.locator('#node-3').count(),0);
await page.locator('#node-2').click();assert.match(await page.locator('#version-title').innerText(),/未开放/);await page.locator('#reader').uncheck();await page.locator('#history').check();await page.locator('#reader').check();assert.match(await page.locator('#body-text').innerText(),/学生票/);
await page.locator('#reset-timeline').click();await page.locator('#node-5').focus();await page.keyboard.press('ArrowLeft');assert.equal(await page.locator('.node.selected').getAttribute('id'),'node-4');
await page.screenshot({path:'/materials/docs/prototypes/brand-v3/timeline-desktop.png',fullPage:true});
await page.locator('#many').check();assert.equal(await page.locator('.node').count(),7);await page.locator('#rail .node').last().focus();await page.keyboard.press('Home');assert.equal(await page.locator('.node.selected').getAttribute('id'),'node-1');await page.keyboard.press('End');assert.equal(await page.locator('.node.selected').getAttribute('id'),'node-24');
for(const width of [390,820,1440]){await page.setViewportSize({width,height:900});for(const view of ['login','timeline','brand']){await page.locator(`[data-view=${view}]`).click();await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`overflow ${view} ${width}`);if(width===390)await page.screenshot({path:`/materials/docs/prototypes/brand-v3/${view}-mobile.png`,fullPage:true});}}
await page.emulateMedia({reducedMotion:'reduce'});await page.locator('[data-view=login]').click();await page.locator('#code').focus();assert.equal(await page.locator('#face').getAttribute('data-expression'),'open');
assert.deepEqual(errors,[]);console.log('PASS: sample login validation/failure/success/art fallback/reduced motion; preview separate from display, confirmed switch, restricted-reader filtering, history access, keyboard/windowing; 390/820/1440 no overflow. UI samples only, no live API calls.');await browser.close();
})().catch(e=>{console.error(e);process.exitCode=1;});
