\set ON_ERROR_STOP on
DO $$ BEGIN IF current_database()<>'vinpoker_ops_series_reorder' OR current_user<>'postgres'
 OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet OR inet_server_port()<>55441
 OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999
 THEN RAISE EXCEPTION 'owned_series_reorder_pg17_only'; END IF; END $$;
BEGIN;
INSERT INTO auth.users(id) VALUES('ee920000-0000-4000-8000-000000000098'),('ee920000-0000-4000-8000-000000000099');
INSERT INTO public.user_roles(user_id,role) VALUES('ee920000-0000-4000-8000-000000000098','super_admin');
INSERT INTO public.clubs(id,owner_id,name,region) VALUES('ee920000-0000-4000-8000-000000000097','ee920000-0000-4000-8000-000000000099','Other owner TEST','TEST');
DROP TRIGGER series_reorder_fixture_fail ON public.club_series_images;
UPDATE public.club_series_images SET position=CASE WHEN id='ee920000-0000-4000-8000-000000000003' THEN 0 ELSE 1 END
WHERE club_id='ee920000-0000-4000-8000-000000000002';
CREATE TRIGGER series_reorder_fixture_fail BEFORE UPDATE ON public.club_series_images FOR EACH ROW EXECUTE FUNCTION public.series_reorder_fixture_fail();
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','ee920000-0000-4000-8000-000000000001',true);
DO $$ DECLARE result jsonb; BEGIN
 BEGIN
  result:=public.reorder_club_series_images_v1('ee920000-0000-4000-8000-000000000002',
   '[{"id":"ee920000-0000-4000-8000-000000000003","position":0},{"id":"ee920000-0000-4000-8000-000000000004","position":1}]',
   ARRAY['ee920000-0000-4000-8000-000000000004','ee920000-0000-4000-8000-000000000003']::uuid[],
   'ee920000-0000-4000-8000-000000000010','ee920000-0000-4000-8000-000000000001');
  RAISE EXCEPTION 'injected failure not reached';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'injected_second_reorder_request_failure' THEN RAISE; END IF;
 END;
 IF EXISTS(SELECT 1 FROM public.club_series_images WHERE id='ee920000-0000-4000-8000-000000000003' AND position<>0)
 OR EXISTS(SELECT 1 FROM public.club_series_images WHERE id='ee920000-0000-4000-8000-000000000004' AND position<>1)
 THEN RAISE EXCEPTION 'atomic failure left partial reorder'; END IF;
