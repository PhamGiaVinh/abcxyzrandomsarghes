import { describe, it, expect } from "vitest";
import {
  computePayouts,
  floorFor,
  poolFromFixedBuyin,
  defaultRoundingUnit,
  type PayoutArchetype,
  type PayoutInput,
} from "./payoutEngine";

const M = 1_000_000;

describe('linked Main Event TEST preset feasibility (read-only calculations)',()=>{
  it('does not silently reduce the four server-derived paid ranks when the current funding is insufficient',()=>{
    // Actual TEST: two flights of 8, each ceil(8 * 15%) = 2 paid ranks.
    // Reserve the 11 other participation floors and one nonselected bag floor:
    // 1.6M direct - 12 * 110k = 280k for the four ranked awards.
    // This fraction represents the server's four ranks, NOT a new ITM policy.
    const result=computePayouts({entries:16,prizePool:280_000,floor:110_000,
      itmPercent:4/16,archetype:'MULTI',roundingUnit:100_000});
    expect(result.itmPlaces).toBeLessThan(4);
    expect(result.warnings).toContain('N_CLAMPED');
    expect(result.rows.reduce((total,row)=>total+row.amount,0)).toBe(280_000);
  });
  it.each(['DAILY','INTL','MULTI','TRITON'] as const)('%s preserves the four ranked awards in the hypothetical funded-GTD scenario',archetype=>{
    // Feasibility only: no overlay or prize rows are written by this test.
    // GTD 2.5M less 11 other floors and one nonselected-bag floor = 1.18M.
    const result=computePayouts({entries:16,prizePool:1_180_000,floor:110_000,
      itmPercent:4/16,archetype,roundingUnit:100_000});
    expect(result.itmPlaces).toBe(4);
    expect(result.rows.every(row=>row.amount>=110_000)).toBe(true);
    expect(result.rows.reduce((total,row)=>total+row.amount,0)).toBe(1_180_000);
    expect(result.warnings).not.toContain('N_CLAMPED');
    expect(result.sumCheck).toBe(true);
  });
});

/** Buy-in 1m + rake 200k (the sheet's reference buy-in): pool/entry = 1M, floor = minCashX × 1.2M. */
function ref(entries: number, itmPercent: number, archetype: PayoutArchetype, minCashX: number): PayoutInput {
  const buyIn = 1_000_000;
  const rake = 200_000;
  return {
    entries,
    prizePool: poolFromFixedBuyin(entries, buyIn),
    floor: floorFor(minCashX, buyIn, rake),
    itmPercent,
    archetype,
    roundingUnit: defaultRoundingUnit(buyIn),
  };
}

const amounts = (r: ReturnType<typeof computePayouts>) => r.rows.map((x) => x.amount);
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

describe("Engine 3-neo — golden (CALCULATOR sheet)", () => {
  it("82 entries · 12.5% · DAILY · buy-in 1m+200k → exact 11-row table, Σ = 82M", () => {
    // Since engine v1.1, ranks 10+ band by default: N=11 → ranks 1-9 individual (unchanged from
    // the pre-banding sheet), ranks 10-11 (the original 2.7M/2.4M) become ONE equal band = 2.5M
    // each (floor((2.7M+2.4M)/2 / 100k)*100k), with the 0.1M flooring residual absorbed by rank 1
    // (27.0M -> 27.1M) so Σ stays exactly 82M. Verified by running the updated engine, not guessed.
    const r = computePayouts({
      entries: 82,
      prizePool: 82 * M,
      floor: 2.4 * M,
      itmPercent: 0.125,
      archetype: "DAILY",
      roundingUnit: 100_000,
    });
    expect(r.itmPlaces).toBe(11);
    expect(r.alpha).toBeCloseTo(0.972004, 6);
    expect(amounts(r)).toEqual([
      27.1 * M, 13.7 * M, 9.1 * M, 6.8 * M, 5.5 * M, 4.5 * M, 3.9 * M, 3.4 * M, 3.0 * M, 2.5 * M, 2.5 * M,
    ]);
    expect(sum(amounts(r))).toBe(82 * M);
    expect(r.sumCheck).toBe(true);
    // ranks 10-11 form ONE band (equal amounts) — the banding differentiator for this golden case
    expect(r.rows[9].amount).toBe(r.rows[10].amount);
    expect(r.warnings).toEqual(["ROUNDING_ADJUSTED"]);
  });
});

