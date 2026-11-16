import {readFileSync,statSync,lstatSync,realpathSync} from 'node:fs';
import path from 'node:path';
import {developmentScenarios} from './comparison.ts';
import {holdoutScenarios} from './holdout.ts';
import {fixtureVersion} from './cases.ts';
import {digest,evaluate,graderVersion} from './evaluate.ts';
import {parseVerdict,type Evidence} from './grade.ts';

type Variant='fixed'|'agent';
const criteria=['factual','answers_question','uncertainty','advice_safe'] as const;
const protocolFiles=['cases.ts','comparison.ts','holdout.ts','evaluate.ts','grade.ts','tools.ts'];
export type AcceptanceRow={key:string;variant:Variant;scenario:string;repeat:number;binding:string;
  automatic_passed:boolean|null;failures:string[];tool_calls:number;elapsed_ms:number;
  turns:{input:string;verdict:ReturnType<typeof parseVerdict>;evidence:Evidence[];next_step:unknown}[]};
export type AcceptanceRun={run_id:string;manifest_sha256:string;source_sha256:string;protocol:string;delivery_version:string;
  environment:string;split:string;repetitions:number;scenarios:{id:string;sha256:string}[];rows:AcceptanceRow[]};
export type AcceptanceReview={run_id:string;reviewer:string;items:{key:string;variant:Variant;binding:string;
  criteria:Record<typeof criteria[number],boolean|null>;notes:string}[]};
const invalid=(code='acceptance_artifact_invalid'):never=>{throw Error(code)};
const object=(value:unknown):value is Record<string,any>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const integer=(n:unknown)=>Number.isSafeInteger(n)&&Number(n)>=0;

function json(root:string,name:string,limit=8_000_000){
  const file=path.join(root,name);
  if(lstatSync(file).isSymbolicLink()||!statSync(file).isFile()||statSync(file).size>limit||
    !realpathSync(file).startsWith(realpathSync(root)+path.sep))invalid();
  const text=readFileSync(file,'utf8');
  return {value:JSON.parse(text),sha256:digestText(text)};
}

