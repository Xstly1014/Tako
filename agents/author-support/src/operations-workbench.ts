import {randomBytes,randomUUID} from 'node:crypto';
import {createServer,type IncomingMessage} from 'node:http';
import {readFileSync} from 'node:fs';
import {ReviewMonitor} from './review-monitor.ts';
import {outcomePeriod} from './review-outcomes.ts';
import {runOperatorShift,shiftSummary} from './operator-shift.ts';
import {checkCuration} from './curation-check.ts';
import {withOperator} from './operator-session.ts';
import {ApiError} from '../../../mobile/src/api/client.ts';
import {prepareReconciliation,reconciliationSummary,runReconciliation} from './shift-reconciliation.ts';

type Operator=typeof withOperator;
type Job={id:number;kind:'shift'|'curation'|'reconciliation';status:'running'|'complete'|'failed';startedAt:string;result?:unknown;error?:string};
type InputSchema={required?:string[];properties:Record<string,{type:string;enum?:unknown[];minimum?:number;maximum?:number;pattern?:string}>};
const contract=JSON.parse(readFileSync(new URL('../workbench/openapi.json',import.meta.url),'utf8')) as {
  paths:Record<string,{post?:{requestBody:{content:{'application/json':{schema:InputSchema}}}}}>;
};
// This bridge deliberately accepts only flat command envelopes, declared in its local contract.
function validateInput(route:string,body:Record<string,unknown>){
  const schema=contract.paths[route]?.post?.requestBody.content['application/json'].schema;
  if(!schema)throw Error('invalid_request');
  if(schema.required?.some(key=>!(key in body))||Object.keys(body).some(key=>!Object.hasOwn(schema.properties,key)))throw Error('invalid_request');
  for(const [key,value] of Object.entries(body)){
    const field=schema.properties[key];
    if(field.type==='integer'?(typeof value!=='number'||!Number.isSafeInteger(value)||value<(field.minimum??-Infinity)||value>(field.maximum??Infinity)):
      typeof value!==field.type)throw Error('invalid_request');
    if(field.enum&&!field.enum.includes(value)||field.pattern&&!new RegExp(field.pattern).test(String(value)))throw Error('invalid_request');
  }
}
const knownErrors=new Set(['invalid_request','invalid_period','period_not_started','shift_not_found','shift_changed',
  'shift_incomplete','invalid_acknowledgment','outcome_report_not_found','curation_report_not_found',
  'report_version_mismatch','report_not_comparable','period_still_open','periods_not_comparable',
  'test_operator_required','local_api_required','operator_logout_failed','job_cancelled',
  'shift_scan_incomplete','shifts_not_comparable','reconciliation_target_changed','reconciliation_changed','reconciliation_not_found']);
const errorCode=(error:unknown)=>error instanceof ApiError&&error.status===429?'operator_rate_limited':
  error instanceof ApiError&&[401,403].includes(error.status??0)?'operator_access_denied':
  error instanceof Error&&knownErrors.has(error.message)?error.message:'operation_failed';
const id=(value:unknown)=>{
  if(typeof value!=='number'||!Number.isSafeInteger(value)||value<1)throw Error('invalid_request');
  return value;
};
const keys=(body:Record<string,unknown>,allowed:string[])=>{
  if(Object.keys(body).some(key=>!allowed.includes(key)))throw Error('invalid_request');
};

