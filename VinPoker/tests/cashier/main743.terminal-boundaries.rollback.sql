\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='15s';SET LOCAL lock_timeout='2s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT EXISTS(SELECT 1 FROM public.tournaments WHERE id='4cd3af4d-7e1d-4042-855f-04fb6777e580' AND status='completed');
END $$;
CREATE TEMP TABLE main743_before ON COMMIT DROP AS SELECT md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_entries x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_bag x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_chip_counts x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_hands x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.multi_day_final_participations_v1 x)
)::text) AS fingerprint;
-- Qualification-only scope gate inside this rollback, never Auto/Daybreak or a persistent enable.
UPDATE public.multi_day_package_release_v1 SET enabled=true,
 allowed_club_ids=ARRAY(SELECT DISTINCT id FROM unnest(coalesce(allowed_club_ids,'{}'::uuid[])||ARRAY['a8e7d1b7-fdaa-45ad-b0a1-f894b6315760'::uuid])id)
 WHERE id;
DO $$ DECLARE ev uuid:='dbb49f8d-7d47-4c2c-afd9-f57062c9971d';
 part public.multi_day_final_participations_v1;bag public.chip_bag;rules public.multi_day_qualification_rules_v1;
 selected uuid[];snapshot jsonb;result jsonb;key uuid:=gen_random_uuid();revision integer;denied boolean;
BEGIN
 SELECT * INTO STRICT part FROM public.multi_day_final_participations_v1 p WHERE p.event_id=ev ORDER BY id LIMIT 1;
 SELECT * INTO STRICT bag FROM public.chip_bag WHERE id=(part.source_bags->0->>'bagId')::uuid;
 SELECT * INTO STRICT rules FROM public.multi_day_qualification_rules_v1 r WHERE r.event_id=ev;
 SELECT array_agg((t->>'tournamentTableId')::uuid ORDER BY t->>'tournamentTableId') INTO selected
 FROM private.multi_day_initial_draw_plans_v1 p CROSS JOIN LATERAL jsonb_array_elements(p.receipt->'selectedTables')t
 WHERE p.id='64b40264-414f-45f2-be65-aabf498b348f';
 ASSERT cardinality(selected)=3;
 SELECT coalesce(max(r.revision),0) INTO revision FROM public.multi_day_final_stack_revisions_v1 r WHERE r.participation_id=part.id;
 PERFORM set_config('request.jwt.claim.sub','675fe35e-60a8-4452-bb90-e79486d54da6',true);
 PERFORM set_config('request.jwt.claims','{"sub":"675fe35e-60a8-4452-bb90-e79486d54da6","role":"authenticated"}',true);
 PERFORM set_config('role','authenticated',true);
 snapshot:=public.multi_day_final_roster_v1(ev);
 ASSERT snapshot->>'releaseEnabled'='true';
 -- New plan cannot resurrect the completed final, even with its current hash.
 denied:=false;
 BEGIN PERFORM public.multi_day_plan_initial_draw_v1(ev,selected,snapshot->>'sourceHash',gen_random_uuid());
 EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='multi_day_final_seating_closed';denied:=true;END;
 ASSERT denied;
 -- Duplicate selected IDs are invalid input, never silently trimmed.
 denied:=false;
 BEGIN PERFORM public.multi_day_plan_initial_draw_v1(ev,ARRAY[selected[1],selected[1]],snapshot->>'sourceHash',gen_random_uuid());
 EXCEPTION WHEN invalid_parameter_value THEN ASSERT SQLERRM='multi_day_initial_draw_duplicate_table';denied:=true;END;
 ASSERT denied;
 -- Legacy one-player seating path cannot recreate a historical participant.
 denied:=false;
 BEGIN PERFORM public.multi_day_seat_final_v1(ev,part.player_id,selected[1],1,revision,gen_random_uuid());
 EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='multi_day_final_player_already_seated';denied:=true;END;
 ASSERT denied;
 -- Locked flight bags cannot be silently edited to change the saved carry proof.
 denied:=false;
 BEGIN PERFORM public.multi_day_record_bag_v1(bag.tournament_id,bag.player_id,bag.bag_code,bag.total_value+1000,bag.multi_day_revision,gen_random_uuid());
 EXCEPTION WHEN check_violation THEN ASSERT SQLERRM IN('multi_day_bagging_day_closed','multi_day_bagging_not_open');denied:=true;END;
 ASSERT denied;
 denied:=false;
 BEGIN PERFORM public.multi_day_set_qualification_rules_v2(ev,'SUM_STACKS',rules.min_cash_x,rules.day2_percent);
 EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='multi_day_rules_immutable';denied:=true;END;
 ASSERT denied;
 -- Existing owner correction is a HELD proposal, not an edit to played stacks/payout.
 result:=public.multi_day_correct_final_seed_v1(ev,part.player_id,part.carried_stack+1000,revision,'LOCAL743 rollback evidence only','LOCAL743-TEST',key);
 ASSERT result->>'state'='OWNER_APPROVED_HELD' AND result->>'liveStackChanged'='false' AND result->>'payoutFinalization'='HELD';
 ASSERT (public.multi_day_correct_final_seed_v1(ev,part.player_id,part.carried_stack+1000,revision,'LOCAL743 rollback evidence only','LOCAL743-TEST',key))->>'idempotent'='true';
 denied:=false;
 BEGIN PERFORM public.multi_day_correct_final_seed_v1(ev,part.player_id,part.carried_stack+2000,revision,'LOCAL743 rollback evidence only','LOCAL743-TEST',key);
 EXCEPTION WHEN unique_violation THEN ASSERT SQLERRM='multi_day_final_request_conflict';denied:=true;END;
 ASSERT denied;
 PERFORM set_config('role','none',true);
 ASSERT (SELECT count(*)=1 FROM public.multi_day_final_adjustments_v1 a WHERE a.request_id=key AND a.delta_chips=1000);
 ASSERT (SELECT count(*)=1 FROM public.multi_day_final_requests_v1 r WHERE r.request_id=key);
END $$;
DO $$ BEGIN ASSERT (SELECT fingerprint FROM main743_before)=md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_entries x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_bag x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_chip_counts x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_hands x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.multi_day_final_participations_v1 x)
)::text),'terminal canonical business facts changed';END $$;
ROLLBACK;
SELECT 'MAIN743_COMPLETED_FINAL_NO_NEW_PLAN_RESEAT_BAG_EDIT_POLICY_MUTATION_HELD_CORRECTION_REPLAY_CONFLICT_NO_BUSINESS_DELTA_PASS';
