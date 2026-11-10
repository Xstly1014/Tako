import type {createAuthorTools} from './tools.ts';

// Owner reads bracket the anonymous read so a concurrent display change
// cannot be presented as a confirmed version mismatch.
export async function checkReaderVisibility(
  workId:string,
  tools:Pick<ReturnType<typeof createAuthorTools>,'invoke'>,
  readPublic:(id:string)=>Promise<{id:string;version:number}|null>,
){
  const before=await tools.invoke('read_work_state',{work_id:workId});
  if(before.status==='error')return {status:'unavailable' as const};
  let observed;
  try{observed=await readPublic(workId)}
  catch{return {status:'unavailable' as const}}
  if(observed&&observed.id!==workId)return {status:'unavailable' as const};

  const after=await tools.invoke('read_work_state',{work_id:workId});
  if(after.status==='error')return {status:'unavailable' as const};
  const state=after.data;
  const compared=['state_revision','display_version','author_hidden','work_limited','display_limited'];
  if(compared.some(key=>before.data[key]!==state[key]))return {status:'changed' as const};
  if(!observed){
    const blocker=state.author_hidden===true?'author_hidden':
      state.work_limited===true?'work_limited':state.display_limited===true?'display_limited':undefined;
    return {status:'not_visible' as const,...(blocker?{blocker}:{})};
  }
  if(observed.version!==state.display_version||state.author_hidden||state.work_limited||state.display_limited){
    return {status:'inconsistent' as const};
  }
  return {status:'visible' as const,displayedVersion:observed.version};
}
