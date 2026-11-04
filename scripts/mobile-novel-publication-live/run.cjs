// Actual ChapterPublishScreen, publisher, API decoders and Session -> real test API/MySQL.
// Platform journal/navigation/DOM adapters; no native persistence or device claim.
const esbuild=require('/tools/node_modules/esbuild'),{chromium}=require('/tools/node_modules/playwright');
const path=require('node:path'),assert=require('node:assert/strict');let stage='preflight';
(async()=>{
 const preflight=await fetch('http://api:8080/api/community');if(!preflight.ok||preflight.headers.get('X-Tako-Environment')!=='test')throw Error('test_service_required');
 stage='bundle';
  const built = await esbuild.build({ entryPoints: [path.join(__dirname, 'entry.jsx')], bundle: true, write: false,
    define: { 'process.env.EXPO_PUBLIC_API_URL': JSON.stringify('http://127.0.0.1:3300/api'), 'process.env.NODE_ENV': JSON.stringify('development') },
    tsconfigRaw: { compilerOptions: { jsx: 'react-jsx', target: 'ES2022' } }, format: 'esm', jsx: 'automatic', loader: { '.png': 'dataurl' }, nodePaths: ['/app/node_modules'],
    plugins: [{ name: 'fixture', setup(build) {
      build.onResolve({ filter: /^react-native$|^react-native-safe-area-context$/ }, () => ({ path: path.join(__dirname, '../mobile-novel-reading-ui/native.jsx') }));
      build.onResolve({filter:/\/components\/PrototypeUi$/},()=>({path:'chrome',namespace:'fixture-chrome'}));
      build.onLoad({filter:/.*/,namespace:'fixture-chrome'},()=>({contents:'export const BottomNavigation=()=>null;',loader:'js'}));
      build.onResolve({filter:/^\.\.\/native$/},args=>args.importer.endsWith('ChapterPublishScreen.tsx')?{path:path.join(__dirname,'journal.jsx')}:undefined);
      build.onResolve({ filter: /^expo-router$/ }, () => ({ path: path.join(__dirname, 'router.jsx') }));
      build.onResolve({ filter: /^react-native-svg$/ }, () => ({ path: path.join(__dirname, '../mobile-versions-ui/svg.jsx') }));
      build.onResolve({ filter: /\/auth\/context$/ }, () => ({ path: path.join(__dirname, '../mobile-author-works-ui/context.jsx') }));
      build.onResolve({ filter: /^expo-crypto$/ }, () => ({ path: 'crypto', namespace: 'fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const randomUUID=()=>crypto.randomUUID();', loader: 'js' }));
    } }],
  });

 const browser=await chromium.launch({headless:true}),page=await browser.newPage();let dropped=false;const submissions=[],errors=[];page.on('pageerror',e=>errors.push(e.name));
 try{
  await page.route('**/__novel-publication',r=>r.fulfill({contentType:'text/html',body:'<div id="root"></div><script type="module">'+built.outputFiles[0].text.replaceAll('</script','<\\/script')+'</script>'}));
  await page.route('**/api/**',async r=>{const request=r.request(),u=new URL(request.url()),headers={...request.headers()};if(headers.cookie)throw Error('cookie_forbidden');delete headers.origin;const response=await r.fetch({url:'http://api:8080'+u.pathname+u.search,headers});if(response.headers()['x-tako-environment']!=='test')throw Error('environment');if(request.method()==='POST'&&u.pathname.endsWith('/chapter-submissions')){submissions.push(request.postDataJSON());if(response.ok()&&!dropped){dropped=true;return r.abort()}}return r.fulfill({response})});
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
  console.log('PASS novel publication actual App screen -> real HTTP/MySQL -> anonymous directory/chapter; fixed R1 preserves R2; dropped response/remount only confirms original. DOM/journal adapters, not native.');
 }catch(e){console.error('FAIL novel publication stage='+stage+' line='+(String(e.stack).match(/run.cjs:(\d+)/)?.[1]??'0'));process.exitCode=1}finally{await browser.close()}
})().catch(()=>{console.error('FAIL novel publication preflight or bundle');process.exitCode=1});
