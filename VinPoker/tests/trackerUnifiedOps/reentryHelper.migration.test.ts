import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";

const migrationsDir = resolve(process.cwd(), "supabase/migrations");
const migrationName = "20270109000001_tracker_pr2a_reentry_helper_canonicalization.sql";
const archivePath = `supabase/migration-archive/superseded/replaced/${migrationName}`;
const archiveFile = resolve(process.cwd(), archivePath);
const migration = readFileSync(archiveFile, "utf8");
const manifest = JSON.parse(readFileSync(resolve(process.cwd(), "supabase/migration-archive/floor-v3-catalog-reconciliation.manifest.json"), "utf8"));
const sourceEntryMigration = readFileSync(
  resolve(process.cwd(), "supabase/migration-archive/historical-never-replay/20261122000000_treg_source_entry_id.sql"),
  "utf8",
);

describe("archived Tracker PR2A re-entry helper migration contract", () => {
  it("retains its unique historical version without restoring it to active replay", () => {
    const versions = readdirSync(migrationsDir)
      .map((name) => /^([0-9]{14})_/.exec(name)?.[1])
      .filter((version): version is string => Boolean(version));
    const version = migrationName.slice(0, 14);

    expect(versions.filter((candidate) => candidate === version)).toHaveLength(0);
    const entry = manifest.historicalSources.find((item: {filename: string}) => item.filename === migrationName);
    expect(entry).toMatchObject({superseded: true, bucket: "superseded/replaced", archivePath});
    // Archive manifest hashes use LF; Windows checkout may materialize CRLF.
    expect(createHash("sha256").update(migration.replace(/\r\n/g, "\n")).digest("hex")).toBe(entry.sha256);
    expect(Number(version)).toBeGreaterThan(Number("20270109000000"));
  });

  it("owns the helper and preserves the wrapper boundary", () => {
    expect(migration.match(/CREATE OR REPLACE FUNCTION public\._assign_reentry_seat\(/g)).toHaveLength(1);
    expect(migration.match(/CREATE OR REPLACE FUNCTION public\.restore_busted_player_to_seat\(/g)).toHaveLength(1);
    expect(migration).not.toContain("CREATE OR REPLACE FUNCTION public.reenter_tournament_player(");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public._assign_reentry_seat");
    expect(migration).toContain("FROM PUBLIC, anon, authenticated, service_role");
  });

  it("checks both canonical and physical table IDs before re-entry writes", () => {
    expect(migration.match(/h\.table_id IN \(tt\.id, tt\.table_id\)/g)).toHaveLength(2);
    expect(migration).toContain("h.status = 'in_progress'");
    expect(migration).toContain("COALESCE(h.is_voided, false) = false");
    expect(migration).toContain("h.table_id IN (v_to_tt.id, v_to_tt.table_id)");
    expect(migration).toContain("error', 'table_has_active_hand'");
  });

  it("keeps source-entry uniqueness in the preceding schema migration", () => {
    expect(sourceEntryMigration).toContain("ADD COLUMN IF NOT EXISTS source_entry_id uuid");
    expect(sourceEntryMigration).toContain("uniq_treg_active_initial");
    expect(sourceEntryMigration).toContain("uniq_treg_pending_reentry_per_entry");
    expect(sourceEntryMigration).toContain("WHERE status IN ('pending', 'confirmed') AND source_entry_id IS NOT NULL");
  });

  it("does not introduce a flag-on or remote operation", () => {
    expect(migration).not.toMatch(/trackerUnifiedOpsFlow\s*[:=]\s*true/i);
    expect(migration).not.toMatch(/supabase\s+(db\s+push|migration\s+repair)/i);
    expect(migration).not.toMatch(/functions\s+deploy|vercel\s+--prod/i);
  });
});
