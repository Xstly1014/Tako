import test from 'node:test';
import assert from 'node:assert/strict';
import {checkReaderVisibility} from '../src/reader-visibility.ts';
import {ids} from '../src/cases.ts';
import type {ToolResult} from '../src/tools.ts';

test('anonymous denial is distinct from transport failure and a concurrent display change',async()=>{
  async function check(readPublic:Parameters<typeof checkReaderVisibility>[2],afterRevision=1){
    let reads=0;
    const tools={invoke:async():Promise<ToolResult>=>{
      const revision=++reads===1?1:afterRevision;
      return {status:'ok',evidence_id:String(reads),observed_at:'',data:{state_revision:revision,display_version:revision}};
    }};
    return checkReaderVisibility(ids.work,tools,readPublic);
  }
  assert.deepEqual(await check(async()=>null),{status:'not_visible'});
  assert.deepEqual(await check(async()=>{throw Error('timeout')}),{status:'unavailable'});
  assert.deepEqual(await check(async id=>({id,version:1}),2),{status:'changed'});
  assert.deepEqual(await check(async id=>({id,version:2})),{status:'inconsistent'});
});