/** Regrade the saved delivery, never silently rerun a model or its archived source. */
export function loadAcceptanceRun(root:string):AcceptanceRun{
  const {value:m,sha256:manifestHash}=json(root,'manifest.json');
  if(!object(m)||typeof m.run_id!=='string'||!['holdout','development'].includes(m.split)||
    m.environment!=='controlled_transport_no_database'||m.json_mode!==true||
    m.fixture_version!==fixtureVersion||m.grader_version!==graderVersion||typeof m.delivery_version!=='string')invalid('acceptance_protocol_unsupported');
  const repetitions=m.repetitions??1;
  if(!integer(repetitions)||repetitions<1||repetitions>10||m.split==='holdout'&&repetitions<3||m.split==='development'&&repetitions!==1)invalid();
  const scenarios=m.split==='holdout'?holdoutScenarios:developmentScenarios;
  if(!Array.isArray(m.scenarios)||m.scenarios.length!==scenarios.length||new Set(m.scenarios.map((s:any)=>s?.id)).size!==scenarios.length)invalid('acceptance_task_set_mismatch');
  for(const scenario of scenarios)if(!m.scenarios.some((s:any)=>s?.id===scenario.id&&s.sha256===digest(scenario)))invalid('acceptance_task_set_mismatch');
  const {value:bundle}=json(root,'sources.json');
  if(!object(bundle)||!object(bundle.files)||digest(bundle.files)!==bundle.bundle_sha256||m.source_bundle?.sha256!==bundle.bundle_sha256)invalid('acceptance_source_changed');
  const hashes:Record<string,string>={};
  for(const name of protocolFiles){
    const file='agents/author-support/src/'+name,stored=bundle.files[file];
    const current=readFileSync(new URL('./'+name,import.meta.url),'utf8');
    if(!object(stored)||stored.content!==current||stored.sha256!==digestText(current))invalid('acceptance_protocol_source_changed');
    hashes[file]=stored.sha256;
  }
  const protocol=digest({fixture:m.fixture_version,grader:m.grader_version,environment:m.environment,json_mode:m.json_mode,
    split:m.split,repetitions,scenarios:m.scenarios.slice().sort((a:any,b:any)=>a.id.localeCompare(b.id)),hashes});
  const rows:AcceptanceRow[]=[];
  for(const scenario of scenarios)for(let repeat=1;repeat<=repetitions;repeat++){
    const key=m.split==='holdout'?`${scenario.id}-${repeat}`:scenario.id;
    let artifact:{value:any;sha256:string}|null=null;
    try{artifact=json(root,key+'.json')}catch(error){
      if(!object(error)||error.code!=='ENOENT')throw error;
    }
    if(artifact&&(artifact.value?.scenario!==scenario.id||artifact.value?.repeat!==repeat))invalid();
    for(const variant of ['fixed','agent'] as const){
      const part=artifact?.value?.[variant];
      const binding=digest({run_id:m.run_id,key,variant,manifest:manifestHash,sources:bundle.bundle_sha256,artifact:artifact?.sha256??null});
      if(part===null||part===undefined){rows.push({key,variant,scenario:scenario.id,repeat,binding,automatic_passed:null,failures:['not_run'],tool_calls:0,elapsed_ms:0,turns:[]});continue}
      if(!object(part)||!Array.isArray(part.turns)||part.turns.length>2)invalid();
      const failures:string[]=[],turns:AcceptanceRow['turns']=[];
      let toolCalls=0,elapsed=0;
      for(let index=0;index<part.turns.length;index++){
        const turn=part.turns[index];
        if(!object(turn)||!object(turn.delivery)||!Array.isArray(turn.evidence)||turn.evidence.length>8||!integer(turn.tool_calls)||!integer(turn.elapsed_ms))invalid();
        const task=index===0?scenario.task:scenario.afterReply??scenario.task;
        const verdict=parseVerdict(JSON.stringify(turn.delivery.verdict));
        const score=evaluate(task,verdict,turn.evidence);
        if(!object(turn.delivered)||turn.delivered.grader_version!==graderVersion||
          turn.delivered.automatic_passed!==score.automatic_passed||digest(turn.delivered.failures)!==digest(score.failures))invalid('acceptance_saved_score_mismatch');
        failures.push(...score.failures.map(code=>`turn_${index+1}:${code}`));
        if(turn.failure)failures.push('execution_incomplete');
        toolCalls+=turn.tool_calls;elapsed+=turn.elapsed_ms;
        turns.push({input:index===0?scenario.task.prompt:scenario.task.prompt+'\n作者补充：'+scenario.reply,
          verdict,evidence:turn.evidence,next_step:turn.delivery.next_step??null});
      }
      if(turns.length!==(scenario.reply?2:1))failures.push('conversation_incomplete');
      if(part.automatic_passed!==(failures.length===0))invalid('acceptance_saved_score_mismatch');
      rows.push({key,variant,scenario:scenario.id,repeat,binding,automatic_passed:failures.length===0,failures,tool_calls:toolCalls,elapsed_ms:elapsed,turns});
    }
  }
  return {run_id:m.run_id,manifest_sha256:manifestHash,source_sha256:bundle.bundle_sha256,protocol,delivery_version:m.delivery_version,
    environment:m.environment,split:m.split,repetitions,scenarios:m.scenarios,rows};
}

// Source manifests use raw-file hashes, while digest() hashes JSON values.
import {createHash} from 'node:crypto';
const digestText=(text:string)=>createHash('sha256').update(text).digest('hex');

export function reviewTemplate(run:AcceptanceRun):AcceptanceReview{
  return {run_id:run.run_id,reviewer:'',items:run.rows.filter(row=>row.automatic_passed!==null).map(row=>({
    key:row.key,variant:row.variant,binding:row.binding,
    criteria:{factual:null,answers_question:null,uncertainty:null,advice_safe:null},notes:'',
  }))};
}

