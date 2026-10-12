import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';

// Recovery of the already-sanitized, owner-reviewed TEST schema only.
// No credentials, database query, production write, or historical SQL replay here.
const profiles={
  original:{hash:'703aed6b620cd24f34c31d4545b2d7e97e4a488f89fe81dfc1a36b175d259223',
    run:37229283609,sha:'d64df388d42b51cb851e8d23361d4fe568988eb7',directory:'reviewed-pre-release-schema'},
  operations:{hash:'d23cfa75a7381453ba0d6216346f6460c816a3b1525ef5d47984c3a995ddc56a',
    run:37820347781,sha:'0463831bb9f8f142d585fd51c1b0633963b2161f',directory:'reviewed-operations-schema'},
};
const owner=process.env.GITHUB_REPOSITORY_OWNER;
assert.ok(owner && process.env.GITHUB_ACTOR===owner && process.env.GITHUB_TRIGGERING_ACTOR===owner,'owner_context_required');
const profileName=process.env.RECOVERY_PROFILE??'original';
assert.ok(Object.hasOwn(profiles,profileName),'unknown_recovery_profile');
const profile=profiles[profileName];
const expected=profile.hash;
const chunks=Array.from({length:17},(_,i)=>process.env[`BASELINE_${String(i+1).padStart(2,'0')}`]??'');
assert.ok(chunks.every(chunk=>chunk.length>0 && /^[A-Za-z0-9+/=]+$/.test(chunk)),'complete private recovery input required');
const schema=gunzipSync(Buffer.from(chunks.join(''),'base64'),{maxOutputLength:5_000_000});
assert.equal(createHash('sha256').update(schema).digest('hex'),expected,'original baseline bytes must match');
assert.ok(process.env.RUNNER_TEMP && isAbsolute(process.env.RUNNER_TEMP),'absolute_runner_temp_required');
const dir=join(process.env.RUNNER_TEMP,profile.directory);
mkdirSync(dir,{recursive:true});
writeFileSync(join(dir,'live-public-schema.sql'),schema,{mode:0o600});
writeFileSync(join(dir,'live-public-schema.sha256'),`${expected}  live-public-schema.sql\n`,{mode:0o600});
writeFileSync(join(process.env.RUNNER_TEMP,`${profile.directory}.provenance.json`),JSON.stringify({originalCaptureRun:profile.run,originalCaptureSha:profile.sha,schemaSha256:expected,schemaOnly:true,recoveryRun:process.env.GITHUB_RUN_ID})+'\n',{mode:0o600});
const result=spawnSync(process.execPath,['VinPoker/scripts/deploy/validate-live-public-schema-artifact.mjs','--artifact-directory',dir],{encoding:'utf8'});
// Never print the recovered content or inputs, including on failure.
assert.equal(result.status,0,'recovered artifact failed schema-only/secret validation');
console.log('EXACT_REVIEWED_TEST_BASELINE_RECOVERED_AND_VALIDATED');
