// tests/pokerIQ/result.test.ts — full result + semantic invariants on the
// canonical "B+ · Tight Solid" fixture.
import { describe, it, expect } from "vitest";
import { computeDrillResult, DRILL_HANDS, DEMO_ANSWERS } from "@/lib/pokerIQ";

const r = computeDrillResult(DRILL_HANDS, DEMO_ANSWERS);

describe("computeDrillResult — canonical fixture", () => {
  it('includes a valid answered zero-score category in the average', () => {
    const hands=DRILL_HANDS.map(hand=>({...hand,options:hand.options.map(option=>({...option,score:hand.category==='preflop_discipline'?0:100}))}));
    const answers=hands.map(hand=>({handId:hand.id,optionId:hand.options[0].id,selfConfidence:'medium' as const}));
    const result=computeDrillResult(hands,answers);
    expect(result.categoryScores.find(c=>c.category==='preflop_discipline')?.score).toBe(0);
    expect(result.totalScore).toBe(80);
  });
  it('does not count unanswered categories as zero-score answers', () => {
    const hand=DRILL_HANDS[0];
    expect(computeDrillResult(DRILL_HANDS,[{handId:hand.id,optionId:hand.options[0].id,selfConfidence:'medium'}]).totalScore).toBe(hand.options[0].score);
    expect(computeDrillResult(DRILL_HANDS,[]).totalScore).toBe(0);
  });
  it("grade and total", () => {
    expect(r.totalScore).toBe(74);
    expect(r.grade).toBe("B+");
  });

  it("archetype is Tight Solid", () => {
    expect(r.archetype).toBe("tight_solid");
  });

  it("weakest category is vs_aggro and the CTA/training maps to it", () => {
    expect(r.weakestCategory).toBe("vs_aggro");
    expect(r.recommendedDrill).toBe(r.weakestCategory);
  });

  it("leaks surface the weakest areas (incl. over-fold vs aggro)", () => {
    expect(r.leaks).toContain("overfold_vs_aggro");
    expect(r.leaks.length).toBeLessThanOrEqual(3);
  });

  it("strengths surface a positive identity (incl. reading nits)", () => {
    expect(r.strengths).toContain("read_nit");
    expect(r.strengths.length).toBeLessThanOrEqual(3);
  });

  it("is always provisional with low confidence in MVP 1", () => {
    expect(r.isProvisional).toBe(true);
    expect(r.confidence).toBe("low");
  });

  it("suggested event fits the style and avoids the weakness", () => {
    expect(r.suggestedEvent.fit).toBe("deepstack_mid_field");
    expect(r.suggestedEvent.avoid).toBe("turbo_short_stack");
  });

  it("carries all three versions for cohort comparability", () => {
    expect(r.scoringVersion).toBeTruthy();
    expect(r.resultSchemaVersion).toBeTruthy();
    expect(r.contentVersion).toBeTruthy();
  });

  it("is deterministic (snapshot locked to scoringVersion)", () => {
    expect(r).toMatchSnapshot();
  });
});
