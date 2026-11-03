// Independent business-owned DOM fixture. Reuses cached locked dependencies.
const {spawnSync}=require("node:child_process"),path=require("node:path"),fs=require("node:fs");
const root=path.resolve(__dirname,".."),empty=path.join(root,".runtime/mobile/qa/empty-host-modules");fs.mkdirSync(empty,{recursive:true});
const r=spawnSync("docker",["run","--rm","--network","none","-v",root+":/materials","-v","writing-community_frontend_modules:/tools/node_modules:ro","-v","tako-mobile-node-modules:/app/node_modules:ro","-v",empty+":/materials/mobile/node_modules:ro","-w","/tools","mcr.microsoft.com/playwright:v1.56.1-noble","node","/materials/scripts/mobile-chapters-ui/run.cjs"],{encoding:"utf8",timeout:180000});
if(r.status===0&&!r.error)console.log("PASS chapters App component fixture (not native evidence).");
else{const stage=String(r.stderr).match(/FAIL chapters fixture stage=([a-z-]+)/)?.[1];console.error("FAIL chapters fixture stage="+(["bundle","book-to-chapter","offline-reopen","recover-as-new","continue-recovered","account-isolation"].includes(stage)?stage:"unavailable"));process.exitCode=1;}
