import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migrationsDir = resolve(root, "supabase/migrations");
const migrationName = "20270110000005_tracker_hand_completion_projection_sync.sql";
const migrationArchivePath = resolve(
  root,
  "supabase/migration-archive/historical-never-replay",
  migrationName,
);
const migration = readFileSync(migrationArchivePath, "utf8");
const edge = readFileSync(
  resolve(root, "supabase/functions/tournament-live-update/index.ts"),
  "utf8",
);
const sourceFiles = [
  edge,
  readFileSync(
    resolve(root, "src/components/cashier/tournament-live/handinput/handInputEdge.ts"),
    "utf8",
  ),
];

describe("Tracker hand completion projection migration", () => {
  it("uses the unique next repository migration version", () => {
    const versions = readdirSync(migrationsDir)
      .map((name) => /^([0-9]{14})_/.exec(name)?.[1])
      .filter((version): version is string => Boolean(version));
    const version = migrationName.slice(0, 14);

    expect(versions.filter((candidate) => candidate === version)).toHaveLength(0);
    expect(existsSync(migrationArchivePath)).toBe(true);
    expect(Number(version)).toBeGreaterThan(Number("20270110000004"));
  });

  it("keeps the ten-argument record_hand contract and fails closed", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.record_hand(");
    expect(migration).toContain("p_created_by UUID DEFAULT NULL");
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("SET search_path = public");
    expect(migration).toContain("public.is_club_tracker(v_actor, v_club_id)");
    expect(migration).toContain("active_hand_not_found");
    expect(migration).toContain("player_snapshot_mismatch");
    expect(migration).toContain("chip_conservation_failed");
    expect(migration).toContain("stack_or_entry_projection_mismatch");
  });

  it("synchronizes all three stack projections atomically", () => {
    expect(migration).toContain("UPDATE public.tournament_seats");
    expect(migration).toContain("INSERT INTO public.tournament_chip_counts");
    expect(migration).toContain("UPDATE public.tournament_entries");
    expect(migration).toContain("current_stack = v_ending_stack");
    expect(migration).toContain("status = CASE WHEN v_is_eliminated THEN 'busted' ELSE 'seated' END");
    expect(migration).toContain("player_name = COALESCE(hp.player_name, v_seat.player_name)");
  });

  it("adds re-entry chip-count and aggregate projections without changing draw behavior", () => {
    expect(migration.match(/CREATE OR REPLACE FUNCTION public\._assign_reentry_seat\(/g)).toHaveLength(1);
    expect(migration.match(/h\.table_id IN \(tt\.id, tt\.table_id\)/g)).toHaveLength(2);
    expect(migration).toContain("'re_entry', 'initial', p_actor_user_id");
    expect(migration).toContain("players_remaining = (");
    expect(migration).toContain("round(avg(s.chip_count))");
  });

  it("gates result finalization on explicit registration closure", () => {
    expect(migration).toContain("t.registration_closed_at");
    expect(migration).toContain("v_registration_closed_at IS NULL");
    expect(migration).toContain("PERFORM public.finalize_tournament_results(NEW.tournament_id)");
  });

  it("revokes both public settlement surfaces from browser roles", () => {
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.record_hand\([\s\S]*?INTEGER, UUID[\s\S]*?FROM PUBLIC, anon, service_role;/,
    );
    expect(migration).toMatch(
      /to_regprocedure\([\s\S]*?record_hand\(uuid,uuid,integer,timestamptz,jsonb,jsonb,jsonb\)[\s\S]*?IS NOT NULL/,
    );
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.record_hand(uuid,uuid,integer,timestamptz,jsonb,jsonb,jsonb) FROM PUBLIC, anon, authenticated",
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.record_hand\([\s\S]*?TO authenticated, postgres;/,
    );
  });

  it("has no browser source consumer of either retired bare overload", () => {
    expect(sourceFiles.join("\n").match(/rpc\(["']record_hand["']/g)).toBeNull();
    expect(edge).toContain('"record_tracker_manual_hand_v1"');
    expect(edge).toContain("intent.actor_id !== user.id");
    expect(edge).toContain("p_intent: intent");
    expect(edge).toContain('validationError("MANUAL_FINISH_CONTEXT_REQUIRED"');
  });

  it("is source-only and keeps risky flags and deployment commands out", () => {
    expect(migration).not.toMatch(/trackerUnifiedOpsFlow\s*[:=]\s*true/i);
    expect(migration).not.toMatch(/cashierReentry\s*[:=]\s*true/i);
    expect(migration).not.toMatch(/supabase\s+(db\s+push|migration\s+repair)/i);
    expect(migration).not.toMatch(/functions\s+deploy|vercel\s+--prod/i);
  });
});
