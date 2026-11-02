-- CLI candidate20261018165028 ->160. LOCAL candidate; server preview/CAS.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF to_regprocedure('public.get_staking_release_preview_v1(uuid)') IS NOT NULL
 OR to_regprocedure('public.commit_staking_release_v1(uuid,jsonb)') IS NULL
 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000160')
 THEN RAISE EXCEPTION 'staking160_catalog_collision';END IF;
END $$;
CREATE FUNCTION public._staking_release_preview_v1(p_actor uuid,p_deal uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.staking_deals%ROWTYPE; p record; rows jsonb:='[]'; result jsonb;
 fee bigint; available bigint; backer bigint; player bigint; total_pct numeric; n integer; i integer:=0; share bigint; allocated bigint:=0;
BEGIN
 IF p_actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p_actor AND role IN('super_admin','cashier'))
 THEN RAISE EXCEPTION 'staking_preview_forbidden' USING ERRCODE='42501';END IF;
 SELECT * INTO d FROM public.staking_deals WHERE id=p_deal;
 IF NOT FOUND THEN RAISE EXCEPTION 'staking_preview_not_found';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p_actor AND role='super_admin')
 AND (d.club_id IS NULL OR NOT public.is_club_cashier(p_actor,d.club_id))
 THEN RAISE EXCEPTION 'staking_preview_club_denied' USING ERRCODE='42501';END IF;
 IF d.status NOT IN('result_verified','release_requested','cosigned') THEN RAISE EXCEPTION 'staking_preview_state_invalid';END IF;
 SELECT count(*),sum(percent) INTO n,total_pct FROM public.staking_purchases WHERE deal_id=d.id AND status='funded';
 IF n NOT BETWEEN 1 AND 100 OR total_pct IS NULL OR total_pct<>d.filled_percent OR d.filled_percent<=0 OR d.filled_percent>100
 OR d.result_prize_vnd IS NULL OR d.result_prize_vnd<0 THEN RAISE EXCEPTION 'staking_preview_snapshot_invalid';END IF;
 fee:=CASE WHEN d.result_prize_vnd>0 THEN least(coalesce(d.platform_archive_fee,199000),d.result_prize_vnd) ELSE 0 END;
 available:=greatest(0,d.result_prize_vnd-fee);
 IF d.override_data->>'override_backer_amount' IS NOT NULL THEN
   backer:=(d.override_data->>'override_backer_amount')::bigint;player:=(d.override_data->>'override_player_amount')::bigint;
 ELSE backer:=round(available*d.filled_percent::numeric/100);player:=greatest(0,available-backer);END IF;
 IF backer IS NULL OR player IS NULL OR least(backer,player,fee)<0
 OR greatest(backer,player,fee,d.result_prize_vnd)>9007199254740991
 OR d.backer_payout_vnd IS DISTINCT FROM backer OR d.player_payout_vnd IS DISTINCT FROM player
 THEN RAISE EXCEPTION 'staking_preview_amount_mismatch';END IF;
 FOR p IN SELECT x.id,x.backer_id,x.percent,pr.display_name,pr.bank_name,pr.bank_account_number,pr.bank_account_holder
   FROM public.staking_purchases x LEFT JOIN public.profiles pr ON pr.user_id=x.backer_id
   WHERE x.deal_id=d.id AND x.status='funded' ORDER BY x.id LOOP
   i:=i+1;share:=CASE WHEN i<n THEN round(backer*p.percent::numeric/total_pct) ELSE greatest(0,backer-allocated) END;
   allocated:=allocated+share;
   rows:=rows||jsonb_build_array(jsonb_build_object('purchase_id',p.id,'backer_id',p.backer_id,'backer_name',p.display_name,
     'percent',p.percent,'vnd_value',share,'bank_name',p.bank_name,'bank_account_number',p.bank_account_number,'bank_account_holder',p.bank_account_holder));
 END LOOP;
 IF allocated<>backer THEN RAISE EXCEPTION 'staking_preview_rounding_invalid';END IF;
 result:=jsonb_build_object('deal_id',d.id,'prize',d.result_prize_vnd,'fee',fee,'distributable',available,'backer_amount',backer,'player_amount',player,'rows',rows);
 RETURN result||jsonb_build_object('preview_hash',md5(result::text));
END $$;
REVOKE ALL ON FUNCTION public._staking_release_preview_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.get_staking_release_preview_v1(p_deal uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public._staking_release_preview_v1(auth.uid(),p_deal);
$$;
REVOKE ALL ON FUNCTION public.get_staking_release_preview_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_staking_release_preview_v1(uuid) TO authenticated;
CREATE FUNCTION public.commit_staking_release_v2(p_actor uuid,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE rr public.staking_release_requests%ROWTYPE; preview jsonb;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service_required' USING ERRCODE='42501';END IF;
 SELECT * INTO rr FROM public.staking_release_requests WHERE id=(p_payload->>'release_request_id')::uuid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'staking_release_not_found';END IF;
 IF EXISTS(SELECT 1 FROM public.staking_release_receipts_v1 WHERE release_request_id=rr.id)
 THEN RETURN public.commit_staking_release_v1(p_actor,p_payload);END IF;
 PERFORM id FROM public.staking_deals WHERE id=rr.deal_id FOR UPDATE;
 PERFORM id FROM public.staking_purchases WHERE deal_id=rr.deal_id ORDER BY id FOR UPDATE;
 preview:=public._staking_release_preview_v1(p_actor,rr.deal_id);
 IF p_payload->>'preview_hash' IS DISTINCT FROM preview->>'preview_hash'
 OR (SELECT jsonb_agg(b->>'purchase_id' ORDER BY ord) FROM jsonb_array_elements(p_payload->'backer_payouts') WITH ORDINALITY AS x(b,ord))
 IS DISTINCT FROM (SELECT jsonb_agg(b->>'purchase_id' ORDER BY ord) FROM jsonb_array_elements(preview->'rows') WITH ORDINALITY AS x(b,ord))
 THEN RAISE EXCEPTION 'staking_release_preview_stale';END IF;
 RETURN public.commit_staking_release_v1(p_actor,p_payload);
END $$;
REVOKE ALL ON FUNCTION public.commit_staking_release_v2(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.commit_staking_release_v2(uuid,jsonb) TO service_role;
COMMIT;