/** Dedicated loopback tool; never mounted on the product HTTP server. */
export async function startWorkbench(monitor:ReviewMonitor,port=3410,operator:Operator=withOperator){
  const secret=randomBytes(32).toString('hex');
  let origin='',closing=false,sequence=0,job:Job|null=null;
  let active:Promise<void>|null=null;
  let stop:AbortController|null=null;
  const files=new Map(['index.html','workbench.js','workbench.css'].map(name=>[
    '/'+(name==='index.html'?'':name),readFileSync(new URL('../workbench/'+name,import.meta.url)),
  ]));
  const launch=(kind:Job['kind'],action:(signal:AbortSignal)=>Promise<unknown>)=>{
    if(active||closing)return false;
    const current:Job={id:++sequence,kind,status:'running',startedAt:new Date().toISOString()};
    job=current;
    stop=new AbortController();
    active=Promise.resolve().then(()=>action(stop!.signal)).then(result=>{
      current.result=result;current.status='complete';
    },error=>{current.error=errorCode(error);current.status='failed'}).finally(()=>{active=null;stop=null});
    return true;
  };
  const server=createServer({requestTimeout:10_000,headersTimeout:10_000,maxHeaderSize:8192},async(req,res)=>{
    const send=(status:number,value:unknown)=>{
      res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});
      res.end(JSON.stringify(value));
    };
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Request-ID',randomUUID());
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    // Exact Host blocks DNS rebinding; ports are part of the origin, not merely the site.
    if(req.headers.host!==new URL(origin).host)return send(403,{error:'local_origin_required'});
    const site=req.headers['sec-fetch-site'];
    if(site&&site!=='same-origin'&&site!=='none')return send(403,{error:'local_origin_required'});
    const url=new URL(req.url??'/',origin);
    if(url.search)return send(400,{error:'invalid_request'});
    if(req.method==='GET'&&files.has(url.pathname)){
      if(url.pathname==='/')res.setHeader('Set-Cookie',`tako_ops=${secret}; HttpOnly; SameSite=Strict; Path=/`);
      res.writeHead(200,{'Content-Type':url.pathname.endsWith('.js')?'text/javascript; charset=utf-8':
        url.pathname.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8'});
      return res.end(files.get(url.pathname));
    }
    if(!req.headers.cookie?.split(';').some(cookie=>cookie.trim()===`tako_ops=${secret}`))return send(403,{error:'local_session_required'});
    if(req.method==='GET'&&url.pathname==='/local/state')return send(200,{job});
    if(req.method!=='POST')return send(404,{error:'not_found'});
    if(req.headers.origin!==origin||req.headers['x-tako-workbench']!=='1')return send(403,{error:'local_origin_required'});
    if(req.headers['content-type']!=='application/json')return send(415,{error:'json_required'});
    try{
      const body=await readBody(req);
      if(!contract.paths[url.pathname]?.post)return send(404,{error:'not_found'});
      validateInput(url.pathname,body);
      switch(url.pathname){
        case '/local/history':{
          keys(body,['kind','before']);
          if(!['shifts','outcomes','curation','reconciliations'].includes(String(body.kind)))throw Error('invalid_request');
          return send(200,monitor.history(body.kind as 'shifts'|'outcomes'|'curation'|'reconciliations',body.before===undefined?undefined:id(body.before)));
        }
        case '/local/report':{
          keys(body,['kind','id']);const reportId=id(body.id);
          if(body.kind==='shifts'){
            const stored=monitor.shift(reportId);
            return send(200,{...shiftSummary(reportId,stored.run),revision:stored.revision,
              acknowledgment:monitor.shiftAcknowledgment(reportId),details:stored.run});
          }
          if(body.kind==='outcomes')return send(200,monitor.outcomeReport(reportId));
          if(body.kind==='curation')return send(200,monitor.curationReport(reportId));
          if(body.kind==='reconciliations'){
            const stored=monitor.reconciliation(reportId);
            return send(200,{...reconciliationSummary(reportId,stored.run),revision:stored.revision,details:stored.run});
          }
          throw Error('invalid_request');
        }
        case '/local/compare':
          keys(body,['previousId','currentId']);
          return send(200,monitor.compareOutcomes(id(body.previousId),id(body.currentId)));
        case '/local/ack':
          keys(body,['id','operatorLabel','revision']);
          if(typeof body.operatorLabel!=='string')throw Error('invalid_request');
          return send(200,monitor.acknowledgeShift(id(body.id),body.operatorLabel,id(body.revision)));
        case '/local/start':{
          keys(body,['from','until']);
          if(typeof body.from!=='string'||typeof body.until!=='string')throw Error('invalid_period');
          const period=outcomePeriod(body.from,body.until);
          if(period.start>=Date.now())throw Error('period_not_started');
          if(!launch('shift',signal=>operator(read=>runOperatorShift(read,monitor,period,undefined,signal),signal))){
            return send(409,{error:'job_running'});
          }
          return send(202,{job});
        }
        case '/local/resume':{
          keys(body,['id']);const stored=monitor.shift(id(body.id));
          if(shiftSummary(stored.id,stored.run).status==='complete')return send(200,shiftSummary(stored.id,stored.run));
          if(!launch('shift',signal=>operator(read=>runOperatorShift(read,monitor,stored.run.period,stored.id,signal),signal))){
            return send(409,{error:'job_running'});
          }
          return send(202,{job});
        }
        case '/local/curation':
          keys(body,[]);
          if(!launch('curation',signal=>operator(async read=>{
            const report=await checkCuration(read);
            return {reportId:monitor.saveCurationReport(report),...report};
          },signal)))return send(409,{error:'job_running'});
          return send(202,{job});
        case '/local/reconcile':{
          const run=prepareReconciliation(monitor,id(body.previousId),id(body.currentId));
          if(active||closing)return send(409,{error:'job_running'});
          // Persist the frozen pair before login so a failed session can resume the same comparison.
          const stored=monitor.createReconciliation(run);
          launch('reconciliation',signal=>run.departed.length?
            operator(read=>runReconciliation(read,monitor,stored.id,signal),signal):
            Promise.resolve(reconciliationSummary(stored.id,run)));
          return send(202,{job,reportId:stored.id});
        }
        case '/local/resume-reconciliation':{
          const stored=monitor.reconciliation(id(body.id));
          const summary=reconciliationSummary(stored.id,stored.run);
          if(summary.status==='complete')return send(200,summary);
          if(!launch('reconciliation',signal=>operator(read=>runReconciliation(read,monitor,stored.id,signal),signal))){
            return send(409,{error:'job_running'});
          }
          return send(202,{job});
        }
        case '/local/stop':
          keys(body,[]);stop?.abort();return send(202,{stopping:Boolean(active)});
        default:return send(404,{error:'not_found'});
      }
    }catch(error){
      const code=errorCode(error);
      return send(code==='invalid_request'||code==='invalid_period'||code==='period_not_started'?400:
        code.endsWith('_not_found')?404:code==='operation_failed'?500:409,{error:code});
    }
  });
  await new Promise<void>((resolve,reject)=>{
    server.once('error',reject);
    server.listen(port,'127.0.0.1',()=>{
      const address=server.address();
      if(!address||typeof address==='string')return reject(Error('listen_failed'));
      origin=`http://127.0.0.1:${address.port}`;resolve();
    });
  });
  return {origin,async close(){
    closing=true;stop?.abort();
    const closed=new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    server.closeAllConnections();
    await active;await closed;
  }};
}

async function readBody(req:IncomingMessage):Promise<Record<string,unknown>>{
  let text='',bytes=0;
  for await(const chunk of req.iterator({destroyOnReturn:false})){
    bytes+=Buffer.byteLength(chunk);
    if(bytes>2048){req.resume();throw Error('invalid_request')}
    text+=String(chunk);
  }
  let value:unknown;
  try{value=JSON.parse(text)}catch{throw Error('invalid_request')}
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid_request');
  return value as Record<string,unknown>;
}
