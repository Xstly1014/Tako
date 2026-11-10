import {ApiError} from '../../../mobile/src/api/client.ts';
import {UUID} from '../../../mobile/src/api/reader.ts';
import type {Transport} from '../../../mobile/src/auth/session.ts';

const targetMs=48*60*60*1000;
const pageLimit=200;
const queues=[
  {name:'pre_review',path:'/ops/work-submissions',cursor:'cursor',next:'next_cursor',since:'first_waiting_at',initial:''},
  {name:'post_review',path:'/ops/reviews',cursor:'after',next:'next',since:'first_waiting_at',initial:0},
  {name:'appeal',path:'/ops/appeals',cursor:'after',next:'next',since:'created_at',initial:0},
] as const;

class ScanError extends Error {}

export async function scanReviewBacklog(read:Transport,now=Date.now()){
  const scannedAt=new Date(now).toISOString();
  const reports=[];
  for(const queue of queues){
    try{
      const pending=await scanQueue(read,queue);
      const ordered=[...pending].sort((a,b)=>a[1]-b[1]);
      reports.push({
        queue:queue.name,pending:ordered.length,
        oldestWaitingAt:ordered.length?new Date(ordered[0][1]).toISOString():null,
        overdue:ordered.filter(([,since])=>now-since>targetMs)
          .map(([id,since])=>({id,waitingSince:new Date(since).toISOString()})),
      });
    }catch(error){
      return {
        status:'incomplete' as const,scannedAt,queues:reports,failedQueue:queue.name,
        error:error instanceof ScanError?error.message:'request_failed',
        httpStatus:error instanceof ApiError?error.status:null,
        totalOverdue:null,
      };
    }
  }
  return {status:'complete' as const,scannedAt,queues:reports,totalOverdue:reports.reduce((n,q)=>n+q.overdue.length,0)};
}

async function scanQueue(read:Transport,queue:typeof queues[number]){
  const items=new Map<string|number,number>();
  const visited=new Set<string|number>();
  let cursor:string|number=queue.initial;
  for(let page=0;page<pageLimit;page++){
    const query=cursor?'?'+new URLSearchParams({[queue.cursor]:String(cursor)}):'';
    const response=await read<Record<string,unknown>>(queue.path+query,{method:'GET'});
    if(!response||!Array.isArray(response.items)||response.items.length>20)throw new ScanError('invalid_queue_page');
    for(const item of response.items){
      const id:unknown=item?.id;
      const validId=typeof queue.initial==='string'
        ?typeof id==='string'&&UUID.test(id)
        :typeof id==='number'&&Number.isSafeInteger(id)&&id>0;
      const timestamp=item?.[queue.since];
      const since=typeof timestamp==='string'?Date.parse(timestamp):NaN;
      if(!validId||item.state!=='pending'||!Number.isFinite(since))throw new ScanError('invalid_queue_item');
      const key=id as string|number;
      if(items.has(key)&&items.get(key)!==since)throw new ScanError('queue_item_changed');
      items.set(key,since);
    }
    const next=response[queue.next];
    if(next===queue.initial)return items;
    const validNext=typeof cursor==='string'
      ?typeof next==='string'&&next.length<=512
      :typeof next==='number'&&Number.isSafeInteger(next)&&next>cursor;
    if(!validNext||visited.has(next as string|number)||!response.items.length)throw new ScanError('invalid_queue_cursor');
    cursor=next as string|number;
    visited.add(cursor);
  }
  throw new ScanError('page_limit');
}
