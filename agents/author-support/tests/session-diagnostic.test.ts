import test from 'node:test';
import assert from 'node:assert/strict';
import {Session,type Transport} from '../../../mobile/src/auth/session.ts';
import {ApiError} from '../../../mobile/src/api/client.ts';
import {ids} from '../src/cases.ts';
import {checkPublication} from '../src/session-diagnostic.ts';

const published={work_id:ids.work,version:1,published_at:'2026-11-04T01:00:00Z',review_status:'pending'};
const preview={
  id:ids.preview,draft_id:ids.draft,source_revision:1,expected_version:0,title:'测试标题',content:'测试正文',
  introduction:'',tags:['日常'],created_at:'2026-11-04T01:00:00Z',expires_at:'2026-11-05T01:00:00Z',published,
};
const timeline={
  state:{id:ids.work,draft_id:ids.draft,state_revision:1,last_version:1,display_version:1,author_hidden:false,platform_limited:false,history_open:false},
  versions:[{...published,title:'测试标题',platform_limited:false}],events:[],next_version_before:0,next_event_before:0,
};

async function fixture(){
  let token:string|null=null;
  let owner=ids.work;
  let beforeRead:()=>Promise<void>=async()=>{};
  const reads:string[]=[];
  const transport:Transport=async<T>(path:string)=>{
    if(path==='/app/auth/login')return {
      access_token:'tako_app_'+'a'.repeat(64),token_type:'Bearer',expires_in:604800,account:{id:owner,nickname:'测试账号'},
    } as T;
    if(path==='/app/auth/logout')return {} as T;
    reads.push(path);
    await beforeRead();
    if(path===`/publication-previews/${ids.preview}`)return preview as T;
    if(path.startsWith(`/my/works/${ids.work}/versions?`))return timeline as T;
    throw new ApiError('resource_not_found','',404);
  };
  const session=new Session({get:async()=>token,set:async value=>{token=value},remove:async()=>{token=null}},transport);
  const login=async(nextOwner=ids.work)=>{
    owner=nextOwner;
    await session.signIn('login','session-test@example.test','synthetic-only');
  };
  await login();
  return {session,reads,login,pauseReads(){
    let signalStarted!:()=>void,resume!:()=>void;
    const started=new Promise<void>(resolve=>{signalStarted=resolve});
    const released=new Promise<void>(resolve=>{resume=resolve});
    beforeRead=()=>{signalStarted();return released};
    return {started,resume};
  }};
}

test('account switch during the first read discards diagnosis and stops further reads',async()=>{
  const env=await fixture();
  const pending=env.pauseReads();
  const check=checkPublication(env.session,{previewId:ids.preview});
  await pending.started;
  await env.session.logout();
  await env.login(ids.other);
  pending.resume();
  assert.equal(await check,null);
  assert.deepEqual(env.reads,[`/publication-previews/${ids.preview}`]);
});

test('diagnosis and its pending follow-up are invalid after re-login to the same account',async()=>{
  const env=await fixture();
  const handle=await checkPublication(env.session,{previewId:ids.preview});
  assert.ok(handle);
  assert.equal(handle.getDelivery()?.verdict.publication,'confirmed');
  const pending=env.pauseReads();
  const follow=handle.followUp();
  await pending.started;
  await env.session.logout();
  await env.login();
  pending.resume();
  assert.equal(await follow,null);
  assert.equal(handle.getDelivery(),null);
  const reads=env.reads.length;
  assert.equal(await handle.followUp(),null);
  assert.equal(env.reads.length,reads);
});
