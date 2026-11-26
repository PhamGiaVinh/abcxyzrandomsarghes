import { describe, it, expect } from "vitest";
import {
  scoreOutcome,
  pickScoringSnapshot,
  findScoredDecision,
  summarizeCapture,
  registrationFunnel,
  isShadowDecision,
  countShadowDecisions,
  SHADOW_PREFIX,
} from "./captureScoring";
import type { DecisionLog, ForecastSnapshot, RegistrationEvent } from "./captureTypes";

const CLUB = "11111111-1111-1111-1111-111111111111";
const EV = "11111111-1111-1111-1111-111111111111";

const snap = (o: Partial<ForecastSnapshot> = {}): ForecastSnapshot => ({
  id: "snap-1",
  club_id: CLUB,
  event_id: EV,
  horizon: "T-7",
  days_before: 7,
  forecast_base: 180,
  forecast_low: 140,
  forecast_high: 230,
  confidence_tier: "medium",
  candidate_gtd: 5_000_000_000,
  overlay_risk_pct: 18.5,
  source_label: "manual",
  notes: null,
  created_at: "2026-06-20T00:00:00Z",
  created_by: null,
  forecast_issued_at: null, as_of_ts: null, target_event_ts: null,
  provenance_kind: null, provenance_completeness: null, forecast_identity_eligible: false,
  engine_version: null, feature_schema_version: null, code_sha: null, model_config_hash: null,
  trial_count: null, selection_protocol_id: null, predictor_id: null, calibration_pool_id: null,
  target_input_hash: null, training_data_hash: null, input_content_hash: null, forecast_instance_id: null,
  derived_from_input_hash: null,
  ...o,
});

const dec = (o: Partial<DecisionLog> = {}): DecisionLog => ({
  id: "dec-1",
  club_id: CLUB,
  event_id: EV,
  forecast_snapshot_id: null,
  decision_horizon: "T-7",
  recommended_action: null,
  owner_decision: null,
  public_action: null,
  decision_reason: null,
  actual_result: null,
  actual_entries: null,
  actual_unique_players: null,
  actual_reentries: null,
  actual_prize_pool: null,
  actual_overlay_amount: null,
  post_event_reason: null,
  created_at: "2026-06-20T00:00:00Z",
  created_by: null,
  ...o,
});

const reg = (o: Partial<RegistrationEvent> = {}): RegistrationEvent => ({
  id: "reg-1",
  club_id: CLUB,
  event_id: EV,
  player_ref_hash: "h1",
  player_ref_type: "phone",
  registered_at: "2026-06-25T00:00:00Z",
  is_reentry: false,
  bullet: 1,
  commitment_stage: "paid",
  entry_source: "direct",
  source_entry_id: null,
  created_at: "2026-06-25T00:00:00Z",
  created_by: null,
  ...o,
});

describe("scoreOutcome", () => {
  it("scores the seeded outcome: actual 205 in band, GTD not covered, no overlay", () => {
    const s = scoreOutcome(snap(), { actual_entries: 205, actual_prize_pool: 4_100_000_000, actual_overlay_amount: 0 });
    expect(s.hasActuals).toBe(true);
    expect(s.inBand).toBe(true); // 140 ≤ 205 ≤ 230
    expect(s.entriesDelta).toBe(25); // 205 − 180
    expect(s.gtdCovered).toBe(false); // 4.1e9 < 5e9
    expect(s.hadOverlay).toBe(false);
    expect(s.label).toBe("Observed Pattern");
  });
  it("marks out-of-band + covered + overlay correctly", () => {
    const s = scoreOutcome(snap(), { actual_entries: 120, actual_prize_pool: 5_500_000_000, actual_overlay_amount: 300_000_000 });
    expect(s.inBand).toBe(false); // 120 < 140
    expect(s.gtdCovered).toBe(true);
    expect(s.hadOverlay).toBe(true);
  });
  it("returns nulls (not false) when snapshot or actuals are missing", () => {
    expect(scoreOutcome(null, { actual_entries: 200, actual_prize_pool: null, actual_overlay_amount: null }).inBand).toBeNull();
    const noActuals = scoreOutcome(snap(), { actual_entries: null, actual_prize_pool: null, actual_overlay_amount: null });
    expect(noActuals.hasActuals).toBe(false);
    expect(noActuals.inBand).toBeNull();
  });
});

