// Explicit loopback-only real HTTP acceptance. Synthetic accounts only; no email.
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),{randomUUID}=require("node:crypto");
const root=path.resolve(__dirname,"../.."),file=path.join(root,".runtime/novels/service-accounts.json");
(async()=>{
 process.env.EXPO_PUBLIC_API_URL="http://127.0.0.1:3300/api";
 const {request,ApiError}=await import("../../mobile/src/api/client.ts");
 const {NovelsApi}=await import("../../mobile/src/api/novels.ts");
 const {BookWriter}=await import("../../mobile/src/novels/writer.ts");
 if(fs.existsSync(file))throw new Error("cleanup_previous_fixture_first");
 const accounts=[];fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(accounts.map(({email,id})=>({email,id}))));
 for(let i=0;i<2;i++){
  const email=randomUUID()+"@example.test";accounts.push({email});fs.writeFileSync(file,JSON.stringify(accounts.map(({email,id})=>({email,id}))));
  const value=await request("/app/auth/register",{method:"POST",body:{email,password:randomUUID()+"-novel-fixture"}});
  accounts[i].id=value.account.id;fs.writeFileSync(file,JSON.stringify(accounts.map(({email,id})=>({email,id}))));
  await request("/me",{method:"PATCH",token:value.access_token,body:{nickname:"合成小说测试"}});accounts[i].token=value.access_token;
 }
 const api=new NovelsApi((route,opts)=>request(route,{...opts,token:accounts[0].token}));
 const other=new NovelsApi((route,opts)=>request(route,{...opts,token:accounts[1].token}));
 const input={mutation_id:randomUUID(),base_revision:0,title:"合成HTTP小说😀",introduction:"不会公开的合成资料",tags:["冒险"]};
 let journal=null,posts=0;
 const writer=new BookWriter({async load(){return journal;},async save(v){journal=v;}},{async write(target,body){posts++;await api.write(target,body);throw new ApiError("network");},receipt:id=>api.receipt(id)},()=>true);
 await writer.restore();await writer.submit({target:null,input});assert.equal(writer.snapshot().phase,"unknown");
 const resumed=new BookWriter({async load(){return journal;},async save(v){journal=v;}},{write:async()=>{throw new Error("unexpected_post");},receipt:id=>api.receipt(id)},()=>true);
 await resumed.restore();await resumed.retry();assert.equal(resumed.snapshot().phase,"confirmed");assert.equal(posts,1);
 const book=resumed.snapshot().result;assert.ok(book);assert.equal((await api.list()).items.length,1);
 await assert.rejects(other.read(book.id),e=>e instanceof ApiError&&e.status===404);
 const changed=await api.write(book.id,{...input,mutation_id:randomUUID(),base_revision:1,title:"合成当前资料"});assert.equal(changed.revision,2);
 await assert.rejects(api.write(book.id,{...input,mutation_id:randomUUID(),base_revision:1}),e=>e instanceof ApiError&&e.code==="novel_revision_conflict");
 assert.equal((await api.receipt(input.mutation_id)).revision,1);assert.equal((await api.read(book.id)).title,"合成当前资料");
 await assert.rejects(request("/my/novels"),e=>e instanceof ApiError&&e.status===401);
 console.log("PASS real App novels client/writer with loopback HTTP and MySQL; no device claim.");
})().catch(()=>{console.error("FAIL novels live acceptance; synthetic account cleanup required");process.exitCode=1;});
