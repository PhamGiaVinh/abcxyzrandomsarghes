-- CLI candidate20261019102140; forward183 after local source collision check.
-- LOCAL qualification only. Match existing Edge pot rules at the shared DB
-- writer too; never rewrite a frozen intent or an existing receipt/history row.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SET LOCAL search_path='';
DO $$ BEGIN
 IF current_user<>'postgres' OR md5(replace(pg_get_functiondef(
  'public.record_hand(uuid,uuid,integer,timestamptz,jsonb,jsonb,jsonb,jsonb,integer,uuid)'::regprocedure),chr(13),''))<>'514d543b756792fcfc3277faa325d991'
 OR md5(replace(pg_get_functiondef('public.record_tracker_manual_hand_v1(jsonb)'::regprocedure),chr(13),''))<>'29c8223e91774dc4767ab72a334e7b56'
 OR to_regprocedure('floor_private.tracker_manual_pots_match_v1(jsonb,jsonb,integer)') IS NOT NULL
 THEN RAISE EXCEPTION 'manual_pot183_dependency_or_definition_drift';END IF;
END $$;

-- Pure, internal parity of trackerEngine/potEngine.ts: DELTA contributions,
-- fold eligibility, one uncalled return, adjacent equal-eligibility merge.
-- No tables, grants, authority decisions, hand ranking or rounding changes.
CREATE FUNCTION floor_private.tracker_manual_pots_match_v1(p_actions jsonb,p_pots jsonb,p_total integer)
RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=''
AS $fn$
 WITH contributions AS (
  SELECT a->>'player_id' player,
   sum(CASE WHEN a->>'action_type' IN('bet','raise','call','all_in','post_sb','post_bb','post_ante')
    AND jsonb_typeof(a->'action_amount')='number' THEN greatest(trunc((a->>'action_amount')::numeric),0) ELSE 0 END) committed,
   bool_or(a->>'action_type'='fold') folded
  FROM jsonb_array_elements(p_actions) a GROUP BY a->>'player_id'
 ), active AS (
  SELECT *,row_number() OVER(ORDER BY committed DESC,player) rank,
   lead(committed,1,0::numeric) OVER(ORDER BY committed DESC,player) next_amount
  FROM contributions WHERE committed>0
 ), effective AS (
  SELECT player,folded,CASE WHEN rank=1 AND committed>next_amount AND NOT coalesce(folded,false)
   THEN next_amount ELSE committed END amount FROM active
 ), levels AS (
  SELECT amount,lag(amount,1,0::numeric) OVER(ORDER BY amount) previous
  FROM (SELECT DISTINCT amount FROM effective WHERE amount>0) l
 ), layers AS (
  SELECT l.amount level,(l.amount-l.previous)*count(*) amount,
   coalesce(array_agg(e.player ORDER BY e.player) FILTER(WHERE NOT coalesce(e.folded,false)),ARRAY[]::text[]) eligible
  FROM levels l JOIN effective e ON e.amount>=l.amount GROUP BY l.amount,l.previous
 ), changes AS (
  SELECT *,CASE WHEN lag(eligible) OVER(ORDER BY level) IS DISTINCT FROM eligible THEN 1 ELSE 0 END change FROM layers
 ), islands AS (
  SELECT *,sum(change) OVER(ORDER BY level) island FROM changes
 ), merged AS (
  SELECT min(level) level,sum(amount) amount,eligible FROM islands GROUP BY island,eligible
 ), expected AS (
  SELECT coalesce(jsonb_agg(jsonb_build_object('amount',amount,'eligible_player_ids',eligible) ORDER BY level),'[]'::jsonb) pots,
   coalesce(sum(amount),0) total FROM merged
 ), supplied AS (
  SELECT coalesce(jsonb_agg(jsonb_build_object('amount',p->'amount','eligible_player_ids',
   CASE WHEN jsonb_typeof(p->'eligible_player_ids')='array' THEN
    (SELECT coalesce(jsonb_agg(id ORDER BY id),'[]'::jsonb) FROM jsonb_array_elements(p->'eligible_player_ids') id) END) ORDER BY n),'[]'::jsonb) pots
  FROM jsonb_array_elements(p_pots) WITH ORDINALITY q(p,n)
 ) SELECT coalesce(expected.pots=supplied.pots AND expected.total=p_total,false) FROM expected,supplied;
$fn$;
REVOKE ALL ON FUNCTION floor_private.tracker_manual_pots_match_v1(jsonb,jsonb,integer) FROM PUBLIC,anon,authenticated,service_role;

DO $patch$
DECLARE target regprocedure:='public.record_hand(uuid,uuid,integer,timestamptz,jsonb,jsonb,jsonb,jsonb,integer,uuid)'::regprocedure;
 definition text:=pg_get_functiondef(target);
 marker text:='  SELECT t.club_id INTO v_club_id';
BEGIN
 IF array_length(string_to_array(definition,marker),1)<>2 THEN RAISE EXCEPTION 'manual_pot183_patch_anchor_drift';END IF;
 EXECUTE replace(definition,marker,$addition$
  IF NOT floor_private.tracker_manual_pots_match_v1(p_actions,COALESCE(p_side_pots,'[]'::jsonb),COALESCE(p_pot_size,0)) THEN
    RETURN jsonb_build_object('ok',false,'error','SIDE_POTS_TAMPERED');
  END IF;
$addition$||marker);
 IF NOT has_function_privilege('postgres',target,'EXECUTE')
 OR has_function_privilege('authenticated',target,'EXECUTE') OR has_function_privilege('anon',target,'EXECUTE')
 OR has_function_privilege('service_role',target,'EXECUTE') THEN RAISE EXCEPTION 'manual_pot183_acl_drift';END IF;
END $patch$;
-- Recovery: suspend new manual Finish via forward REVOKE EXECUTE on the public
-- wrapper if necessary; retain receipts/history. Do not re-enable the bypass.
COMMIT;
