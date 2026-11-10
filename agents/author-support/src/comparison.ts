import {cases,environment,ids,type Case} from './cases.ts';
import {evaluate} from './evaluate.ts';
import type {Delivery} from './delivery.ts';
import type {Evidence,Verdict} from './grade.ts';

const ambiguous=cases.find(task=>task.id==='ambiguous')!;
const selectedWork:Case={
  ...ambiguous,
  reference:'所选作品当前展示V1，未记录访问限制；没有原预览ID，原发布结果未确认。',
  expected:{publication:'unknown',access:'no_recorded_block'},
  actions:['open_work_detail'],
  assertions:['state'],
};

type Scenario={id:string;task:Case;reply?:string;afterReply?:Case};
export const developmentScenarios:Scenario[]=[
  ...cases.filter(task=>task!==ambiguous).map(task=>({id:task.id,task})),
  {id:'clarification-selected',task:ambiguous,reply:`我查到了，要核对的是作品ID ${ids.work}。请继续核对访问状态。`,afterReply:selectedWork},
  {id:'clarification-unavailable',task:ambiguous,reply:'我现在还是找不到作品ID，也没有原预览ID。'},
];

type Outcome={verdict?:Verdict;evidence:Evidence[];delivery:Delivery;failure?:string};
export async function runScenario(scenario:Scenario,run:(input:string,tools:ReturnType<typeof environment>['tools'])=>Promise<Outcome>){
  const turns=[];
  let input=scenario.task.prompt;
  const tasks=[scenario.task];
  for(const task of tasks){
    const env=environment(task),started=performance.now();
    const outcome=await run(input,env.tools);
    const delivered=evaluate(task,outcome.delivery.verdict,outcome.evidence);
    turns.push({
      ...outcome,
      tool_calls:env.tools.trace().length,
      elapsed_ms:Math.round(performance.now()-started),
      raw:outcome.verdict?evaluate(task,outcome.verdict,outcome.evidence):null,
      delivered,
    });
    if(turns.length!==1||outcome.failure||outcome.delivery.next_step?.kind!=='provide_identifiers'||!scenario.reply)continue;
    input+=`\n作者补充：${scenario.reply}`;
    tasks.push(scenario.afterReply??scenario.task);
  }
  const expectedTurns=scenario.reply?2:1;
  return {turns,automatic_passed:turns.length===expectedTurns&&turns.every(turn=>!turn.failure&&turn.delivered.automatic_passed),human_review:'pending' as const};
}
