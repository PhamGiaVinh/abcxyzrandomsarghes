// Actual projection SQL -> actual server reducer. Owned empty local PG17 only.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {reducePublicSpectatorPayload} from '../../supabase/functions/_shared/publicSpectatorReducer.ts';

const env={...process.env};
for(const key of Object.keys(env))if(key.startsWith('PG'))delete env[key];
const args=['-h','127.0.0.1','-p','56419','-U','postgres','-d','tracker_bba350_full','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const query=sql=>execFileSync(process.env.TRACKER_TEST_PSQL??'psql',args,{env,input:sql,encoding:'utf8',timeout:90000,maxBuffer:4*1024*1024,windowsHide:true});
const identity=JSON.parse(query("SELECT json_build_object('host',host(inet_server_addr()),'port',inet_server_port(),'data',current_setting('data_directory'),'hands',(SELECT count(*) FROM public.tournament_hands));"));
assert.equal(identity.host,'127.0.0.1');assert.equal(identity.port,56419);assert.equal(identity.hands,0);
assert.match(identity.data,/tracker-bba349-pg17-[a-f0-9]+[/\\]data$/);
const preimage=readFileSync(process.env.TRACKER_TEST_PROJECTION_PREIMAGE,'utf8');
assert.match(preimage,/^CREATE OR REPLACE FUNCTION public\.get_public_spectator_projection_source_v2\(/);
const migration=readFileSync('supabase/migrations/20270128000352_tracker_public_mini_pot_layers.sql','utf8');
const body=migration.replace(/^BEGIN;\r?$/m,'').replace(/^COMMIT;\r?$/m,'');
const rollback=readFileSync('tests/publicHud/miniPotLayers.rollback.sql','utf8').replace(/^BEGIN;\r?$/m,'').replace(/^COMMIT;\r?$/m,'');
const fixture=readFileSync('tests/trackerEngine/bbAnteSettlement.local.pg17.sql','utf8');
assert.match(fixture,/ROLLBACK;\s*$/);
const sql=fixture.replace('BEGIN;',()=>`BEGIN;\n${preimage};\n${body}`).replace(/ROLLBACK;\s*$/,()=>`
SET LOCAL request.jwt.claims='{"role":"service_role"}';
-- Older owned schema fixture lacks the compact-generation queue. Model only
-- its lookup seam; this does not qualify the full hosted generation publisher.
CREATE TABLE spectator_projection_v2.deferred_generations_v1(tournament_id uuid,component text);
CREATE TEMP TABLE mini_projection_cases(payload jsonb);
DO $check$ DECLARE item record; fence uuid; snapshot jsonb; shown jsonb; BEGIN
 FOR item IN SELECT h.tournament_id,h.id,c.pot FROM bba_finished_cases c JOIN public.tournament_hands h ON h.id=c.hand_id LOOP
  fence:=gen_random_uuid();
  INSERT INTO spectator_projection_v2.work_groups(tournament_id,component,group_key,fencing_token,claimed_until)
   VALUES(item.tournament_id,'tables','event',fence,clock_timestamp()+interval '5 minutes')
   ON CONFLICT(tournament_id,component,group_key) DO UPDATE SET fencing_token=excluded.fencing_token,claimed_until=excluded.claimed_until;
  snapshot:=public.get_public_spectator_projection_source_v2(item.tournament_id,'tables',fence);
  SELECT value INTO STRICT shown FROM jsonb_array_elements(snapshot->'payload'->'items') WHERE value->>'handId'=item.id::text;
  ASSERT shown->>'bigBlindAnteOnly'='true',shown::text;
  ASSERT (shown->>'pot')::integer=item.pot,shown::text;
  INSERT INTO mini_projection_cases VALUES(snapshot->'payload');
  ASSERT public.get_public_spectator_projection_source_v2(item.tournament_id,'tables',gen_random_uuid())='{"fenced":true}'::jsonb;
  INSERT INTO spectator_projection_v2.deferred_generations_v1 VALUES(item.tournament_id,'tables');
  ASSERT public.get_public_spectator_projection_source_v2(item.tournament_id,'tables',fence)='{"fenced":true}'::jsonb;
  DELETE FROM spectator_projection_v2.deferred_generations_v1 WHERE tournament_id=item.tournament_id AND component='tables';
 END LOOP;
END $check$;
SELECT json_build_object('miniCases',(SELECT json_agg(payload) FROM mini_projection_cases),'postHash',md5(replace(pg_get_functiondef('public.get_public_spectator_projection_source_v2(uuid,text,uuid)'::regprocedure),chr(13),'')));
${rollback}
ROLLBACK;
`);
const output=query(sql);
const row=output.split(/\r?\n/).find(line=>line.startsWith('{"miniCases"'));
assert.ok(row,'Actual projection result missing');
const {miniCases:cases,postHash}=JSON.parse(row);assert.equal(cases.length,2);
for(const payload of cases){
 const result=reducePublicSpectatorPayload('tables',payload);
 const hand=result.items.find(item=>item.handId);
 assert.deepEqual(hand.potLayers,[hand.pot]);
 assert.deepEqual(hand.players.map(player=>player.stack),payload.items.find(item=>item.handId===hand.handId).players.map(player=>player.stack));
 assert.equal('actions' in hand,false);
}
assert.equal(query('SELECT count(*) FROM public.tournament_hands;').trim(),'0');
console.log('MINI_POT_NATIVE_PASS: actual SQL frozen rule,600/500 layers, ending stacks, fence and rollback');
console.log('MINI_POT_PROJECTION_POST_HASH '+postHash);
