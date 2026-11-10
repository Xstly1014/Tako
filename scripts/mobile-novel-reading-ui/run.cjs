// Actual App screens + real API decoder; mocked transport/DOM adapters. No native-device claim.
const esbuild=require('/tools/node_modules/esbuild'),{chromium}=require('/tools/node_modules/playwright');
const path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),book='11111111-1111-4111-8111-111111111111',chapter='22222222-2222-4222-8222-222222222222',hidden='33333333-3333-4333-8333-333333333333';
let stage='bundle';
(async()=>{
  const built = await esbuild.build({ entryPoints: [path.join(__dirname, 'entry.jsx')], bundle: true, write: false,
    define: { 'process.env.EXPO_PUBLIC_API_URL': JSON.stringify('http://127.0.0.1:3300/api'), 'process.env.NODE_ENV': JSON.stringify('development') },
    tsconfigRaw: { compilerOptions: { jsx: 'react-jsx', target: 'ES2022' } }, format: 'esm', jsx: 'automatic', loader: { '.png': 'dataurl' }, nodePaths: ['/app/node_modules'],
    plugins: [{ name: 'fixture', setup(build) {
      build.onResolve({ filter: /^react-native$|^react-native-safe-area-context$/ }, () => ({ path: path.join(__dirname, 'native.jsx') }));
      build.onResolve({filter:/\/components\/PrototypeUi$/},()=>({path:'chrome',namespace:'fixture-chrome'}));
      build.onLoad({filter:/.*/,namespace:'fixture-chrome'},()=>({contents:'export const BottomNavigation=()=>null;',loader:'js'}));
      build.onResolve({filter:/^\.\/native$/},args=>(args.importer.endsWith('ReadingPositionUi.tsx')||args.importer.endsWith('ShelfUi.tsx'))?{path:'reading-journal',namespace:'fixture'}:undefined);
      build.onLoad({filter:/reading-journal/,namespace:'fixture'},()=>({contents:'export function nativeReadingJournal(){throw Error("guest_reading_must_not_open_private_storage")} export function nativeShelfJournal(){throw Error("guest_shelf_must_not_open_private_storage")}',loader:'js'}));
      build.onResolve({ filter: /^expo-router$/ }, () => ({ path: path.join(__dirname, 'router.jsx') }));
      build.onResolve({ filter: /^react-native-svg$/ }, () => ({ path: path.join(__dirname, '../mobile-versions-ui/svg.jsx') }));
      build.onResolve({ filter: /\/auth\/context$/ }, () => ({ path: path.join(__dirname, '../mobile-comments-ui/context.jsx') }));
      build.onResolve({ filter: /^expo-crypto$/ }, () => ({ path: 'crypto', namespace: 'fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const randomUUID=()=>crypto.randomUUID();', loader: 'js' }));
    } }],
  });

 const browser=await chromium.launch({headless:true}),page=await browser.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.name));
 let failMore=true,restricted=false,reads=0;
 const reply=(r,v,status=200)=>r.fulfill({status,contentType:'application/json',headers:{'X-Tako-Environment':'test'},body:JSON.stringify(v)});
 try{
  await page.route('**/__novels',r=>r.fulfill({contentType:'text/html',body:'<div id="root"></div><script type="module">'+built.outputFiles[0].text.replaceAll('</script','<\\/script')+'</script>'}));
  await page.route('**/api/novels**',r=>{
   const u=new URL(r.request().url());
   const novel={id:book,title:'合成长文',introduction:'正式简介',tags:['幻想'],author:'合成作者',completed:false,chapter_count:3,first_published_at:'2026-11-03T00:00:00Z',latest_chapter_published_at:'2026-11-03T00:00:00Z'};
   if(u.pathname==='/api/novels')return reply(r,{items:[novel],next_cursor:''});
   if(u.pathname.endsWith('/directory')){
    if(u.searchParams.has('cursor')){if(failMore){failMore=false;return reply(r,{error:'service_unavailable'},503)}return reply(r,{items:[{id:chapter,ordinal:1,title:'第一章',readable:true},{id:hidden,ordinal:3,title:null,readable:false}],next_cursor:''})}
    return reply(r,{items:[{id:chapter,ordinal:1,title:'第一章',readable:true}],next_cursor:'next'});
   }
   if(u.pathname.includes('/chapters/')){reads++;return restricted?reply(r,{error:'resource_not_found'},404):reply(r,{novel_id:book,chapter_id:chapter,ordinal:1,version:1,title:'第一章',content:'真实页面合成正文😀\n下一段',published_at:'2026-11-03T00:00:00Z'})}
   return reply(r,novel);
  });
  await page.goto('http://127.0.0.1:3300/__novels');
  stage='feed';await page.getByRole('button',{name:'打开作品 合成长文'}).click();
  await page.getByText('正式简介',{exact:true}).waitFor();
  stage='pagination-failure';await page.getByRole('button',{name:'加载更多',exact:true}).click();
  await page.getByRole('button',{name:'重试加载更多'}).click();
  await page.getByRole('button',{name:'第3章 暂不可读'}).waitFor();
  assert.equal(await page.getByRole('button',{name:'第1章 第一章'}).count(),1);
  assert.equal(await page.getByRole('button',{name:'第3章 暂不可读'}).isDisabled(),true);
  stage='reading';await page.getByRole('button',{name:'第1章 第一章'}).click();
  await page.getByText('真实页面合成正文😀',{exact:false}).waitFor();
  const loadedReads=reads;restricted=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  assert.equal(reads,loadedReads);await page.getByText('真实页面合成正文😀',{exact:false}).waitFor();
  stage='new-request-rechecks';await page.getByRole('button',{name:'返回目录',exact:true}).click();
  await page.getByRole('button',{name:'第1章 第一章'}).click();
  await page.getByText('章节未能加载',{exact:true}).waitFor();
  assert.equal(await page.getByText('真实页面合成正文😀',{exact:false}).count(),0);
  await page.getByRole('button',{name:'章节目录',exact:true}).click();
  await page.getByRole('button',{name:'长文频道',exact:true}).click();
  await page.getByRole('button',{name:'打开作品 合成长文'}).waitFor();assert.deepEqual(errors,[]);
  console.log('PASS novel App reading components: pagination retry/deduplication, safe placeholders, loaded text preserved, new request denied, return navigation. Mock API/DOM, not native.');
 }catch(e){console.error('FAIL novel App reading stage='+stage+' line='+(String(e.stack).match(/run.cjs:(\d+)/)?.[1]??'0'));process.exitCode=1}finally{await browser.close()}
})().catch(()=>{console.error('FAIL novel reading bundle');process.exitCode=1});
