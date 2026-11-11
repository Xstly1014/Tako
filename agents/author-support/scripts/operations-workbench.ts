import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {ReviewMonitor} from '../src/review-monitor.ts';
import {startWorkbench} from '../src/operations-workbench.ts';

const directory=path.resolve('.runtime/author-agent');
mkdirSync(directory,{recursive:true});
const monitor=new ReviewMonitor(path.join(directory,'review-backlog.sqlite'));
try{
  const workbench=await startWorkbench(monitor);
  console.log(`Tako 本地运营值班：${workbench.origin}`);
  let closing=false;
  const shutdown=async()=>{
    if(closing)return;
    closing=true;
    try{await workbench.close()}finally{monitor.close()}
  };
  process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
}catch{
  monitor.close();console.error('workbench_start_failed');process.exitCode=1;
}
