-- Candidate only: not in the approved/reviewed31-migration release manifest.
-- One verified-player Edge call replaces sequential Data API round trips.
-- Pricing, entry eligibility and pending idempotency remain canonical.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF to_regprocedure('public.cashier_app_reentry_transport_v1(uuid,uuid)') IS NOT NULL THEN
  RAISE EXCEPTION 'reentry_transport_signature_collision';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.cashier_create_app_reentry_v1(uuid,uuid)')
  AND md5(replace(prosrc,chr(13),''))='8c1fed4cdecbccde55c7f8ba5aa7b169'
  AND pg_get_userbyid(proowner)='postgres' AND prosecdef AND provolatile='v'
  AND proconfig=ARRAY['search_path=""']::text[]
  AND has_function_privilege('service_role',oid,'EXECUTE')
  AND NOT has_function_privilege('anon',oid,'EXECUTE')
  AND NOT has_function_privilege('authenticated',oid,'EXECUTE')) THEN
  RAISE EXCEPTION 'canonical_reentry_dependency_drift';
 END IF;
END $$;
CREATE FUNCTION public.cashier_app_reentry_transport_v1(p_tournament_id uuid,p_player_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
 v_tour record; v_setting jsonb; v_config jsonb; v_accounts jsonb;
 v_bank jsonb; v_bin text; v_registration jsonb; v_snapshot jsonb;
 v_response jsonb; v_amount jsonb; v_key text;
BEGIN
 IF current_user <> 'service_role' THEN
  RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501';
 END IF;
 -- Keep caller identity verification in Edge. Browser roles cannot invoke this
 -- service transport or supply another player's identity to its canonical RPC.
 BEGIN
  SELECT id,name,club_id INTO v_tour FROM public.tournaments WHERE id=p_tournament_id;
 EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('status',503,'body',jsonb_build_object('error','Tournament unavailable'));
 END;
 IF NOT FOUND THEN
  RETURN jsonb_build_object('status',404,'body',jsonb_build_object('error','Tournament not found'));
 END IF;
 IF v_tour.club_id IS NULL THEN
  RETURN jsonb_build_object('status',400,'body',jsonb_build_object('error','Tournament has no club'));
 END IF;
 BEGIN
  SELECT jsonb_agg(jsonb_build_object('enabled',enabled)) INTO v_setting
   FROM public.cashier_tour_settings WHERE club_id=v_tour.club_id;
  IF jsonb_array_length(v_setting)>1 THEN RAISE EXCEPTION 'ambiguous_configuration'; END IF;
 EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('status',503,'body',jsonb_build_object('error','Payment configuration unavailable'));
 END;
 IF (v_setting->0->>'enabled')::boolean IS TRUE THEN
  BEGIN
   SELECT jsonb_agg(jsonb_build_object('master_account_number',master_account_number)) INTO v_config
    FROM public.club_payment_config WHERE club_id=v_tour.club_id AND is_active AND api_token_vault_key IS NOT NULL;
   IF jsonb_array_length(v_config)>1 THEN RAISE EXCEPTION 'ambiguous_configuration'; END IF;
  EXCEPTION WHEN OTHERS THEN
   RETURN jsonb_build_object('status',503,'body',jsonb_build_object('error','Payment configuration unavailable'));
  END;
  IF v_config IS NOT NULL THEN
   IF coalesce(v_config->0->>'master_account_number','')='' THEN
    RETURN jsonb_build_object('status',503,'body',jsonb_build_object('error','SePay master account missing'));
   END IF;
   BEGIN
    SELECT jsonb_agg(jsonb_build_object('id',id,'club_id',club_id,'bank_name',bank_name,
     'account_number',account_number,'account_holder',account_holder,'qr_code_url',qr_code_url)) INTO v_accounts
     FROM public.platform_bank_accounts WHERE is_active AND account_number=v_config->0->>'master_account_number';
   EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('status',503,'body',jsonb_build_object('error','Club bank account unavailable'));
   END;
   IF coalesce(jsonb_array_length(v_accounts),0)<>1 OR (v_accounts->0->>'club_id')::uuid IS DISTINCT FROM v_tour.club_id THEN
    RETURN jsonb_build_object('status',503,'body',jsonb_build_object('error','SePay master account is not exclusive to this club'));
   END IF;
   v_bank:=v_accounts->0;
  END IF;
  -- Enabled cashier without SePay accepts counter payment, with no fallback.
 ELSE
  BEGIN
   SELECT jsonb_build_object('id',id,'bank_name',bank_name,'account_number',account_number,
    'account_holder',account_holder,'qr_code_url',qr_code_url) INTO v_bank
    FROM public.platform_bank_accounts WHERE is_active AND club_id=v_tour.club_id ORDER BY created_at DESC LIMIT 1;
   IF v_bank IS NULL THEN
    SELECT jsonb_build_object('id',id,'bank_name',bank_name,'account_number',account_number,
     'account_holder',account_holder,'qr_code_url',qr_code_url) INTO v_bank
     FROM public.platform_bank_accounts WHERE is_active AND club_id IS NULL ORDER BY created_at DESC LIMIT 1;
   END IF;
  EXCEPTION WHEN OTHERS THEN
   RETURN jsonb_build_object('status',503,'body',jsonb_build_object('error','Bank configuration unavailable'));
  END;
  IF v_bank IS NULL THEN
   RETURN jsonb_build_object('status',400,'body',jsonb_build_object('error','CLB chưa cấu hình tài khoản nhận tiền.'));
  END IF;
 END IF;
 IF v_bank IS NOT NULL THEN
  BEGIN
   SELECT bank_bin INTO v_bin FROM public.platform_bank_accounts WHERE id=(v_bank->>'id')::uuid;
  EXCEPTION WHEN OTHERS THEN v_bin:=NULL;
  END;
 END IF;
 BEGIN
  v_registration:=public.cashier_create_app_reentry_v1(p_tournament_id,p_player_id);
 EXCEPTION
  WHEN check_violation THEN
   IF SQLERRM='multi_day_rules_required_before_registration' THEN
    RETURN jsonb_build_object('status',409,'body',jsonb_build_object('error','Main Event chưa khóa rules. Vui lòng liên hệ Floor trước khi đăng ký.','code','MAIN_EVENT_RULES_NOT_READY'));
   END IF;
   RETURN jsonb_build_object('status',503,'body',jsonb_build_object('error','Re-entry unavailable'));
  WHEN OTHERS THEN
   RETURN jsonb_build_object('status',503,'body',jsonb_build_object('error','Re-entry unavailable'));
 END;
 IF (v_registration->>'ok')::boolean IS DISTINCT FROM TRUE THEN
  RETURN jsonb_build_object('status',400,'body',jsonb_build_object('error',coalesce(v_registration->>'error','Re-entry unavailable')));
 END IF;
 v_snapshot:=v_registration->'price_snapshot';
 -- Return a mapped failure rather than raising after a successful canonical
 -- call: the existing registration must survive an invalid stored snapshot.
 FOREACH v_key IN ARRAY ARRAY['total_pay','buy_in','rake','service_fee','platform_fee'] LOOP
  v_amount:=CASE WHEN v_key='total_pay' THEN v_registration->v_key ELSE v_snapshot->v_key END;
  IF jsonb_typeof(v_amount) IS DISTINCT FROM 'number' THEN
   RETURN jsonb_build_object('status',503,'body',jsonb_build_object('error','Re-entry price unavailable'));
  END IF;
  IF (v_amount::text)::numeric<0 OR (v_amount::text)::numeric>9007199254740991
   OR trunc((v_amount::text)::numeric)<>(v_amount::text)::numeric THEN
   RETURN jsonb_build_object('status',503,'body',jsonb_build_object('error','Re-entry price unavailable'));
  END IF;
 END LOOP;
 v_response:=jsonb_build_object('success',true,'reentry',true,
  'already_registered',v_registration->'already_registered','registration_id',v_registration->'registration_id',
  'status',v_registration->'status','reference_code',v_registration->'reference_code','total_pay',v_registration->'total_pay',
  'breakdown',jsonb_build_object('buy_in',v_snapshot->'buy_in','club_fee',v_snapshot->'rake',
   'service_fee',v_snapshot->'service_fee','platform_fee',v_snapshot->'platform_fee'),
  'bank_name',v_bank->'bank_name','account_number',v_bank->'account_number','account_holder',v_bank->'account_holder',
  'qr_code_url',v_bank->'qr_code_url','bank_bin',v_bin,'transfer_proof_url',v_registration->'transfer_proof_image_url',
  'transfer_proof_submitted',v_registration->'transfer_proof_submitted','committed_at',v_registration->'committed_at',
  'free_rake_applied',false,'savings',0);
 IF (v_registration->>'already_registered')::boolean IS DISTINCT FROM TRUE THEN
  BEGIN
   INSERT INTO public.notifications(user_id,type,title,body,data) VALUES(p_player_id,'registration_confirmed','Yêu cầu mua lại giải',
    'Bạn đã tạo yêu cầu mua lại giải "'||v_tour.name||'". '||CASE WHEN v_bank IS NOT NULL
     THEN 'Vui lòng chuyển khoản để vào lại bàn.' ELSE 'Vui lòng thanh toán tại quầy để vào lại bàn.' END,
    jsonb_build_object('tournament_id',p_tournament_id,'club_id',v_tour.club_id,'reentry',true));
  EXCEPTION WHEN OTHERS OR query_canceled THEN
   -- Optional notification failures must not roll back canonical registration.
   NULL;
  END;
 END IF;
 RETURN jsonb_build_object('status',200,'body',v_response);
END;
$$;
ALTER FUNCTION public.cashier_app_reentry_transport_v1(uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cashier_app_reentry_transport_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cashier_app_reentry_transport_v1(uuid,uuid) TO service_role;
COMMIT;
