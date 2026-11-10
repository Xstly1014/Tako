const localApi='http://127.0.0.1:3300/api';

async function main(){
  if(process.env.EXPO_PUBLIC_API_URL&&process.env.EXPO_PUBLIC_API_URL!==localApi)throw Error('local_api_required');
  process.env.EXPO_PUBLIC_API_URL=localApi;
  const password=process.env.TEST_OPERATOR_PASSWORD;
  if(!password)throw Error('test_operator_required');

  const {Session}=await import('../../../mobile/src/auth/session.ts');
  const {request}=await import('../../../mobile/src/api/client.ts');
  const {scanReviewBacklog}=await import('../src/review-backlog.ts');
  let token:string|null=null;
  const session=new Session({
    get:async()=>token,set:async value=>{token=value},remove:async()=>{token=null},
  },request);
  await session.signIn('login','operator@tako-test.invalid',password);
  const report=await scanReviewBacklog((path,options)=>session.authorized(path,options)).finally(async()=>{
    if(session.snapshot().phase==='ready')await session.logout();
  });
  console.log(JSON.stringify(report,null,2));
  if(report.status==='incomplete')process.exitCode=1;
}

main().catch(error=>{
  const code=error instanceof Error&&['local_api_required','test_operator_required'].includes(error.message)
    ?error.message:'operator_session_failed';
  console.error(code);
  process.exitCode=1;
});
