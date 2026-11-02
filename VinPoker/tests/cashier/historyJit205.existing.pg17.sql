-- Run inside the parent's qualification transaction, never independently retain.
DO $test$ DECLARE r jsonb;before_row record;after_row record;
BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR host(inet_server_addr())<>'127.0.0.1' OR inet_server_port()<>55441
 THEN RAISE EXCEPTION 'history205_exact_local_database_required';END IF;
 SELECT * INTO before_row FROM pg_temp.history205_metadata;
 SELECT * INTO after_row FROM pg_proc WHERE oid=before_row.oid;
 IF after_row.prosrc IS DISTINCT FROM before_row.prosrc OR after_row.proacl IS DISTINCT FROM before_row.proacl
 OR after_row.proowner<>before_row.proowner OR after_row.proconfig IS DISTINCT FROM ARRAY['search_path=""','jit=off']::text[]
 THEN RAISE EXCEPTION 'history205_source_acl_or_config_changed';END IF;
 IF current_setting('jit')<>'on' THEN RAISE EXCEPTION 'history205_must_not_disable_jit_for_session';END IF;
 PERFORM set_config('role','anon',true);
 r:=public.get_public_tournament_table_history_v2('46cab483-91e7-4220-aacf-e17bdf05269c','d294f4a4-082b-4efc-a6ca-1f96579ea344',20,NULL,NULL);
 PERFORM set_config('role','none',true);
 IF r IS DISTINCT FROM (SELECT value FROM pg_temp.history205_before WHERE label='full')
 OR current_setting('jit')<>'on' THEN RAISE EXCEPTION 'history205_anon_parity_or_setting_leak';END IF;
 IF EXISTS(SELECT 1 FROM pg_temp.history205_before b WHERE b.value IS DISTINCT FROM
  public.get_public_tournament_table_history_v2(b.tour,b.tbl,b.lim,b.cursor_time,b.cursor_id))
 THEN RAISE EXCEPTION 'history205_contract_matrix_changed';END IF;
END $test$;
SELECT 'HISTORY205_BODY_ACL_SCOPE_ERROR_CURSOR_PUBLIC_JSON_PARITY_NO_GLOBAL_JIT_CHANGE_PASS';
