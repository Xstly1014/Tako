import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {setTimeout as wait} from 'node:timers/promises';
import {ReviewMonitor,type Observation} from '../src/review-monitor.ts';
import {reviewHandoff} from '../src/review-handoff.ts';
import {outcomePeriod,reviewOutcomes} from '../src/review-outcomes.ts';

const localApi='http://127.0.0.1:3300/api';

async function main(){
  const args=process.argv.slice(2);
  const [mode,value,operatorLabel]=args;
  if(mode==='--watch'){
    if(args.length>2||(value!==undefined&&(!/^\d+$/.test(value)||Number(value)<300||Number(value)>3600))){
      throw Error('invalid_cli');
    }
  }else if(mode==='--pending'){
    if(args.length>2||(value!==undefined&&!validId(value)))throw Error('invalid_cli');
  }else if(mode==='--ack'){
    if(args.length!==3||!validId(value))throw Error('invalid_cli');
  }else if(mode==='--handoff'){
    if(args.length<2||args.length>3||!validId(value)||
      (operatorLabel!==undefined&&!['all','resume'].includes(operatorLabel)&&
        (!/^\d+$/.test(operatorLabel)||!Number.isSafeInteger(Number(operatorLabel))))){
      throw Error('invalid_cli');
    }
  }else if(mode==='--handoff-status'){
    if(args.length!==2||!validId(value))throw Error('invalid_cli');
  }else if(mode==='--outcomes'){
    if(args.length!==1&&args.length!==3)throw Error('invalid_cli');
    if(args.length===3)outcomePeriod(value,operatorLabel);
  }else if(mode==='--outcome-report'){
    if(args.length!==2||!validId(value))throw Error('invalid_cli');
  }else if(mode==='--compare-outcomes'){
    if(args.length!==3||!validId(value)||!validId(operatorLabel))throw Error('invalid_cli');
  }else if(args.length>1||(mode!==undefined&&!['--track','--events'].includes(mode))){
    throw Error('invalid_cli');
  }
  if(!mode)return printScan(await runScan());
  const directory=path.resolve('.runtime/author-agent');
  mkdirSync(directory,{recursive:true});
  const monitor=new ReviewMonitor(path.join(directory,'review-backlog.sqlite'));
  try{
    if(mode==='--events')console.log(JSON.stringify(monitor.recentEvents(),null,2));
    else if(mode==='--pending')console.log(JSON.stringify(monitor.pendingEvents(Number(value??0)),null,2));
    else if(mode==='--ack')console.log(JSON.stringify(monitor.acknowledge(Number(value),operatorLabel),null,2));
    else if(mode==='--handoff-status')console.log(JSON.stringify(monitor.handoffSummary(Number(value)),null,2));
    else if(mode==='--outcome-report')console.log(JSON.stringify(monitor.outcomeReport(Number(value)),null,2));
    else if(mode==='--compare-outcomes')console.log(JSON.stringify(monitor.compareOutcomes(Number(value),Number(operatorLabel)),null,2));
    else if(mode==='--outcomes'){
      const {session,password}=await createOperator();
      let report;
      try{
        await session.signIn('login','operator@tako-test.invalid',password);
        report=await reviewOutcomes((path,options)=>session.authorized(path,options),
          value===undefined?undefined:outcomePeriod(value,operatorLabel));
      }finally{
        if(session.snapshot().phase==='ready')await session.logout();
      }
      const reportId=monitor.saveOutcomeReport(report);
      console.log(JSON.stringify({reportId,version:monitor.outcomeReport(reportId).version,...report},null,2));
      if(report.status==='incomplete')process.exitCode=1;
    }
    else if(mode==='--handoff'){
      const eventId=Number(value);
      const batch=operatorLabel==='all'||operatorLabel==='resume';
      const items=operatorLabel==='resume'
        ?monitor.handoffSummary(eventId).rows.filter(row=>['unchecked','unavailable'].includes(row.status))
        :monitor.handoffItems(eventId);
      if(batch&&!items.length){
        console.log(JSON.stringify(monitor.handoffSummary(eventId),null,2));
        return;
      }
      const {session,password}=await createOperator();
      let report;
      try{
        await session.signIn('login','operator@tako-test.invalid',password);
        for(let offset=batch?0:Number(operatorLabel??0);offset<items.length;offset+=20){
          report=await reviewHandoff((path,options)=>session.authorized(path,options),items,offset);
          monitor.saveHandoff(eventId,report);
          const blocked=report.rows.some(row=>'httpStatus' in row&&[401,403,429].includes(row.httpStatus??0));
          if(!batch||blocked)break;
        }
      }finally{
        if(session.snapshot().phase==='ready')await session.logout();
      }
      const summary=monitor.handoffSummary(eventId);
      console.log(JSON.stringify(batch?summary:report??{total:items.length,rows:[],nextOffset:null},null,2));
      if(batch
        ?summary.counts.unavailable+summary.counts.rescan_required+summary.counts.unchecked>0
        :report?.rows.some(row=>row.status==='unavailable'||row.status==='rescan_required'))process.exitCode=1;
    }
    else if(mode==='--watch')await watch(monitor,Number(value??300));
    else printScan(await runScan(monitor));
  }finally{monitor.close()}
}

