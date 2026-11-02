import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
assert.equal(process.env.VINPOKER_EARLYITM1161_LOCAL,'1');
const output='D:/Quy trình/output/reports/earlyitm1161-lifecycle-gap-native-local-20261027.json';
assert.equal(existsSync(output),false);
let source=readFileSync('tests/floorProduction/d2_913.multiplayer-boundary.rollback.sql','utf8');
assert.equal(createHash('sha256').update(source).digest('hex'),'54e8cf94e6ad5cb931a388bba8bfc99a6ab83045c77737b51daea0a183c826b7');
source=source.replaceAll("'SUM_STACKS'","'SELECT_LARGEST'")
 .replace("VALUES(event,club,'D2 913 two flights boundary TEST',final,100,100000,0);","VALUES(event,club,'Early ITM1161 two flights TEST',final,50,100000,0);")
 .replace("public.multi_day_set_qualification_rules_v2(event,'SELECT_LARGEST',1,100)","public.multi_day_set_qualification_rules_v2(event,'SELECT_LARGEST',1,50)");
assert.match(source,/Early ITM1161 two flights TEST',final,50,100000,0/);
assert.match(source,/multi_day_set_qualification_rules_v2\(event,'SELECT_LARGEST',1,50\)/);
const anchor=" PERFORM set_config('role','authenticated',true);\n preview:=public.multi_day_qualification_preview_v1(event);";
assert.equal(source.split(anchor).length,2);
source=source.slice(0,source.indexOf(anchor))+String.raw`
 PERFORM set_config('role','authenticated',true);
 preview:=public.multi_day_qualification_preview_v1(event);
 ASSERT preview->>'state'='READY',preview::text;
 SELECT array_agg((b->>'bagId')::uuid ORDER BY b->>'bagId') INTO bags
 FROM jsonb_array_elements(preview->'flights')f
 CROSS JOIN LATERAL jsonb_array_elements(f->'eligibleBags')b
 WHERE (f->>'flightId'=flights[1]::text AND (b->>'playerId')::uuid=ANY(players[1:4]))
 OR (f->>'flightId'=flights[2]::text AND (b->>'playerId')::uuid=ANY(players[5:8]));
 ASSERT cardinality(bags)=8;
 r:=public.multi_day_lock_qualification_v1(event,bags,preview->>'sourceHash',gen_random_uuid());ASSERT r->>'ok'='true',r::text;
 PERFORM set_config('role','none',true);
 FOR i IN 1..3 LOOP
  physical:=gen_random_uuid();
  INSERT INTO public.game_tables(id,club_id,table_name,table_number,table_type,status,operational_status)
  VALUES(physical,club,'Early ITM1161 physical TEST '||i,table_no+2+i,'tournament','inactive','available');
  PERFORM set_config('role','authenticated',true);
  opened:=public.floor_open_tournament_table_v3(final,physical,'manual',gen_random_uuid());ASSERT opened->>'ok'='true',opened::text;
  PERFORM set_config('role','none',true);
  SELECT id,table_session_id INTO STRICT tt,sess FROM public.tournament_tables WHERE tournament_id=final AND game_table_id=physical;
  selected:=array_append(selected,tt);sessions:=array_append(sessions,sess);
 END LOOP;
 PERFORM set_config('role','authenticated',true);
 snap:=public.multi_day_final_roster_v1(event);
 SELECT (x->>'participationId')::uuid INTO STRICT p FROM jsonb_array_elements(snap->'players')x WHERE x->>'playerId'=players[1]::text;
 plan:=public.multi_day_plan_initial_draw_v1(event,selected,snap->>'sourceHash',gen_random_uuid());ASSERT plan->>'state'='PLANNED',plan::text;
 applied:=public.multi_day_apply_initial_draw_v1((plan->>'planId')::uuid,gen_random_uuid());
 ASSERT applied->>'state'='APPLIED' AND jsonb_array_length(applied->'seatReceipts')=8,applied::text;
 PERFORM set_config('role','none',true);
 SELECT e.id,s.revision,s.control_epoch,ts.chip_count INTO STRICT seeded_entry,rev,epoch,amount_before
 FROM public.tournament_entries e JOIN public.tournament_seats ts ON ts.entry_id=e.id AND ts.is_active
 JOIN public.table_sessions s ON s.id=ts.table_session_id WHERE e.tournament_id=final AND e.player_id=players[1];
 PERFORM set_config('role','authenticated',true);
 r:=public.floor_bust_player_v3(seeded_entry,rev,epoch,amount_before::integer,gen_random_uuid(),'Early ITM1161 canonical bust TEST');
 ASSERT r->>'ok'='true',r::text;
 snap:=public.get_tournament_ranking_review_v1(final);
 ASSERT (snap->'source'->>'survivors')::int=7;
 -- This existing whole-field review correctly cannot finalize one bust early.
 SELECT array_agg((x->>'entryId')::uuid ORDER BY x->>'entryId') INTO bags FROM jsonb_array_elements(snap->'source'->'entries')x;
 denied:=false;
 BEGIN
  PERFORM public.confirm_tournament_ranking_review_v1(final,snap->'source'->>'sourceHash',bags,gen_random_uuid(),actor);
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM='ranking_review_not_ready' THEN denied:=true;ELSE RAISE;END IF;
 END;
 ASSERT denied,'whole-field review unexpectedly authored early official results';
 r:=public.record_multi_day_prize_payment_v1(event,p,'cash',md5('LOCAL1161 no final individual rank'),gen_random_uuid());
 ASSERT r->>'ok'='false' AND r->>'error'='multi_day_obligations_not_finalized',r::text;
 PERFORM set_config('role','none',true);
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_prize_payments WHERE tournament_id=final);
 ASSERT NOT EXISTS(SELECT 1 FROM public.multi_day_payout_finalizations_v1 WHERE event_id=event);
 ASSERT (SELECT count(*)=8 AND count(*) FILTER(WHERE status='busted')=1 AND count(finished_place)=0 FROM public.tournament_entries WHERE tournament_id=final);
 ASSERT (SELECT count(*)=16 AND sum(amount)=1600000 FROM public.cashier_buyin_movements WHERE tournament_id=ANY(flights));
 ASSERT NOT EXISTS(SELECT 1 FROM public.cashier_buyin_movements WHERE tournament_id=final);
 RAISE NOTICE 'EARLYITM1161_EXISTING_GUARDS_PRESERVED_NOT_FEATURE_PASS';
 PERFORM set_config('test.early1161',jsonb_build_object('event',event,'final',final,'actor',actor,'club',club,
  'bustedEntry',seeded_entry,'participation',p,'qualified',8,'survivors',7,'busted',1,'officialRanks',0,
  'wholeFieldReviewRejected',denied,'paymentResponse',r,'payments',0,'individualFinalizationAvailable',false)::text,true);
END $$;
SELECT current_setting('test.early1161')::jsonb;
ROLLBACK;
DO $$ BEGIN ASSERT (SELECT fingerprint FROM d2_789_protected)=pg_temp.d2_789_fingerprint(),'1161 outer rollback changed original facts';END $$;
SELECT jsonb_build_object('rollbackProtectedGroups',41,'unchanged',true);
`;
const sqlPath='D:/Quy trình/output/reports/earlyitm1161-lifecycle-gap-executed-attempt3-local-20261027.sql';assert.equal(existsSync(sqlPath),false);writeFileSync(sqlPath,source);
const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ranking860_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const raw=execFileSync('wsl',args,{input:source,encoding:'utf8',timeout:60000,maxBuffer:4e6});
const observations=raw.split(/\r?\n/).filter(x=>x.startsWith('{')).map(JSON.parse);
assert.equal(observations.length,2);assert.equal(observations[0].survivors,7);assert.equal(observations[0].payments,0);assert.equal(observations[1].unchanged,true);
writeFileSync(output,JSON.stringify({kind:'NATIVE_EXISTING_GUARD_AND_MISSING_INDIVIDUAL_LIFECYCLE_NOT_BUGFIX_PASS',observations,executedSql:sqlPath,retainedWrites:0,fullR03Accepted:false},null,2)+'\n');
console.log('EARLYITM1161_NATIVE_GUARDS_AND_GAP_QUALIFIED_ROLLBACK_NOT_EARLY_PAYMENT_ACCEPTED');