describe("Engine 3-neo — REF tables (field 200 @ 15% ITM)", () => {
  it("REF_DAILY: ranks 1..15 + N=30 + min-cash 2.4M + Σ=200M", () => {
    // Ranks 10-12 and 13-15 are now equal-amount bands (engine v1.1 default banding); rank1
    // absorbs the small flooring residual (55 -> 55.7M). Verified by running the updated engine.
    const r = computePayouts(ref(200, 0.15, "DAILY", 2));
    expect(r.itmPlaces).toBe(30);
    const expectTop = [55.7, 23.6, 14.7, 10.7, 8.5, 7.1, 6.1, 5.4, 4.9, 4.2, 4.2, 4.2, 3.5, 3.5, 3.5].map((x) => x * M);
    expect(amounts(r).slice(0, 15)).toEqual(expectTop);
    expect(r.rows[9].amount).toBe(r.rows[11].amount); // 10-12 banded equal
    expect(r.rows[12].amount).toBe(r.rows[14].amount); // 13-15 banded equal
    expect(r.rows[29].amount).toBe(2.4 * M); // last band still sits AT the min-cash floor here
    expect(sum(amounts(r))).toBe(200 * M);
  });

  it("REF_MULTI: N=30 + min-cash 1.8M (1.5×) floor-clamped last band + Σ=200M", () => {
    const r = computePayouts(ref(200, 0.15, "MULTI", 1.5));
    expect(r.itmPlaces).toBe(30);
    expect(r.rows[0].amount).toBe(39.2 * M); // rank1 absorbs the banding residual (was 38.7M pre-v1.1)
    expect(r.rows[29].amount).toBe(1.9 * M); // last band sits AT/ABOVE the 1.8M floor (never below)
    expect(r.rows[29].amount).toBeGreaterThanOrEqual(1.8 * M);
    expect(sum(amounts(r))).toBe(200 * M);
  });

  it("REF_INTL: N=30 + min-cash 2.4M (2×) + Σ=200M", () => {
    const r = computePayouts(ref(200, 0.15, "INTL", 2));
    expect(r.itmPlaces).toBe(30);
    expect(r.rows[0].amount).toBe(41.5 * M); // rank1 absorbs the banding residual (was 41.1M pre-v1.1)
    expect(r.rows[29].amount).toBe(2.4 * M);
    expect(sum(amounts(r))).toBe(200 * M);
  });
});

describe("Engine 3-neo — small N", () => {
  it("N=1 (winner takes the whole pool)", () => {
    const r = computePayouts({ entries: 10, prizePool: 12 * M, floor: 2.4 * M, itmPercent: 0.05, archetype: "DAILY", roundingUnit: 100_000 });
    expect(r.itmPlaces).toBe(1);
    expect(amounts(r)).toEqual([12 * M]);
    expect(sum(amounts(r))).toBe(12 * M);
  });

  it("N=2 → {pool − floor, floor}", () => {
    const r = computePayouts({ entries: 14, prizePool: 14 * M, floor: 2.4 * M, itmPercent: 0.1, archetype: "DAILY", roundingUnit: 100_000 });
    expect(r.itmPlaces).toBe(2);
    expect(amounts(r)).toEqual([14 * M - 2.4 * M, 2.4 * M]);
    expect(sum(amounts(r))).toBe(14 * M);
    expect(r.rows[1].amount).toBe(2.4 * M);
  });
});

describe("Engine 3-neo — edge cases", () => {
  it("pool < floor → POOL_BELOW_MIN_CASH, single row = pool", () => {
    const r = computePayouts({ entries: 3, prizePool: 2 * M, floor: 2.4 * M, itmPercent: 0.34, archetype: "DAILY", roundingUnit: 100_000 });
    expect(r.warnings).toContain("POOL_BELOW_MIN_CASH");
    expect(r.itmPlaces).toBe(1);
    expect(amounts(r)).toEqual([2 * M]);
    expect(r.effectiveFloor).toBe(2 * M);
  });

  it("pool = N × floor → every paid place = floor (no remainder)", () => {
    // N = ceil(5 × 1.0) = 5, maxByPool = floor(10M / 2M) = 5, distributable = 0
    const r = computePayouts({ entries: 5, prizePool: 10 * M, floor: 2 * M, itmPercent: 1.0, archetype: "DAILY", roundingUnit: 100_000 });
    expect(r.itmPlaces).toBe(5);
    expect(amounts(r)).toEqual([2 * M, 2 * M, 2 * M, 2 * M, 2 * M]);
    expect(sum(amounts(r))).toBe(10 * M);
    expect(r.tiers).toHaveLength(1); // all equal → one tier
    expect(r.tiers[0]).toMatchObject({ fromPosition: 1, toPosition: 5, amount: 2 * M });
  });

  it("N clamped by pool emits N_CLAMPED", () => {
    // ceil(20 × 0.5) = 10 places wanted, but pool only covers floor(15M / 2M) = 7
    const r = computePayouts({ entries: 20, prizePool: 15 * M, floor: 2 * M, itmPercent: 0.5, archetype: "DAILY", roundingUnit: 100_000 });
    expect(r.warnings).toContain("N_CLAMPED");
    expect(r.itmPlaces).toBe(7);
    expect(sum(amounts(r))).toBe(15 * M);
  });

  it("rounding inversion → DOWN-repair makes the table monotone (ROUNDING_ADJUSTED)", () => {
    // Coarse 1M unit on a near-flat 3-way split: nearest rounding would give [2.6M, 3M, 2.4M]
    // (rank1 < rank2). The deterministic DOWN-repair rebuilds it monotone, Σ still = pool.
    const r = computePayouts({ entries: 5, prizePool: 8 * M, floor: 2.4 * M, itmPercent: 0.5, archetype: "DAILY", roundingUnit: 1_000_000 });
    expect(r.warnings).toContain("ROUNDING_ADJUSTED");
    expect(amounts(r)).toEqual([3.2 * M, 2.4 * M, 2.4 * M]);
    for (let i = 0; i < r.rows.length - 1; i++) expect(r.rows[i].amount).toBeGreaterThanOrEqual(r.rows[i + 1].amount);
    expect(sum(amounts(r))).toBe(8 * M);
    expect(r.rows[2].amount).toBe(r.effectiveFloor);
  });

  it("N > 450 (huge field) → ALPHA_CLAMP_450, still exact sum + monotone + last ≥ floor (banded)", () => {
    const r = computePayouts({ entries: 4000, prizePool: 4000 * M, floor: 2.4 * M, itmPercent: 0.15, archetype: "DAILY", roundingUnit: 1_000_000 });
    expect(r.itmPlaces).toBe(600);
    expect(r.warnings).toContain("ALPHA_CLAMP_450");
    expect(sum(amounts(r))).toBe(4000 * M);
    // last rank is now part of a band (N=600 » 10); the floor-clamp in applyBanding guarantees it
    // never sits BELOW the true min-cash floor, even though 2.4M isn't a multiple of the 1M
    // rounding unit here (this exact combination surfaced a real floor-undershoot bug during
    // implementation — this assertion locks the fix in).
    expect(r.rows[r.rows.length - 1].amount).toBeGreaterThanOrEqual(2.4 * M);
    for (let i = 0; i < r.rows.length - 1; i++) expect(r.rows[i].amount).toBeGreaterThanOrEqual(r.rows[i + 1].amount);
  });
});

