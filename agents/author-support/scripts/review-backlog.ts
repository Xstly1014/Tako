import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {ReviewMonitor,type Observation} from '../src/review-monitor.ts';

const localApi='http://127.0.0.1:3300/api';

async function main(){
  const args=process.argv.slice(2);
  if(args.length>1||args.some(arg=>!['--track','--events'].includes(arg)))throw Error('invalid_cli');
  if(args.length===0)return runScan();
  const directory=path.resolve('.runtime/author-agent');
  mkdirSync(directory,{recursive:true});
  const monitor=new ReviewMonitor(path.join(directory,'review-backlog.sqlite'));
  try{
    if(args[0]==='--events')console.log(JSON.stringify(monitor.recentEvents(),null,2));
    else await runScan(monitor);
  }finally{monitor.close()}
}

async function runScan(monitor?:ReviewMonitor){
  if(process.env.EXPO_PUBLIC_API_URL&&process.env.EXPO_PUBLIC_API_URL!==localApi)throw Error('local_api_required');
  process.env.EXPO_PUBLIC_API_URL=localApi;
  const password=process.env.TEST_OPERATOR_PASSWORD;
  if(!password)throw Error('test_operator_required');

  const {Session}=await import('../../../mobile/src/auth/session.ts');
  const {ApiError,request}=await import('../../../mobile/src/api/client.ts');
  const {scanReviewBacklog}=await import('../src/review-backlog.ts');
  let token:string|null=null;
  const session=new Session({
    get:async()=>token,set:async value=>{token=value},remove:async()=>{token=null},
  },request);
  const started=Date.now();
  let report:Observation;
  let cleanupFailed=false;
  try{
    await session.signIn('login','operator@tako-test.invalid',password);
    report=await scanReviewBacklog((path,options)=>session.authorized(path,options),started);
  }catch(error){
    report={status:'incomplete',scannedAt:new Date(started).toISOString(),queues:[],failedQueue:'session',
      error:'operator_session_failed',httpStatus:error instanceof ApiError?error.status:null,totalOverdue:null};
  }finally{
    if(session.snapshot().phase==='ready')await session.logout().catch(()=>{cleanupFailed=true});
  }
  const tracking=monitor?.record(report);
  console.log(JSON.stringify({...report,...(tracking?{tracking}:{}),...(cleanupFailed?{cleanupFailed}: {})},null,2));
  if(report.status==='incomplete'||tracking?.accepted===false||cleanupFailed)process.exitCode=1;
}

main().catch(error=>{
  const code=error instanceof Error&&['invalid_cli','local_api_required','test_operator_required'].includes(error.message)
    ?error.message:'review_scan_failed';
  console.error(code);
  process.exitCode=1;
});
