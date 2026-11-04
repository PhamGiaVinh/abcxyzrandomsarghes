-- The public_context fallback intentionally spans algorithm versions. Its
-- existing version-prefixed history index cannot provide this ordering.
-- Preserve the public reader, membership gate and source identity exactly;
-- only add an ordered access path on the private, derived contribution table.
-- Apply with the reviewed HUD release while its dispatchers are paused.
-- Rollback: tests/publicHud/identity-lookup.forward-rollback.sql (index only).
BEGIN;
CREATE INDEX IF NOT EXISTS hud_identity_latest
  ON tracker_analytics_v1.hand_contributions
  (player_id,tournament_id,played_at DESC NULLS LAST,hand_id DESC);
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
    WHERE i.indexrelid='tracker_analytics_v1.hud_identity_latest'::regclass
      AND i.indrelid='tracker_analytics_v1.hand_contributions'::regclass
      AND i.indisvalid AND i.indisready AND NOT i.indisunique
      AND pg_get_indexdef(i.indexrelid)=
        'CREATE INDEX hud_identity_latest ON tracker_analytics_v1.hand_contributions USING btree (player_id, tournament_id, played_at DESC NULLS LAST, hand_id DESC)'
  ) THEN RAISE EXCEPTION 'HUD identity index catalog drift'; END IF;
END $$;
COMMIT;
