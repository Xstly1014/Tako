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
      build.onResolve({filter:/^\.\/journal$/},args=>/WorkSubmissionsScreen.tsx/.test(args.importer)?{path:path.join(__dirname,'journal.jsx')}:undefined);
      build.onResolve({ filter: /^expo-router$/ }, () => ({ path: path.join(__dirname, 'router.jsx') }));
      build.onResolve({ filter: /^react-native-svg$/ }, () => ({ path: path.join(__dirname, '../mobile-versions-ui/svg.jsx') }));
      build.onResolve({ filter: /\/auth\/context$/ }, () => ({ path: path.join(__dirname, '../mobile-author-works-ui/context.jsx') }));
      build.onResolve({ filter: /^expo-crypto$/ }, () => ({ path: 'crypto', namespace: 'fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const randomUUID=()=>crypto.randomUUID();', loader: 'js' }));
    } }],
  });

 const browser=await chromium.launch({headless:true}),page=await browser.newPage();let dropped=false,dropVisibility=true,dropMetadata=true,failManagementRefresh=false;const submissions=[],managementWrites=[],errors=[];
 let failRectificationDetail=false,webContext=null,webPage=null,lifecycleBook="",completeDrop=true,completeWrites=0,rectDrop=true,rectWrites=0,grantDrop=true,grantWrites=0,decideDrop=true,decideWrites=0;
 let caseFixture=null,caseAppeals=[],caseWrites=0,dropAppeal=true,appealReceipt=null,realAppealDrop=true,realAppealWrites=0,middlePublishDrop=true,middlePublishWrites=0,withdrawDrop=true,withdrawWrites=0;page.on('pageerror',e=>errors.push(e.name));
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
  if(failRectificationDetail&&/^\/api\/my\/novels\/[^/]+\/rectifications\/[^/]+$/.test(u.pathname)&&request.method()==='GET'){failRectificationDetail=false;return r.fulfill({status:503,contentType:'application/json',headers:{'X-Tako-Environment':'test'},body:JSON.stringify({error:'service_unavailable',request_id:randomUUID()})})}
  if(failManagementRefresh&&u.pathname.endsWith('/publication-chapters')){failManagementRefresh=false;return r.fulfill({status:503,contentType:'application/json',headers:{'X-Tako-Environment':'test'},body:JSON.stringify({error:'service_unavailable'})})}const response=await r.fetch({url:'http://api:8080'+u.pathname+u.search,headers});if(response.headers()['x-tako-environment']!=='test')throw Error('environment');if(request.method()==='POST'&&u.pathname.endsWith('/completion')){completeWrites++;if(response.ok()&&completeDrop){completeDrop=false;return r.abort()}}if(request.method()==='POST'&&/\/rectifications\/[^/]+\/submission$/.test(u.pathname)){rectWrites++;if(response.ok()&&rectDrop){rectDrop=false;failRectificationDetail=true;return r.abort()}}if(request.method()==='POST'&&u.pathname.endsWith('/chapter-submissions')){submissions.push(request.postDataJSON());if(response.ok()&&!dropped){dropped=true;return r.abort()}}if(!caseFixture&&request.method()==='POST'&&/\/my\/novels\/[^/]+\/moderation\/\d+$/.test(u.pathname)){realAppealWrites++;if(response.ok()&&realAppealDrop){realAppealDrop=false;return r.abort()}}if(request.method()==='POST'&&u.pathname==='/api/publications'){middlePublishWrites++;if(response.ok()&&middlePublishDrop){middlePublishDrop=false;return r.abort()}}if(request.method()==='POST'&&/\/work-submissions\/[^/]+\/withdraw$/.test(u.pathname)){withdrawWrites++;if(response.ok()&&withdrawDrop){withdrawDrop=false;return r.abort()}}if(request.method()==='POST'&&(u.pathname.endsWith('/visibility')||u.pathname.endsWith('/metadata-submissions'))){managementWrites.push({path:u.pathname,body:request.postDataJSON()});if(response.ok()&&u.pathname.endsWith('/visibility')&&dropVisibility){dropVisibility=false;return r.abort()}if(response.ok()&&u.pathname.endsWith('/metadata-submissions')&&dropMetadata){dropMetadata=false;return r.abort()}}return r.fulfill({response})});
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

  stage='observation-policy-start';
  const policyPath=`/ops/novels/${target.book}/author-policy`,policy=await api(policyPath);
  const policyStart={mutation_id:randomUUID(),expected_revision:policy.policy.revision,action:'start',reason:'实际联调：运营确认后开始7天观察'};
  const start=await api(policyPath,policyStart);assert.equal(Date.parse(start.observation_until)-Date.parse(start.created_at),7*86400000);
  assert.deepEqual(await api(policyPath+'/requests/'+policyStart.mutation_id),start);
  const extension=await api(policyPath,{mutation_id:randomUUID(),expected_revision:start.revision,action:'extend',reason:'实际联调：再次确认后延长7天'});assert.equal(Date.parse(extension.observation_until)-Date.parse(start.observation_until),7*86400000);
  await page.evaluate(()=>window.novelLive.openManagement());await page.getByRole('tab',{name:'处置与复核',exact:true}).click();await page.getByText('观察中：新提交先审后发',{exact:true}).waitFor();await page.getByText('延长7天 · 实际联调：再次确认后延长7天',{exact:true}).waitFor();
  stage='observed-two-chapters';
  const observed=await page.evaluate(async()=>{
    const session=window.novelLive.session;
    const book=await session.authorized('/my/novels',{method:'POST',body:{mutation_id:crypto.randomUUID(),base_revision:0,title:'A提交时的资料',introduction:'同一观察期真实App链路',tags:['幻想']}});
    const make=(title)=>session.authorized(`/my/novels/${book.id}/chapter-drafts/create`,{method:'POST',body:{mutation_id:crypto.randomUUID(),title,content:title+' 固定正文😀'}});
    return {book:book.id,A:await make('待审A章'),B:await make('待审B章')};
  });
  async function submitObserved(draft){
    await page.evaluate(({book,draft})=>{window.novelLive.source={book,draft:draft.draft_id,revision:String(draft.revision),local:crypto.randomUUID()};window.novelLive.openPublisher()},{book:observed.book,draft});
    await page.getByRole('button',{name:'生成固定预览',exact:true}).click();await page.getByText('当前提交须先审核，通过后才能被读者阅读。',{exact:true}).waitFor();await page.getByRole('button',{name:'确认原创或已获发布授权'}).click();await page.getByRole('button',{name:'提交发布',exact:true}).click();await page.getByText('先审提交已受理',{exact:true}).waitFor();
    const input=submissions.at(-1);const receipt=await page.evaluate(({book,mutation})=>window.novelLive.session.authorized(`/my/novels/${book}/publication-requests/${mutation}`),{book:observed.book,mutation:input.mutation_id});
    await page.getByRole('button',{name:'完成本次处理',exact:true}).click();await page.getByRole('button',{name:'生成固定预览',exact:true}).waitFor();return receipt;
  }
  const A=await submitObserved(observed.A);assert.equal(A.ordinal,1);assert.equal(A.state,'pending');
  await page.evaluate(async book=>window.novelLive.session.authorized(`/my/novels/${book}`,{method:'POST',body:{mutation_id:crypto.randomUUID(),base_revision:1,title:'B先通过时的资料',introduction:'B首个正式发布快照',tags:['幻想']}}),observed.book);
  const B=await submitObserved(observed.B);assert.equal(B.ordinal,2);assert.equal(B.state,'pending');
  stage='observation-revoke-retains-pending';await api(policyPath,{mutation_id:randomUUID(),expected_revision:extension.revision,action:'revoke',reason:'实际联调：提前结束，原待审继续人工处理'});
  // Replacement after revoke still requires review; it must not exploit the normal-author path.
  const A2=await submitObserved(observed.A);assert.equal(A2.ordinal,1);assert.equal(A2.state,'pending');assert.notEqual(A2.submission_id,A.submission_id);
  const stillPending=await page.evaluate(async book=>{const p=await window.novelLive.session.authorized(`/my/novels/${book}/publication-chapters`);return p.items.filter(x=>x.current_submission_id).map(x=>x.last_version)},observed.book);assert.deepEqual(stillPending,[0,0]);
  const review=receipt=>`/ops/novels/${observed.book}/chapter-submissions/${receipt.submission_id}/review`;
  stage='observed-out-of-order-review';await api(review(B),{mutation_id:randomUUID(),decision:'approve',reason:''});
  let directory=await page.evaluate(book=>window.novelLive.reader.directory(book),observed.book);assert.deepEqual(directory.items.map(x=>x.ordinal),[2]);
  await api(review(A2),{mutation_id:randomUUID(),decision:'approve',reason:''});
  directory=await page.evaluate(book=>window.novelLive.reader.directory(book),observed.book);assert.deepEqual(directory.items.map(x=>x.ordinal),[1,2]);
  const publicResult=await page.evaluate(async ({book,ids})=>{const reader=window.novelLive.reader;return {book:await reader.book(book),bodies:await Promise.all(ids.map(id=>reader.chapter(book,id))) }},{book:observed.book,ids:directory.items.map(x=>x.id)});
  assert.equal(publicResult.book.title,'B先通过时的资料');assert.deepEqual(publicResult.bodies.map(x=>x.content),['待审A章 固定正文😀','待审B章 固定正文😀']);
  await page.evaluate(()=>window.novelLive.openManagement());await page.getByRole('button',{name:'管理章节 待审A章',exact:true}).waitFor();await page.getByRole('tab',{name:'处置与复核',exact:true}).click();await page.getByText('读取时不在观察期',{exact:true}).waitFor();

  stage='middle-pre-review-start';
  const currentPolicy=await api(policyPath);await api(policyPath,{mutation_id:randomUUID(),expected_revision:currentPolicy.policy.revision,action:'start',reason:'实际联调：中篇也先审后发'});
  await page.evaluate(async()=>{const draft=await window.novelLive.session.authorized('/drafts/create',{method:'POST',body:{mutation_id:crypto.randomUUID(),title:'中篇先审真实App',content:'这份中篇固定内容R1😀，不是后续工作稿。'}});window.novelLive.middleDraft=draft.draft_id;window.novelLive.openMiddle()});
  await page.getByRole('button',{name:'发布标签 幻想',exact:true}).click();await page.getByRole('button',{name:'确认原创或取得发布授权',exact:true}).click();await page.getByRole('button',{name:'生成固定预览',exact:true}).click();await page.getByText('这份中篇固定内容R1😀，不是后续工作稿。',{exact:true}).waitFor();await page.getByRole('button',{name:'提交这份快照等待审核',exact:true}).click();await page.getByRole('button',{name:'检查原发布请求',exact:true}).waitFor();await page.evaluate(()=>window.novelLive.openMiddle());await page.getByText('先审提交已受理',{exact:true}).waitFor();assert.equal(middlePublishWrites,1);assert.equal(await page.getByText('已确认正式版本 V0',{exact:true}).count(),0);
  const middle=await page.evaluate(async()=>{const p=await window.novelLive.session.authorized('/my/work-submissions');return p.items.find(x=>x.title==='中篇先审真实App')});assert.equal(middle.state,'pending');await page.getByRole('button',{name:'确认结果并选择其他稿件',exact:true}).click();await page.getByText('选择服务器已保存的稿件',{exact:true}).waitFor();
  await page.evaluate(async()=>window.novelLive.session.authorized('/drafts/save',{method:'POST',body:{mutation_id:crypto.randomUUID(),draft_id:window.novelLive.middleDraft,base_revision:1,title:'后续中篇工作稿R2',content:'R2不属于已经提交的固定内容'}}));
  await page.evaluate(work=>{window.novelLive.source={work};window.novelLive.openSubmissions()},middle.work_id);await page.getByRole('button',{name:'查看提交 中篇先审真实App',exact:true}).click();await page.getByText('这份中篇固定内容R1😀，不是后续工作稿。',{exact:true}).waitFor();assert.equal(await page.getByText('R2不属于已经提交的固定内容',{exact:true}).count(),0);
  const approved=await api(`/ops/work-submissions/${middle.id}/review`,{mutation_id:randomUUID(),decision:'approve',reason:''});assert.equal(approved.version,1);assert.equal(approved.state,'published');
  const publicMiddle=await page.evaluate(async work=>{const response=await fetch('/api/works/'+work,{credentials:'omit'});return response.json()},middle.work_id);assert.equal(publicMiddle.content,'这份中篇固定内容R1😀，不是后续工作稿。');
  await page.getByRole('button',{name:'刷新这条提交',exact:true}).click();await page.getByText('已发布 ·',{exact:false}).waitFor();
  stage='middle-formal-pending-nodes';
  await page.evaluate(work=>{window.novelLive.middleWork=work;window.novelLive.openMiddle()},middle.work_id);
  await page.getByRole('button',{name:'读取本次修订与正式展示版',exact:true}).click();await page.getByRole('button',{name:'采用已核对修订 R2',exact:true}).click();
  await page.getByRole('button',{name:'发布标签 幻想',exact:true}).click();await page.getByRole('button',{name:'确认原创或取得发布授权',exact:true}).click();await page.getByRole('button',{name:'生成固定预览',exact:true}).click();await page.getByRole('button',{name:'提交这份快照等待审核',exact:true}).click();await page.getByText('先审提交已受理',{exact:true}).waitFor();
  const revision=await page.evaluate(async work=>(await window.novelLive.session.authorized('/my/work-submissions?work='+work)).items.find(x=>x.state==='pending'),middle.work_id);assert.ok(revision);
  await page.getByRole('button',{name:'确认结果并选择其他稿件',exact:true}).click();
  await page.evaluate(work=>{window.novelLive.source={work};window.novelLive.openNodes()},middle.work_id);
  await page.getByRole('button',{name:'查看待审核提交 后续中篇工作稿R2',exact:true}).click();
  const nodeTarget=await page.evaluate(()=>window.novelLive.target);assert.equal(nodeTarget.params.submission,revision.id);assert.equal(nodeTarget.params.work,middle.work_id);
  await page.evaluate(params=>{window.novelLive.source=params;window.novelLive.openSubmissions()},nodeTarget.params);await page.getByText('R2不属于已经提交的固定内容',{exact:true}).waitFor();
  await api(`/ops/work-submissions/${revision.id}/review`,{mutation_id:randomUUID(),decision:'reject',reason:'固定R2测试驳回'});
  await page.evaluate(work=>{window.novelLive.source={work};window.novelLive.openNodes()},middle.work_id);await page.getByRole('button',{name:'查看已驳回提交 后续中篇工作稿R2',exact:true}).waitFor();
  const stillFormal=await page.evaluate(async work=>(await fetch('/api/works/'+work,{credentials:'omit'})).json(),middle.work_id);assert.equal(stillFormal.content,publicMiddle.content);
  await page.evaluate(()=>{window.novelLive.middleWork=undefined});
  stage='middle-withdrawal-actual';
  await page.evaluate(async()=>{const draft=await window.novelLive.session.authorized('/drafts/create',{method:'POST',body:{mutation_id:crypto.randomUUID(),title:'中篇待审撤回真实App',content:'待审撤回固定内容'}});window.novelLive.middleDraft=draft.draft_id;window.novelLive.openMiddle()});
  await page.getByRole('button',{name:'发布标签 日常',exact:true}).click();await page.getByRole('button',{name:'确认原创或取得发布授权',exact:true}).click();await page.getByRole('button',{name:'生成固定预览',exact:true}).click();await page.getByRole('button',{name:'提交这份快照等待审核',exact:true}).click();await page.getByText('先审提交已受理',{exact:true}).waitFor();const withdrawTarget=await page.evaluate(async()=>{const p=await window.novelLive.session.authorized('/my/work-submissions');return p.items.find(x=>x.title==='中篇待审撤回真实App')});await page.getByRole('button',{name:'确认结果并选择其他稿件',exact:true}).click();await page.getByText('选择服务器已保存的稿件',{exact:true}).waitFor();
  await page.evaluate(work=>{window.novelLive.source={work};window.novelLive.openSubmissions()},withdrawTarget.work_id);await page.getByRole('button',{name:'查看提交 中篇待审撤回真实App',exact:true}).click();await page.getByRole('button',{name:'撤回这次待审提交',exact:true}).click();await page.getByRole('dialog',{name:'撤回这次待审提交？'}).getByRole('button',{name:'撤回',exact:true}).click();await page.getByRole('button',{name:'查询原撤回结果',exact:true}).waitFor();await page.evaluate(()=>window.novelLive.openSubmissions());await page.getByRole('button',{name:'查询原撤回结果',exact:true}).click();await page.getByText('撤回已确认',{exact:true}).waitFor();assert.equal(withdrawWrites,1);await page.getByRole('button',{name:'确认记录并刷新',exact:true}).click();await page.getByRole('button',{name:'查看提交 中篇待审撤回真实App',exact:true}).click();await page.getByText('已撤回 ·',{exact:false}).waitFor();
  const endPolicy=await api(policyPath);await api(policyPath,{mutation_id:randomUUID(),expected_revision:endPolicy.policy.revision,action:'revoke',reason:'实际联调结束，恢复合成作者正常提交'});

  await page.setViewportSize({width:390,height:844});stage='completion-check-screen';lifecycleBook=target.book;
  await page.evaluate(book=>{window.novelLive.source={book};window.novelLive.openManagement()},target.book);
  await page.getByRole('tab',{name:'书籍资料',exact:true}).click();await page.getByRole('button',{name:'完结与指定整改',exact:true}).click();
  await page.getByRole('button',{name:'准备完结核对',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'执行',exact:true}).click();await page.getByText('这次核对的章节',{exact:true}).waitFor();
  await page.getByRole('button',{name:'确认记录并刷新',exact:true}).click();await page.getByLabel('我理解完结后不能恢复连载，也不能普通修改旧章',{exact:true}).click();
  await page.getByRole('button',{name:'确认不可逆完结',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'执行',exact:true}).click();await page.getByText('原管理操作待确认',{exact:true}).waitFor();
  await page.evaluate(()=>window.novelLive.openManagement());await page.getByRole('button',{name:'查询原管理结果',exact:true}).click();await page.getByText('原操作已确认',{exact:true}).waitFor();assert.equal(completeWrites,1);
  failManagementRefresh=true;await page.getByRole('button',{name:'确认记录并刷新',exact:true}).click();await page.getByText('已完结 · 指定整改',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'准备完结核对',exact:true}).count(),0);
  const completed=await page.evaluate(book=>window.novelLive.session.authorized(`/my/novels/${book}/formal-state`),target.book);assert.equal(completed.completed,true);
  const chapterBefore=await page.evaluate(t=>window.novelLive.session.authorized(`/my/novels/${t.book}/chapters/${t.chapter}/state`),target);
  await page.evaluate(({t,rev})=>window.novelLive.session.authorized(`/my/novels/${t.book}/chapters/${t.chapter}/visibility`,{method:'POST',body:{mutation_id:crypto.randomUUID(),expected_revision:rev,action:'hide'}}),{t:target,rev:chapterBefore.state_revision});
  const restriction=await api(`/ops/novels/${target.book}/limits`,{mutation_id:randomUUID(),scope:'book',chapter_id:null,version:0,expected_revision:completed.state_revision,reason:'N3联调：整书要求第一章整改'});

  stage='real-operator-grant';webContext=await browser.newContext({viewport:{width:1280,height:900}});webPage=await webContext.newPage();webPage.setDefaultTimeout(12000);webPage.on('pageerror',e=>errors.push(e.name));
  await webPage.route('http://127.0.0.1:3300/**',async route=>{
   const q=route.request(),u=new URL(q.url());
   // Actual browser Cookie/Origin are preserved; only the Docker transport address changes.
   const response=await route.fetch({url:(u.pathname.startsWith('/api/')?'http://api:8080':'http://web:3000')+u.pathname+u.search});
   if(u.pathname.startsWith('/api/')&&response.headers()['x-tako-environment']!=='test')throw Error('environment');
   if(q.method()==='POST'&&u.pathname===`/api/ops/novels/${target.book}/rectifications`){grantWrites++;if(response.ok()&&grantDrop){grantDrop=false;return route.abort()}}
   if(q.method()==='POST'&&/\/rectifications\/[^/]+\/actions\/approve$/.test(u.pathname)){decideWrites++;if(response.ok()&&decideDrop){decideDrop=false;return route.abort()}}
   return route.fulfill({response});
  });
  await webPage.goto('http://127.0.0.1:3300/');
  await webPage.evaluate(async password=>{const r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'operator@tako-test.invalid',password})});if(!r.ok)throw Error('browser_login_rejected')},env.TEST_OPERATOR_PASSWORD);
  await webPage.goto('http://127.0.0.1:3300/ops/novels');await webPage.getByRole('button',{name:'处置记录',exact:true}).click();await webPage.locator('.queue-row').first().click();await webPage.getByText('N3联调：整书要求第一章整改',{exact:true}).waitFor();
  await webPage.getByRole('button',{name:'读取可选正式章',exact:true}).click();await webPage.getByLabel('整改目标').selectOption(target.chapter);await webPage.getByLabel('处理方式').selectOption('rect-grant');await webPage.getByLabel('处理原因',{exact:true}).fill('N3联调：指定第一章一次整改');
  await webPage.getByRole('button',{name:'核对本次处理',exact:true}).click();await webPage.getByRole('button',{name:'确认执行',exact:true}).click();await webPage.getByRole('heading',{name:'原处理尚未确认',exact:true}).waitFor();await webPage.reload();await webPage.getByRole('button',{name:'查询原结果',exact:true}).click();await webPage.getByRole('status').filter({hasText:'处理已确认'}).waitFor();assert.equal(grantWrites,1);
  const grant=await page.evaluate(async book=>(await window.novelLive.session.authorized(`/my/novels/${book}/rectifications`)).items[0],target.book);assert.equal(grant.case_id,restriction.case_id);
  const source=await page.evaluate(async ({book,id})=>(await window.novelLive.session.authorized(`/my/novels/${book}/rectifications/${id}`)).source,{book:target.book,id:grant.id});assert.ok(source);
  const draft3=await page.evaluate(({book,source})=>window.novelLive.session.authorized(`/my/novels/${book}/chapter-drafts/save`,{method:'POST',body:{mutation_id:crypto.randomUUID(),draft_id:source.draft_id,base_revision:source.revision,title:'整改核对第一章',content:'这份整改固定正文R3😀。\n人工需要核对到末尾。'}}),{book:target.book,source});

  stage='actual-rectification-fixed-submit';await page.evaluate(()=>window.novelLive.openManagement());await page.getByRole('tab',{name:'书籍资料',exact:true}).click();await page.getByRole('button',{name:'完结与指定整改',exact:true}).click();await page.getByRole('button',{name:'读取整改记录',exact:true}).click();await page.getByLabel('查看整改 N3联调：指定第一章一次整改',{exact:true}).click();
  await page.getByRole('button',{name:'准备这份工作稿的固定整改预览',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'执行',exact:true}).click();await page.getByText('这份整改固定正文R3😀。',{exact:false}).waitFor();
  await page.evaluate(({book,source,revision})=>window.novelLive.session.authorized(`/my/novels/${book}/chapter-drafts/save`,{method:'POST',body:{mutation_id:crypto.randomUUID(),draft_id:source.draft_id,base_revision:revision,title:'后续私稿R4',content:'这段R4私稿没有提交给运营。'}}),{book:target.book,source,revision:draft3.revision});
  assert.equal(await page.getByText('这段R4私稿没有提交给运营。',{exact:false}).count(),0);
  await page.getByRole('button',{name:'确认记录并刷新',exact:true}).click();await page.getByLabel('我确认本次内容为原创，或已取得发布授权',{exact:true}).click();
  fs.mkdirSync('/materials/.runtime/novel-lifecycle',{recursive:true});await page.screenshot({path:'/materials/.runtime/novel-lifecycle/author-fixed-390.png',fullPage:true});
  await page.getByRole('button',{name:'提交这份固定整改',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'执行',exact:true}).click();await page.getByText('原管理操作待确认',{exact:true}).waitFor();
  await page.evaluate(()=>window.novelLive.openManagement());await page.getByRole('button',{name:'查询原管理结果',exact:true}).click();await page.getByText('原提交已确认，但授权现状未刷新；请先重新核对这条授权。',{exact:true}).waitFor();assert.equal(rectWrites,1);await page.getByRole('button',{name:'确认记录并刷新',exact:true}).click();await page.getByRole('button',{name:'读取整改记录',exact:true}).click();await page.getByLabel('查看整改 N3联调：指定第一章一次整改',{exact:true}).click();await page.getByText('等待人工审核',{exact:true}).first().waitFor();assert.equal(await page.getByRole('button',{name:'准备这份工作稿的固定整改预览',exact:true}).count(),0);

  stage='real-operator-fixed-approval';await webPage.getByRole('button',{name:'处置记录',exact:true}).click();await webPage.locator('.queue-row').first().click();await webPage.getByText('N3联调：整书要求第一章整改',{exact:true}).waitFor();await webPage.getByRole('button',{name:'读取本书整改记录',exact:true}).click();await webPage.locator('.queue-row').filter({hasText:'N3联调：指定第一章一次整改'}).click();
  await webPage.getByText('这份整改固定正文R3😀。',{exact:false}).waitFor();assert.equal(await webPage.getByText('这段R4私稿没有提交给运营。',{exact:false}).count(),0);
  await webPage.getByLabel('处理方式').selectOption('rect-approve');await webPage.getByLabel('处理原因',{exact:true}).fill('N3联调：人工已看过这份固定整改');await webPage.getByLabel('同时撤销这次整改关联的那一条处置',{exact:true}).check();await webPage.getByRole('button',{name:'核对本次处理',exact:true}).click();
  await webPage.screenshot({path:'/materials/.runtime/novel-lifecycle/operator-approval-1280.png',fullPage:true});await webPage.setViewportSize({width:390,height:844});assert.ok(await webPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await webPage.screenshot({path:'/materials/.runtime/novel-lifecycle/operator-approval-390.png',fullPage:true});
  await webPage.getByRole('button',{name:'确认执行',exact:true}).click();await webPage.getByRole('heading',{name:'原处理尚未确认',exact:true}).waitFor();await webPage.reload();await webPage.getByRole('button',{name:'查询原结果',exact:true}).click();await webPage.getByRole('status').filter({hasText:'处理已确认'}).waitFor();assert.equal(decideWrites,1);
  const final=await page.evaluate(async({t,source})=>{const s=window.novelLive.session;return {book:await s.authorized(`/my/novels/${t.book}/formal-state`),chapter:await s.authorized(`/my/novels/${t.book}/chapters/${t.chapter}/state`),draft:await s.authorized(`/my/novels/${t.book}/chapter-drafts/${source.draft_id}`)}},{t:target,source});
  assert.equal(final.book.completed,true);assert.equal(final.book.platform_limited,false);assert.equal(final.chapter.author_hidden,true);assert.equal(final.chapter.last_version,2);assert.equal(final.draft.content,'这段R4私稿没有提交给运营。');
  await page.evaluate(({t,rev})=>window.novelLive.session.authorized(`/my/novels/${t.book}/chapters/${t.chapter}/visibility`,{method:'POST',body:{mutation_id:crypto.randomUUID(),expected_revision:rev,action:'restore'}}),{t:target,rev:final.chapter.state_revision});
  const reread=await page.evaluate(t=>window.novelLive.reader.chapter(t.book,t.chapter),target);assert.equal(reread.version,2);assert.equal(reread.content,'这份整改固定正文R3😀。\n人工需要核对到末尾。');
  console.log('PASS N3 actual author management and real operator Cookie/Origin web -> HTTP/MySQL: irreversible completion, fixed one-use rectification, four lost-response recoveries without duplicate POST; R4 private draft preserved; author hidden independent. DOM/journal adapters, not Android.');
  assert.deepEqual(errors,[]);
  console.log('PASS appeal screen fixtures (mock case/appeal responses with real ownership checks): leave guard, same-account memory restoration, original confirmation and account isolation.');
  console.log('PASS novel publication actual App screen -> real HTTP/MySQL -> anonymous directory/chapter; fixed R1 preserves R2; original recovery; chapter hide/restore; fixed export; explicit metadata publish and original recovery; real version restriction, appeal, cooldown, revoke preserves author hiding, explicit restore. DOM/journal adapters, not native.');
 }catch(e){fs.mkdirSync('/materials/.runtime/novel-lifecycle',{recursive:true});await page.screenshot({path:'/materials/.runtime/novel-lifecycle/failure-author.png',fullPage:true}).catch(()=>undefined);if(webPage)await webPage.screenshot({path:'/materials/.runtime/novel-lifecycle/failure-operator.png',fullPage:true}).catch(()=>undefined);console.error('FAIL novel publication stage='+stage+' line='+(String(e.stack).match(/run.cjs:(\d+)/)?.[1]??'0'));console.error('DIAG writes='+realAppealWrites+' query='+await page.getByRole('button',{name:'查询原复核结果',exact:true}).count()+' confirmed='+await page.getByText('复核已受理。原请求已确认，不会重复提交。',{exact:true}).count()+' error='+e.name);process.exitCode=1}finally{
  if(webPage)await webPage.evaluate(()=>fetch('/api/auth/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).catch(()=>undefined);
  if(lifecycleBook)await page.evaluate(async book=>{const s=window.novelLive.session,v=await s.authorized(`/my/novels/${book}/formal-state`);if(!v.author_hidden)await s.authorized(`/my/novels/${book}/visibility`,{method:'POST',body:{mutation_id:crypto.randomUUID(),expected_revision:v.state_revision,action:'hide'}})},lifecycleBook).catch(()=>undefined);
  if(webContext)await webContext.close();await browser.close();if(operatorToken)await api('/app/auth/logout',{},operatorToken).catch(()=>undefined)}
})().catch(()=>{console.error('FAIL novel publication preflight or bundle');process.exitCode=1});
