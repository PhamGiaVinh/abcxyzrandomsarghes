-- Pending only. Apply after verifying the invitation RPC baseline.
-- Rollback: hide Dealer Control invitation entrypoints, keep ledger and memberships for review.
-- Owner-issued Dealer Control invites can activate for at most one hour after email delivery.
BEGIN;

ALTER TABLE public.club_operator_invites
  DROP CONSTRAINT IF EXISTS club_operator_invites_operator_role_check,
  ADD CONSTRAINT club_operator_invites_operator_role_check
    CHECK (operator_role IN ('floor', 'cashier', 'dealer_control'));
ALTER TABLE public.club_operator_invite_events
  DROP CONSTRAINT IF EXISTS club_operator_invite_events_operator_role_check,
  ADD CONSTRAINT club_operator_invite_events_operator_role_check
    CHECK (operator_role IN ('floor', 'cashier', 'dealer_control'));

CREATE OR REPLACE FUNCTION public.apply_club_operator_invite(
  p_actor_id uuid,
  p_club_id uuid,
  p_auth_user_id uuid,
  p_email_normalized text,
  p_operator_role text,
  p_invitation_sent boolean,
  p_delivery_outcome text DEFAULT 'not_required'
)
RETURNS TABLE(invite_id uuid, outcome text, invite_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_owner_id uuid;
  v_invite public.club_operator_invites%ROWTYPE;
  v_status text;
  v_action text;
  v_membership_exists boolean;
  v_auth_email text;
  v_auth_confirmed_at timestamptz;
BEGIN
  IF p_operator_role IS NULL OR p_operator_role NOT IN ('floor', 'cashier', 'dealer_control') THEN
    RAISE EXCEPTION 'INVALID_OPERATOR_ROLE' USING ERRCODE = '22023';
  END IF;
  IF p_email_normalized IS NULL OR p_email_normalized <> lower(btrim(p_email_normalized)) THEN
    RAISE EXCEPTION 'INVALID_OPERATOR_EMAIL' USING ERRCODE = '22023';
  END IF;
  IF p_delivery_outcome NOT IN ('sent', 'resent', 'not_required') THEN
    RAISE EXCEPTION 'INVALID_DELIVERY_OUTCOME' USING ERRCODE = '22023';
  END IF;
  SELECT lower(btrim(email)), email_confirmed_at
  INTO v_auth_email, v_auth_confirmed_at
  FROM auth.users
  WHERE id = p_auth_user_id;
  IF NOT FOUND OR v_auth_email IS DISTINCT FROM p_email_normalized THEN
    RAISE EXCEPTION 'AUTH_USER_EMAIL_MISMATCH' USING ERRCODE = '42501';
  END IF;
  IF NOT p_invitation_sent AND v_auth_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'AUTH_USER_UNCONFIRMED' USING ERRCODE = '42501';
  END IF;

  -- Canonical order for all mutations: club, invitation, then membership.
  SELECT owner_id INTO v_owner_id
  FROM public.clubs
  WHERE id = p_club_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CLUB_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF v_owner_id IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'CLUB_OWNER_REQUIRED' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_invite
  FROM public.club_operator_invites
  WHERE club_id = p_club_id
    AND email_normalized = p_email_normalized
    AND operator_role = p_operator_role
    AND status IN ('pending', 'active')
  FOR UPDATE;

  IF v_invite.id IS NOT NULL
    AND v_invite.auth_user_id IS NOT NULL
    AND v_invite.auth_user_id IS DISTINCT FROM p_auth_user_id THEN
    RAISE EXCEPTION 'INVITE_AUTH_USER_MISMATCH' USING ERRCODE = '42501';
  END IF;

  -- Retrying an already completed grant is a genuine no-op, including events.
  v_status := CASE WHEN p_invitation_sent THEN 'pending' ELSE 'active' END;
  IF v_status = 'active' THEN
    IF p_operator_role = 'floor' THEN
      SELECT EXISTS (
        SELECT 1 FROM public.club_floors
        WHERE club_id = p_club_id AND user_id = p_auth_user_id
      ) INTO v_membership_exists;
    ELSIF p_operator_role = 'dealer_control' THEN
      SELECT EXISTS (
        SELECT 1 FROM public.club_dealer_controls
        WHERE club_id = p_club_id AND user_id = p_auth_user_id
      ) INTO v_membership_exists;
    ELSE
      SELECT EXISTS (
        SELECT 1 FROM public.club_cashiers
        WHERE club_id = p_club_id AND user_id = p_auth_user_id
      ) INTO v_membership_exists;
    END IF;
    IF v_invite.id IS NOT NULL AND v_invite.status = 'active'
      AND v_invite.auth_user_id = p_auth_user_id
      AND v_membership_exists THEN
      RETURN QUERY SELECT v_invite.id, 'ALREADY_ACTIVE'::text, v_invite.status;
      RETURN;
    END IF;
  END IF;

  -- A mail-backed invite is pending only. Membership is created exclusively by
  -- accept_my_club_operator_invites() after this Auth user confirms their email.
  IF v_status = 'active' THEN
    IF p_operator_role = 'floor' THEN
      INSERT INTO public.club_floors (club_id, user_id, granted_by)
      VALUES (p_club_id, p_auth_user_id, p_actor_id)
      ON CONFLICT (club_id, user_id) DO UPDATE SET granted_by = EXCLUDED.granted_by;
    ELSIF p_operator_role = 'dealer_control' THEN
      INSERT INTO public.club_dealer_controls (club_id, user_id, granted_by)
      VALUES (p_club_id, p_auth_user_id, p_actor_id)
      ON CONFLICT (club_id, user_id) DO NOTHING;
    ELSE
      INSERT INTO public.club_cashiers (club_id, user_id, granted_by)
      VALUES (p_club_id, p_auth_user_id, p_actor_id)
      ON CONFLICT (club_id, user_id) DO UPDATE SET granted_by = EXCLUDED.granted_by;
    END IF;
  END IF;

  IF v_invite.id IS NULL THEN
    INSERT INTO public.club_operator_invites (
      club_id, email_normalized, operator_role, auth_user_id, invited_by,
      status, invitation_sent_at, last_delivery_outcome, accepted_at, updated_at
    ) VALUES (
      p_club_id, p_email_normalized, p_operator_role, p_auth_user_id, p_actor_id,
      v_status,
      CASE WHEN p_invitation_sent THEN now() ELSE NULL END,
      p_delivery_outcome,
      CASE WHEN v_status = 'active' THEN now() ELSE NULL END,
      now()
    )
    RETURNING * INTO v_invite;
  ELSE
    UPDATE public.club_operator_invites
    SET auth_user_id = p_auth_user_id,
        invited_by = p_actor_id,
        status = v_status,
        invitation_sent_at = CASE WHEN p_invitation_sent THEN now() ELSE invitation_sent_at END,
        last_delivery_outcome = p_delivery_outcome,
        accepted_at = CASE WHEN v_status = 'active' THEN coalesce(accepted_at, now()) ELSE NULL END,
        revoked_at = NULL,
        revoked_by = NULL,
        updated_at = now()
    WHERE id = v_invite.id
    RETURNING * INTO v_invite;
  END IF;

  v_action := CASE
    WHEN p_delivery_outcome = 'resent' THEN 'resent'
    WHEN p_invitation_sent THEN 'invited'
    ELSE 'granted_existing'
  END;
  INSERT INTO public.club_operator_invite_events (
    invite_id, club_id, auth_user_id, actor_id, event_type, operator_role, detail
  )
  VALUES (
    v_invite.id, p_club_id, p_auth_user_id, p_actor_id, v_action, p_operator_role,
    jsonb_build_object('status', v_invite.status)
  );

  RETURN QUERY SELECT
    v_invite.id,
    CASE
      WHEN p_delivery_outcome = 'resent' THEN 'RESENT'
      WHEN p_invitation_sent THEN 'INVITED'
      ELSE 'GRANTED_EXISTING'
    END,
    v_invite.status;
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_club_operator_invite(
  p_actor_id uuid,
  p_invite_id uuid
)
RETURNS TABLE(invite_id uuid, outcome text, invite_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_club_id uuid;
  v_owner_id uuid;
  v_invite public.club_operator_invites%ROWTYPE;
BEGIN
  -- Read the club id, then take the canonical club -> invitation locks.
  SELECT club_id INTO v_club_id
  FROM public.club_operator_invites
  WHERE id = p_invite_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVITE_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  SELECT owner_id INTO v_owner_id
  FROM public.clubs
  WHERE id = v_club_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CLUB_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF v_owner_id IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'CLUB_OWNER_REQUIRED' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_invite
  FROM public.club_operator_invites
  WHERE id = p_invite_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVITE_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF v_invite.status = 'revoked' THEN
    RETURN QUERY SELECT v_invite.id, 'ALREADY_REVOKED'::text, v_invite.status;
    RETURN;
  END IF;

  -- Pending invitations have no membership. An active invite's membership is
  -- removed in the same transaction as its revocation.
  IF v_invite.status = 'active' AND v_invite.auth_user_id IS NOT NULL THEN
    IF v_invite.operator_role = 'floor' THEN
      DELETE FROM public.club_floors
      WHERE club_id = v_invite.club_id AND user_id = v_invite.auth_user_id;
    ELSIF v_invite.operator_role = 'dealer_control' THEN
      DELETE FROM public.club_dealer_controls
      WHERE club_id = v_invite.club_id AND user_id = v_invite.auth_user_id;
    ELSE
      DELETE FROM public.club_cashiers
      WHERE club_id = v_invite.club_id AND user_id = v_invite.auth_user_id;
    END IF;
  END IF;
  UPDATE public.club_operator_invites
  SET status = 'revoked', revoked_at = now(), revoked_by = p_actor_id, updated_at = now()
  WHERE id = v_invite.id
  RETURNING * INTO v_invite;
  INSERT INTO public.club_operator_invite_events (
    invite_id, club_id, auth_user_id, actor_id, event_type, operator_role, detail
  )
  VALUES (
    v_invite.id, v_invite.club_id, v_invite.auth_user_id, p_actor_id, 'revoked',
    v_invite.operator_role, jsonb_build_object('status', v_invite.status)
  );
  RETURN QUERY SELECT v_invite.id, 'REVOKED'::text, v_invite.status;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_club_operator_invite(uuid, uuid, uuid, text, text, boolean, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revoke_club_operator_invite(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_club_operator_invite(uuid, uuid, uuid, text, text, boolean, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_club_operator_invite(uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.accept_my_club_operator_invites()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_email text;
  v_confirmed_at timestamptz;
  v_candidate record;
  v_invite public.club_operator_invites%ROWTYPE;
  v_owner_id uuid;
  v_accepted_count integer := 0;
  v_already_active_count integer := 0;
  v_invite_ids jsonb := '[]'::jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501';
  END IF;

  SELECT lower(btrim(email)), email_confirmed_at
  INTO v_email, v_confirmed_at
  FROM auth.users
  WHERE id = v_actor;
  IF NOT FOUND OR v_email IS NULL OR v_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'EMAIL_CONFIRMATION_REQUIRED' USING ERRCODE = '42501';
  END IF;

  -- Candidate enumeration is deterministic. Each iteration then takes the
  -- canonical lock order club -> invitation -> membership mutation.
  FOR v_candidate IN
    SELECT id, club_id
    FROM public.club_operator_invites
    WHERE auth_user_id = v_actor
      AND email_normalized = v_email
      AND status IN ('pending', 'active')
    ORDER BY club_id, id
  LOOP
    SELECT owner_id INTO v_owner_id
    FROM public.clubs
    WHERE id = v_candidate.club_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'CLUB_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;

    SELECT * INTO v_invite
    FROM public.club_operator_invites
    WHERE id = v_candidate.id
    FOR UPDATE;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;
    IF v_invite.status = 'active' THEN
      v_already_active_count := v_already_active_count + 1;
      CONTINUE;
    END IF;
    -- A simultaneous owner revocation may have won the invitation lock first.
    IF v_invite.status <> 'pending' THEN
      CONTINUE;
    END IF;
    IF v_invite.operator_role = 'dealer_control'
      AND (v_invite.invited_by IS DISTINCT FROM v_owner_id
        OR v_invite.invitation_sent_at IS NULL
        OR v_invite.invitation_sent_at + interval '1 hour' <= clock_timestamp()) THEN
      CONTINUE;
    END IF;
    IF v_invite.auth_user_id IS DISTINCT FROM v_actor
      OR v_invite.email_normalized IS DISTINCT FROM v_email
      OR v_invite.operator_role NOT IN ('floor', 'cashier', 'dealer_control') THEN
      RAISE EXCEPTION 'INVITE_ACCEPTANCE_MISMATCH' USING ERRCODE = '42501';
    END IF;

    IF v_invite.operator_role = 'floor' THEN
      INSERT INTO public.club_floors (club_id, user_id, granted_by)
      VALUES (v_invite.club_id, v_actor, v_invite.invited_by)
      ON CONFLICT (club_id, user_id) DO NOTHING;
    ELSIF v_invite.operator_role = 'dealer_control' THEN
      INSERT INTO public.club_dealer_controls (club_id, user_id, granted_by)
      VALUES (v_invite.club_id, v_actor, v_invite.invited_by)
      ON CONFLICT (club_id, user_id) DO NOTHING;
    ELSE
      INSERT INTO public.club_cashiers (club_id, user_id, granted_by)
      VALUES (v_invite.club_id, v_actor, v_invite.invited_by)
      ON CONFLICT (club_id, user_id) DO NOTHING;
    END IF;

    UPDATE public.club_operator_invites
    SET status = 'active', accepted_at = now(), updated_at = now()
    WHERE id = v_invite.id AND status = 'pending';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'INVITE_ACCEPTANCE_CONFLICT' USING ERRCODE = '40001';
    END IF;
    INSERT INTO public.club_operator_invite_events (
      invite_id, club_id, auth_user_id, actor_id, event_type, operator_role, detail
    )
    VALUES (
      v_invite.id, v_invite.club_id, v_actor, v_actor, 'accepted',
      v_invite.operator_role, jsonb_build_object('status', 'active')
    );
    v_accepted_count := v_accepted_count + 1;
    v_invite_ids := v_invite_ids || jsonb_build_array(v_invite.id);
  END LOOP;

  IF v_accepted_count = 0 THEN
    SELECT count(*) INTO v_already_active_count
    FROM public.club_operator_invites
    WHERE auth_user_id = v_actor
      AND email_normalized = v_email
      AND status = 'active';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'acceptedCount', v_accepted_count,
    'alreadyActiveCount', v_already_active_count,
    'inviteIds', v_invite_ids
  );
END;
$$;

REVOKE ALL ON FUNCTION public.accept_my_club_operator_invites() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_my_club_operator_invites() TO authenticated;

COMMENT ON FUNCTION public.apply_club_operator_invite(uuid, uuid, uuid, text, text, boolean, text) IS
  'Service-only atomic operator invitation grant. Rechecks club ownership; no browser grant.';
COMMENT ON FUNCTION public.revoke_club_operator_invite(uuid, uuid) IS
  'Service-only atomic operator revocation. Rechecks club ownership.';
COMMENT ON FUNCTION public.accept_my_club_operator_invites() IS
  'Caller-bound acceptance of club operator invitations after confirmed Auth email. Dealer Control has a one-hour acceptance window.';

COMMIT;
