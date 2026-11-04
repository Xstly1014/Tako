// Actual novel reading screens with DOM adapters and mocked API; no native-device claim.
const {spawnSync}=require("node:child_process"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const root=path.resolve(__dirname,".."),scratch=fs.mkdtempSync(path.join(os.tmpdir(),"tako-novel-modules-"));
try{
 const r=spawnSync("docker",["run","--rm","--network","tako-local-test_default","-v",root+":/materials","-v","writing-community_frontend_modules:/tools/node_modules:ro","-v","tako-mobile-node-modules:/app/node_modules:ro","-v",scratch+":/materials/mobile/node_modules:ro","-w","/tools","mcr.microsoft.com/playwright:v1.56.1-noble","node","/materials/scripts/mobile-novel-publication-live/run.cjs"],{encoding:"utf8",timeout:180000});
 if(r.error||r.status!==0){const stage=String(r.stderr).match(/stage=([a-z-]+) line=(\d+)/);console.error("FAIL novel publication workflow"+(stage?" stage="+stage[1]+" line="+stage[2]:"; check locked tools and Docker"));process.exitCode=1}
 else console.log("PASS novel publication workflow (real HTTP/MySQL + DOM/journal adapters; not native-device evidence).");
}finally{fs.rmSync(scratch,{recursive:true,force:true})}
