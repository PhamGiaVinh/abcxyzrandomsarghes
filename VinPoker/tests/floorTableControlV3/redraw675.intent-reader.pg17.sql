\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
END $$;
SET LOCAL request.jwt.claim.sub='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL request.jwt.claims='{"sub":"febf2b51-fdb7-42ff-886c-b3bb1fffdc3e","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; BEGIN
 r:=public.floor_get_redraw_intent_v1('c367013a-3ed3-48af-ad48-3915acadc50e','plan','381733df-5402-4e27-bb62-536f01abc690',
  '{"tournament_id":"c367013a-3ed3-48af-ad48-3915acadc50e","target_max_seats":9,"game_table_ids":["991b1e8e-da4c-461a-9b39-ddebd7a5d044"]}',
  'febf2b51-fdb7-42ff-886c-b3bb1fffdc3e');
 ASSERT r->>'status'='unknown',r::text;
END $$;
RESET ROLE;
UPDATE public.centerpoint_tournament_ops_release SET enabled=true,
 allowed_club_ids=ARRAY['d4427834-5f5f-48ef-bde5-e2dc388ed00b'::uuid] WHERE id;
SET LOCAL ROLE authenticated;
DO $$ DECLARE p jsonb; r jsonb; batch uuid; applied jsonb; continued jsonb;
 payload jsonb:='{"tournament_id":"c367013a-3ed3-48af-ad48-3915acadc50e","target_max_seats":9,"game_table_ids":["991b1e8e-da4c-461a-9b39-ddebd7a5d044"]}';
 BEGIN
 p:=public.floor_plan_tournament_redraw_v1('c367013a-3ed3-48af-ad48-3915acadc50e',9,ARRAY['991b1e8e-da4c-461a-9b39-ddebd7a5d044'::uuid],'381733df-5402-4e27-bb62-536f01abc690');
 ASSERT p->>'ok'='true',p::text;batch:=(p->>'batch_id')::uuid;
 r:=public.floor_get_redraw_intent_v1('c367013a-3ed3-48af-ad48-3915acadc50e','plan','381733df-5402-4e27-bb62-536f01abc690',payload,'febf2b51-fdb7-42ff-886c-b3bb1fffdc3e');
 ASSERT r->>'status'='found' AND r->'result'=p AND r->'payload'=payload AND r->>'actor_id'='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e',r::text;
 r:=public.floor_get_redraw_intent_v1('c367013a-3ed3-48af-ad48-3915acadc50e','plan','381733df-5402-4e27-bb62-536f01abc690',payload||'{"target_max_seats":8}', 'febf2b51-fdb7-42ff-886c-b3bb1fffdc3e');
 ASSERT r->>'error'='IDEMPOTENCY_CONFLICT',r::text;
 applied:=public.floor_apply_tournament_redraw_v1(batch,'381733df-5402-4e27-bb62-536f01abc691');
 ASSERT applied->>'ok'='true',applied::text;
 r:=public.floor_get_redraw_intent_v1('c367013a-3ed3-48af-ad48-3915acadc50e','apply','381733df-5402-4e27-bb62-536f01abc691',jsonb_build_object('batch_id',batch),'febf2b51-fdb7-42ff-886c-b3bb1fffdc3e');
 ASSERT r->>'status'='found' AND r->'result'=applied,r::text;
 r:=public.floor_get_redraw_intent_v1('c367013a-3ed3-48af-ad48-3915acadc50e','apply','381733df-5402-4e27-bb62-536f01abc691','{"batch_id":"381733df-5402-4e27-bb62-536f01abc699"}','febf2b51-fdb7-42ff-886c-b3bb1fffdc3e');
 ASSERT r->>'error'='IDEMPOTENCY_CONFLICT',r::text;
 continued:=public.floor_continue_tournament_redraw_v1(batch,1,'381733df-5402-4e27-bb62-536f01abc692');
 ASSERT continued->>'ok'='true',continued::text;
 ASSERT public.get_public_tournament_redraw_v1('c367013a-3ed3-48af-ad48-3915acadc50e')->>'batch_id' IS NULL,'Continue removes active TV projection';
 r:=public.floor_get_redraw_intent_v1('c367013a-3ed3-48af-ad48-3915acadc50e','apply','381733df-5402-4e27-bb62-536f01abc691',jsonb_build_object('batch_id',batch),'febf2b51-fdb7-42ff-886c-b3bb1fffdc3e');
 ASSERT r->>'status'='found' AND r->'result'=applied,'durable apply receipt survives inactive TV';
 r:=public.floor_get_redraw_intent_v1('c367013a-3ed3-48af-ad48-3915acadc50e','continue','381733df-5402-4e27-bb62-536f01abc692',jsonb_build_object('batch_id',batch,'expected_redraw_revision',1),'febf2b51-fdb7-42ff-886c-b3bb1fffdc3e');
 ASSERT r->>'status'='found' AND r->'result'=continued,r::text;
 r:=public.floor_get_redraw_intent_v1('c367013a-3ed3-48af-ad48-3915acadc50e','apply','381733df-5402-4e27-bb62-536f01abc691',jsonb_build_object('batch_id',batch),'11111111-1111-4111-8111-111111111111');
 ASSERT r->>'error'='ACTOR_MISMATCH',r::text;
END $$;
RESET ROLE;
SAVEPOINT authorized_peer;
-- Local rollback-only role fixture: a peer allowed to operate this club must
-- still not receive another actor's receipt for the same UUID/payload.
INSERT INTO public.club_floors(club_id,user_id)
 SELECT 'd4427834-5f5f-48ef-bde5-e2dc388ed00b','675fe35e-60a8-4452-bb90-e79486d54da6'
 WHERE NOT EXISTS(SELECT 1 FROM public.club_floors WHERE club_id='d4427834-5f5f-48ef-bde5-e2dc388ed00b' AND user_id='675fe35e-60a8-4452-bb90-e79486d54da6');
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';
SET LOCAL request.jwt.claims='{"sub":"675fe35e-60a8-4452-bb90-e79486d54da6","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; BEGIN
 ASSERT public.is_club_floor('675fe35e-60a8-4452-bb90-e79486d54da6','d4427834-5f5f-48ef-bde5-e2dc388ed00b');
 r:=public.floor_get_redraw_intent_v1('c367013a-3ed3-48af-ad48-3915acadc50e','plan','381733df-5402-4e27-bb62-536f01abc690',
  '{"tournament_id":"c367013a-3ed3-48af-ad48-3915acadc50e","target_max_seats":9,"game_table_ids":["991b1e8e-da4c-461a-9b39-ddebd7a5d044"]}',
  '675fe35e-60a8-4452-bb90-e79486d54da6');
 ASSERT r->>'status'='unknown',r::text;
END $$;
RESET ROLE;
ROLLBACK TO authorized_peer;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
SET LOCAL request.jwt.claims='{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
DO $$ DECLARE r jsonb; BEGIN
 r:=public.floor_get_redraw_intent_v1('c367013a-3ed3-48af-ad48-3915acadc50e','plan','381733df-5402-4e27-bb62-536f01abc690','{}','11111111-1111-4111-8111-111111111111');
 ASSERT r->>'error'='actor_not_allowed',r::text;
END $$;
RESET ROLE;
DO $$ BEGIN
 ASSERT NOT has_function_privilege('anon','public.floor_get_redraw_intent_v1(uuid,text,uuid,jsonb,uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('service_role','public.floor_get_redraw_intent_v1(uuid,text,uuid,jsonb,uuid)','EXECUTE');
END $$;
ROLLBACK;
SELECT 'REDRAW675_INTENT_READER_PLAN_APPLY_CONTINUE_INACTIVE_TV_CONFLICT_AUTH_ACL_PASS';
