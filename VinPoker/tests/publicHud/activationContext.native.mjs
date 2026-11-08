// Negative execution proof only; positive activation/cron/Vault requires its
// separately owned real-stack fixture and must not be inferred from this file.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {sql} from './nativeDb.mjs';
import {buildActivationSql} from '../../scripts/ops/tracker-hud-activation-20261107.mjs';
assert.equal(process.env.PUBLIC_HUD_LOCAL_DATABASE,'vinpoker_hud_test_current_undo_20261107a');
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port();"),'vinpoker_hud_test_current_undo_20261107a|127.0.0.1|55441');
assert.equal(sql("SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();"),'vinpoker-owned-current-undo-20261107a');
const output=process.env.HUD_ACTIVATION_CONTEXT_REPORT;
assert.match(output??'',/^D:\/Quy-trinh-hud-scale-evidence\/activation-context-[a-z0-9-]+\.json$/);assert.equal(existsSync(output),false);
const state=()=>sql("SELECT jsonb_build_object('hands',(SELECT count(*) FROM public.tournament_hands),'actions',(SELECT count(*) FROM public.hand_actions),'roleConfig',(SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY setdatabase,setrole)::text,'[]')) FROM pg_db_role_setting r));");
const before=state(),phases=['configure-url','start-workers','enable-reads'];
for(const phase of phases)assert.throws(()=>sql(buildActivationSql(phase,'a'.repeat(40)),{captureFailure:true}),error=>String(error.stderr).includes('activation_context_not_approved'));
// Evaluate the reviewed predicate against real PostgreSQL VALUES rows. This is
// a database-target drift test, not a fake installation of cron.
const source=readFileSync(new URL('../../scripts/ops/tracker-hud-activation-20261107.mjs',import.meta.url),'utf8');
const predicate=JSON.parse(source.match(/const spectatorJob=("[^\n]+");/)[1]);
const quote=s=>"'"+s.replaceAll("'","''")+"'";
const database=sql('SELECT current_database();');
for(const [target,expected] of [[database,'1'],['different_database','0']]){
 const row=['public-spectator-v2-dispatch','postgres',target,'1 second','SELECT public.dispatch_public_spectator_projection_v2()'].map(quote).join(',');
 assert.equal(sql(`WITH job(jobname,username,database,schedule,command,active) AS (VALUES(${row},false)) SELECT count(*) FROM job WHERE ${predicate} AND NOT active;`),expected);
}
assert.equal(state(),before);
writeFileSync(output,JSON.stringify({kind:'NATIVE_ACTIVATION_CONTEXT_REJECTION_NO_MUTATION',phases,cronDatabaseTargetCases:2,passed:true,productionChanged:false,limits:'Wrong owned database/context rejection before ledger/config mutation,plus predicate VALUES cases. Not positive activation,actual cron/Vault,full33 receipt or hosted readiness proof.'},null,2)+'\n');
console.log('ACTIVATION_THREE_PHASE_CONTEXT_REJECTION_PASS');
