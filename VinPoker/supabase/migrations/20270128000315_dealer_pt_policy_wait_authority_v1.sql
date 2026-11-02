-- Recheck policy setter after advisory wait and club row lock, before policy replay or writes.
CREATE OR REPLACE FUNCTION public.set_dealer_pt_wage_accrual_policy(p_club_id uuid, p_standby_accrual_enabled boolean, p_effective_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor          uuid := auth.uid();
  v_existing       public.dealer_pt_wage_accrual_policies%rowtype;
  v_policy         public.dealer_pt_wage_accrual_policies%rowtype;
  v_now            timestamptz := now();
  v_effective_from timestamptz;
  v_reason         text := nullif(btrim(p_reason), '');
  v_action         text;
begin
  if v_actor is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_standby_accrual_enabled is null then
    raise exception 'standby accrual enabled is required' using errcode = '22023';
  end if;
  if v_reason is null or char_length(v_reason) > 500 then
    raise exception 'a reason of at most 500 characters is required' using errcode = '22023';
  end if;
  if p_effective_from is not null and p_effective_from is distinct from v_now then
    raise exception 'effective from is assigned by the server' using errcode = '22023';
  end if;
  if not (
    public.has_role(v_actor, 'super_admin'::app_role)
    or exists (select 1 from public.clubs c where c.id = p_club_id and c.owner_id = v_actor)
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('dealer_pt_wage_policy:' || p_club_id::text));
  perform 1 from public.clubs where id = p_club_id for update;
  if not found then
    raise exception 'club not found' using errcode = 'P0002';
  end if;

  -- Club row stays locked; ownership may have changed while waiting.
  if not (
    public.has_role(v_actor, 'super_admin'::app_role)
    or exists (select 1 from public.clubs c where c.id = p_club_id and c.owner_id = v_actor)
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_existing
  from public.dealer_pt_wage_accrual_policies
  where club_id = p_club_id
  for update;

  -- A normal client request never supplies a timestamp. Repeating an already
  -- enabled forward policy therefore cannot slide its boundary. The global
  -- RPC passes the exact transaction timestamp only when it intentionally
  -- rebases a current club during the audited all-club activation.
  if found
     and p_standby_accrual_enabled
     and p_effective_from is null
     and v_existing.standby_accrual_enabled
     and v_existing.effective_from is not null then
    return jsonb_build_object(
      'policy_id', v_existing.id,
      'idempotent', true,
      'club_id', p_club_id,
      'standby_accrual_enabled', v_existing.standby_accrual_enabled,
      'effective_from', v_existing.effective_from,
      'updated_at', v_existing.updated_at
    );
  end if;

  v_effective_from := case
    when p_standby_accrual_enabled then coalesce(p_effective_from, v_now)
    else null
  end;

  if found
     and v_existing.standby_accrual_enabled = p_standby_accrual_enabled
     and v_existing.effective_from is not distinct from v_effective_from then
    return jsonb_build_object(
      'policy_id', v_existing.id,
      'idempotent', true,
      'club_id', p_club_id,
      'standby_accrual_enabled', v_existing.standby_accrual_enabled,
      'effective_from', v_existing.effective_from,
      'updated_at', v_existing.updated_at
    );
  end if;

  insert into public.dealer_pt_wage_accrual_policies as p (
    club_id, standby_accrual_enabled, effective_from, updated_at, updated_by, reason
  ) values (
    p_club_id,
    p_standby_accrual_enabled,
    v_effective_from,
    v_now,
    v_actor,
    v_reason
  )
  on conflict (club_id) do update
  set standby_accrual_enabled = excluded.standby_accrual_enabled,
      effective_from = excluded.effective_from,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by,
      reason = excluded.reason
  returning * into v_policy;

  v_action := case when v_existing.id is null then 'INSERT' else 'UPDATE' end;
  insert into public.payroll_audit_log (
    table_name, record_id, club_id, action, old_values, new_values, changed_by, reason
  ) values (
    'dealer_pt_wage_accrual_policies',
    v_policy.id,
    p_club_id,
    v_action,
    case when v_existing.id is null then null else jsonb_build_object(
      'standby_accrual_enabled', v_existing.standby_accrual_enabled,
      'effective_from', v_existing.effective_from
    ) end,
    jsonb_build_object(
      'standby_accrual_enabled', v_policy.standby_accrual_enabled,
      'effective_from', v_policy.effective_from
    ),
    v_actor,
    v_reason
  );

  return jsonb_build_object(
    'policy_id', v_policy.id,
    'idempotent', false,
    'club_id', p_club_id,
    'standby_accrual_enabled', v_policy.standby_accrual_enabled,
    'effective_from', v_policy.effective_from,
    'updated_at', v_policy.updated_at
  );
end;
$function$
;
