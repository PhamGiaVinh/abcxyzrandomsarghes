CREATE OR REPLACE FUNCTION public.dispatch_public_spectator_projection_v2()
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_url text; v_secret text; v_request_id bigint; BEGIN
  IF NOT EXISTS(SELECT 1 FROM spectator_projection_v2.work_groups w WHERE w.available_at<=clock_timestamp() AND (w.claimed_until IS NULL OR w.claimed_until<clock_timestamp())) AND NOT EXISTS(SELECT 1 FROM spectator_projection_v2.broadcast_pending_v1) AND NOT EXISTS(SELECT 1 FROM spectator_projection_v2.deferred_generations_v1) AND NOT EXISTS(SELECT 1 FROM tracker_analytics_v1.revocation_broadcast_v1) THEN RETURN NULL; END IF;
  v_url:=COALESCE(NULLIF(current_setting('app.supabase_url',true),''),'https://orlesggcjamwuknxwcpk.supabase.co');
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name='PUBLIC_SPECTATOR_WORKER_SECRET';
  IF v_secret IS NULL OR btrim(v_secret)='' THEN RAISE LOG 'spectator v2 dispatcher skipped: secret missing'; RETURN NULL; END IF;
  SELECT net.http_post(url:=v_url||'/functions/v1/public-spectator-projector-v2',
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_secret),
    body:='{}'::jsonb,timeout_milliseconds:=8000) INTO v_request_id;
  RETURN v_request_id;
EXCEPTION WHEN OTHERS THEN RAISE LOG 'spectator v2 dispatcher failed: %',SQLERRM; RETURN NULL;
END; $function$

