import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as wait} from 'node:timers/promises';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {request} from 'node:http';
import {startWorkbench} from '../src/operations-workbench.ts';
import {ReviewMonitor} from '../src/review-monitor.ts';
import type {withOperator} from '../src/operator-session.ts';
import type {Transport} from '../../../mobile/src/auth/session.ts';
import {outcomePeriod} from '../src/review-outcomes.ts';
import {reviewOutcomes} from '../src/review-outcomes.ts';
import {ApiError} from '../../../mobile/src/api/client.ts';
import {ids} from '../src/cases.ts';

const emptyRead=(async(route:string)=>{
  if(route==='/ops/work-submissions')return {items:[],next_cursor:''};
  if(['/ops/reviews','/ops/appeals','/ops/moderation?before=0'].includes(route))return {items:[],next:0};
  throw Error('unexpected_path');
}) as Transport;
const operator:typeof withOperator=async action=>action(emptyRead);

async function connect(monitor:ReviewMonitor,run:typeof withOperator=operator){
  const workbench=await startWorkbench(monitor,0,run);
  const root=await fetch(workbench.origin);
  const cookie=root.headers.get('set-cookie')!.split(';')[0];
  const headers={'Content-Type':'application/json','X-Tako-Workbench':'1',Origin:workbench.origin,Cookie:cookie};
  return {...workbench,root,cookie,headers,
    post:(route:string,body:unknown)=>fetch(workbench.origin+'/local/'+route,{method:'POST',headers,body:JSON.stringify(body)}),
    state:async()=>await (await fetch(workbench.origin+'/local/state',{headers:{Cookie:cookie}})).json(),
  };
}
async function done(client:Awaited<ReturnType<typeof connect>>){
  for(let attempt=0;attempt<100;attempt++){
    const state=await client.state();if(state.job?.status!=='running')return state.job;
    await wait(5);
  }
  throw Error('job_did_not_finish');
}

test('browser bridge rejects cross-origin, rebinding, missing session and malformed commands before invoking operator',async()=>{
  const monitor=new ReviewMonitor(':memory:');let calls=0;
  const client=await connect(monitor,async action=>{calls++;return action(emptyRead)});
  try{
    assert.match(client.root.headers.get('set-cookie')!,/HttpOnly; SameSite=Strict/);
    assert.equal(client.root.headers.get('cache-control'),'no-store');
    assert.match(client.root.headers.get('content-security-policy')!,/frame-ancestors 'none'/);
    assert.equal((await fetch(client.origin+'/local/state')).status,403);
    const forbiddenHeaders:Record<string,string>[]=[{Origin:'http://127.0.0.1:3300'},{'Sec-Fetch-Site':'same-site'},
      {'X-Tako-Workbench':''},{'Content-Type':'text/plain'}];
    for(const changed of forbiddenHeaders){
      const response=await fetch(client.origin+'/local/start',{method:'POST',headers:{...client.headers,...changed},body:'{}'});
      assert.ok([403,415].includes(response.status),`${Object.keys(changed)[0]} returned ${response.status}`);
    }
    const rebinding=await new Promise<number>((resolve,reject)=>{
      const req=request(client.origin+'/local/state',{headers:{Host:'attacker.invalid',Cookie:client.cookie}},res=>{
        res.resume();resolve(res.statusCode!);
      });req.on('error',reject);req.end();
    });assert.equal(rebinding,403);
    assert.equal((await client.post('start',{from:'2026-02-30',until:'2026-03-01'})).status,400);
    assert.equal((await client.post('history',{kind:'shifts',before:0})).status,400);
    assert.equal((await client.post('start',{from:'2026-11-01',until:'2026-11-06',owner_id:'x'})).status,400);
    assert.equal((await client.post('start',{from:'x'.repeat(4096),until:'2026-11-06'})).status,400);
    assert.equal((await fetch(client.origin+'/local/state?secret=x',{headers:{Cookie:client.cookie}})).status,400);
    assert.equal(calls,0);
  }finally{await client.close();monitor.close()}
});

