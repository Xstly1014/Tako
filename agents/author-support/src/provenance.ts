import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {sha256} from './budget.ts';

const agent='agents/author-support/';
export const requiredSources=['mobile/package.json','mobile/src/api/contract.d.ts','mobile/src/api/reader.ts','mobile/src/api/client.ts','mobile/src/api/publications.ts','mobile/src/api/author-works.ts','mobile/src/auth/session.ts','mobile/src/author-works/catalog.ts','mobile/src/publication/submissions.ts','mobile/src/publication/flow.ts','mobile/src/drafts/model.ts','mobile/src/drafts/access.ts',agent+'package.json',agent+'package-lock.json',agent+'tsconfig.json'];
export type SourceBundle={version:1;git_head:string;dirty:boolean;node:string;files:Record<string,{sha256:string;content:string}>;bundle_sha256:string};
export function allowedSource(file:string){
  return requiredSources.includes(file)||new RegExp('^'+agent+'(?:src|scripts|tests)/[A-Za-z0-9_./-]+\\.(?:ts|md)$').test(file)&&!file.split('/').includes('..');
}
function walk(directory:string):string[]{return readdirSync(directory,{withFileTypes:true}).flatMap(x=>{if(x.isSymbolicLink())throw Error('source_symlink_rejected');return x.isDirectory()?walk(directory+'/'+x.name):[directory+'/'+x.name]});}
export function captureSources(directory:string){
  const names=[...requiredSources,...['src','scripts','tests'].flatMap(x=>walk(agent+x))].filter(allowedSource).sort();
  const files=Object.fromEntries(names.map(file=>{const content=readFileSync(file,'utf8');return [file,{sha256:sha256(content),content}]}));
  const result:SourceBundle={version:1,git_head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty:!!execFileSync('git',['status','--porcelain','--',...names],{encoding:'utf8'}).trim(),node:process.versions.node,files,bundle_sha256:sha256(JSON.stringify(files))};
  writeFileSync(path.join(directory,'sources.json'),JSON.stringify(result),{flag:'wx',mode:0o600});
  return {file:'sources.json',sha256:result.bundle_sha256,git_head:result.git_head,dirty:result.dirty,node:result.node,files:names.length};
}
export function verifySources(value:unknown):SourceBundle{
  const bundle=value as SourceBundle;
  if(bundle?.version!==1||!bundle.files||typeof bundle.files!=='object'||Object.keys(bundle.files).length>200||!/^24\.\d+\.\d+$/.test(bundle.node))throw Error('source_bundle_invalid');
  for(const [file,item] of Object.entries(bundle.files))if(!allowedSource(file)||typeof item.content!=='string'||item.content.length>2_000_000||sha256(item.content)!==item.sha256)throw Error('source_file_invalid');
  for(const file of requiredSources)if(!bundle.files[file])throw Error('source_bundle_incomplete');
  if(sha256(JSON.stringify(bundle.files))!==bundle.bundle_sha256)throw Error('source_bundle_changed');
  return bundle;
}
