// Explicit local fixture target; does not send mail, register or touch 3300.
const assert = require('node:assert/strict');
(async()=>{
 process.env.EXPO_PUBLIC_API_URL='http://127.0.0.1:3320/api';
 const {searchWorks}=await import('../../mobile/src/api/search.ts');
 const {SearchFlow}=await import('../../mobile/src/search/flow.ts');
 const first=await searchWorks('合成搜索_%!');assert.equal(first.items.length,12);assert.ok(first.next_cursor);
 const next=await searchWorks('合成搜索_%!',first.next_cursor);assert.equal(next.items.length,2);assert.equal(next.next_cursor,'');
 assert.equal(new Set([...first.items,...next.items].map(x=>x.id)).size,14);
 assert.equal((await searchWorks('正文专用词')).items.length,0);
 assert.equal((await searchWorks('搜索验收作者')).items.length,12);
 const flow=new SearchFlow();flow.input('合成搜索_%!');await flow.submit();assert.equal(flow.snapshot().error,null);
 await flow.more();assert.equal(flow.snapshot().items.length,14);assert.equal(flow.snapshot().cursor,'');
 flow.dispose();console.log('PASS isolated real HTTP search client/coordination with MySQL fixture; no device claim.');
})().catch(()=>{console.error('FAIL isolated search acceptance; details withheld');process.exitCode=1;});
