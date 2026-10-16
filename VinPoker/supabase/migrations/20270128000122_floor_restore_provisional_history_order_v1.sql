-- Forward-only, SOURCE/LOCAL TEST ONLY until exact live catalog/release review.
-- CLI generated20261016151453, reserved forward slot122 after local/source scan.
-- Undoing a mistaken bust invalidates only its provisional order. Never reset
-- tournament bust_seq, rewrite official places, money, payout or audit history.
-- Compensation: restore the pre-apply function definition/ACL from the reviewed
-- recovery artifact; retain restored entries, receipts and the monotonic sequence.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $restore_history$
DECLARE fn regprocedure:=to_regprocedure('floor_private.restore_busted_player_to_seat(uuid,uuid,integer,bigint,bigint,uuid,uuid)'); definition text;
 guard_anchor text:=$anchor$  IF NOT FOUND OR v_entry.status <> 'busted' THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'entry_not_busted');
  END IF;$anchor$;
 clear_anchor text:=$anchor$        busted_at = NULL,
        updated_at = pg_catalog.now()$anchor$;
BEGIN
 IF current_user<>'postgres' OR fn IS NULL THEN RAISE EXCEPTION 'restore122_reviewed_owner_dependency_required'; END IF;
 SELECT replace(pg_get_functiondef(fn),chr(13),'') INTO definition;
 IF md5(definition)<>'e671d6c24edf4d4ed631ecec820efae2' THEN RAISE EXCEPTION 'restore122_dependency_drift'; END IF;
 IF (length(definition)-length(replace(definition,guard_anchor,'')))/length(guard_anchor)<>2
 OR (length(definition)-length(replace(definition,clear_anchor,'')))/length(clear_anchor)<>1
 THEN RAISE EXCEPTION 'restore122_anchor_drift'; END IF;
 definition:=replace(definition,guard_anchor,guard_anchor||$guard$
  IF v_entry.finished_place IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'restore_result_dependency');
  END IF;$guard$);
 definition:=replace(definition,clear_anchor,$clear$        busted_at = NULL,
        bust_order = NULL,
        updated_at = pg_catalog.now()$clear$);
 EXECUTE definition;
END;
$restore_history$;
-- The shared implementation still has its original ABI, owner, ACL and path;
-- every existing public restore wrapper uses the same integrity checks.
DO $postcheck$
DECLARE p pg_proc%ROWTYPE;
BEGIN
 SELECT * INTO p FROM pg_proc WHERE oid='floor_private.restore_busted_player_to_seat(uuid,uuid,integer,bigint,bigint,uuid,uuid)'::regprocedure;
 IF NOT p.prosecdef OR pg_get_userbyid(p.proowner)<>'postgres'
 OR p.proacl::text<>'{postgres=X/postgres}' OR p.proconfig::text<>'{"search_path=\"\""}'
 THEN RAISE EXCEPTION 'restore122_security_contract_changed'; END IF;
END;
$postcheck$;
COMMIT;
