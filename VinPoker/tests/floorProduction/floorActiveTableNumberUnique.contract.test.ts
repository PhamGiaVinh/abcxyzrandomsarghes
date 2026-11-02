import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migration-archive/historical-never-replay/20270105000000_floor_active_table_number_unique.sql"),
  "utf8",
);

describe("Floor active table-number uniqueness migration", () => {
  it("keeps closed history while failing closed on duplicate active table numbers", () => {
    expect(migration).toContain("WHERE status = 'active'");
    expect(migration).toContain("AND table_number IS NOT NULL");
    expect(migration).toContain("CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS tournament_tables_one_active_number_per_tournament");
    expect(migration).toContain("floor_active_table_number_duplicate");
    const executableSql = migration.replace(/--[^\r\n]*/g, "");
    expect(executableSql).not.toMatch(/\bDELETE\b|\bTRUNCATE\b|\bDROP\s+TABLE\b/i);
  });
});