export function assessAcceptance(run:AcceptanceRun,variant:Variant,review?:AcceptanceReview,baseline?:AcceptanceRun){
  if(!['fixed','agent'].includes(variant))invalid();
  if(!run.scenarios.length||run.rows.length!==run.scenarios.length*run.repetitions*2||
    new Set(run.rows.map(row=>row.key+':'+row.variant)).size!==run.rows.length)invalid();
  if(baseline?.protocol!==undefined&&baseline.protocol!==run.protocol)invalid('acceptance_comparison_protocol_mismatch');
  if(review&&(review.run_id!==run.run_id||typeof review.reviewer!=='string'||!Array.isArray(review.items)))invalid('acceptance_review_invalid');
  const reviews=new Map<string,{passed:boolean|null;notes:string}>();
  for(const item of review?.items??[]){
    const key=item.key+':'+item.variant,row=run.rows.find(row=>row.key===item.key&&row.variant===item.variant);
    if(!row||row.automatic_passed===null||reviews.has(key)||item.binding!==row.binding)invalid('acceptance_review_stale_or_duplicate');
    if(!object(item.criteria)||Object.keys(item.criteria).sort().join(',')!==[...criteria].sort().join(',')||
      Object.values(item.criteria).some(value=>value!==null&&typeof value!=='boolean')||typeof item.notes!=='string')invalid('acceptance_review_invalid');
    const values=Object.values(item.criteria);
    const passed=values.some(value=>value===false)?false:
      values.every(value=>value===true)&&Boolean(review!.reviewer.trim())&&Boolean(item.notes.trim())?true:null;
    reviews.set(key,{passed,notes:item.notes});
  }
  const rows=run.rows.map(row=>({...row,human_passed:reviews.get(row.key+':'+row.variant)?.passed??null}));
  const selected=rows.filter(row=>row.variant===variant);
  const automaticFailed=selected.filter(row=>row.automatic_passed===false),notRun=selected.filter(row=>row.automatic_passed===null);
  const humanFailed=selected.filter(row=>row.human_passed===false),pending=selected.filter(row=>row.human_passed===null&&row.automatic_passed!==null);
  const reasons=[...(automaticFailed.length?['automatic_failure']:[]),...(notRun.length?['trials_not_run']:[]),
    ...(humanFailed.length?['human_review_failed']:[]),...(pending.length?['human_review_pending']:[])];
  const comparison=baseline?selected.map(row=>{
    const old=baseline.rows.find(old=>old.key===row.key&&old.variant===variant)!;
    return {key:row.key,before:old.automatic_passed,after:row.automatic_passed,
      transition:old.automatic_passed===null||row.automatic_passed===null?'not_comparable':
        old.automatic_passed&&!row.automatic_passed?'regressed':!old.automatic_passed&&row.automatic_passed?'improved':'unchanged'};
  }):null;
  const failures=rows.filter(row=>row.automatic_passed===false||row.human_passed===false).map(row=>({
    key:row.key,variant:row.variant,binding:row.binding,failures:row.failures,human_failed:row.human_passed===false,
    source_run:run.run_id,scenario:run.scenarios.find(s=>s.id===row.scenario)!,
    fixture:run.split==='holdout'?holdoutScenarios.find(s=>s.id===row.scenario)!:developmentScenarios.find(s=>s.id===row.scenario)!,
    turns:row.turns,triage:'unassigned' as const,case_use:'regression_only_after_intake' as const,
  }));
  const groups=run.scenarios.map(scenario=>({scenario:scenario.id,variants:Object.fromEntries((['fixed','agent'] as const).map(name=>{
    const trials=rows.filter(row=>row.scenario===scenario.id&&row.variant===name);
    return [name,{expected:run.repetitions,completed:trials.filter(row=>row.automatic_passed!==null).length,
      automatic_passed:trials.filter(row=>row.automatic_passed===true).length,
      business_passed:trials.filter(row=>row.automatic_passed===true&&row.human_passed===true).length,
      all_repeats_automatic_passed:trials.every(row=>row.automatic_passed===true),
      all_repeats_business_passed:trials.every(row=>row.automatic_passed===true&&row.human_passed===true)}];
  }))}));
  return {version:'author-acceptance-v1',run_id:run.run_id,variant,
    decision:automaticFailed.length||notRun.length||humanFailed.length?'blocked':pending.length?'review_required':'accepted_regression_gate',
    reasons,expected:selected.length,completed:selected.length-notRun.length,automatic_passed:selected.filter(row=>row.automatic_passed===true).length,
    human_passed:selected.filter(row=>row.human_passed===true).length,pending_review:pending.length,
    baseline_run:baseline?.run_id??null,delivery_change:baseline?{before:baseline.delivery_version,after:run.delivery_version}:null,
    comparison,groups,failures};
}
