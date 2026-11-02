-- Owner 2026-10-24: each club has100 tables, agent to setup. Exact retained
-- LOCAL single244 club only; do not run on production or infer other identities.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='20s';SET LOCAL lock_timeout='2s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT to_regclass('floor_private.single636_table_setup_audit') IS NULL;
 PERFORM 1 FROM public.clubs WHERE id='d4427834-5f5f-48ef-bde5-e2dc388ed00b' AND owner_id='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e' AND name='Cash identity local TEST' FOR UPDATE;
 ASSERT FOUND;
 PERFORM 1 FROM public.game_tables WHERE club_id='d4427834-5f5f-48ef-bde5-e2dc388ed00b' ORDER BY id FOR UPDATE;
 ASSERT (SELECT count(*)=100 AND count(DISTINCT table_name)=100 FROM public.game_tables WHERE club_id='d4427834-5f5f-48ef-bde5-e2dc388ed00b');
 ASSERT (SELECT count(*)=100 FROM public.game_tables WHERE club_id='d4427834-5f5f-48ef-bde5-e2dc388ed00b'
  AND table_number IS NULL AND operational_status IS NULL AND status='inactive' AND table_type='tournament' AND game_type='NLH'
  AND shift_id IS NULL AND opened_at IS NULL AND dealer_open_operation_id IS NULL AND table_name ~ '^Bàn ([1-9]|[1-9][0-9]|100)$');
END $$;
-- Every declared FK to these exact assets, including the composite session FK.
DO $$ DECLARE r record; n bigint;BEGIN
 FOR r IN SELECT DISTINCT ns.nspname,cl.relname,sa.attname FROM pg_constraint c JOIN pg_class cl ON cl.oid=c.conrelid JOIN pg_namespace ns ON ns.oid=cl.relnamespace
 CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY sk(attnum,ord) JOIN LATERAL unnest(c.confkey) WITH ORDINALITY rk(attnum,ord) ON rk.ord=sk.ord
 JOIN pg_attribute sa ON sa.attrelid=c.conrelid AND sa.attnum=sk.attnum JOIN pg_attribute ra ON ra.attrelid=c.confrelid AND ra.attnum=rk.attnum
 WHERE c.contype='f' AND c.confrelid='public.game_tables'::regclass AND ra.attname='id' LOOP
  EXECUTE format('SELECT count(*) FROM %I.%I x JOIN public.game_tables g ON x.%I=g.id WHERE g.club_id=$1',r.nspname,r.relname,r.attname) INTO n USING 'd4427834-5f5f-48ef-bde5-e2dc388ed00b'::uuid;
  ASSERT n=0,format('asset already referenced: %I.%I.%I',r.nspname,r.relname,r.attname);
 END LOOP;
END $$;
CREATE TEMP TABLE single636_outside ON COMMIT DROP AS SELECT md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.game_tables x WHERE club_id<>'d4427834-5f5f-48ef-bde5-e2dc388ed00b'),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.table_sessions x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_tables x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.dealer_assignments x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.dealer_attendance x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_registrations x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_entries x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_inventory_ledger x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x))::text) facts;
CREATE TABLE floor_private.single636_table_setup_audit AS SELECT id,
 'febf2b51-fdb7-42ff-886c-b3bb1fffdc3e'::uuid owner_id,
 'Owner instructed agent to setup100 tables per club; exact unused local single244 seed pool'::text reason,
 to_jsonb(g) before_row,NULL::jsonb after_row,now() created_at
 FROM public.game_tables g WHERE club_id='d4427834-5f5f-48ef-bde5-e2dc388ed00b';
ALTER TABLE floor_private.single636_table_setup_audit ADD PRIMARY KEY(id);
ALTER TABLE floor_private.single636_table_setup_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON floor_private.single636_table_setup_audit FROM PUBLIC,anon,authenticated,service_role;
UPDATE public.game_tables g SET table_number=substring(g.table_name FROM '^Bàn ([0-9]+)$')::integer,operational_status='available'
 FROM floor_private.single636_table_setup_audit a WHERE g.id=a.id AND to_jsonb(g)=a.before_row;
UPDATE floor_private.single636_table_setup_audit a SET after_row=to_jsonb(g) FROM public.game_tables g WHERE g.id=a.id;
DO $$ BEGIN
 ASSERT (SELECT count(*)=100 FROM floor_private.single636_table_setup_audit);
 ASSERT NOT EXISTS(SELECT 1 FROM floor_private.single636_table_setup_audit WHERE after_row IS DISTINCT FROM
  before_row||jsonb_build_object('table_number',substring(before_row->>'table_name' FROM '^Bàn ([0-9]+)$')::integer,'operational_status','available'));
 ASSERT NOT has_table_privilege('authenticated','floor_private.single636_table_setup_audit','SELECT');
 ASSERT NOT has_table_privilege('anon','floor_private.single636_table_setup_audit','SELECT');
 ASSERT NOT has_table_privilege('service_role','floor_private.single636_table_setup_audit','SELECT');
END $$;
SET LOCAL request.jwt.claim.sub='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';SET LOCAL ROLE authenticated;
DO $$ BEGIN
 ASSERT (SELECT count(*)=100 AND count(DISTINCT table_number)=100 AND min(table_number)=1 AND max(table_number)=100
  AND bool_and(availability_status='available' AND operational_status='available' AND table_session_id IS NULL)
 FROM public.get_club_table_inventory('d4427834-5f5f-48ef-bde5-e2dc388ed00b'));
END $$;
RESET ROLE;
DO $$ BEGIN
 ASSERT (SELECT facts FROM single636_outside)=md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.game_tables x WHERE club_id<>'d4427834-5f5f-48ef-bde5-e2dc388ed00b'),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.table_sessions x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_tables x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.dealer_assignments x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.dealer_attendance x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_registrations x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_entries x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_inventory_ledger x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x))::text);
END $$;
COMMIT;
SELECT 'SINGLE636_SAME100_IDS_CANONICAL_INVENTORY_NO_OPERATIONAL_FINANCIAL_DELTA_PASS';