describe("pickScoringSnapshot", () => {
  it("prefers the snapshot linked by the post decision", () => {
    const a = snap({ id: "a", days_before: 7 });
    const b = snap({ id: "b", days_before: 1 });
    const post = dec({ decision_horizon: "post", forecast_snapshot_id: "a" });
    expect(pickScoringSnapshot([a, b], post)?.id).toBe("a");
  });
  it("falls back to the latest pre-event snapshot (smallest days_before)", () => {
    const a = snap({ id: "a", days_before: 7 });
    const b = snap({ id: "b", days_before: 1 });
    expect(pickScoringSnapshot([a, b], null)?.id).toBe("b");
  });

  it("does not score a different forecast when the linked snapshot is unavailable", () => {
    const other = snap({ id: "other", days_before: 1 });
    const post = dec({ forecast_snapshot_id: "missing" });
    expect(pickScoringSnapshot([other], post)).toBeNull();
  });
  it("returns null when there are no snapshots", () => {
    expect(pickScoringSnapshot([], null)).toBeNull();
  });
});

describe("findScoredDecision", () => {
  it("prefers a post decision that carries actuals", () => {
    const t7 = dec({ id: "t7", decision_horizon: "T-7" });
    const post = dec({ id: "post", decision_horizon: "post", actual_entries: 205 });
    expect(findScoredDecision([t7, post])?.id).toBe("post");
  });
  it("returns null when no decision has actuals", () => {
    expect(findScoredDecision([dec(), dec()])).toBeNull();
  });
});

describe("summarizeCapture", () => {
  it("counts events/decisions/scored/gtd-covered from the seed shape", () => {
    const decisions = [
      dec({ id: "d1", decision_horizon: "T-7" }),
      dec({ id: "d2", decision_horizon: "post", actual_entries: 205, actual_prize_pool: 4_100_000_000, actual_overlay_amount: 0 }),
    ];
    const s = summarizeCapture(decisions, [snap()]);
    expect(s).toEqual({ events: 1, decisions: 2, scoredEvents: 1, gtdCoveredEvents: 0 });
  });
});

describe("shadow decisions (TP9)", () => {
  it("isShadowDecision detects the text convention and the is_shadow flag", () => {
    expect(isShadowDecision(dec({ owner_decision: SHADOW_PREFIX + "hoãn giải" }))).toBe(true);
    expect(isShadowDecision(dec({ owner_decision: "[SHADOW] " }))).toBe(true);
    expect(isShadowDecision({ ...dec(), is_shadow: true } as DecisionLog)).toBe(true);
    expect(isShadowDecision(dec({ owner_decision: "giữ GTD" }))).toBe(false);
    expect(isShadowDecision(dec({ owner_decision: null }))).toBe(false);
  });

  it("countShadowDecisions counts only shadow rows", () => {
    const ds = [
      dec({ owner_decision: SHADOW_PREFIX + "a" }),
      dec({ owner_decision: "b" }),
      dec({ owner_decision: SHADOW_PREFIX + "c" }),
    ];
    expect(countShadowDecisions(ds)).toBe(2);
  });

  it("findScoredDecision never scores a shadow decision (even with actuals)", () => {
    const shadowWithActuals = dec({ id: "sh", decision_horizon: "post", owner_decision: SHADOW_PREFIX + "hoãn", actual_entries: 200 });
    expect(findScoredDecision([shadowWithActuals])).toBeNull(); // shadow is never scored
    const real = dec({ id: "real", decision_horizon: "post", actual_entries: 200 });
    expect(findScoredDecision([shadowWithActuals, real])?.id).toBe("real");
  });

  it("no shadow present ⇒ findScoredDecision behaves exactly as before", () => {
    const t7 = dec({ id: "t7", decision_horizon: "T-7" });
    const post = dec({ id: "post", decision_horizon: "post", actual_entries: 205 });
    expect(findScoredDecision([t7, post])?.id).toBe("post");
    expect(countShadowDecisions([t7, post])).toBe(0);
  });
});

describe("registrationFunnel", () => {
  it("counts total, unique hashes, re-entries, and per-stage from the seed funnel", () => {
    const regs = [
      reg({ id: "r1", player_ref_hash: "p1", commitment_stage: "paid", is_reentry: false }),
      reg({ id: "r2", player_ref_hash: "p1", commitment_stage: "paid", is_reentry: true }), // same player re-entry
      reg({ id: "r3", player_ref_hash: "p2", commitment_stage: "reserved", is_reentry: false }),
      reg({ id: "r4", player_ref_hash: "p3", commitment_stage: "interested", is_reentry: false }),
    ];
    const f = registrationFunnel(regs);
    expect(f.total).toBe(4);
    expect(f.unique).toBe(3); // p1, p2, p3
    expect(f.reentries).toBe(1);
    expect(f.byStage).toEqual({ paid: 2, reserved: 1, interested: 1 });
  });
});
