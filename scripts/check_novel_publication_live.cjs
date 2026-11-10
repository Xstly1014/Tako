// Actual publication/management screens -> real test API, with explicit DOM/journal adapters.
const {spawnSync}=require("node:child_process"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const root=path.resolve(__dirname,".."),scratch=fs.mkdtempSync(path.join(os.tmpdir(),"tako-novel-modules-"));
try{
 const r=spawnSync("docker",["run","--rm","--network","tako-local-test_default","-v",root+":/materials","-v","writing-community_frontend_modules:/tools/node_modules:ro","-v","tako-mobile-node-modules:/app/node_modules:ro","-v",scratch+":/materials/mobile/node_modules:ro","-w","/tools","mcr.microsoft.com/playwright:v1.56.1-noble","node","/materials/scripts/mobile-novel-publication-live/run.cjs"],{encoding:"utf8",timeout:300000});
 if(r.error||r.status!==0){const stage=String(r.stderr).match(/stage=([a-z-]+) line=(\d+)/);console.error("FAIL novel publication workflow"+(stage?" stage="+stage[1]+" line="+stage[2]:"; check locked tools and Docker"));const diagnostic=String(r.stderr).match(/DIAG writes=\d+ query=\d+ confirmed=\d+ error=[A-Za-z]+/);if(diagnostic)console.error(diagnostic[0]);process.exitCode=1}
 else console.log("PASS novel publication workflow (real HTTP/MySQL + DOM/journal adapters; not native-device evidence).");
}finally{const resolved=path.resolve(scratch),temporary=path.resolve(os.tmpdir());if(path.dirname(resolved)!==temporary||!path.basename(resolved).startsWith("tako-novel-modules-"))throw Error("temporary_cleanup_target_invalid");fs.rmSync(resolved,{recursive:true,force:true})}
