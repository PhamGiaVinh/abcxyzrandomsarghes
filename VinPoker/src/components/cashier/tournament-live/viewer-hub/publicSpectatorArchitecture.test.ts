import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const migration = readFileSync(resolve(root, "supabase/pending-migrations/20270115000000_public_spectator_realtime_v2.sql"), "utf8");
const lastHandMigration = readFileSync(resolve(root, "supabase/migration-archive/remote-history/recovered-source/20260924070939_public_spectator_last_hand_history.sql"), "utf8");
const flags = readFileSync(resolve(root, "src/lib/featureFlags.ts"), "utf8");
const viewer = readFileSync(resolve(root, "src/components/cashier/tournament-live/TournamentLiveView.tsx"), "utf8");
const handFeed = readFileSync(resolve(root, "src/components/cashier/tournament-live/viewer-hub/useCompletedHandsFeed.ts"), "utf8");

describe("public spectator v2 boundary", () => {
  it('reads canonical public counts instead of stale tournament counters',()=>{
    expect(viewer.includes('"get_public_tournament_clock_summary"')).toBe(true);
    expect(viewer.includes('supabase.from("tournaments").select("players_remaining, average_stack")')).toBe(false);
  });
  it("enables the reviewed public viewer through explicit read RPC grants", () => {
    expect(flags).toMatch(/publicSpectatorRealtimeV2:\s*true/);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_public_tournament_viewer_snapshot_v2[\s\S]+TO anon, authenticated, service_role/);
    expect(migration).toMatch(/REVOKE ALL ON ALL TABLES IN SCHEMA spectator_projection_v2 FROM PUBLIC, anon, authenticated/);
  });

  it("publishes only hole cards recorded after a player shows them to the dealer", () => {
    expect(migration).toContain("'holeCards',COALESCE(hp.hole_cards,'[]'::jsonb)");
    expect(migration).toContain("'holeCardsPolicy','recorded'");
    expect(migration).toContain("get_public_tournament_hand_catalog_v2");
    expect(viewer).toMatch(/FEATURES\.publicSpectatorRealtimeV2[\s\S]+get_public_tournament_hand_v2/);
    expect(viewer).toContain("hole_cards: player.holeCards ?? []");
    expect(viewer).toMatch(/publicV2[\s\S]+public:tournament-viewer-v2/);
    expect(handFeed).toMatch(/FEATURES\.publicSpectatorRealtimeV2[\s\S]+get_public_tournament_hand_catalog_v2/);
  });

  it("guards request scope, fencing, and stale projection publication", () => {
    expect(migration).toContain("cardinality(p_table_ids)>16");
    expect(migration).toContain("FOR UPDATE NOWAIT");
    expect(migration).toContain("v_current IS DISTINCT FROM p_source_vector");
    expect(migration).toContain("w.claimed_until>clock_timestamp()");
    expect(migration).toContain("ORDER BY m.entity_key FOR UPDATE NOWAIT");
    expect(migration).toContain("min(w.oldest_pending_at)");
    expect(migration).not.toContain("min(w.available_at)");
    expect(migration).toContain("pg_current_xact_id()::text");
    expect(migration).toContain("jsonb_each_text(w.source_vector)");
    expect(migration).not.toContain("THEN 'infinity'::timestamptz");
  });

  it("invalidates blind and table-session changes and fails closed on stale identities", () => {
    expect(migration).toContain("spectator_v2_levels_ranking_dirty");
    expect(migration).toContain("spectator_v2_sessions_tables_dirty");
    expect(migration).toContain("spectator_v2_chip_counts_tables_dirty");
    expect(migration).toContain("th.table_session_id=tt.table_session_id");
    expect(migration).toContain("s.table_session_id=tt.table_session_id");
    expect(migration).toContain("th.status='in_progress'");
    expect(migration).toContain("FROM public.hand_players hp");
    expect(migration).toContain("A payout source change invalidates cached confirmation immediately");
  });

  it("keeps activation off and publishes BB and catalog metadata", () => {
    expect(migration).not.toMatch(/PERFORM\s+cron\.schedule/i);
    expect(migration).toContain("'bigBlind'");
    expect(migration).toContain("'{catalog}'");
    expect(flags).toContain("publicSpectatorLastHandHistory: isPublicSpectatorLastHandHistoryEnabled()");
    expect(flags).not.toMatch(/publicSpectatorLastHandHistory:\s*true/);
  });

  it("keeps winner and chip writes outside the projection", () => {
    expect(migration).not.toMatch(/UPDATE\s+public\.tournament_chip_counts/i);
    expect(migration).not.toMatch(/UPDATE\s+public\.tournament_entries/i);
    expect(migration).not.toMatch(/INSERT\s+INTO\s+public\.tournament_eliminations/i);
  });

  it("keeps last-completed and history scoped to a canonical table/session", () => {
    expect(lastHandMigration).toContain("get_public_tournament_table_live_or_last_hand_v2");
    expect(lastHandMigration).toContain("th.table_session_id = s.table_session_id");
    expect(lastHandMigration).toContain("'last_completed'");
    expect(lastHandMigration).toContain("ORDER BY h.created_at DESC, h.id DESC");
    expect(lastHandMigration).toContain("(h.created_at, h.id) < (p_before_created_at, p_before_id)");
    expect(lastHandMigration).toContain("get_public_tournament_table_hand_v2");
    expect(lastHandMigration).toContain("SET search_path = ''");
    expect(lastHandMigration).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_public_tournament_table_history_v2[\s\S]+TO anon, authenticated, service_role/);
  });
});
