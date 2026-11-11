import assert from 'node:assert/strict';
import test from 'node:test';
import {checkCuration} from '../src/curation-check.ts';
import {ReviewMonitor} from '../src/review-monitor.ts';
import {ApiError} from '../../../mobile/src/api/client.ts';
import type {Transport} from '../../../mobile/src/auth/session.ts';
import {ids} from '../src/cases.ts';

const card=(id=ids.work)=>({
  id,version:1,title:'PRIVATE_TITLE',introduction:'PRIVATE_INTRO',tags:['日常'],
  author_nickname:'PRIVATE_AUTHOR',first_published_at:'2026-11-01T00:00:00Z',
});
function state(selected=true){
  return {revision:1,slots:Array.from({length:6},(_,index)=>({
    slot:index+1,work_id:index===0?ids.work:null,work:index===0&&selected?card():null,
  }))};
}
const read=(selected=true)=>(async(path,options)=>{
  assert.equal(path,'/ops/curation');
  assert.deepEqual(options,{method:'GET'});
  return state(selected);
}) as Transport;

test('hidden selection, restored visibility and explicit reselection have distinct outcomes',async()=>{
  const hidden=await checkCuration(read(false),{featured:async()=>[],work:async()=>null});
  assert.equal(hidden.status,'complete');
  assert.equal(hidden.slots[0].status,'excluded_unreadable');
  const restored=await checkCuration(read(false),{featured:async()=>[],work:async()=>card()});
  assert.equal(restored.status,'complete');
  assert.equal(restored.slots[0].status,'selection_stale');
  assert.deepEqual('actions' in restored?restored.actions:null,[
    {slot:1,action:'review_reselection',workbenchPath:'/ops/curation'},
  ]);
  const selected=await checkCuration(read(),{featured:async()=>[card()],work:async()=>card()});
  assert.equal(selected.status,'complete');
  assert.equal(selected.slots[0].status,'selected_readable');
  assert.doesNotMatch(JSON.stringify([hidden,restored,selected]),/PRIVATE/);
});

test('changed snapshots and anonymous transport failures remain unconfirmed',async()=>{
  let calls=0;
  const changed=await checkCuration((async()=>({...state(),revision:++calls})) as Transport,{
    featured:async()=>[card()],work:async()=>card(),
  });
  assert.equal(changed.status,'changed');
  const failed=await checkCuration(read(),{
    featured:async()=>[card()],work:async()=>{throw Error('network')},
  });
  assert.equal(failed.status,'incomplete');
  assert.equal(failed.slots[0].status,'unavailable');
});

test('unconfigured public selections and version mismatches require rechecking',async()=>{
  const report=await checkCuration(read(),{
    featured:async()=>[card(ids.other)],work:async()=>({...card(),version:2}),
  });
  assert.equal(report.status,'complete');
  assert.equal('needsRecheck' in report&&report.needsRecheck,true);
  assert.equal(report.slots[0].status,'observed_mismatch');
  const monitor=new ReviewMonitor(':memory:');
  try{
    const id=monitor.saveCurationReport(report);
    assert.deepEqual(monitor.curationReport(id),{reportId:id,...report});
  }finally{monitor.close()}
});

test('operator denial stops before querying anonymous resources',async()=>{
  const report=await checkCuration(async()=>{throw new ApiError('operator_required','',403)},{
    featured:async()=>{assert.fail('unexpected public read')},
    work:async()=>{assert.fail('unexpected public read')},
  });
  assert.equal(report.status,'incomplete');
  assert.equal('httpStatus' in report&&report.httpStatus,403);
});
