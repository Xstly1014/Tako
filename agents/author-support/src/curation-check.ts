import {ApiError} from '../../../mobile/src/api/client.ts';
import {ReaderError,UUID,community,isCard,work,type WorkCard} from '../../../mobile/src/api/reader.ts';
import type {Transport} from '../../../mobile/src/auth/session.ts';
import type {operations} from '../../../mobile/src/api/contract.d.ts';

type Curation=operations['getCurationSlots']['responses'][200]['content']['application/json'];
type PublicReads={
  featured:()=>Promise<WorkCard[]>;
  work:(id:string)=>Promise<{id:string;version:number}|null>;
};
const anonymous:PublicReads={
  featured:async()=>(await community('','')).featured,
  work:async id=>{
    try{return await work(id)}
    catch(error){
      if(error instanceof ReaderError&&error.kind==='unavailable')return null;
      throw error;
    }
  },
};
const cardKey=(card:{id:string;version:number})=>card.id+':'+card.version;

function checkedState(value:Curation){
  if(!value||!Number.isSafeInteger(value.revision)||value.revision<1||!Array.isArray(value.slots)||
    value.slots.length!==6)throw new ApiError('contract');
  const positions=new Set<number>(),works=new Set<string>();
  for(const slot of value.slots){
    if(!Number.isInteger(slot.slot)||slot.slot<1||slot.slot>6||positions.has(slot.slot)||
      !(slot.work_id===null||(typeof slot.work_id==='string'&&UUID.test(slot.work_id)))||
      (slot.work_id!==null&&works.has(slot.work_id))||
      (slot.work!==null&&(!isCard(slot.work)||slot.work.id!==slot.work_id))||
      (slot.work_id===null&&slot.work!==null))throw new ApiError('contract');
    positions.add(slot.slot);
    if(slot.work_id)works.add(slot.work_id);
  }
  return {...value,slots:[...value.slots].sort((a,b)=>a.slot-b.slot)};
}

function featuredKey(cards:WorkCard[]){
  if(!Array.isArray(cards)||cards.length>6||!cards.every(isCard)||new Set(cards.map(card=>card.id)).size!==cards.length){
    throw new ApiError('contract');
  }
  return JSON.stringify(cards.map(cardKey));
}
const stateKey=(state:Curation)=>JSON.stringify({
  revision:state.revision,slots:state.slots.map(slot=>[slot.slot,slot.work_id,slot.work?cardKey(slot.work):null]),
});

type SlotStatus='empty'|'selected_readable'|'selection_stale'|'excluded_unreadable'|'observed_mismatch'|'unavailable';
type SlotResult={slot:number;workId:string|null;status:SlotStatus;displayedVersion?:number;detailPath?:string};

export async function checkCuration(read:Transport,publicReads:PublicReads=anonymous){
  const startedAt=new Date().toISOString(),slots:SlotResult[]=[];
  try{
    const before=checkedState(await read<Curation>('/ops/curation',{method:'GET'}));
    const featured=await publicReads.featured();
    const firstPublicKey=featuredKey(featured);
    const expected=before.slots.flatMap(slot=>slot.work?[cardKey(slot.work)]:[]);
    const listingMatches=JSON.stringify(expected)===firstPublicKey;
    for(const slot of before.slots){
      if(!slot.work_id){
        slots.push({slot:slot.slot,workId:null,status:'empty'});
        continue;
      }
      let status:SlotStatus,displayedVersion:number|undefined;
      try{
        const observed=await publicReads.work(slot.work_id);
        if(observed&&(observed.id!==slot.work_id||!Number.isSafeInteger(observed.version)||observed.version<1)){
          throw new ApiError('contract');
        }
        displayedVersion=observed?.version;
        if(slot.work){
          status=observed?.version===slot.work.version&&listingMatches?'selected_readable':'observed_mismatch';
        }else{
          status=featured.some(card=>card.id===slot.work_id)?'observed_mismatch':
            observed?'selection_stale':'excluded_unreadable';
        }
      }catch{status='unavailable'}
      slots.push({slot:slot.slot,workId:slot.work_id,status,...(displayedVersion?{displayedVersion}:{}),
        detailPath:'/ops/curation/'+slot.work_id});
    }
    const afterPublicKey=featuredKey(await publicReads.featured());
    const after=checkedState(await read<Curation>('/ops/curation',{method:'GET'}));
    if(stateKey(before)!==stateKey(after)||firstPublicKey!==afterPublicKey){
      return {status:'changed' as const,startedAt,slots};
    }
    const unknown=slots.filter(slot=>slot.status==='unavailable').length;
    const mismatch=slots.filter(slot=>slot.status==='observed_mismatch').length;
    const actions=slots.flatMap(slot=>{
      switch(slot.status){
        case 'selection_stale':
          return [{slot:slot.slot,action:'review_reselection',workbenchPath:'/ops/curation'}];
        case 'excluded_unreadable':
          return [{slot:slot.slot,action:'review_visibility',workbenchPath:'/ops/curation'}];
        case 'observed_mismatch':
        case 'unavailable':
          return [{slot:slot.slot,action:'recheck_observation',workbenchPath:'/ops/curation'}];
        default:
          return [];
      }
    });
    return {
      status:unknown?'incomplete' as const:'complete' as const,startedAt,revision:before.revision,
      listingMatches,needsRecheck:!listingMatches||mismatch>0,slots,actions,
      featured:featured.map(card=>({workId:card.id,version:card.version})),
    };
  }catch(error){
    return {status:'incomplete' as const,startedAt,slots,error:'request_failed',
      httpStatus:error instanceof ApiError?error.status:null};
  }
}
