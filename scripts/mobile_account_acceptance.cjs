// Real local-test API acceptance. No email, production access, or credentials printed.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..'),base='http://127.0.0.1:3300/api';
async function call(route,{method='GET',body,token,headers={}}={},want=200){
 const r=await fetch(base+route,{method,headers:{Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'}),...(token?{Authorization:'Bearer '+token}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
 assert.equal(r.headers.get('X-Tako-Environment'),'test','environment guard');assert.equal(r.status,want,method+' '+route+' status');
 return {value:r.status===204?undefined:await r.json(),cookie:r.headers.get('set-cookie')};
}
async function register(label){
 const email='app-'+crypto.randomBytes(6).toString('hex')+'@example.test',password=crypto.randomBytes(18).toString('hex');
 const {value,cookie}=await call('/app/auth/register',{method:'POST',body:{email,password}});assert.equal(cookie,null);
 const account=(await call('/me',{method:'PATCH',token:value.access_token,body:{nickname:'App自动验收'+label}})).value;
 return {email,password,token:value.access_token,account};
}
(async()=>{
 const methods=await call('/auth/methods');assert.equal(methods.value.mode,'password');
 const a=await register('甲'),b=await register('乙');
 const token=a.token;
 await call('/app/auth/register',{method:'POST',body:{email:a.email,password:a.password}},409);
 await call('/app/auth/login',{method:'POST',body:{email:a.email,password:'wrong-password'}},401);
 await call('/me',{token,headers:{Origin:'http://127.0.0.1:3300'}},403);
 await call('/me',{headers:{Cookie:'tako_test_session='+token}},401);
 const browser=await call('/auth/login',{method:'POST',body:{email:a.email,password:a.password},headers:{Origin:'http://127.0.0.1:3300'}});
 const browserCookie=browser.cookie.split(';')[0];
 await call('/me',{token,headers:{Cookie:browserCookie}},403);
 await call('/me',{token:browserCookie.split('=')[1]},401);
 const draft=(await call('/drafts/create',{method:'POST',token,body:{mutation_id:crypto.randomUUID(),title:'App链路验收：一段完整的测试故事',content:'这是仅供自动验收的合成作品，不是真实作者内容。\n故事从一次相遇开始，也在这篇文字里结束。'}})).value;
 const preview=(await call('/publication-previews',{method:'POST',token,body:{mutation_id:crypto.randomUUID(),draft_id:draft.draft_id,source_revision:draft.revision,introduction:'App账号、收藏与返回验收。',tags:['日常'],rights_confirmed:true}})).value;
 const published=(await call('/publications',{method:'POST',token,body:{mutation_id:crypto.randomUUID(),preview_id:preview.id,expected_version:preview.expected_version}})).value;
 const work=published.work_id;
 const mutate={mutation_id:crypto.randomUUID(),expected_account_id:a.account.id,expected_revision:0,favorite:true};
 const first=(await call('/my/favorites/'+work,{method:'POST',token,body:mutate})).value;
 // Discarded first response models an uncertain result; replay must return one receipt.
 const replay=(await call('/my/favorites/'+work,{method:'POST',token,body:mutate})).value;assert.deepEqual(replay,first);
 const own=(await call('/my/favorites',{token})).value;assert.equal(own.items.filter(x=>x.work_id===work).length,1);
 assert.equal((await call('/my/favorites',{token:b.token})).value.items.length,0);
 await call('/my/favorites/'+work,{method:'POST',token:b.token,body:{...mutate,mutation_id:crypto.randomUUID()}},409);
 const manage=(await call('/my/works/'+work,{token})).value;
 await call('/my/works/'+work+'/actions',{method:'POST',token,body:{mutation_id:crypto.randomUUID(),expected_state_revision:manage.state_revision,action:'hide'}});
 assert.equal((await call('/my/favorites',{token})).value.items.find(x=>x.work_id===work).work,null);
 await call('/works/'+work,{},404);
 await call('/my/favorites/'+work,{method:'POST',token,body:{mutation_id:crypto.randomUUID(),expected_account_id:a.account.id,expected_revision:first.revision,favorite:false}});
 const hidden=(await call('/my/works/'+work,{token})).value;
 await call('/my/works/'+work+'/actions',{method:'POST',token,body:{mutation_id:crypto.randomUUID(),expected_state_revision:hidden.state_revision,action:'restore'}});
 assert.equal((await call('/my/favorites',{token})).value.items.length,0);
 const state=(await call('/my/favorites/'+work,{token})).value;
 await call('/my/favorites/'+work,{method:'POST',token,body:{mutation_id:crypto.randomUUID(),expected_account_id:a.account.id,expected_revision:state.revision,favorite:true}});
 await call('/app/auth/logout',{method:'POST',token,body:{}},204);await call('/app/auth/logout',{method:'POST',token,body:{}},204);await call('/me',{token},401);
 await call('/me',{headers:{Cookie:browserCookie}});
 const relog=(await call('/app/auth/login',{method:'POST',body:{email:a.email,password:a.password}})).value;
 assert.equal(relog.account.id,a.account.id);
 assert.equal((await call('/my/favorites',{token:relog.access_token})).value.items[0].work_id,work);
 await call('/app/auth/logout',{method:'POST',token:relog.access_token,body:{}},204);
 await call('/app/auth/logout',{method:'POST',token:b.token,body:{}},204);
 await call('/auth/logout',{method:'POST',body:{},headers:{Origin:'http://127.0.0.1:3300',Cookie:browserCookie}},204);
 const fixtures={a:{email:a.email,password:a.password},b:{email:b.email,password:b.password},work};
 const directory=path.join(root,'.runtime/mobile/qa');fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'account-fixture.json'),JSON.stringify(fixtures));
 console.log('PASS: real test API registration/login, duplicate/wrong password, native/browser credential isolation, immutable ownership, lost-response favorite receipt, hidden metadata null/cancel/restore, account A/B isolation, logout retry and independent browser session. Test-only device fixture saved without printing credentials.');
})().catch(()=>{console.error('Mobile account API acceptance failed; inspect test-only status and contracts without printing response credentials.');process.exit(1)});
