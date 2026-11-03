const esbuild=require("/tools/node_modules/esbuild"),{chromium}=require("/tools/node_modules/playwright"),assert=require("node:assert/strict"),path=require("node:path");
let stage="bundle";
async function runFixture(){
 const built=await esbuild.build({entryPoints:[path.join(__dirname,"entry.jsx")],bundle:true,write:false,format:"esm",jsx:"automatic",loader:{".png":"dataurl"},nodePaths:["/app/node_modules"],define:{"process.env.NODE_ENV":'"development"',"process.env.EXPO_PUBLIC_API_URL":'"http://127.0.0.1:3300/api"'},tsconfigRaw:{compilerOptions:{jsx:"react-jsx",target:"ES2022"}},plugins:[{name:"adapters",setup(build){
  build.onResolve({filter:/^react-native$|^react-native-safe-area-context$/},()=>({path:path.join(__dirname,"../mobile-comments-ui/native.jsx")}));
  build.onResolve({filter:/^expo-router$/},()=>({path:path.join(__dirname,"../mobile-drafts-ui/router.jsx")}));
  build.onResolve({filter:/^expo-crypto$/},()=>({path:path.join(__dirname,"../mobile-drafts-ui/crypto.jsx")}));
  build.onResolve({filter:/^react-native-svg$/},()=>({path:path.join(__dirname,"../mobile-versions-ui/svg.jsx")}));
  build.onResolve({filter:/chapters\/native$/},()=>({path:path.join(__dirname,"../mobile-drafts-ui/chapters.jsx")}));
  build.onResolve({filter:/\/auth\/context$|^\.\/native$/},()=>({path:path.join(__dirname,"stub.jsx")}));
 }}]});
 const browser=await chromium.launch({headless:true}),page=await browser.newPage();
 try{
  await page.route("**/*",route=>route.fulfill({status:200,contentType:"text/html",body:'<div id="root"></div>'}));await page.goto("https://fixture.test");await page.addScriptTag({content:built.outputFiles[0].text,type:"module"});
  stage="create-and-lost-response";await page.getByText("先建一本书",{exact:true}).waitFor();await page.getByRole("button",{name:"开新书",exact:true}).click();
  await page.getByRole("textbox",{name:"书名",exact:true}).fill("合成小说😀");await page.getByRole("textbox",{name:"书籍简介",exact:true}).fill("合成冒险简介");
  await page.evaluate(()=>{window.bookUi.drop=true;});await page.getByRole("button",{name:"建立书籍",exact:true}).click();await page.getByText("原提交待确认",{exact:true}).waitFor();
  assert.equal(await page.getByRole("textbox",{name:"书名",exact:true}).isEditable(),false);
  stage="restart-and-receipt";await page.evaluate(()=>window.bookUi.remount());await page.getByRole("button",{name:"重试确认原提交",exact:true}).click();await page.getByText("资料已保存，尚未公开",{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.bookUi.posts),1);
  await page.getByRole("button",{name:"查看当前资料",exact:true}).click();assert.equal(await page.getByRole("textbox",{name:"书名",exact:true}).inputValue(),"合成小说😀");
  stage="cas-keeps-input";await page.getByRole("textbox",{name:"书名",exact:true}).fill("并发编辑仍保留");await page.evaluate(()=>{window.bookUi.conflict=true;});await page.getByRole("button",{name:"保存资料",exact:true}).click();await page.getByText("资料已被另一端修改。你的输入仍保留，请先查看最新资料。",{exact:true}).waitFor();assert.equal(await page.getByRole("textbox",{name:"书名",exact:true}).inputValue(),"并发编辑仍保留");
  await page.getByRole("button",{name:"保留输入，查看服务器新资料",exact:true}).click();await page.getByRole("button",{name:"使用当前修订继续编辑",exact:true}).click();assert.equal(await page.getByRole("textbox",{name:"书名",exact:true}).inputValue(),"并发编辑仍保留");
  await page.evaluate(()=>{window.bookUi.conflict=false;});await page.getByRole("button",{name:"保存资料",exact:true}).click();await page.getByText("资料已保存，尚未公开",{exact:true}).waitFor();
  await page.getByRole("textbox",{name:"书名",exact:true}).fill("未提交的继续编辑");
  stage="discard-and-new-book";await page.getByRole("button",{name:"书籍列表",exact:true}).click();await page.getByRole("button",{name:"放弃",exact:true}).click();await page.getByRole("button",{name:"开新书",exact:true}).click();
  await page.getByRole("textbox",{name:"书名",exact:true}).fill("第二本合成小说");await page.evaluate(()=>{window.bookUi.conflict=false;});await page.getByRole("button",{name:"建立书籍",exact:true}).click();await page.getByText("资料已保存，尚未公开",{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.bookUi.books.size),2);
  stage="confirmed-read-error";await page.evaluate(()=>{window.bookUi.failRead=true;});await page.getByRole("button",{name:"查看当前资料",exact:true}).click();await page.getByText("连接中断，资料仍保留。请重试确认原提交。",{exact:true}).waitFor();await page.getByText("资料已保存，尚未公开",{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.bookUi.posts),4);
  console.log("PASS private books component fixture; no native claim");
 }finally{await browser.close();}
}
module.exports=runFixture;
if(require.main===module)runFixture().catch(()=>{console.error("FAIL private books fixture stage="+stage);process.exitCode=1;});
