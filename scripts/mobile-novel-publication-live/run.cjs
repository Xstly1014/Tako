// Actual ChapterPublishScreen, publisher, API decoders and Session -> real test API/MySQL.
// Platform journal/navigation/DOM adapters; no native persistence or device claim.
const esbuild=require('/tools/node_modules/esbuild'),{chromium}=require('/tools/node_modules/playwright');
const path=require('node:path'),assert=require('node:assert/strict'),fs=require('node:fs'),{randomUUID}=require('node:crypto');let stage='preflight',operatorToken="";
async function api(path,body,token=operatorToken){const response=await fetch('http://api:8080/api'+path,{method:body===undefined?'GET':'POST',headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});if(response.headers.get('X-Tako-Environment')!=='test')throw Error('environment');if(response.status===204&&response.ok)return;const value=await response.json();if(!response.ok)throw Error('test_api_rejected');return value}

(async()=>{
 const preflight=await fetch('http://api:8080/api/community');if(!preflight.ok||preflight.headers.get('X-Tako-Environment')!=='test')throw Error('test_service_required');
 const env=Object.fromEntries(fs.readFileSync('/materials/.runtime/local-test/.env','utf8').split(/\r?\n/).filter(v=>v.includes('=')&&!v.startsWith('#')).map(v=>{const p=v.indexOf('=');return [v.slice(0,p),v.slice(p+1)]}));
 const operator=await api('/app/auth/login',{email:'operator@tako-test.invalid',password:env.TEST_OPERATOR_PASSWORD},'');operatorToken=operator.access_token;
 stage='bundle';
  const built = await esbuild.build({ entryPoints: [path.join(__dirname, 'entry.jsx')], bundle: true, write: false,
    define: { 'process.env.EXPO_PUBLIC_API_URL': JSON.stringify('http://127.0.0.1:3300/api'), 'process.env.NODE_ENV': JSON.stringify('development') },
    tsconfigRaw: { compilerOptions: { jsx: 'react-jsx', target: 'ES2022' } }, format: 'esm', jsx: 'automatic', loader: { '.png': 'dataurl' }, nodePaths: ['/app/node_modules'],
    plugins: [{ name: 'fixture', setup(build) {
      build.onResolve({ filter: /^react-native$|^react-native-safe-area-context$/ }, () => ({ path: path.join(__dirname, 'native.jsx') }));
      build.onResolve({filter:/\/components\/PrototypeUi$/},()=>({path:'chrome',namespace:'fixture-chrome'}));
      build.onLoad({filter:/.*/,namespace:'fixture-chrome'},()=>({contents:'export const BottomNavigation=()=>null;',loader:'js'}));
      build.onResolve({filter:/^\.\.\/native$|^\.\/native$/},args=>/ChapterPublishScreen.tsx|NovelManagementScreen.tsx/.test(args.importer)?{path:path.join(__dirname,'journal.jsx')}:undefined);
      build.onResolve({ filter: /^expo-router$/ }, () => ({ path: path.join(__dirname, 'router.jsx') }));
      build.onResolve({ filter: /^react-native-svg$/ }, () => ({ path: path.join(__dirname, '../mobile-versions-ui/svg.jsx') }));
      build.onResolve({ filter: /\/auth\/context$/ }, () => ({ path: path.join(__dirname, '../mobile-author-works-ui/context.jsx') }));
      build.onResolve({ filter: /^expo-crypto$/ }, () => ({ path: 'crypto', namespace: 'fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const randomUUID=()=>crypto.randomUUID();', loader: 'js' }));
    } }],
  });

 const browser=await chromium.launch({headless:true}),page=await browser.newPage();let dropped=false,dropVisibility=true,dropMetadata=true,failManagementRefresh=false;const submissions=[],managementWrites=[],errors=[];
 let caseFixture=null,caseAppeals=[],caseWrites=0,dropAppeal=true,appealReceipt=null,realAppealDrop=true,realAppealWrites=0;page.on('pageerror',e=>errors.push(e.name));
 try{
  await page.route('**/__novel-publication',r=>r.fulfill({contentType:'text/html',body:'<style>*{box-sizing:border-box}html,body,#root{margin:0;height:100%;width:100%;font-family:Arial,\"Microsoft YaHei\",sans-serif}#root{display:flex;flex-direction:column}button,input,textarea{font:inherit}</style><div id="root"></div><script type="module">'+built.outputFiles[0].text.replaceAll('</script','<\\/script')+'</script>'}));
  await page.route('**/api/**',async r=>{const request=r.request(),u=new URL(request.url()),headers={...request.headers()};if(headers.cookie)throw Error('cookie_forbidden');delete headers.origin;if(caseFixture&&u.pathname.includes('/moderation')){
   const owned=await fetch('http://api:8080/api/my/novels/'+caseFixture.novel_id+'/formal-state',{headers:headers.authorization?{Authorization:headers.authorization}:{}});
   if(!owned.ok)return r.fulfill({status:owned.status,contentType:'application/json',headers:{'X-Tako-Environment':'test'},body:JSON.stringify(await owned.json())});
   const json=(v,status=200)=>r.fulfill({status,contentType:'application/json',headers:{'X-Tako-Environment':'test'},body:JSON.stringify(v)});
   if(request.method()==='POST'){
    caseWrites++;const input=request.postDataJSON();
    if(!appealReceipt){appealReceipt={novel_id:caseFixture.novel_id,case_id:caseFixture.id,id:1,operation:'appeal',state:'pending',revision:1};caseAppeals=[{id:1,novel_id:caseFixture.novel_id,case_id:caseFixture.id,reason:input.reason,state:'pending',decision_reason:'',created_at:'2026-11-04T00:00:00Z',decided_at:null}]}
    if(dropAppeal){dropAppeal=false;return r.abort()}return json(appealReceipt);
   }
   if(u.pathname.includes('/moderation-requests/'))return json(appealReceipt);
   if(u.pathname.endsWith('/moderation'))return json({items:[caseFixture],next:0});
   return json({case:caseFixture,appeals:{items:caseAppeals,next:0}});
  }
  if(failManagementRefresh&&u.pathname.endsWith('/publication-chapters')){failManagementRefresh=false;return r.fulfill({status:503,contentType:'application/json',headers:{'X-Tako-Environment':'test'},body:JSON.stringify({error:'service_unavailable'})})}const response=await r.fetch({url:'http://api:8080'+u.pathname+u.search,headers});if(response.headers()['x-tako-environment']!=='test')throw Error('environment');if(request.method()==='POST'&&u.pathname.endsWith('/chapter-submissions')){submissions.push(request.postDataJSON());if(response.ok()&&!dropped){dropped=true;return r.abort()}}if(!caseFixture&&request.method()==='POST'&&/\/my\/novels\/[^/]+\/moderation\/\d+$/.test(u.pathname)){realAppealWrites++;if(response.ok()&&realAppealDrop){realAppealDrop=false;return r.abort()}}if(request.method()==='POST'&&(u.pathname.endsWith('/visibility')||u.pathname.endsWith('/metadata-submissions'))){managementWrites.push({path:u.pathname,body:request.postDataJSON()});if(response.ok()&&u.pathname.endsWith('/visibility')&&dropVisibility){dropVisibility=false;return r.abort()}if(response.ok()&&u.pathname.endsWith('/metadata-submissions')&&dropMetadata){dropMetadata=false;return r.abort()}}return r.fulfill({response})});
  await page.goto('http://127.0.0.1:3300/__novel-publication');await page.evaluate(()=>window.novelLive.setup());
  stage='fixed-preview';await page.getByRole('button',{name:'生成固定预览',exact:true}).click();
  await page.getByText('本次正式中文与表情😀。',{exact:false}).waitFor();
  await page.evaluate(()=>{const s=window.novelLive.source;return window.novelLive.session.authorized(`/my/novels/${s.book}/chapter-drafts/save`,{method:'POST',body:{mutation_id:crypto.randomUUID(),draft_id:s.draft,base_revision:1,title:'后续私稿标题',content:'后续私稿不属于本次正式版本。'}})});
  assert.equal(await page.getByText('后续私稿不属于本次正式版本。',{exact:false}).count(),0);
  stage='submit-dropped-response';await page.getByRole('button',{name:'确认原创或已获发布授权'}).click();await page.getByRole('button',{name:'提交发布',exact:true}).click();
  await page.getByText('原请求尚未确认',{exact:true}).waitFor();assert.equal(submissions.length,1);
  stage='remount-readonly-recovery';await page.evaluate(()=>window.novelLive.mount());await page.getByText('原请求尚未确认',{exact:true}).waitFor();assert.equal(submissions.length,1);
  await page.getByRole('button',{name:'查询原结果',exact:true}).click();await page.getByText('已发布正式章节',{exact:true}).waitFor();assert.equal(submissions.length,1);
  stage='same-public-data';const result=await page.evaluate(async()=>{const s=window.novelLive.source,r=window.novelLive.reader,book=await r.book(s.book),directory=await r.directory(s.book),chapter=await r.chapter(s.book,directory.items[0].id),draft=await window.novelLive.session.authorized(`/my/novels/${s.book}/chapter-drafts/${s.draft}`);return {bookTitle:book.title,count:book.chapter_count,title:chapter.title,content:chapter.content,draftRevision:draft.revision,draftContent:draft.content}});
  assert.equal(result.count,1);assert.equal(result.title,'固定第一章');assert.equal(result.content,'本次正式中文与表情😀。\n冻结正文末尾。');assert.equal(result.draftRevision,2);assert.equal(result.draftContent,'后续私稿不属于本次正式版本。');
  await page.getByRole('button',{name:'完成本次处理',exact:true}).click();await page.getByRole('button',{name:'生成固定预览',exact:true}).waitFor();assert.deepEqual(errors,[]);
  stage='management-catalog';await page.evaluate(async()=>{for(let i=0;i<8;i++){const s=window.novelLive.source;await window.novelLive.session.authorized(`/my/novels/${s.book}/chapter-drafts/create`,{method:'POST',body:{mutation_id:crypto.randomUUID(),title:'仅本人可见的章节草稿 '+(i+1),content:'真实接口建立的布局验收私稿，不会自动公开。'}})}});await page.evaluate(()=>window.novelLive.openManagement());
  await page.getByRole('button',{name:'管理章节 固定第一章',exact:true}).waitFor();
  for(const width of [320,390,430]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);require('node:fs').mkdirSync('/materials/.runtime/novel-management-layout',{recursive:true});await page.screenshot({path:'/materials/.runtime/novel-management-layout/'+width+'.png'});}

  await page.getByRole('button',{name:'管理章节 固定第一章',exact:true}).click();
  await page.getByText('本次正式中文与表情😀。',{exact:false}).waitFor();
  await page.evaluate(()=>{window.novelLive.failExport=true});
  await page.getByRole('button',{name:'导出当前固定版本',exact:true}).click();
  await page.getByText('导出未完成，正文仍保留，可重试选择导出方式。',{exact:true}).waitFor();await page.getByText('本次正式中文与表情😀。',{exact:false}).waitFor();await page.evaluate(()=>{window.novelLive.failExport=false});
  await page.getByRole('button',{name:'导出当前固定版本',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.novelLive.exported.message),'固定第一章\n\n本次正式中文与表情😀。\n冻结正文末尾。');
  stage='chapter-history';await page.getByRole('button',{name:'查看本章提交记录',exact:true}).click();
  const historyButton=page.getByRole('button',{name:/^查看本章提交 /});await historyButton.first().waitFor();assert.equal(await historyButton.count(),1);await historyButton.first().click();
  await page.getByText('提交记录 · 已发布',{exact:false}).waitFor();await page.getByRole('button',{name:'导出本次提交内容',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.novelLive.exported.message),'固定第一章\n\n本次正式中文与表情😀。\n冻结正文末尾。');
  await page.getByRole('button',{name:'返回当前章节',exact:true}).click();
  stage='hide-original-recovery';await page.getByRole('button',{name:'隐藏这一章',exact:true}).click();await page.getByRole('dialog',{name:'隐藏这一章？'}).getByRole('button',{name:'执行',exact:true}).click();
  await page.getByText('原管理操作待确认',{exact:true}).waitFor();assert.equal(managementWrites.length,1);
  failManagementRefresh=true;await page.evaluate(()=>window.novelLive.openManagement());await page.getByText('原管理操作待确认',{exact:true}).waitFor();
  await page.getByRole('button',{name:'查询原管理结果',exact:true}).click();await page.getByText('原操作已确认',{exact:true}).waitFor();assert.equal(managementWrites.length,1);
  failManagementRefresh=true;await page.getByRole('button',{name:'确认记录并刷新',exact:true}).click();await page.getByText('原操作已确认；若状态尚未刷新，可重试读取。',{exact:true}).waitFor();assert.equal(managementWrites.length,1);await page.getByRole('button',{name:'刷新章节列表',exact:true}).click();await page.getByRole('button',{name:'管理章节 固定第一章',exact:true}).waitFor();
  assert.equal(await page.evaluate(async()=>{try{await window.novelLive.reader.book(window.novelLive.source.book);return false}catch(e){return e.status===404}}),true);
  stage='chapter-restore';await page.getByRole('button',{name:'管理章节 固定第一章',exact:true}).click();await page.getByRole('button',{name:'恢复这一章',exact:true}).click();await page.getByRole('dialog',{name:'恢复这一章？'}).getByRole('button',{name:'执行',exact:true}).click();
  await page.getByText('原操作已确认',{exact:true}).waitFor();await page.getByRole('button',{name:'确认记录并刷新',exact:true}).click();assert.equal(managementWrites.length,2);
  stage='metadata-source';await page.evaluate(()=>{const s=window.novelLive.source;return window.novelLive.session.authorized(`/my/novels/${s.book}`,{method:'POST',body:{mutation_id:crypto.randomUUID(),base_revision:1,title:'明确发布的新书名',introduction:'后续资料只通过显式发布生效',tags:['冒险']}})});
  await page.getByRole('tab',{name:'书籍资料',exact:true}).click();await page.getByRole('button',{name:'读取最新资料',exact:true}).click();await page.getByText('明确发布的新书名',{exact:true}).waitFor();
  assert.equal(await page.evaluate(async()=>{return (await window.novelLive.reader.book(window.novelLive.source.book)).title}),'长文真实页面联调');
  await page.getByRole('button',{name:'确认资料发布授权'}).click();await page.getByRole('button',{name:'发布这份资料',exact:true}).click();await page.getByRole('dialog',{name:'发布所示创作资料？'}).getByRole('button',{name:'执行',exact:true}).click();
  await page.getByText('原管理操作待确认',{exact:true}).waitFor();assert.equal(managementWrites.length,3);
  stage='metadata-original-recovery';await page.evaluate(()=>window.novelLive.openManagement());await page.getByRole('button',{name:'查询原管理结果',exact:true}).click();await page.getByText('原操作已确认',{exact:true}).waitFor();await page.getByRole('button',{name:'确认记录并刷新',exact:true}).click();
  assert.equal(managementWrites.length,3);const updated=await page.evaluate(()=>window.novelLive.reader.book(window.novelLive.source.book));assert.equal(updated.title,'明确发布的新书名');assert.equal(updated.chapter_count,1);
  stage='appeal-memory-fixture';const scope=await page.evaluate(async()=>{const book=window.novelLive.source.book,d=await window.novelLive.reader.directory(book);return {book,chapter:d.items[0].id}});
  caseFixture={id:909090,novel_id:scope.book,target_id:scope.chapter,scope:'version',version:1,reason:'合成处置原因，仅用于复核页面验证',state:'active',revision:1,created_at:'2026-11-04T00:00:00Z',next_appeal_at:null,decision_reason:''};
  await page.getByRole('tab',{name:'处置与复核',exact:true}).click();await page.getByRole('button',{name:'查看处置 909090',exact:true}).click();
  await page.getByRole('textbox',{name:'复核说明',exact:true}).fill('只在本页内存的复核说明');
  await page.getByRole('button',{name:'返回处置列表',exact:true}).click();await page.getByRole('dialog',{name:'离开这项复核？'}).getByRole('button',{name:'继续处理',exact:true}).click();
  assert.equal(await page.getByRole('textbox',{name:'复核说明',exact:true}).inputValue(),'只在本页内存的复核说明');
  await page.evaluate(()=>window.novelLive.session.logout());await page.getByText('登录后管理本人长文',{exact:true}).waitFor();assert.equal(await page.getByRole('textbox',{name:'复核说明'}).count(),0);
  await page.evaluate(()=>window.novelLive.session.signIn('login',window.novelLive.credentials.email,window.novelLive.credentials.password));
  await page.getByText('恢复本账号在当前页面的复核说明？',{exact:true}).waitFor();await page.getByRole('button',{name:'保留复核说明',exact:true}).click();
  assert.equal(await page.getByRole('textbox',{name:'复核说明',exact:true}).inputValue(),'只在本页内存的复核说明');
  stage='appeal-original-fixture';await page.getByRole('button',{name:'提交文字复核',exact:true}).click();await page.getByRole('button',{name:'查询原复核结果',exact:true}).waitFor();assert.equal(caseWrites,1);
  await page.getByRole('button',{name:'查询原复核结果',exact:true}).click();await page.getByText('复核已受理。原请求已确认，不会重复提交。',{exact:true}).waitFor();assert.equal(caseWrites,1);
  caseAppeals=[];await page.getByRole('button',{name:'刷新这项处置',exact:true}).click();await page.getByRole('textbox',{name:'复核说明',exact:true}).fill('换账号不能恢复的说明');
  stage='appeal-account-fixture';await page.evaluate(async()=>{await window.novelLive.session.logout();await window.novelLive.session.signIn('register','novel-other-'+crypto.randomUUID()+'@example.test',crypto.randomUUID())});
  assert.equal(await page.getByRole('textbox',{name:'复核说明'}).count(),0);
  await page.evaluate(async()=>{await window.novelLive.session.logout();await window.novelLive.session.signIn('login',window.novelLive.credentials.email,window.novelLive.credentials.password)});
  await page.getByRole('tab',{name:'处置与复核',exact:true}).click();await page.getByRole('button',{name:'查看处置 909090',exact:true}).click();
  assert.equal(await page.getByText('恢复本账号在当前页面的复核说明？',{exact:true}).count(),0);assert.equal(await page.getByRole('textbox',{name:'复核说明',exact:true}).inputValue(),'');
  assert.equal(await page.evaluate(()=>JSON.stringify([...window.novelLive.records.values()]).includes('换账号不能恢复的说明')),false);
  stage='real-version-limit';caseFixture=null;
  const target=await page.evaluate(async()=>{const book=window.novelLive.source.book,d=await window.novelLive.reader.directory(book);return {book,chapter:d.items[0].id}});
  const current=await api(`/ops/novels/${target.book}/chapters/${target.chapter}/state`);
  const limited=await api(`/ops/novels/${target.book}/limits`,{mutation_id:randomUUID(),scope:'version',chapter_id:target.chapter,version:1,expected_revision:current.state_revision,reason:'实际联调：固定正式版本限制'});
  assert.equal(await page.evaluate(async()=>{try{await window.novelLive.reader.book(window.novelLive.source.book);return false}catch(e){return e.status===404}}),true);
  await page.evaluate(()=>window.novelLive.openManagement());await page.getByRole('button',{name:'管理章节 固定第一章',exact:true}).click();
  await page.getByText('本次正式中文与表情😀。',{exact:false}).waitFor();await page.getByRole('button',{name:'导出当前固定版本',exact:true}).click();
  await page.getByRole('button',{name:'隐藏这一章',exact:true}).click();await page.getByRole('dialog',{name:'隐藏这一章？'}).getByRole('button',{name:'执行',exact:true}).click();await page.getByRole('button',{name:'确认记录并刷新',exact:true}).click();
  await page.getByRole('button',{name:'恢复这一章',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'恢复这一章',exact:true}).isDisabled(),true);
  stage='real-author-appeal';await page.getByRole('tab',{name:'处置与复核',exact:true}).click();await page.getByRole('button',{name:'查看处置 '+limited.case_id,exact:true}).click();
  await page.getByRole('textbox',{name:'复核说明',exact:true}).fill('实际服务复核：请重新核对本章固定内容。');stage='real-author-appeal-submit';await page.getByRole('button',{name:'提交文字复核',exact:true}).click();stage='real-author-appeal-query';await page.getByRole('button',{name:'查询原复核结果',exact:true}).waitFor();
  await page.getByRole('button',{name:'查询原复核结果',exact:true}).click();await page.getByText('复核已受理。原请求已确认，不会重复提交。',{exact:true}).waitFor();assert.equal(realAppealWrites,1);
  const casePath=`/ops/novels/${target.book}/moderation/${limited.case_id}`;let detail=await api(casePath);assert.equal(detail.appeals.items.length,1);
  stage='real-cooldown-and-revoke';await api(casePath,{mutation_id:randomUUID(),expected_revision:detail.case.revision,decision:'uphold',appeal_id:detail.appeals.items[0].id,reason:'实际联调：维持并进入冷静期'});
  await page.getByRole('button',{name:'刷新这项处置',exact:true}).click();await page.getByText('维持处置',{exact:true}).waitFor();await page.getByRole('textbox',{name:'复核说明',exact:true}).fill('冷静期间不应重复提交');assert.equal(await page.getByRole('button',{name:'提交文字复核',exact:true}).isDisabled(),true);assert.equal(realAppealWrites,1);
  detail=await api(casePath);await api(casePath,{mutation_id:randomUUID(),expected_revision:detail.case.revision,decision:'revoke',appeal_id:0,reason:'实际联调：运营主动纠错撤销'});
  await page.getByRole('textbox',{name:'复核说明',exact:true}).fill('');await page.getByRole('button',{name:'刷新这项处置',exact:true}).click();await page.getByText('指定正式版本 · 已撤销',{exact:false}).waitFor();
  assert.equal(await page.evaluate(async()=>{try{await window.novelLive.reader.book(window.novelLive.source.book);return false}catch(e){return e.status===404}}),true);
  await page.getByRole('button',{name:'返回处置列表',exact:true}).click();await page.getByRole('tab',{name:'章节',exact:true}).click();await page.getByRole('button',{name:'刷新章节状态',exact:true}).click();await page.getByRole('button',{name:'恢复这一章',exact:true}).click();await page.getByRole('dialog',{name:'恢复这一章？'}).getByRole('button',{name:'执行',exact:true}).click();await page.getByRole('button',{name:'确认记录并刷新',exact:true}).click();
  const restored=await page.evaluate(async()=>{const b=window.novelLive.source.book,d=await window.novelLive.reader.directory(b);return window.novelLive.reader.chapter(b,d.items[0].id)});assert.equal(restored.version,1);assert.equal(restored.content,'本次正式中文与表情😀。\n冻结正文末尾。');
  assert.deepEqual(errors,[]);
  console.log('PASS appeal screen fixtures (mock case/appeal responses with real ownership checks): leave guard, same-account memory restoration, original confirmation and account isolation.');
  console.log('PASS novel publication actual App screen -> real HTTP/MySQL -> anonymous directory/chapter; fixed R1 preserves R2; original recovery; chapter hide/restore; fixed export; explicit metadata publish and original recovery; real version restriction, appeal, cooldown, revoke preserves author hiding, explicit restore. DOM/journal adapters, not native.');
 }catch(e){console.error('FAIL novel publication stage='+stage+' line='+(String(e.stack).match(/run.cjs:(\d+)/)?.[1]??'0'));console.error('DIAG writes='+realAppealWrites+' query='+await page.getByRole('button',{name:'查询原复核结果',exact:true}).count()+' confirmed='+await page.getByText('复核已受理。原请求已确认，不会重复提交。',{exact:true}).count()+' error='+e.name);process.exitCode=1}finally{await browser.close();if(operatorToken)await api('/app/auth/logout',{},operatorToken).catch(()=>undefined)}
})().catch(()=>{console.error('FAIL novel publication preflight or bundle');process.exitCode=1});
