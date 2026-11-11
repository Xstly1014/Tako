import type {Transport} from '../../../mobile/src/auth/session.ts';

/** Local-test credentials stay in the server process, never in a browser or URL. */
export async function withOperator<T>(action:(read:Transport)=>Promise<T>,signal:AbortSignal):Promise<T>{
  const localApi='http://127.0.0.1:3300/api';
  if(process.env.EXPO_PUBLIC_API_URL&&process.env.EXPO_PUBLIC_API_URL!==localApi)throw Error('local_api_required');
  process.env.EXPO_PUBLIC_API_URL=localApi;
  const password=process.env.TEST_OPERATOR_PASSWORD;
  if(!password)throw Error('test_operator_required');
  const {Session}=await import('../../../mobile/src/auth/session.ts');
  const {request}=await import('../../../mobile/src/api/client.ts');
  let token:string|null=null;
  const session=new Session({get:async()=>token,set:async value=>{token=value},remove:async()=>{token=null}},request);
  try{
    await session.signIn('login','operator@tako-test.invalid',password);
    if(signal.aborted)throw Error('job_cancelled');
    return await action((path,options)=>session.authorized(path,{...options,signal}));
  }finally{
    // Logout has its own request timeout and must still run after a job was cancelled.
    if(session.snapshot().phase==='ready'){
      try{await session.logout()}catch{throw Error('operator_logout_failed')}
    }
  }
}
