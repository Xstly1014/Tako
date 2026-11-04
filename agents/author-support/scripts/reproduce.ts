import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,symlinkSync,unlinkSync,rmSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {verifySources} from '../src/provenance.ts';
import {sha256} from '../src/budget.ts';

let temporary='',link='',linked=false;
try{
  const source=path.resolve(process.argv[2]),allowed=path.resolve('.runtime/author-agent');
  const relative=path.relative(allowed,source);
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw Error('local_source_required');
  const bundle=verifySources(JSON.parse(readFileSync(path.join(source,'sources.json'),'utf8')));
  if(bundle.node!==process.versions.node)throw Error('matching_node_required');
  const agent='agents/author-support/';
  if(bundle.files[agent+'package-lock.json'].sha256!==sha256(readFileSync(agent+'package-lock.json','utf8')))throw Error('matching_dependencies_required');
  const pkg=JSON.parse(bundle.files[agent+'package.json'].content);
  for(const [name,version] of Object.entries({...pkg.dependencies,...pkg.devDependencies})){
    if(JSON.parse(readFileSync(agent+'node_modules/'+name+'/package.json','utf8')).version!==version)throw Error('dependency_version_mismatch');
  }
  temporary=mkdtempSync(path.join(tmpdir(),'tako-agent-reproduce-'));
  for(const [file,item] of Object.entries(bundle.files)){
    const target=path.resolve(temporary,file),rel=path.relative(temporary,target);
    if(rel.startsWith('..')||path.isAbsolute(rel))throw Error('extraction_escape');
    mkdirSync(path.dirname(target),{recursive:true});writeFileSync(target,item.content,{flag:'wx'});
  }
  link=path.join(temporary,agent,'node_modules');
  symlinkSync(path.resolve(agent+'node_modules'),link,process.platform==='win32'?'junction':'dir');
  linked=true;
  const preload=path.join(temporary,'network-disabled.mjs');
  writeFileSync(preload,`import net from 'node:net';import http from 'node:http';import https from 'node:https';import {syncBuiltinESMExports} from 'node:module';const deny=()=>{throw Error('network_disabled_reproduction')};globalThis.fetch=deny;net.Socket.prototype.connect=deny;http.request=deny;http.get=deny;https.request=deny;https.get=deny;syncBuiltinESMExports();`);
  // Deliberate minimal environment: no API key, proxy credentials or .env.
  const env:NodeJS.ProcessEnv={};
  for(const name of ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','TMPDIR'])if(process.env[name])env[name]=process.env[name];
  env.NODE_OPTIONS='--import='+JSON.stringify(pathToFileURL(preload).href);
  const tests=Object.keys(bundle.files).filter(x=>x.startsWith(agent+'tests/')&&x.endsWith('.test.ts'));
  const check=spawnSync(process.execPath,['--test','--test-reporter=tap',...tests],{cwd:temporary,env,encoding:'utf8',timeout:60000,maxBuffer:3_000_000});
  const types=spawnSync(process.execPath,[path.resolve(agent+'node_modules/typescript/bin/tsc'),'--noEmit'],{cwd:path.join(temporary,agent),env,encoding:'utf8',timeout:60000,maxBuffer:3_000_000});
  const run=randomUUID(),out=path.resolve('.runtime/author-agent/reproductions',run);mkdirSync(out,{recursive:true});
  writeFileSync(path.join(out,'tests.log'),(check.stdout??'')+(check.stderr??''));
  writeFileSync(path.join(out,'types.log'),(types.stdout??'')+(types.stderr??''));
  const result={run_id:run,source_sha256:bundle.bundle_sha256,source_git_head:bundle.git_head,source_dirty:bundle.dirty,node:process.versions.node,dependencies:'reused_local_exact_versions_and_matching_lock_not_vendored',environment:'temporary_source_tree_without_keys_with_fetch_http_socket_blocked_not_os_sandbox',tests:Number(check.stdout?.match(/^# tests (\d+)$/m)?.[1]??0),failures:Number(check.stdout?.match(/^# fail (\d+)$/m)?.[1]??0),test_exit:check.status,type_exit:types.status,passed:check.status===0&&types.status===0};
  writeFileSync(path.join(out,'report.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));if(!result.passed)process.exitCode=1;
}catch{console.error('source_reproduction_rejected_or_failed');process.exitCode=1}
finally{
  if(linked)unlinkSync(link); // Unlink the dependency junction before any recursive removal.
  if(temporary){const rel=path.relative(path.resolve(tmpdir()),path.resolve(temporary));if(!rel||rel.startsWith('..')||path.isAbsolute(rel)||!path.basename(temporary).startsWith('tako-agent-reproduce-'))throw Error('cleanup_target_invalid');rmSync(temporary,{recursive:true,force:true});}
}
