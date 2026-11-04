import {runAgent} from './agent.ts';
import {contextFromInput,fallback} from './delivery.ts';

// Public diagnostic boundary: incomplete inference never becomes a raw answer.
// The underlying loop keeps its error semantics and budget holds, no retry.
export async function diagnose(...args:Parameters<typeof runAgent>){
  try{const trial=await runAgent(...args);return {status:'completed' as const,delivery:trial.delivery,trial}}
  catch(error){
    const allowed=['missing_deepseek_key','provider_call_unconfirmed','budget_exceeded','unresolved_provider_charge','agent_output_not_json','agent_output_schema','agent_output_incomplete','tool_call_budget','model_turn_budget','request_size_budget','requested_model_unavailable'];
    const failure=error instanceof Error&&allowed.includes(error.message)?error.message:'diagnostic_unavailable';
    return {status:'incomplete' as const,failure,delivery:fallback(contextFromInput(args[0]),[failure])};
  }
}
