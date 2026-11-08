// Real late-grant drift: second-function rejection must undo first replacement.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {sql} from '../publicHud/nativeDb.mjs';
const db='vinpoker_hud_test_showdown_20261107c';
assert.equal(process.env.PUBLIC_HUD_LOCAL_DATABASE,db);
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port();"),db+'|127.0.0.1|55441');
assert.equal(sql("SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();"),'vinpoker-owned-showdown-20261107c');
assert.equal(sql("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron'));"),'f');
const output=process.env.NATIVE_CLOSE_ACL_REPORT;
assert.match(output??'',/^D:\/Quy-trinh-hud-scale-evidence\/close-paid-prize-acl-[a-z0-9-]+\.json$/);assert.equal(existsSync(output),false);
const forward=readFileSync('supabase/migrations/20261107093000_tournament_close_paid_prize_source_v1.sql','utf8');
const rollback=readFileSync('scripts/ops/tournament-close-paid-prize-20261107-rollback.sql','utf8');
const state=()=>sql("SELECT md5(jsonb_agg(jsonb_build_object('definition',pg_get_functiondef(oid),'acl',proacl) ORDER BY proname)::text) FROM pg_proc WHERE oid IN('public.close_tournament(uuid,text)'::regprocedure,'public.get_tournament_close_readiness_v1(uuid)'::regprocedure);");
const reports=()=>sql("SELECT md5(jsonb_agg(to_jsonb(r) ORDER BY r.id)::text) FROM public.tournament_close_report r WHERE tournament_id='de780003-0000-4000-8000-000000000001';");
const history=reports();
sql(rollback,{captureFailure:true});const before=state();
const body=forward.replace(/^([\s\S]*?)BEGIN;/,(_all,prefix)=>prefix).replace(/COMMIT;\s*$/,'');
let denials=0;
for(const grant of [
 "GRANT EXECUTE ON FUNCTION public.get_tournament_close_readiness_v1(uuid) TO anon;",
 "GRANT EXECUTE ON FUNCTION public.close_tournament(uuid,text) TO authenticated WITH GRANT OPTION;"
]){
 let denied=false;
 try{sql('BEGIN;'+grant+body+'ROLLBACK;',{captureFailure:true});}
 catch(error){denied=String(error.stderr??'').includes('close_paid_prize_exact_metadata_drift');}
 assert.equal(denied,true);assert.equal(state(),before);assert.equal(reports(),history);denials++;
}
sql(forward,{captureFailure:true});assert.equal(reports(),history);
const report={passed:true,productionChanged:false,lateAclDriftDenied:denials,secondObjectFailureRolledBackFirstObject:true,grantOptionDenied:true,positiveMigrationApplyPassed:true,exactRollbackPassed:true,immutableReportsUnchanged:true,limits:'Native migration transaction, not full34 ledger/production apply or successful activation.'};
writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