test('period comparison uses saved flow metrics and rejects reversed periods and missing reports',async()=>{
  const monitor=new ReviewMonitor(':memory:');const client=await connect(monitor);
  try{
    const previousId=monitor.saveOutcomeReport(await reviewOutcomes(emptyRead,outcomePeriod('2026-10-01','2026-10-06')));
    const currentId=monitor.saveOutcomeReport(await reviewOutcomes(emptyRead,outcomePeriod('2026-10-06','2026-10-11')));
    const response=await client.post('compare',{previousId,currentId});assert.equal(response.status,200);
    const compared=await response.json();
    assert.deepEqual(compared.closingBacklog,{previous:0,current:0,change:0});
    assert.deepEqual(compared.incoming,{previous:0,current:0,change:0});
    assert.equal((await client.post('compare',{previousId:currentId,currentId:previousId})).status,409);
    assert.equal((await client.post('report',{kind:'outcomes',id:999})).status,404);
  }finally{await client.close();monitor.close()}
});

test('complete shift is persisted, revision-bound acknowledgment is idempotent and completed resume performs no login',async()=>{
  const directory=mkdtempSync(path.join(os.tmpdir(),'tako-workbench-'));
  const file=path.join(directory,'monitor.sqlite');let monitor=new ReviewMonitor(file);
  let calls=0;let client=await connect(monitor,async action=>{calls++;return action(emptyRead)});
  try{
    assert.equal((await client.post('start',{from:'2026-11-01',until:'2026-11-06'})).status,202);
    assert.equal((await done(client)).status,'complete');
    const history=await (await client.post('history',{kind:'shifts'})).json();
    const id=history.items[0].id;
    const report=await (await client.post('report',{kind:'shifts',id})).json();
    assert.equal(report.status,'complete');assert.equal(report.acknowledgment,null);
    assert.equal((await client.post('ack',{id,revision:report.revision-1,operatorLabel:'oncall'})).status,409);
    assert.equal((await client.post('ack',{id,revision:report.revision,operatorLabel:'oncall'})).status,200);
    const receipt=monitor.shiftAcknowledgment(id);
    await client.post('ack',{id,revision:report.revision,operatorLabel:'other'});
    assert.deepEqual(monitor.shiftAcknowledgment(id),receipt);
    assert.equal((await client.post('resume',{id})).status,200);assert.equal(calls,1);
    await client.close();monitor.close();
    monitor=new ReviewMonitor(file);client=await connect(monitor);
    const restored=await (await client.post('report',{kind:'shifts',id})).json();
    assert.equal(restored.acknowledgment.operatorLabel,'oncall');
    assert.equal(restored.outcomeReportId,report.outcomeReportId);
  }finally{await client.close();monitor.close();rmSync(directory,{recursive:true,force:true})}
});

test('one active job; cancellation preserves partial shift and resume finishes only remaining stages',async()=>{
  const monitor=new ReviewMonitor(':memory:');let first=true;
  const client=await connect(monitor,async(action,signal)=>action((async(route,options)=>{
    if(first){first=false;await wait(1000,undefined,{signal}).catch(()=>{});throw Error('cancelled')}
    return emptyRead(route,options);
  }) as Transport));
  try{
    await client.post('start',{from:'2026-11-01',until:'2026-11-06'});
    assert.equal((await client.post('curation',{})).status,409);
    await client.post('stop',{});await done(client);
    const id=(await (await client.post('history',{kind:'shifts'})).json()).items[0].id;
    assert.equal((await client.post('ack',{id,revision:monitor.shift(id).revision,operatorLabel:'oncall'})).status,409);
    assert.equal((await client.post('resume',{id})).status,202);await done(client);
    assert.equal(monitor.shift(id).run.outcomeStatus,'complete');
  }finally{await client.close();monitor.close()}
});

test('shutdown cancels active operator task; sanitized errors never return raw upstream failure',async()=>{
  const monitor=new ReviewMonitor(':memory:');let entered!:()=>void;
  const waiting=new Promise<void>(resolve=>{entered=resolve});let cancelled=false;
  const client=await connect(monitor,async(_action,signal)=>{
    entered();await wait(10000,undefined,{signal}).catch(()=>{cancelled=true});throw Error('secret upstream payload');
  });
  try{
    await client.post('curation',{});await waiting;await client.close();assert.equal(cancelled,true);
  }finally{monitor.close()}
  const secondMonitor=new ReviewMonitor(':memory:');const second=await connect(secondMonitor,async()=>{throw Error('password=SECRET')});
  try{
    await second.post('curation',{});const job=await done(second);
    assert.equal(job.error,'operation_failed');assert.ok(!JSON.stringify(job).includes('SECRET'));
  }finally{await second.close();secondMonitor.close()}
});

