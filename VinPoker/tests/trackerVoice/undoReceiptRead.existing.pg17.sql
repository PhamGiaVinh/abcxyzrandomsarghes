-- Receipt lookup only. Seed an already-committed receipt inside rollback; this
-- proves read authorization/recovery, NOT a successful live Dealer Undo.
BEGIN;
SET LOCAL statement_timeout='15s';SET LOCAL lock_timeout='3s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c';
 ASSERT inet_server_addr()='127.0.0.1'::inet AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net');
 ASSERT to_regprocedure('public.get_tracker_undo_receipt_v1(uuid,uuid,uuid,uuid,bigint,uuid)') IS NOT NULL,
  'missing pure authenticated Undo receipt recovery API';
END $$;
GRANT USAGE ON SCHEMA auth TO authenticated;
DO $$ DECLARE actor uuid:='675fe35e-60a8-4452-bb90-e79486d54da6';
 tour uuid:='46cab483-91e7-4220-aacf-e17bdf05269c';tbl uuid:='d294f4a4-082b-4efc-a6ca-1f96579ea344';
 hand uuid:='f738688d-b606-4af7-b16f-84c66a95a4d3';action uuid:=gen_random_uuid();key uuid:=gen_random_uuid();
 answer jsonb;receipt jsonb;before_state text;other_actor uuid;
BEGIN
 ASSERT EXISTS(SELECT 1 FROM public.tournament_hands h JOIN public.tournaments t ON t.id=h.tournament_id
 JOIN public.clubs c ON c.id=t.club_id WHERE h.id=hand AND t.id=tour AND h.tournament_table_id=tbl
 AND t.name='Cash identity local TEST' AND c.owner_id=actor AND h.status='completed');
 ASSERT NOT has_function_privilege('anon','public.get_tracker_undo_receipt_v1(uuid,uuid,uuid,uuid,bigint,uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('service_role','public.get_tracker_undo_receipt_v1(uuid,uuid,uuid,uuid,bigint,uuid)','EXECUTE');
 ASSERT NOT has_table_privilege('authenticated','public.tracker_correction_operations','SELECT');
 ASSERT has_function_privilege('authenticated','public.get_tracker_undo_receipt_v1(uuid,uuid,uuid,uuid,bigint,uuid)','EXECUTE');
 receipt:=jsonb_build_object('ok',true,'duplicate',false,'operation','undo_open_hand','hand_id',hand,
  'undone_action_id',action,'source_revision',8,'deleted',jsonb_build_object('test','receipt-only'));
 INSERT INTO public.tracker_correction_operations(actor_user_id,tournament_id,tournament_table_id,hand_id,
 operation,idempotency_key,request_hash,receipt) VALUES(actor,tour,tbl,hand,'undo_open_hand',key,
 md5(jsonb_build_object('tournament_id',tour,'tournament_table_id',tbl,'hand_id',hand,'action_id',action,'source_revision',7)::text),receipt);
 -- No assignment, live lock, or current epoch is required to READ this old
 -- operation; it is NOT authorization to submit an Undo writer today.
 SELECT md5(jsonb_build_object('hand',(SELECT to_jsonb(h) FROM public.tournament_hands h WHERE h.id=hand),
  'actions',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.hand_actions a WHERE a.hand_id=hand),
  'operations',(SELECT jsonb_agg(to_jsonb(o) ORDER BY o.id) FROM public.tracker_correction_operations o))::text) INTO before_state;
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor)::text,true);
 PERFORM set_config('role','authenticated',true);
 answer:=public.get_tracker_undo_receipt_v1(tour,tbl,hand,action,7,key);
 ASSERT answer->>'outcome'='recorded',answer::text;
 ASSERT answer->'receipt'=receipt||jsonb_build_object('duplicate',true),answer::text;
 ASSERT answer->>'actor_id'=actor::text AND answer->>'request_id'=key::text;
 ASSERT public.get_tracker_undo_receipt_v1(tour,tbl,hand,action,7,key)=answer,'read replay changed receipt';
 answer:=public.get_tracker_undo_receipt_v1(tour,tbl,hand,action,8,key);
 ASSERT answer->>'error'='request_key_conflict' AND NOT(answer ? 'receipt'),answer::text;
 answer:=public.get_tracker_undo_receipt_v1(tour,tbl,hand,gen_random_uuid(),7,key);
 ASSERT answer->>'error'='request_key_conflict' AND NOT(answer ? 'receipt'),answer::text;
 answer:=public.get_tracker_undo_receipt_v1(tour,tbl,hand,action,7,gen_random_uuid());
 ASSERT answer->>'outcome'='not_found' AND NOT(answer ? 'receipt'),answer::text;
 answer:=public.get_tracker_undo_receipt_v1(tour,tbl,hand,action,0,key);
 ASSERT answer->>'error'='invalid_request',answer::text;
 answer:=public.get_tracker_undo_receipt_v1(tour,gen_random_uuid(),hand,action,7,key);
 ASSERT answer->>'error'='tracker_scope_denied' AND NOT(answer ? 'receipt'),answer::text;
 PERFORM set_config('role','none',true);
 SELECT c.owner_id INTO other_actor FROM public.clubs c WHERE c.id<>'a8e7d1b7-fdaa-45ad-b0a1-f894b6315760'
 AND c.owner_id<>actor AND NOT public.is_club_tracker(c.owner_id,'a8e7d1b7-fdaa-45ad-b0a1-f894b6315760') LIMIT 1;
 ASSERT other_actor IS NOT NULL,'need actual cross-club actor';
 PERFORM set_config('request.jwt.claim.sub',other_actor::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',other_actor)::text,true);
 PERFORM set_config('role','authenticated',true);
 answer:=public.get_tracker_undo_receipt_v1(tour,tbl,hand,action,7,key);
 ASSERT answer->>'error'='tracker_scope_denied' AND NOT(answer ? 'receipt'),answer::text;
 PERFORM set_config('role','none',true);
 -- Even a second authorized actor cannot read the first actor's receipt/key.
 INSERT INTO public.club_trackers(club_id,user_id,granted_by) VALUES('a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',other_actor,actor);
 PERFORM set_config('role','authenticated',true);
 answer:=public.get_tracker_undo_receipt_v1(tour,tbl,hand,action,7,key);
 ASSERT answer->>'outcome'='not_found' AND NOT(answer ? 'receipt'),answer::text;
 PERFORM set_config('request.jwt.claim.sub','',true);PERFORM set_config('request.jwt.claims','{"role":"authenticated"}',true);
 answer:=public.get_tracker_undo_receipt_v1(tour,tbl,hand,action,7,key);
 ASSERT answer->>'error'='authentication_required' AND NOT(answer ? 'receipt'),answer::text;
 PERFORM set_config('role','none',true);
 ASSERT before_state=(SELECT md5(jsonb_build_object('hand',(SELECT to_jsonb(h) FROM public.tournament_hands h WHERE h.id=hand),
  'actions',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.hand_actions a WHERE a.hand_id=hand),
  'operations',(SELECT jsonb_agg(to_jsonb(o) ORDER BY o.id) FROM public.tracker_correction_operations o))::text)),
  'receipt reads changed canonical state';
END $$;
ROLLBACK;
