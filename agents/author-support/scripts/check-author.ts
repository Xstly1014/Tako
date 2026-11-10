import {parseArgs} from 'node:util';

const localApi='http://127.0.0.1:3300/api';

async function main(){
  const {values,tokens}=parseArgs({
    options:{work:{type:'string'},preview:{type:'string'},case:{type:'string'}},
    tokens:true,
  });
  const targets=tokens.filter(token=>token.kind==='option').map(token=>token.name);
  if(new Set(targets).size!==targets.length){
    throw Error('invalid_target');
  }
  const {work:workId,preview:previewId,case:caseText}=values;
  const caseId=caseText===undefined?undefined:Number(caseText);
  if(caseText!==undefined){
    if(!/^[1-9]\d*$/.test(caseText)||!Number.isSafeInteger(caseId)||workId!==undefined||previewId!==undefined){
      throw Error('invalid_target');
    }
  }else if(!workId&&!previewId){
    throw Error('invalid_target');
  }
  if(process.env.EXPO_PUBLIC_API_URL&&process.env.EXPO_PUBLIC_API_URL!==localApi)throw Error('local_api_required');
  process.env.EXPO_PUBLIC_API_URL=localApi;
  const {UUID}=await import('../../../mobile/src/api/reader.ts');
  if([workId,previewId].some(id=>id!==undefined&&!UUID.test(id)))throw Error('invalid_target');
  const password=process.env.TEST_AUTHOR_PASSWORD;
  if(!password)throw Error('test_author_required');

  const {Session}=await import('../../../mobile/src/auth/session.ts');
  const {request}=await import('../../../mobile/src/api/client.ts');
  const {checkPublication,checkModerationVisibility}=await import('../src/session-diagnostic.ts');
  let token:string|null=null;
  const session=new Session({
    get:async()=>token,set:async value=>{token=value},remove:async()=>{token=null},
  },request);
  await session.signIn('login','author@tako-test.invalid',password);
  try{
    if(caseId!==undefined){
      const result=await checkModerationVisibility(session,caseId);
      console.log(JSON.stringify(result??{status:'session_changed'},null,2));
      if(result?.status!=='checked'||result.visibility.status==='unavailable')process.exitCode=1;
      return;
    }
    const diagnosis=await checkPublication(session,{workId,previewId});
    const visibility=await diagnosis?.checkReaderVisibility()??null;
    const delivery=diagnosis?.getDelivery();
    if(!delivery){
      console.log(JSON.stringify({status:'session_changed'}));
      process.exitCode=1;
      return;
    }
    console.log(JSON.stringify({
      status:delivery.verification,publication:delivery.verdict.publication,access:delivery.verdict.access,
      explanation:delivery.verdict.explanation,nextStep:delivery.next_step??null,visibility,
    },null,2));
    if(delivery.verification==='unable_to_check'||visibility?.status==='unavailable')process.exitCode=1;
  }finally{
    if(session.snapshot().phase==='ready')await session.logout();
  }
}

main().catch(error=>{
  const known=['invalid_target','local_api_required','test_author_required'];
  const code=error instanceof Error&&known.includes(error.message)?error.message:
    error instanceof TypeError&&'code' in error&&String(error.code).startsWith('ERR_PARSE_ARGS')?'invalid_target':'author_check_failed';
  console.error(code);
  process.exitCode=1;
});
