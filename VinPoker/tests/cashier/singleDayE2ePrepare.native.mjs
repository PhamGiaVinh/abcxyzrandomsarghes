import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

// Prepare a NEW journey, never retrofit old bust history or frozen payout.
// Reuse only the explicitly synthetic club/actor from the linked D2 test.
export function prepareSingleDayE2e(sql) {
 assert.equal(process.env.VINPOKER_NATIVE_PAYOUT,'1');
 assert.equal(sql('SELECT current_database();'),'vinpoker_ops_cash115_qualified_c');
 const club='349ecf35-50ba-4c71-a581-15dc45f1cd01',actor='a364de8e-06b1-4428-a20d-ac614ec406e5';
 assert.equal(sql(`SELECT count(*) FROM public.clubs c JOIN public.club_settings s ON s.club_id=c.id
  WHERE c.id='${club}' AND c.owner_id='${actor}' AND c.name='Cash identity local TEST' AND s.player_history_enabled AND NOT s.auto_swing_enabled;`),'1');
 const key=randomUUID();
 const manifest=JSON.parse(sql(`BEGIN;
 SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claim.role='authenticated';
 SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${actor}"}';
 CREATE FUNCTION pg_temp.prepare_configured_single() RETURNS jsonb LANGUAGE plpgsql AS $$
 DECLARE created jsonb;r jsonb;tour uuid;chips uuid;low uuid;high uuid;template uuid;BEGIN
 PERFORM set_config('role','authenticated',true);
 created:=public.create_tournament_with_levels_v1('${club}',jsonb_build_object('name','Single-day browser local TEST',
  'start_time',now()+interval '1 hour','buy_in',100000,'rake_amount',0,'service_fee_amount',0,
  'starting_stack',20000,'game_type','nlh','minutes_per_level',20,'late_reg_close_level',6),
  '[{"level_number":1,"small_blind":100,"big_blind":200,"ante":0,"duration_minutes":20,"is_break":false}]','${key}','${actor}');
 IF created->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'canonical_create_failed: %',created;END IF;
 tour:=(created->>'tournament_id')::uuid;
 PERFORM set_config('role','none',true);
 -- Explicit synthetic prize setup, before ANY registration. 50/25/25 matches
 -- existing accepted test distribution; planned9 paid entries, not actual cash.
 UPDATE public.tournaments SET itm_places=3 WHERE id=tour;
 INSERT INTO public.tournament_prizes(tournament_id,position,percentage,amount)
 VALUES(tour,1,50,450000),(tour,2,25,225000),(tour,3,25,225000);
 PERFORM set_config('role','authenticated',true);
 r:=public.chip_ops_create_chip_set('${club}','Single-day E2E ${key} TEST chips');
 IF r->>'status' IS DISTINCT FROM 'ok' THEN RAISE EXCEPTION 'chip_create: %',r;END IF;chips:=(r->>'chip_set_id')::uuid;
 r:=public.chip_ops_bind_tournament_chip_set(tour,chips);
 IF r->>'status' IS DISTINCT FROM 'ok' THEN RAISE EXCEPTION 'chip_bind: %',r;END IF;
 r:=public.chip_ops_add_denomination(chips,100,'red',NULL,0);
 IF r->>'status' IS DISTINCT FROM 'ok' THEN RAISE EXCEPTION 'chip_low: %',r;END IF;low:=(r->>'denomination_id')::uuid;
 r:=public.chip_ops_add_denomination(chips,1000,'yellow',NULL,1);
 IF r->>'status' IS DISTINCT FROM 'ok' THEN RAISE EXCEPTION 'chip_high: %',r;END IF;high:=(r->>'denomination_id')::uuid;
 r:=public.chip_ops_save_stack_template(tour,'Single-day E2E 20k TEST',20000,
  jsonb_build_array(jsonb_build_object('denomination_id',low,'count',100),jsonb_build_object('denomination_id',high,'count',10)));
 IF r->>'status' IS DISTINCT FROM 'ok' THEN RAISE EXCEPTION 'stack_setup: %',r;END IF;template:=(r->>'stack_template_id')::uuid;
 RETURN jsonb_build_object('tour',tour,'club','${club}','actor','${actor}','createRequest','${key}',
  'chipSet',chips,'low',low,'high',high,'template',template,'plannedPaidEntries',9,'setupBeforeRegistration',true);
 END $$;
 SELECT pg_temp.prepare_configured_single();COMMIT;`));
 const facts=JSON.parse(sql(`SELECT jsonb_build_object('entries',(SELECT count(*) FROM public.tournament_entries WHERE tournament_id='${manifest.tour}'),
  'registrations',(SELECT count(*) FROM public.tournament_registrations WHERE tournament_id='${manifest.tour}'),
  'payments',(SELECT count(*) FROM public.cashier_buyin_movements WHERE tournament_id='${manifest.tour}'),
  'issued',(SELECT count(*) FROM public.stack_template_issuance WHERE stack_template_id='${manifest.template}'),
  'blindLevels',(SELECT count(*) FROM public.tournament_levels WHERE tournament_id='${manifest.tour}'),
  'prizes',(SELECT sum(amount) FROM public.tournament_prizes WHERE tournament_id='${manifest.tour}'));`));
 assert.deepEqual(facts,{entries:0,registrations:0,payments:0,issued:0,blindLevels:1,prizes:900000});
 console.log('CONFIGURED_SINGLE_DAY_CANONICAL_SETUP_BEFORE_REGISTRATION_READY',JSON.stringify({manifest,facts}));
 return manifest;
}
