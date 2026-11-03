const esbuild=require("/tools/node_modules/esbuild"),{chromium}=require("/tools/node_modules/playwright"),assert=require("node:assert/strict"),path=require("node:path");
let stage="bundle";
async function runFixture(){
 const shared=name=>path.join(__dirname,"../mobile-drafts-ui/"+name);
 const built=await esbuild.build({entryPoints:[path.join(__dirname,"entry.jsx")],bundle:true,write:false,format:"esm",jsx:"automatic",loader:{".png":"dataurl"},nodePaths:["/app/node_modules"],define:{"process.env.NODE_ENV":'"development"',"process.env.EXPO_PUBLIC_API_URL":'"http://127.0.0.1:3300/api"'},tsconfigRaw:{compilerOptions:{jsx:"react-jsx",target:"ES2022"}},plugins:[{name:"adapters",setup(build){
  build.onResolve({filter:/^react-native$|^react-native-safe-area-context$/},()=>({path:shared("native.jsx")}));
  build.onResolve({filter:/^expo-router$/},()=>({path:shared("router.jsx")}));
  build.onResolve({filter:/^expo-crypto$/},()=>({path:shared("crypto.jsx")}));
  build.onResolve({filter:/^react-native-svg$/},()=>({path:path.join(__dirname,"../mobile-versions-ui/svg.jsx")}));
  build.onResolve({filter:/\/auth\/context$/},()=>({path:shared("context.jsx")}));
  build.onResolve({filter:/chapters\/native$|^\.\/native$/},args=>args.importer.includes("/chapters/")||/chapters\/native$/.test(args.path)?({path:shared("chapters.jsx")}):undefined);
  build.onResolve({filter:/\/drafts\/native$/},()=>({path:shared("tools.jsx")}));
  build.onResolve({filter:/^\.\/native$/},args=>args.importer.endsWith("/novels/NovelsScreen.tsx")?({path:shared("books.jsx")}):undefined);
 }}]});
 const browser=await chromium.launch({headless:true}),page=await browser.newPage();
 try{
  await page.route("**/*",route=>route.fulfill({status:200,contentType:"text/html",body:'<div id="root"></div>'}));await page.goto("https://fixture.test");await page.addScriptTag({content:built.outputFiles[0].text,type:"module"});
  stage="book-to-chapter";await page.getByRole("button",{name:"编辑书籍 合成连载",exact:true}).click();await page.getByRole("button",{name:"打开章节草稿",exact:true}).click();await page.getByRole("button",{name:"新建章节",exact:true}).click();
  await page.getByRole("textbox",{name:"草稿标题",exact:true}).fill("合成首章😀");await page.getByRole("textbox",{name:"草稿正文",exact:true}).fill("中文章节与表情😀离线文字");await page.getByText("已暂存本机，待同步",{exact:true}).waitFor();assert.equal(await page.getByRole("button",{name:"准备发布",exact:true}).count(),0);
  stage="offline-reopen";await page.evaluate(()=>window.chapterUi.restart());assert.equal(await page.getByRole("textbox",{name:"草稿正文",exact:true}).inputValue(),"中文章节与表情😀离线文字");
  await page.evaluate(()=>{window.draftUi.online=true;});await page.getByText("同步",{exact:true}).click();await page.getByText("已保存到服务器",{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.chapterUi.server.size),1);
  stage="recover-as-new";await page.evaluate(()=>{window.draftUi.online=false;window.chapterUi.original=[...window.chapterUi.server.keys()][0];window.chapterUi.advance();});await page.getByRole("textbox",{name:"草稿正文",exact:true}).fill("离线冲突端文字");await page.getByText("已暂存本机，待同步",{exact:true}).waitFor();
  await page.evaluate(()=>{window.draftUi.online=true;window.chapterUi.drop=true;});await page.getByText("同步",{exact:true}).click();await page.getByText("已暂存本机，服务器结果待确认",{exact:true}).waitFor();await page.evaluate(()=>{window.draftUi.online=false;window.chapterUi.restart();});
  await page.getByText("已暂存本机，服务器结果待确认",{exact:true}).waitFor();await page.evaluate(()=>{window.draftUi.online=true;});await page.getByText("同步",{exact:true}).click();await page.getByText("已另存为新章节草稿，原章保留",{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.chapterUi.server.size),2);
  stage="continue-recovered";await page.getByRole("textbox",{name:"草稿正文",exact:true}).fill("恢复章继续写");await page.getByText("同步",{exact:true}).click();await page.getByText("已保存到服务器",{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.chapterUi.server.get(window.chapterUi.original).content),"服务器另端文字");assert.equal(await page.evaluate(()=>window.chapterUi.requests.some(x=>x.path.startsWith("/drafts"))),false);
  await page.getByText("章节列表",{exact:true}).click();await page.getByText("服务器另端章节",{exact:true}).waitFor();await page.getByText("合成首章😀",{exact:true}).waitFor();
  stage="account-isolation";await page.evaluate(async()=>{await window.draftUi.session.logout();await window.draftUi.session.signIn("login","b@example.test","fixture-password");await window.draftUi.session.confirmDraftAccess();});await page.getByText("尚不能打开这本书",{exact:true}).waitFor();assert.equal(await page.getByText("合成首章😀",{exact:true}).count(),0);
  await page.evaluate(async()=>{await window.draftUi.session.logout();await window.draftUi.session.signIn("login","a@example.test","fixture-password");await window.draftUi.session.confirmDraftAccess();});await page.getByText("合成首章😀",{exact:true}).waitFor();
  console.log("PASS chapter routes, private offline editing and independently recovered draft fixture; not device evidence");
 }finally{await browser.close();}
}
module.exports=runFixture;if(require.main===module)runFixture().catch(error=>{console.error("chapter_fixture_line="+(String(error?.stack).match(/run\.cjs:(\d+)/)?.[1]??"0"));console.error("FAIL chapters fixture stage="+stage);process.exitCode=1;});
