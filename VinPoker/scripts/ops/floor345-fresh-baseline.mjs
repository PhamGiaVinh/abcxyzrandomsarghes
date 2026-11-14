import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateArtifactDirectory} from '../deploy/validate-live-public-schema-artifact.mjs';

export const policy=JSON.parse(readFileSync(new URL('./floor345-fresh-baseline.json',import.meta.url)));
export function validateCapture(run,artifact){
 const p=policy.capture;
 assert.equal(run.id,p.run);assert.equal(run.workflow_id,p.workflowId);
 assert.equal(run.repository?.full_name,policy.repository);
 assert.equal(run.actor?.login,p.actor);assert.equal(run.triggering_actor?.login,p.actor);
 assert.equal(run.head_sha,p.sha);assert.equal(run.head_branch,p.branch);
 assert.equal(run.event,p.event);assert.equal(run.status,'completed');assert.equal(run.conclusion,'success');
 assert.equal(artifact.id,p.artifactId);assert.equal(artifact.name,'live-public-schema');
 assert.equal(artifact.digest,p.artifactDigest);assert.equal(artifact.expired,false);
 assert.ok(artifact.size_in_bytes>0);
 return true;
}
export function validateSource(bytes){
 const actual=createHash('sha256').update(bytes.toString('utf8').replace(/\r\n?/g,'\n')).digest('hex');
 assert.equal(actual,policy.migration.sha256,'Only the exact reviewed migration345 is allowed');
 return true;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [runPath,artifactPath,directory,sqlPath]=process.argv.slice(2);
 validateCapture(JSON.parse(readFileSync(runPath)),JSON.parse(readFileSync(artifactPath)));
 assert.equal(validateArtifactDirectory(directory).schemaSha256,policy.capture.schemaSha256);
 validateSource(readFileSync(sqlPath));
 console.log('FLOOR345_FRESH_CAPTURE_PROVENANCE_AND_EXACT_SOURCE_PASS_NOT_PRE03');
}