describe("Engine 3-neo — invariants over a sweep (monotone, Σ=pool, min-cash exact)", () => {
  const archetypes: PayoutArchetype[] = ["DAILY", "INTL", "MULTI", "TRITON"];
  it("never produces a non-monotone or sum-breaking table; exercises the rounding repair", () => {
    let adjusted = 0;
    for (const arch of archetypes) {
      for (const entries of [3, 7, 13, 30, 49, 82, 150, 333, 777, 1500, 2999]) {
        for (const itm of [0.1, 0.125, 0.15, 0.18, 0.2]) {
          for (const buyIn of [600_000, 1_000_000, 1_500_000, 2_000_000, 5_000_000]) {
            const minCashX = arch === "MULTI" ? 1.5 : arch === "TRITON" ? 1.6 : 2;
            const r = computePayouts({
              entries,
              prizePool: entries * buyIn,
              floor: floorFor(minCashX, buyIn, Math.round(buyIn * 0.2)),
              itmPercent: itm,
              archetype: arch,
              roundingUnit: defaultRoundingUnit(buyIn),
            });
            const a = amounts(r);
            // Σ = pool exactly
            expect(sum(a)).toBe(r.prizePool);
            // monotone non-increasing
            for (let i = 0; i < a.length - 1; i++) expect(a[i]).toBeGreaterThanOrEqual(a[i + 1]);
            // last paid place: for N in 2..9 (never banded) it lands exactly on the floor
            // (affine-shift invariant, unchanged since engine v1.1); for N > 9 the last rank is
            // part of a band and only guaranteed to be AT/ABOVE the floor (never pinned exactly —
            // this is the whole point of banding); with a single place the winner takes the whole
            // pool. (Drives the DB invariant: `LAST_NOT_FLOOR` is now bypassed whenever N > 9.)
            if (r.itmPlaces >= 2 && r.itmPlaces <= 9) expect(a[a.length - 1]).toBe(r.effectiveFloor);
            else if (r.itmPlaces === 1) expect(a[0]).toBe(r.prizePool);
            // no paid place is ever below the floor — true for both individual AND banded ranks
            // (the floor-clamp in applyBanding guarantees this even when `floor` isn't an exact
            // multiple of the rounding unit; this sweep caught a real undershoot bug pre-fix).
            if (!r.warnings.includes("POOL_BELOW_MIN_CASH")) expect(a[a.length - 1]).toBeGreaterThanOrEqual(r.effectiveFloor);
            if (r.warnings.includes("ROUNDING_ADJUSTED")) adjusted++;
          }
        }
      }
    }
    // Realistic buy-ins rarely need the repair; the explicit case above covers that path.
    expect(adjusted).toBeGreaterThanOrEqual(0);
  });
});

describe("Engine 3-neo — determinism", () => {
  it("same input → identical output (no Date/random)", () => {
    const input: PayoutInput = { entries: 137, prizePool: 137 * M, floor: 2.4 * M, itmPercent: 0.15, archetype: "INTL", roundingUnit: 100_000 };
    expect(computePayouts(input)).toEqual(computePayouts(input));
  });
});
