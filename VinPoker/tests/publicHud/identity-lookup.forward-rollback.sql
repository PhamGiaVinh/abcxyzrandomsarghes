-- Forward recovery changes no source, counters, public function or ACL.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    WHERE i.indexrelid=to_regclass('tracker_analytics_v1.hud_identity_latest')
      AND i.indisvalid AND i.indisready AND NOT i.indisunique
      AND pg_get_indexdef(i.indexrelid)=
        'CREATE INDEX hud_identity_latest ON tracker_analytics_v1.hand_contributions USING btree (player_id, tournament_id, played_at DESC NULLS LAST, hand_id DESC)'
  ) THEN RAISE EXCEPTION 'HUD identity index recovery catalog drift'; END IF;
END $$;
DROP INDEX tracker_analytics_v1.hud_identity_latest;
COMMIT;
