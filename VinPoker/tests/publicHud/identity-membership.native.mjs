import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sql,jsonSql} from './nativeDb.mjs';
const signature='tracker_analytics_v1.public_context(uuid,uuid)';
const migration=readFileSync('supabase/migrations/20261104002900_public_hud_identity_membership_lookup.sql','utf8');
const recovery=readFileSync('tests/publicHud/identity-membership.forward-rollback.sql','utf8');
const body=s=>s.replace(/^BEGIN;\r?\n/m,'').replace(/COMMIT;\s*$/,'');
const hash=()=>sql(`SELECT md5(replace(pg_get_functiondef('${signature}'::regprocedure),chr(13),''));`);
if(hash()==='d72e037647d90f1470ae73c47ac4f8ad')sql(recovery);
assert.equal(hash(),'7c9682eba221897c6f956899ce72fdc1');
const metadata=()=>jsonSql(`SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid='${signature}'::regprocedure;`);
const before=metadata();
const scopes=jsonSql(`SELECT jsonb_agg(s) FROM (SELECT DISTINCT player_id,tournament_id FROM tracker_analytics_v1.hand_contributions) s;`);
const withoutRanking="UPDATE spectator_projection_v2.publications SET payload=jsonb_set(payload,'{items}','[]') WHERE component='ranking';";
const cases=[];
for(const scope of scopes){
 const context=`tracker_analytics_v1.public_context('${scope.tournament_id}','${scope.player_id}')`;
 assert.equal(sql(`BEGIN;${withoutRanking}CREATE TEMP TABLE expected_context AS SELECT ${context} identity;${body(migration)}SELECT identity IS NOT DISTINCT FROM ${context} FROM expected_context;ROLLBACK;`),'t');
}
cases.push('all-source-scope-json-parity');
const fake='f3333333-0000-4000-8000-000000000001',tour='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
const hand=sql(`SELECT id FROM public.tournament_hands WHERE tournament_id='${tour}' ORDER BY id DESC LIMIT 1;`);
for(const [name,change,requested] of [
 ['sparse-last-hand-valid',`INSERT INTO public.hand_players(hand_id,tournament_id,player_id,seat_number,starting_stack,player_name) VALUES('${hand}','${tour}','${fake}',9,1000,'SPARSE TEST');`,tour],
 ['wrong-source-tour',`INSERT INTO public.hand_players(hand_id,tournament_id,player_id,seat_number,starting_stack,player_name) VALUES('${hand}','${other}','${fake}',9,1000,'WRONG TOUR TEST');`,other],
 ['missing-participant','',tour],
]){
 const context=`tracker_analytics_v1.public_context('${requested}','${fake}')`;
 const result=jsonSql(`BEGIN;${withoutRanking}${change}CREATE TEMP TABLE expected_context AS SELECT ${context} identity;${body(migration)}SELECT jsonb_build_object('expected',identity,'actual',${context}) FROM expected_context;ROLLBACK;`);
 assert.deepEqual(result.actual,result.expected,name);
 if(name==='sparse-last-hand-valid')assert.equal(result.actual.name,'Người chơi');else assert.equal(result.actual,null);
 cases.push(name);
}
sql(migration);assert.deepEqual(metadata(),before);assert.equal(hash(),'d72e037647d90f1470ae73c47ac4f8ad');
assert.throws(()=>sql(migration),/preimage differs/);
assert.equal(sql(`BEGIN;${body(recovery)}SELECT md5(replace(pg_get_functiondef('${signature}'::regprocedure),chr(13),''));ROLLBACK;`),'7c9682eba221897c6f956899ce72fdc1');
assert.deepEqual(metadata(),before);
console.log(JSON.stringify({kind:'NATIVE_HUD_MEMBERSHIP_PLAN_PARITY',passed:true,scopes:scopes.length,cases,metadataUnchanged:true,recoveryExact:true}));
