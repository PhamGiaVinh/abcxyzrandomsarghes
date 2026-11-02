import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const source = (path: string) => readFileSync(join(ROOT, path), "utf8");

describe("Series Club Pulse V1 architecture boundary", () => {
  it("keeps contracts and mapping pure while isolating Supabase to one fixed RPC adapter", () => {
    const contract = source("src/lib/series-intelligence/seriesClubLivePulseV1.ts");
    const adapter = source("src/lib/series-intelligence/seriesClubLivePulseRpc.ts");
    const client = source("src/lib/series-intelligence/seriesClubLivePulseClient.ts");
    expect(contract).not.toMatch(/supabase|\.rpc\(|\bfetch\s*\(/i);
    expect(adapter).toContain("getSeriesClubLivePulseV1WithClient(supabase, clubId)");
    expect(client).toContain('const CLUB_PULSE_RPC = "get_series_club_live_pulse_v1"');
    expect(client).toContain("parseSeriesClubLivePulseV1(data)");
    expect(client).not.toContain("@/integrations/supabase/client");
    expect(client).not.toMatch(/\.from\s*\(/);
    expect(adapter).not.toMatch(/\.from\s*\(/);
  });

  it("wires the fixed adapter through one hook with both rollout flags active", () => {
    const panel = source("src/components/series-intelligence/VCopilotPanel.tsx");
    const pulsePanel = source("src/components/series-intelligence/ClubPulsePanel.tsx");
    const hook = source("src/lib/series-intelligence/useSeriesClubLivePulseV1.ts");
    const page = source("src/pages/SeriesIntelligence.tsx");
    const flags = source("src/lib/featureFlags.ts");
    expect(panel).not.toMatch(/seriesClubLivePulseRpc|getSeriesClubLivePulseV1/);
    expect(page).not.toMatch(/seriesClubLivePulseRpc|getSeriesClubLivePulseV1/);
    expect(pulsePanel).not.toMatch(/supabase|\.from\s*\(|\.rpc\s*\(/i);
    expect(hook).toContain('from "./seriesClubLivePulseRpc"');
    expect(hook).not.toMatch(/supabase|\.from\s*\(|\.rpc\s*\(/i);
    expect(page).toContain("FEATURES.seriesClubPulseV1 && <ClubPulsePanel");
    expect(flags).toMatch(/seriesVCopilotV1:\s*true/);
    expect(flags).toMatch(/seriesClubPulseV1:\s*true/);
  });
});
