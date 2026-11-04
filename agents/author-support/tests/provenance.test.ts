import test from 'node:test';
import assert from 'node:assert/strict';
import {allowedSource,verifySources,requiredSources} from '../src/provenance.ts';
import {sha256} from '../src/budget.ts';
test('source bundle rejects credentials, traversal and changed/incomplete sources',()=>{
  for(const file of ['.runtime/author-agent/.env','cv.tex','/tmp/code.ts','agents/author-support/src/../../.env','agents/author-support/src/a\\evil.ts','agents/author-support/node_modules/x.ts'])assert.equal(allowedSource(file),false,file);
  assert.equal(allowedSource('agents/author-support/src/agent.ts'),true);
  assert.equal(allowedSource('mobile/src/api/contract.d.ts'),true);
  assert.throws(()=>verifySources({version:1,node:'24.19.0',files:{'../outside.ts':{content:'x',sha256:'wrong'}},bundle_sha256:'x'}),/source_file_invalid/);
  assert.throws(()=>verifySources({version:1,node:'24.19.0',files:{},bundle_sha256:'x'}),/incomplete/);
  const files=Object.fromEntries(requiredSources.map(file=>[file,{content:'synthetic source',sha256:sha256('synthetic source')}]));
  const bundle={version:1 as const,node:'24.19.0',git_head:'synthetic',dirty:true,files,bundle_sha256:sha256(JSON.stringify(files))};
  assert.equal(verifySources(bundle).bundle_sha256,bundle.bundle_sha256);
  files[requiredSources[0]].content='changed source';
  assert.throws(()=>verifySources(bundle),/source_file_invalid/);
});