END $$;
RESET ROLE;
DROP TRIGGER series_reorder_fixture_fail ON public.club_series_images;
CREATE FUNCTION public.series_receipt_fixture_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.operation_type='reorder_club_series_images_v1' AND NEW.request_id='ee920000-0000-4000-8000-000000000013' THEN RAISE EXCEPTION 'injected_series_receipt_failure'; END IF; RETURN NEW; END $$;
CREATE TRIGGER series_receipt_fixture_fail BEFORE INSERT ON public.table_operation_receipts FOR EACH ROW EXECUTE FUNCTION public.series_receipt_fixture_fail();
SET LOCAL ROLE authenticated;
DO $$ DECLARE result jsonb; replay jsonb; expected jsonb:='[{"id":"ee920000-0000-4000-8000-000000000003","position":0},{"id":"ee920000-0000-4000-8000-000000000004","position":1}]'; desired uuid[]:=ARRAY['ee920000-0000-4000-8000-000000000004','ee920000-0000-4000-8000-000000000003']::uuid[];
BEGIN
 BEGIN
  result:=public.reorder_club_series_images_v1('ee920000-0000-4000-8000-000000000002',expected,desired,'ee920000-0000-4000-8000-000000000013','ee920000-0000-4000-8000-000000000001');
  RAISE EXCEPTION 'receipt fault not reached';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'injected_series_receipt_failure' THEN RAISE; END IF; END;
 IF EXISTS(SELECT 1 FROM public.club_series_images WHERE id='ee920000-0000-4000-8000-000000000003' AND position<>0)
 OR EXISTS(SELECT 1 FROM public.club_series_images WHERE id='ee920000-0000-4000-8000-000000000004' AND position<>1)
 THEN RAISE EXCEPTION 'receipt fault left gallery delta'; END IF;
 result:=public.reorder_club_series_images_v1('ee920000-0000-4000-8000-000000000097',expected,desired,'ee920000-0000-4000-8000-000000000015','ee920000-0000-4000-8000-000000000001');
 IF result->>'error' IS DISTINCT FROM 'actor_not_allowed' THEN RAISE EXCEPTION 'cross club accepted'; END IF;
 result:=public.reorder_club_series_images_v1('ee920000-0000-4000-8000-000000000002',expected,desired,'ee920000-0000-4000-8000-000000000010','ee920000-0000-4000-8000-000000000001');
 IF result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'valid owner rejected %',result; END IF;
 replay:=public.reorder_club_series_images_v1('ee920000-0000-4000-8000-000000000002',expected,desired,'ee920000-0000-4000-8000-000000000010','ee920000-0000-4000-8000-000000000001');
 IF replay IS DISTINCT FROM result THEN RAISE EXCEPTION 'receipt replay changed'; END IF;
 replay:=public.get_club_series_reorder_receipt_v1('ee920000-0000-4000-8000-000000000002',expected,desired,'ee920000-0000-4000-8000-000000000010','ee920000-0000-4000-8000-000000000001');
 IF replay IS DISTINCT FROM result THEN RAISE EXCEPTION 'receipt readback changed'; END IF;
 replay:=public.reorder_club_series_images_v1('ee920000-0000-4000-8000-000000000002',expected,ARRAY['ee920000-0000-4000-8000-000000000003','ee920000-0000-4000-8000-000000000004']::uuid[],'ee920000-0000-4000-8000-000000000010','ee920000-0000-4000-8000-000000000001');
 IF replay->>'error' IS DISTINCT FROM 'IDEMPOTENCY_CONFLICT' THEN RAISE EXCEPTION 'payload conflict missing'; END IF;
 replay:=public.reorder_club_series_images_v1('ee920000-0000-4000-8000-000000000002',expected,desired,'ee920000-0000-4000-8000-000000000011','ee920000-0000-4000-8000-000000000001');
 IF replay->>'error' IS DISTINCT FROM 'reorder_conflict' THEN RAISE EXCEPTION 'stale snapshot accepted'; END IF;
 BEGIN
  UPDATE public.club_series_images SET position=9 WHERE id='ee920000-0000-4000-8000-000000000003';
  RAISE EXCEPTION 'legacy position seam still writable';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 UPDATE public.club_series_images SET caption='Allowed non-position edit' WHERE id='ee920000-0000-4000-8000-000000000003';
 IF NOT FOUND THEN RAISE EXCEPTION 'non-position compatibility lost'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','ee920000-0000-4000-8000-000000000099',true);
DO $$ DECLARE result jsonb; BEGIN
 result:=public.reorder_club_series_images_v1('ee920000-0000-4000-8000-000000000002','[]','{}','ee920000-0000-4000-8000-000000000012','ee920000-0000-4000-8000-000000000099');
 IF result->>'error' IS DISTINCT FROM 'actor_not_allowed' THEN RAISE EXCEPTION 'outsider accepted'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','ee920000-0000-4000-8000-000000000098',true);
DO $$ DECLARE result jsonb; BEGIN
 result:=public.reorder_club_series_images_v1('ee920000-0000-4000-8000-000000000002',
 '[{"id":"ee920000-0000-4000-8000-000000000003","position":1},{"id":"ee920000-0000-4000-8000-000000000004","position":0}]',
 ARRAY['ee920000-0000-4000-8000-000000000003','ee920000-0000-4000-8000-000000000004']::uuid[],
 'ee920000-0000-4000-8000-000000000014','ee920000-0000-4000-8000-000000000098');
 IF result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'superadmin rejected %',result; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF has_function_privilege('anon','public.reorder_club_series_images_v1(uuid,jsonb,uuid[],uuid,uuid)','EXECUTE')
 OR has_function_privilege('service_role','public.reorder_club_series_images_v1(uuid,jsonb,uuid[],uuid,uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'RPC exposed to forbidden role'; END IF;
END $$;
ROLLBACK;
\echo SERIES_REORDER_ATOMIC_FAULT_ROLLBACK_REPLAY_CONFLICT_STALE_ACTOR_LEGACY_POSITION_DENIAL_PASS