test('history pagination remains stable when new shifts arrive between pages',()=>{
  const monitor=new ReviewMonitor(':memory:');
  try{
    const create=()=>monitor.createShift({startedAt:new Date().toISOString(),period:outcomePeriod('2026-11-01','2026-11-06'),
      scan:null,checks:[],policy:null,outcomeReportId:null,outcomeStatus:'not_run'});
    for(let i=0;i<25;i++)create();
    const first=monitor.history('shifts');assert.equal(first.items.length,20);create();
    const second=monitor.history('shifts',first.nextBefore!);assert.equal(second.items.length,5);
    assert.equal(new Set([...first.items,...second.items].map(row=>row.id)).size,25);
  }finally{monitor.close()}
});

test('reconciliation HTTP commands retain failures, resume the same record and expose saved history',async()=>{
  const monitor=new ReviewMonitor(':memory:');let fail=true,calls=0;
  const client=await connect(monitor,async action=>action((async route=>{
    calls++;assert.equal(route,`/ops/reviews/${ids.work}/versions/1`);
    if(fail)throw new ApiError('service_unavailable','',503);
    return {task:{id:1,work_id:ids.work,version:1,state:'approved'}};
  }) as Transport));
  try{
    const make=(at:string,hasTask:boolean)=>monitor.createShift({startedAt:at,period:outcomePeriod('2026-11-01','2026-11-06'),
      scan:{status:'complete',scannedAt:at,totalOverdue:hasTask?1:0,queues:[{queue:'post_review',pending:hasTask?1:0,
        oldestWaitingAt:hasTask?'2026-10-01T00:00:00Z':null,overdue:hasTask?[{id:1,waitingSince:'2026-10-01T00:00:00Z',
          target:{queue:'post_review',workId:ids.work,version:1}}]:[]}]},
      checks:[],policy:null,outcomeStatus:'not_run',outcomeReportId:null});
    const previous=make('2026-11-01T00:00:00Z',true),current=make('2026-11-02T00:00:00Z',false);
    assert.equal((await client.post('reconcile',{previousId:current.id,currentId:previous.id})).status,409);
    assert.equal((await client.post('reconcile',{previousId:previous.id,currentId:999})).status,404);
    const started=await client.post('reconcile',{previousId:previous.id,currentId:current.id});assert.equal(started.status,202);
    const {reportId}=await started.json();await done(client);
    let report=await (await client.post('report',{kind:'reconciliations',id:reportId})).json();
    assert.equal(report.status,'incomplete');assert.equal(report.departureChecks.unconfirmed,1);
    fail=false;assert.equal((await client.post('resume-reconciliation',{id:reportId})).status,202);await done(client);
    report=await (await client.post('report',{kind:'reconciliations',id:reportId})).json();
    assert.equal(report.status,'complete');assert.equal(report.departureChecks.decided,1);assert.equal(calls,2);
    assert.equal((await client.post('resume-reconciliation',{id:reportId})).status,200);assert.equal(calls,2);
    const history=await (await client.post('history',{kind:'reconciliations'})).json();assert.equal(history.items[0].reportId,reportId);
  }finally{await client.close();monitor.close()}
});

test('effect command binds to stored task metadata and keeps an independently retrievable report',async()=>{
  const monitor=new ReviewMonitor(':memory:');
  const client=await connect(monitor,async action=>action((async()=>({task:{id:1,work_id:ids.work,version:1,state:'pending'}})) as Transport));
  try{
    const stored=monitor.createShift({startedAt:new Date().toISOString(),period:outcomePeriod('2026-11-01','2026-11-06'),
      scan:{status:'complete',scannedAt:new Date().toISOString(),totalOverdue:1,queues:[{queue:'post_review',pending:1,oldestWaitingAt:null,
        overdue:[{id:1,waitingSince:'2026-10-01T00:00:00Z',target:{queue:'post_review',workId:ids.work,version:1}}]}]},
      checks:[],policy:null,outcomeStatus:'not_run',outcomeReportId:null});
    const source={kind:'shifts',id:stored.id,queue:'post_review',itemId:'1'};
    assert.equal((await client.post('effect',{...source,workId:ids.work})).status,400);
    assert.equal((await client.post('effect',{...source,itemId:'99'})).status,404);
    assert.equal((await client.post('effect',source)).status,202);
    const job=await done(client);assert.equal(job.result.status,'awaiting_decision');
    const report=await (await client.post('report',{kind:'effects',id:job.result.reportId})).json();
    assert.equal(report.operation.workId,ids.work);assert.equal(report.display,null);
    const history=await (await client.post('history',{kind:'effects'})).json();assert.equal(history.items[0].id,report.reportId);
  }finally{await client.close();monitor.close()}
});
