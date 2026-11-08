import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sql,jsonSql} from './nativeDb.mjs';
const migration=readFileSync('supabase/migrations/20261104003100_public_hud_enqueue_write_coalescing.sql','utf8');
const recovery=readFileSync('tests/publicHud/enqueue-writes.forward-rollback.sql','utf8');
const hashes=()=>jsonSql("SELECT jsonb_object_agg(proname,md5(replace(pg_get_functiondef(p.oid),chr(13),''))) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='tracker_analytics_v1' AND proname IN('enqueue','outcome_changed');");
const metadata=()=>jsonSql("SELECT jsonb_object_agg(proname,to_jsonb(p)-'prosrc') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='tracker_analytics_v1' AND proname IN('enqueue','outcome_changed');");
const after={enqueue:'0650893a716858e40a966b9c9dd2a460',outcome_changed:'ee4e45ea372523c4aef8371aa16cf430'};
const before={enqueue:'254e7c518947be9f67a816c9b60850ee',outcome_changed:'fbb5f17d0ee565045237227e59d4bd94'};
assert.deepEqual(hashes(),after);const originalMetadata=metadata();
function denied(query,message){let stderr='';try{sql(query,{captureFailure:true});}catch(error){stderr=String(error.stderr);}assert.ok(stderr.includes(message),'Expected fixed catalog guard rejection');}
denied(migration,'HUD enqueue write preimage differs');assert.deepEqual(hashes(),after);
sql(recovery);assert.deepEqual(hashes(),before);assert.deepEqual(metadata(),originalMetadata);
denied(recovery,'HUD enqueue write recovery differs');assert.deepEqual(hashes(),before);
sql(migration);assert.deepEqual(hashes(),after);assert.deepEqual(metadata(),originalMetadata);
console.log(JSON.stringify({kind:'NATIVE_ENQUEUE_RECOVERY_CATALOG_AND_ACL',duplicateApplyDenied:true,duplicateRecoveryDenied:true,originalDefinitionsRestored:true,reapplied:true,metadataIncludingOwnerAclUnchanged:true}));
