// Exercise the real release wrapper and exact ledger on a disposable PG17 DB.
// Schema-only fixture comes from the existing isolated qualification environment.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { applyPhase, preparePackage } from './tracker-bb-ante-release.mjs';
import { runPaidCorrectionEdge } from '../../tests/trackerSettlement/paidCorrectionEdge.native.mjs';

const psql = process.env.TRACKER_TEST_PSQL ?? 'psql';
const name = 'tracker_bba350_release_gate';
const env = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('PG')) delete env[key];
const args = ['-h','127.0.0.1','-p','56419','-U','postgres','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql = (database, input) => execFileSync(psql, [...args, '-d', database], {
  input, env, encoding: 'utf8', windowsHide: true, maxBuffer: 8*1024*1024, timeout: 120000,
}).trim();
const identity = JSON.parse(sql('tracker_bba350_full', `SELECT json_build_object(
 'host',host(inet_server_addr()),'port',inet_server_port(),'data',current_setting('data_directory'),
 'hands',(SELECT count(*) FROM public.tournament_hands));`));
assert.equal(identity.host,'127.0.0.1'); assert.equal(identity.port,56419);
assert.match(identity.data,/tracker-bba349-pg17-[a-f0-9]+[/\\]data$/);
assert.equal(identity.hands,0);
const schema = readFileSync(process.env.TRACKER_TEST_SCHEMA, 'utf8');
assert.match(schema,/Dumped from database version 17\./);
assert.doesNotMatch(schema,/COPY public\.tournament_hands/);
assert.equal(sql('tracker_bba350_full', `SELECT count(*) FROM pg_database WHERE datname='${name}';`),'0');
sql('tracker_bba350_full', `CREATE DATABASE ${name};`);
try {
  sql(name,schema);
  const phases=preparePackage(fileURLToPath(new URL('../..',import.meta.url)));
  for(const phase of phases) {
    applyPhase(phase, {
      execute: query => sql(name,query),
      json: query => {
        const result=JSON.parse(sql(name,query));
        // Only the test-owned database name differs from the production gate.
        if(result.database!==undefined){assert.equal(result.database,name);result.database='postgres';}
        return result;
      },
    }, console.log);
  }
  assert.equal(sql(name,`SELECT count(*) FROM public.tournament_hands;`),'0');
  console.log('TRACKER_BBA_NATIVE_RELEASE_GATE_PASS: exact350/351 receipts and function metadata; zero business rows');
  const fixture=readFileSync(fileURLToPath(new URL('../../tests/trackerEngine/bbAnteSettlement.local.pg17.sql',import.meta.url)),'utf8');
  assert.match(fixture,/ROLLBACK;\s*$/);
  assert.equal(fixture.split("current_database()='tracker_bba350_full'").length,2);
  sql(name,fixture.replace("current_database()='tracker_bba350_full'",`current_database()='${name}'`).replace(/ROLLBACK;\s*$/,'COMMIT;'));
  const hand=JSON.parse(sql(name,`SELECT json_build_object('id',h.id,'actor',h.created_by,'tour',h.tournament_id,'club',t.club_id,'table',h.tournament_table_id)
    FROM public.tournament_hands h JOIN public.tournaments t ON t.id=h.tournament_id WHERE h.pot_size=600;`));
  sql(name,`INSERT INTO public.tracker_correction_uat_scopes(club_id,tournament_id,tournament_table_id,user_id,capability,enabled)
    VALUES('${hand.club}','${hand.tour}','${hand.table}','${hand.actor}','correct_completed_hand',true);`);
  // Real Edge handler/compute/SQL; modeled Auth/HTTP and admin SQL transport.
  // The schema-only fixture does not establish production effective-ACL parity.
  await runPaidCorrectionEdge({sql:query=>sql(name,query),service:`SET request.jwt.claims='{"role":"service_role"}';`,
    fixture:hand,hand:hand.id,scenario:async({invoke,body,errors})=>{
      let response=await invoke(body);const preview=await response.json();
      assert.equal(response.status,200,JSON.stringify({preview,errors}));assert.equal(preview.status,'preview');
      const commit={...body,mode:'commit',idempotency_key:'bba-native-edge-'+hand.id,
        expected_source_revision:preview.source_revision,expected_source_chain_hash:preview.source_chain_hash,
        expected_outcome_hash:preview.outcome_hash};
      response=await invoke(commit);const receipt=await response.json();
      assert.equal(response.status,200,JSON.stringify({receipt,errors}));assert.equal(receipt.ok,true);
      response=await invoke(commit);assert.equal(response.status,409);
      assert.equal(sql(name,`SELECT sum(ending_stack) FROM public.hand_players WHERE hand_id='${hand.id}';`),'2000');
      console.log('TRACKER_BBA_ACTUAL_CORRECTION_EDGE_PASS: preview, commit, stale retry and conserved stacks');
    }});
} finally {
  // This name was checked absent and created by this invocation on the guarded cluster.
  sql('tracker_bba350_full',`DROP DATABASE ${name};`);
}
