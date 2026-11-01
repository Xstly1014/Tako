// Dedicated persistent local-test environment; only synthetic identities/content.
const {chromium}=require('/app/node_modules/playwright');
const fs=require('node:fs'),crypto=require('node:crypto'),assert=require('node:assert/strict');
(async()=>{
 const cfg=Object.fromEntries(fs.readFileSync('/materials/.runtime/local-test/.env','utf8').split(/\r?\n/).filter(x=>x&&!x.startsWith('#')).map(x=>{const i=x.indexOf('=');return[x.slice(0,i),x.slice(i+1)]}));
 const ns=Buffer.from(cfg.TEST_DATASET_ID.replaceAll('-',''),'hex'),raw=crypto.createHash('sha1').update(ns).update('work/1').digest().subarray(0,16);raw[6]=(raw[6]&15)|80;raw[8]=(raw[8]&63)|128;
 const hex=raw.toString('hex'),work=[hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
 const origin='http://127.0.0.1:3300',browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const owner=await browser.newContext();
 const response=await owner.request.post(origin+'/api/auth/login',{headers:{Origin:origin},data:{email:'author@tako-test.invalid',password:cfg.TEST_AUTHOR_PASSWORD}});assert.equal(response.status(),200);
 const state=async()=>{const r=await owner.request.get(origin+'/api/my/works/'+work);assert.equal(r.status(),200);return r.json()};
 const change=async(action)=>{const s=await state();const r=await owner.request.post(origin+'/api/my/works/'+work+'/actions',{headers:{Origin:origin},data:{mutation_id:crypto.randomUUID(),expected_state_revision:s.state_revision,action}});assert.equal(r.status(),200)};
 let hidden=false;
 try {
  assert.equal((await state()).author_hidden,false);
  await page.goto(origin+'/works/'+work);
  await page.getByRole('button',{name:'登录后收藏',exact:true}).click();
  await page.getByLabel('邮箱',{exact:true}).fill('reader@tako-test.invalid');await page.getByLabel('密码',{exact:true}).fill(cfg.TEST_READER_PASSWORD);await page.getByRole('button',{name:'登录',exact:true}).click();
  await page.getByRole('button',{name:/^(收藏作品|已收藏)$/}).waitFor();
  if(await page.getByRole('button',{name:'已收藏',exact:true}).count()){await page.getByRole('button',{name:'已收藏',exact:true}).click();await page.getByRole('button',{name:'收藏作品',exact:true}).waitFor()}
  await page.route('**/api/my/favorites/'+work,async route=>{if(route.request().method()!=='POST'){await route.continue();return}await route.fetch();await route.abort('connectionreset')});
  await page.getByRole('button',{name:'收藏作品',exact:true}).click();await page.getByRole('button',{name:'检查原操作',exact:true}).waitFor();
  await page.unroute('**/api/my/favorites/'+work);await page.getByRole('button',{name:'检查原操作',exact:true}).click();await page.getByRole('button',{name:'已收藏',exact:true}).waitFor();
  await page.getByRole('navigation',{name:'主导航'}).getByRole('link',{name:'我的收藏',exact:true}).click();
  await page.locator('a[href="/works/'+work+'"]').waitFor();
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:'/materials/docs/design/favorites-'+width+'.png',fullPage:true})}
  const listed=await(await context.request.get(origin+'/api/my/favorites')).json();assert.equal(listed.items.filter(x=>x.work_id===work).length,1);
  await change('hide');hidden=true;await page.reload();await page.getByRole('heading',{name:'作品暂不可访问',exact:true}).waitFor();
  const privateList=await(await context.request.get(origin+'/api/my/favorites')).json();assert.equal(privateList.items.find(x=>x.work_id===work).work,null);
  await page.getByRole('button',{name:'取消收藏',exact:true}).click();await page.getByRole('heading',{name:'还没有收藏作品',exact:true}).waitFor();
  await change('restore');hidden=false;await page.reload();await page.getByRole('heading',{name:'还没有收藏作品',exact:true}).waitFor();
  await page.route('**/api/my/favorites',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'service_unavailable'})}));await page.reload();await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('heading',{name:'还没有收藏作品',exact:true}).count(),0);await page.unroute('**/api/my/favorites');await page.getByRole('button',{name:'重新加载',exact:true}).click();await page.getByRole('heading',{name:'还没有收藏作品',exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  console.log('PASS: anonymous reading -> inline normal login -> lost-response favorite retry once -> my favorites; desktop/mobile; hidden metadata null and cancellation; restored work does not resurrect cancelled relation; error distinct from empty.');
 }finally{if(hidden)await change('restore');await browser.close()}
})().catch(()=>{console.error('Favorites browser acceptance failed; inspect test-only selectors and screenshots.');process.exit(1)});