function validId(raw:string){
  return /^[1-9]\d*$/.test(raw)&&Number.isSafeInteger(Number(raw));
}

async function watch(monitor:ReviewMonitor,seconds:number){
  const stop=new AbortController();
  const shutdown=()=>stop.abort();
  process.on('SIGINT',shutdown);
  process.on('SIGTERM',shutdown);
  try{
    let first=true;
    while(!stop.signal.aborted){
      const scan=await runScan(monitor,stop.signal);
      if(scan.cleanupFailed){
        console.error('operator_logout_failed');
        process.exitCode=1;
        return;
      }
      if(stop.signal.aborted)break;
      const {report,tracking}=scan;
      const accessBlocked=report.status==='incomplete'&&[401,403,429].includes(report.httpStatus??0);
      if(first||tracking?.events.length||accessBlocked){
        console.log(JSON.stringify({status:report.status,scannedAt:report.scannedAt,totalOverdue:report.totalOverdue,tracking}));
      }
      if(accessBlocked){
        process.exitCode=1;
        return;
      }
      first=false;
      try{await wait(seconds*1000,undefined,{signal:stop.signal})}
      catch(error){if(!stop.signal.aborted)throw error}
    }
  }finally{
    process.off('SIGINT',shutdown);
    process.off('SIGTERM',shutdown);
  }
}

async function createOperator(){
  if(process.env.EXPO_PUBLIC_API_URL&&process.env.EXPO_PUBLIC_API_URL!==localApi)throw Error('local_api_required');
  process.env.EXPO_PUBLIC_API_URL=localApi;
  const password=process.env.TEST_OPERATOR_PASSWORD;
  if(!password)throw Error('test_operator_required');

  const {Session}=await import('../../../mobile/src/auth/session.ts');
  const {request}=await import('../../../mobile/src/api/client.ts');
  let token:string|null=null;
  const session=new Session({
    get:async()=>token,set:async value=>{token=value},remove:async()=>{token=null},
  },request);
  return {session,password};
}

async function runScan(monitor?:ReviewMonitor,signal?:AbortSignal){
  const {session,password}=await createOperator();
  const {ApiError}=await import('../../../mobile/src/api/client.ts');
  const {scanReviewBacklog}=await import('../src/review-backlog.ts');
  const started=Date.now();
  let report:Observation;
  let cleanupFailed=false;
  try{
    await session.signIn('login','operator@tako-test.invalid',password);
    report=await scanReviewBacklog((path,options)=>session.authorized(path,{...options,signal}),started);
  }catch(error){
    report={status:'incomplete',scannedAt:new Date(started).toISOString(),queues:[],failedQueue:'session',
      error:'operator_session_failed',httpStatus:error instanceof ApiError?error.status:null,totalOverdue:null};
  }finally{
    if(session.snapshot().phase==='ready')await session.logout().catch(()=>{cleanupFailed=true});
  }
  const tracking=signal?.aborted?undefined:monitor?.record(report);
  return {report,tracking,cleanupFailed};
}

function printScan({report,tracking,cleanupFailed}:Awaited<ReturnType<typeof runScan>>){
  console.log(JSON.stringify({...report,...(tracking?{tracking}:{}),...(cleanupFailed?{cleanupFailed}: {})},null,2));
  if(report.status==='incomplete'||tracking?.accepted===false||cleanupFailed)process.exitCode=1;
}

main().catch(error=>{
  const code=error instanceof Error&&['invalid_cli','local_api_required','test_operator_required',
    'invalid_acknowledgment','review_event_not_found','not_backlog_event','handoff_target_changed',
    'invalid_period','period_not_started','outcome_report_not_found','report_version_mismatch',
    'report_not_comparable','period_still_open','periods_not_comparable'].includes(error.message)
    ?error.message:'review_scan_failed';
  console.error(code);
  process.exitCode=1;
});
