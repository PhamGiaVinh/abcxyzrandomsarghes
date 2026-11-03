import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("operational tournament lists exclude tombstones", () => {
  for (const file of ["src/components/cashier/TournamentLivePanel.tsx", "src/components/floor/useFloorTournaments.ts", "src/hooks/useTournaments.ts", "src/ops/auth/OpsTournamentScopeGate.tsx"]) {
    it(file, () => {
      const source = readFileSync(file, "utf8");
      expect(source).toMatch(/\.from\("tournaments"\)[\s\S]*?\.is\("deleted_at", null\)/);
    });
  }
});
