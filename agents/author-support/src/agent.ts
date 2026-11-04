import OpenAI from "openai";
import type {ChatCompletionMessageParam} from "openai/resources/chat/completions";
import {readFileSync} from "node:fs";
import {Buffer} from "node:buffer";
import {BudgetLedger,limits,pricing,sha256} from "./budget.ts";
import {toolDefinitions,type createAuthorTools} from "./tools.ts";
import {parseVerdict,type Evidence} from "./grade.ts";
import {contextFromInput} from './delivery.ts';
import {deliver} from './recovery.ts';

export type Progress={kind:'model';usage:Record<string,unknown>}|{kind:'tool';evidence:Evidence}|{kind:'answer';text:string};
export async function runAgent(input:string,tools:ReturnType<typeof createAuthorTools>,budget:BudgetLedger,runId:string,onProgress?:(event:Progress)=>void,options:{jsonMode?:boolean;client?:OpenAI;onReserved?:(charge:string,requestHash:string)=>void}={}){
  if(!options.client&&!process.env.DEEPSEEK_API_KEY)throw Error('missing_deepseek_key');
  // Client injection is for controlled SDK failure tests, never a model/user arg.
  const client=options.client??new OpenAI({apiKey:process.env.DEEPSEEK_API_KEY,baseURL:'https://api.deepseek.com',maxRetries:0,timeout:30_000,logLevel:'off'});
  const models=await client.models.list();
  const advertised=models.data.find(x=>x.id==='deepseek-flash');
  if(!advertised)throw Error('requested_model_unavailable');
  const messages:ChatCompletionMessageParam[]=[{role:'system',content:readFileSync(new URL('./policy.md',import.meta.url),'utf8')},{role:'user',content:input}];
  const evidence:Evidence[]=[],usage:Record<string,unknown>[]=[];
  let toolCalls=0;
  for(let turn=0;turn<limits.max_model_calls;turn++){
    const request={model:'deepseek-flash',messages,tools:toolDefinitions,max_tokens:limits.max_output_tokens,thinking:{type:'disabled'},stream:false as const,...(options.jsonMode?{response_format:{type:'json_object' as const}}:{})};
    if(Buffer.byteLength(JSON.stringify(request),'utf8')>limits.max_request_bytes)throw Error('request_size_budget');
    const requestHash=sha256(JSON.stringify(request)),charge=budget.reserve(runId,requestHash);
    let response;
    try{
      options.onReserved?.(charge,requestHash);
      response=await client.chat.completions.create(request);
      if(!response.usage)throw Error('missing_provider_usage');
      budget.recordReceipt(charge,requestHash,{response_id:response.id,model:response.model,prompt_tokens:response.usage.prompt_tokens,completion_tokens:response.usage.completion_tokens,observed_at:new Date().toISOString(),source:options.client?'controlled_test':'sdk_response'});
      const cost=budget.settle(charge,response.usage.prompt_tokens,response.usage.completion_tokens);
      usage.push({charge_id:charge,request_sha256:requestHash,response_id:response.id,model:response.model,system_fingerprint:response.system_fingerprint??null,prompt_tokens:response.usage.prompt_tokens,completion_tokens:response.usage.completion_tokens,upper_estimate_cny:cost/1_000_000});
    }catch{budget.unknown(charge);throw Error('provider_call_unconfirmed');}
    onProgress?.({kind:'model',usage:usage.at(-1)!});
    const choice=response.choices[0];
    if(!choice||choice.finish_reason==='length')throw Error('agent_output_incomplete');
    const message=choice.message;
    if(message.tool_calls?.length){
      messages.push(message);
      for(const call of message.tool_calls){
        if(++toolCalls>limits.max_tool_calls)throw Error('tool_call_budget');
        if(call.type!=='function')throw Error('unsupported_tool_call');
        let args:unknown;try{args=JSON.parse(call.function.arguments)}catch{args=null}
        const result=await tools.invoke(call.function.name,args);
        evidence.push({tool:call.function.name,result});
        onProgress?.({kind:'tool',evidence:evidence.at(-1)!});
        messages.push({role:'tool',tool_call_id:call.id,content:JSON.stringify(result)});
      }
    }else{
      onProgress?.({kind:'answer',text:message.content??''});
      const verdict=parseVerdict(message.content??'');
      return {verdict,evidence,delivery:deliver(contextFromInput(input),verdict,evidence),usage,provider:{requested_model:'deepseek-flash',requested_release:'DeepSeek-V4.1-Flash-1017',advertised_name:(advertised as unknown as {name?:string}).name??null,version_is_rolling_alias:true},pricing};
    }
  }
  throw Error('model_turn_budget');
}
