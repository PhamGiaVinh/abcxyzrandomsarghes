import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {sql,jsonSql} from './nativeDb.mjs';
const migration=readFileSync('supabase/migrations/20261105044028_public_hud_hand_withdrawal_scope.sql','utf8');
const recovery=readFileSync('tests/publicHud/hand-withdrawal.forward-rollback.sql','utf8');
const signatures=['tracker_analytics_v1.broadcast_withdrawal_v1()','public.flush_public_spectator_broadcast_v2(integer)'];
const metadata=()=>jsonSql(`SELECT jsonb_agg(to_jsonb(p)-'prosrc' ORDER BY p.oid) FROM pg_proc p WHERE oid IN (${signatures.map(s=>`'${s}'::regprocedure`).join(',')});`);
const hashes=()=>signatures.map(s=>sql(`SELECT md5(replace(pg_get_functiondef('${s}'::regprocedure),chr(13),''));`));
const oldHashes=hashes(),before=metadata();
const checks=readFileSync('scripts/ops/tracker-hud-20261104-postcheck.sql','utf8').split(/\r?\n/).filter(line=>/^\s*'(resultWithdrawalDefinitionMatches|handWithdrawalBroadcastDefinitionMatches)',/.test(line));
assert.equal(checks.length,2);
const postcheck=()=>jsonSql(`SELECT jsonb_build_object(${checks.map(line=>line.trim().replace(/,$/,'')).join(',')});`);
assert.deepEqual(Object.values(postcheck()),[false,false]);
assert.deepEqual(oldHashes,['80d94877352e8ad4bb86c3ffd6fa9c4e','ef1f388d4fe77907a1133e1f35df6604']);
const scope=jsonSql(`SELECT jsonb_build_object('hand',h.id,'tour',h.tournament_id) FROM public.tournament_hands h
 WHERE NOT coalesce(h.is_voided,false) AND EXISTS(SELECT 1 FROM tracker_analytics_v1.hand_contributions c WHERE c.hand_id=h.id) LIMIT 1;`);
assert.ok(scope?.hand);
sql(migration);assert.deepEqual(metadata(),before);
assert.deepEqual(Object.values(postcheck()),[true,true]);
assert.throws(()=>sql(migration),/hand withdrawal preimage differs/);
const cases=[];
for(const mode of ['hand','mixed','split','tour']){
 const result=jsonSql(`BEGIN; SET LOCAL request.jwt.claim.role='service_role';
 DELETE FROM spectator_projection_v2.broadcast_pending_v1;DELETE FROM tracker_analytics_v1.revocation_broadcast_v1;DELETE FROM realtime.fixture_messages;
 ${mode==='tour'?`UPDATE public.tournaments SET deleted_at=now() WHERE id='${scope.tour}';`:`UPDATE public.tournament_hands SET is_voided=true WHERE id='${scope.hand}';`}
 ${mode==='mixed'||mode==='split'?`SELECT spectator_projection_v2.queue_broadcast_v1('${scope.tour}','visibility',pg_current_xact_id()::text);`:''}
 ${mode==='split'?`INSERT INTO spectator_projection_v2.broadcast_pending_v1(tournament_id,component,revision,source_txid) SELECT '${scope.tour}','tables','test',(100+n)::text::xid8 FROM generate_series(1,501) n;`:''}
 DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM tracker_analytics_v1.revocation_broadcast_v1) THEN RAISE EXCEPTION 'global HUD revocation missing'; END IF;
 ${mode==='hand'?`IF NOT EXISTS(SELECT 1 FROM spectator_projection_v2.broadcast_pending_v1 WHERE component='hand_visibility') OR EXISTS(SELECT 1 FROM spectator_projection_v2.broadcast_pending_v1 WHERE component='visibility') THEN RAISE EXCEPTION 'hand scope outbox incorrect'; END IF;`:''}
 PERFORM public.flush_public_spectator_broadcast_v2(100); END $$;
 SELECT jsonb_build_object('messages',(SELECT jsonb_agg(payload) FROM realtime.fixture_messages WHERE event='changed' AND topic='public:tournament-viewer-v2:${scope.tour}'),
  'hudRevocations',(SELECT count(*) FROM realtime.fixture_messages WHERE event='revoked'),'pending',(SELECT count(*) FROM spectator_projection_v2.broadcast_pending_v1));ROLLBACK;`);
 assert.equal(result.hudRevocations,1);
 if(mode==='split')assert.ok(result.pending>0,'Full visibility remains in the next outbox batch');else assert.equal(result.pending,0);
 assert.equal(result.messages.length,1);
 const message=result.messages[0];assert.ok(message.components.includes('visibility'),'old clients retain immediate clearing');
 assert.equal(message.handVisibilityOnly,mode==='hand');
 assert.ok(!message.components.includes('hand_visibility'),'wire remains backwards compatible');
 cases.push({mode,handVisibilityOnly:message.handVisibilityOnly,globalHudRevocations:result.hudRevocations});
}
sql(recovery);assert.deepEqual(hashes(),oldHashes);assert.deepEqual(metadata(),before);
sql(migration);
const report={kind:'NATIVE_HAND_WITHDRAWAL_SCOPE',passed:true,cases,metadataPreserved:true,duplicateDenied:true,guardedRecoveryPassed:true,productionChanged:false};
if(process.env.PUBLIC_HUD_HAND_WITHDRAWAL_REPORT)writeFileSync(process.env.PUBLIC_HUD_HAND_WITHDRAWAL_REPORT,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
