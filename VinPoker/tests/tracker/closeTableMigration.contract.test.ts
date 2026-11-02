import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = resolve(process.cwd(), "supabase/migrations");
const canonicalFilename = "20270106000003_close_table_canonical_contract.sql";
const archivePath = `supabase/migration-archive/superseded/replaced/${canonicalFilename}`;
const migrationPath = resolve(process.cwd(), archivePath);
const sql = readFileSync(migrationPath, "utf8");
const manifest = JSON.parse(readFileSync(resolve(process.cwd(), "supabase/migration-archive/floor-v3-catalog-reconciliation.manifest.json"), "utf8"));
const historicalHashes = {
  "20261240000000_floor_production_hardening.sql":
    "97f0b1784de774cb991e82ff9c854e24212cce54d7536e874382d1daff903aa3",
  "20270101000000_close_tournament_table_containment.sql":
    "c3f0199373a4d3429ce8da19b89961e06da238e5e63724a7f3b821f1752ce10a",
} as const;

function closeTableDefinitionsInFilenameOrder(): string[] {
  return readdirSync(migrationsDir)
    .filter((filename) => /^\d{14}_.*\.sql$/.test(filename))
    .sort()
    .filter((filename) => /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.close_tournament_table/i.test(
      readFileSync(resolve(migrationsDir, filename), "utf8"),
    ));
}

describe("archived close_tournament_table canonical migration contract", () => {
  it("keeps the live authorization and exact canonical signature", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.close_tournament_table(");
    expect(sql).toContain("p_tournament_table_id UUID");
    expect(sql).toContain("OR public.is_club_floor(v_actor, v_tour.club_id)");
    expect(sql).toContain("LEFT JOIN public.club_cashiers cc");
    expect(sql).toContain("c.owner_id = v_actor");
  });

  it("uses the shared table advisory key and blocks active hands before any move", () => {
    expect(sql).toContain("pg_advisory_xact_lock(");
    expect(sql).toContain("hashtext(v_tour.id::text)");
    expect(sql).toContain("hashtext(v_close.id::text)");
    const activeHand = sql.indexOf("'table_has_active_hand'");
    const movers = sql.indexOf("CREATE TEMP TABLE _floor_close_movers");
    expect(activeHand).toBeGreaterThan(-1);
    expect(movers).toBeGreaterThan(activeHand);
  });

  it("locks the source table, tournament, and active-seat snapshot before any write", () => {
    expect(sql).toMatch(/FROM public\.tournament_tables tt[\s\S]*?FOR UPDATE;/);
    expect(sql).toMatch(/FROM public\.tournaments[\s\S]*?FOR UPDATE;/);
    expect(sql).toMatch(/FROM public\.tournament_seats ts[\s\S]*?AND ts\.is_active = true[\s\S]*?FOR UPDATE;/);
  });

  it("fails closed for unlinked active seats before creating movers or mutating seats", () => {
    const unlinked = sql.indexOf("'UNLINKED_ACTIVE_SEATS'");
    const mismatch = sql.indexOf("'seat_entry_mismatch'");
    const movers = sql.indexOf("CREATE TEMP TABLE _floor_close_movers");
    expect(unlinked).toBeGreaterThan(-1);
    expect(mismatch).toBeGreaterThan(unlinked);
    expect(movers).toBeGreaterThan(mismatch);
    expect(sql).toContain("v_unlinked_active_seats > 0");
    expect(sql).toContain("'active_chip_total', v_active_chip_total");
  });

  it("preserves idempotent and empty-table receipts plus dealer release", () => {
    expect(sql).toContain("'already_closed', true");
    expect(sql).toContain("'already_closed', false");
    expect(sql).toContain("IF v_need = 0 THEN");
    expect(sql).toContain("PERFORM public.release_dealer_from_table(v_close.table_id)");
    expect(sql).not.toMatch(/UPDATE public\.tournament_seats\s+SET is_active = false\s+WHERE tournament_id/s);
  });

  it("uses mover-local identity and chip conservation before closing the table", () => {
    const closeTable = sql.lastIndexOf("UPDATE public.tournament_tables");
    expect(sql.indexOf("close_table_mover_conservation_failed")).toBeLessThan(closeTable);
    expect(sql.indexOf("close_table_mover_identity_failed")).toBeLessThan(closeTable);
    expect(sql.indexOf("close_table_duplicate_active_entry")).toBeLessThan(closeTable);
    expect(sql).toContain("source_table_not_empty");
    expect(sql).not.toContain("other_active_seat_changed");
    expect(sql).not.toContain("close_table_conservation_failed");
  });

  it("keeps the superseded definition intact outside active migration replay", () => {
    const definitions = closeTableDefinitionsInFilenameOrder();
    expect(definitions).not.toContain(canonicalFilename);
    const entry = manifest.historicalSources.find((item: {filename: string}) => item.filename === canonicalFilename);
    expect(entry).toMatchObject({superseded: true, bucket: "superseded/replaced", archivePath});
    // Archive manifest hashes use LF; Windows checkout may materialize CRLF.
    expect(createHash("sha256").update(sql.replace(/\r\n/g, "\n")).digest("hex")).toBe(entry.sha256);
    expect(sql).toContain("'UNLINKED_ACTIVE_SEATS'");
  });

  it("keeps owner, search_path, and live grant parity explicit", () => {
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("SET search_path = public");
    expect(sql).toContain(
      "ALTER FUNCTION public.close_tournament_table(UUID, TEXT, TEXT) OWNER TO postgres",
    );
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.close_tournament_table\(UUID, TEXT, TEXT\)\s+FROM PUBLIC, anon;/,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.close_tournament_table\(UUID, TEXT, TEXT\)\s+TO authenticated, service_role;/,
    );
  });

  it("does not edit either historical close-table migration", () => {
    for (const [filename, expected] of Object.entries(historicalHashes)) {
      const actual = createHash("sha256")
        .update(readFileSync(filename === "20270101000000_close_tournament_table_containment.sql"
          ? resolve(process.cwd(), "supabase/migration-archive/superseded/replaced", filename)
          : resolve(migrationsDir, filename)))
        .digest("hex");
      expect(actual).toBe(expected);
    }
  });
});
