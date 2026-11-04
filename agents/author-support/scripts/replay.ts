import {readFileSync} from 'node:fs';
import {cases} from '../src/cases.ts';
import {evaluate,digest} from '../src/evaluate.ts';
import {parseVerdict,type Evidence} from '../src/grade.ts';

try{
  const artifact=JSON.parse(readFileSync(process.argv[2],'utf8'));
  const task=cases.find(x=>x.id===artifact.case_id);
  if(!task||artifact.synthetic_only!==true||artifact.status!=='completed'||artifact.case_sha256!==digest(task))throw Error('replay_case_mismatch');
  if(!Array.isArray(artifact.evidence)||artifact.evidence.length>8)throw Error('replay_evidence_invalid');
  const verdict=parseVerdict(JSON.stringify(artifact.verdict));
  if(artifact.review_binding!==digest({case:task,verdict,evidence:artifact.evidence,version:artifact.version}))throw Error('replay_artifact_changed');
  // Re-evaluate evidence, never trust the old grade or a handwritten pass flag.
  const result=evaluate(task,verdict,artifact.evidence as Evidence[]);
  console.log(JSON.stringify({case_id:task.id,...result,recorded_grader:artifact.version.grader_version},null,2));
  if(!result.automatic_passed)process.exitCode=1;
}catch{console.error('replay_invalid_or_incompatible');process.exitCode=1}
