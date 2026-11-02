import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("restore refreshes server-owned tournament totals without waiting for Realtime", () => {
  it("notifies the parent through the successful restore callback", () => {
    const panel = readFileSync("src/components/cashier/tournament-live/PlayersGroupedPanel.tsx", "utf8");
    expect(panel).toMatch(/onRestored=\{\(\) => \{\s*void load\(\);[\s\S]*?onTournamentChanged\?\.\(\);\s*\}\}/);
    expect(panel).not.toMatch(/players_remaining\s*[:=]\s*.*\+\s*1/);
  });

  it("reloads the canonical tournament data used by the header", () => {
    const parent = readFileSync("src/components/cashier/TournamentLivePanel.tsx", "utf8");
    expect(parent).toContain("onTournamentChanged={() => { void loadTournaments(); }}");
    expect(parent).toContain('from("tournaments")');
    expect(parent).toContain("participation.data.counts.remaining");
    expect(parent).toContain("participation.data.averageStack");
    expect(parent).not.toContain("selectedTournament.players_remaining");
  });
});
