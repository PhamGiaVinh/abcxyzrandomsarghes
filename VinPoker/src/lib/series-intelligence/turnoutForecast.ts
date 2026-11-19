// Series Intelligence — Turnout forecast (transparent ridge log-linear, PURE, client-only).
//
// Predicts entries for an UPCOMING event from the club's OWN past events, with a confidence band + tier +
// an honest walk-forward CV error. This is a TRANSPARENT model (ridge regression on log(entries) with one-hot
// categoricals), NOT black-box ML. It is the ROADMAP's gated Phase-5 PREDICTIVE tier shipped as RESEARCH:
// output is labeled only with the existing tiers (Hypothesis + confidence) — NEVER `Model Estimate` — and
// stays behind a default-OFF flag until a backtest beats the rules baseline (owner-gated).
//
// LEAKAGE DISCIPLINE (locked): inputs are ONLY known-before-the-event features (date → weekday/quarter/
// hour-slot, log buy-in, log GTD + a missing flag, event-type keyword). total_entries is the TARGET only;
// prize_pool_actual / fee-actual / overlay / rake are RESULTS and are NEVER predictors. Serving + every CV
// fold train ONLY on events strictly before the target date. Deterministic (closed-form ridge, no random).

import type { SeriesEvent } from "./nativeData";
import { typeOf, TYPE_LABEL } from "./seriesEventType";
import { editionOf } from "./editionIndex";
import { isHolidayWindow, isPaydayWindow } from "./viCalendar";
import { hitCapacity } from "./censoring";
import { buildFeatures, makeOrigin, type ForecastOrigin, type StaticFeature } from "./featureBoundary";
import {
  evaluateModelCapability,
  MIN_TRAIN_LENGTH,
  FULL_FEATURE_THRESHOLD,
  HIGH_N_THRESHOLD,
  type ModelCapability,
} from "./modelCapability";

export type ForecastConfidence = "low" | "medium" | "high"; // reuses the ScenarioConfidence vocabulary

/** Fallback log-SD for the overlay feed when the forecast band cannot be inverted (degenerate low/high). */
export const FEED_LOG_SD_FALLBACK = 0.4;

/** What the forecast hands to the overlay simulator (simulateOverlayFromForecast — the explicit
 *  forecast-centered adapter; no synthetic observation count involved). */
export interface ForecastOverlayFeed {
  base: number; // central entries (forecast base, or the owner's override)
  logSd: number; // the forecast's own log-space uncertainty, recovered from its p10–p90 band
  buyIn: number; // prize contribution per entry of the event being forecast
  label: string; // honest source description for the UI
}

/**
 * Convert a forecast (+ optional owner override of the center) into an overlay-simulation feed.
 * σ is recovered from the band: logSd = (ln high − ln low) / (2·Z) with Z the band's z-score; falls back
 * to FEED_LOG_SD_FALLBACK when the band is degenerate. Returns null when there is nothing usable to feed.
 */
export function forecastToOverlayFeed(
  fc: TurnoutForecast | null,
  buyIn: number | null,
  ownerBase?: number | null,
): ForecastOverlayFeed | null {
  if (!fc || !fc.available || buyIn === null || !(buyIn > 0)) return null;
  const base = ownerBase ?? fc.base;
  if (base === null || !(base > 0)) return null;
  const logSd =
    fc.low !== null && fc.high !== null && fc.low > 0 && fc.high > fc.low
      ? (Math.log(fc.high) - Math.log(fc.low)) / (2 * Z)
      : FEED_LOG_SD_FALLBACK;
  return {
    base,
    logSd,
    buyIn,
    label: ownerBase != null ? "dự báo (đã sửa tay) · Hypothesis" : "dự báo thống kê · Hypothesis",
  };
}

// A4a: the sample-size / data-capability thresholds (MIN_FULL=8, HIGH_N=12, CV_MIN_TRAIN=4) now live ONLY in
// modelCapability.ts as FULL_FEATURE_THRESHOLD / HIGH_N_THRESHOLD / MIN_TRAIN_LENGTH; every decision below is
// routed through evaluateModelCapability so no threshold is re-derived here.
const LAMBDA = 1.0; // ridge strength (intercept unpenalised); mainly shrinks sparse one-hot levels
const Z = 1.2816; // ~p10–p90 band

// Event-type vocabulary lives in the shared seriesEventType helper (also used by contribution-margin
// grouping) so all consumers classify identically. Its specific-first ordering fixes two misclassifications
// this file's original inline list had ("Super High Roller" → high roller; "Satellite to Main" → main).

export interface UpcomingEvent {
  event_date: string; // ISO
  buy_in: number;
  gtd: number | null;
  typeKeyword?: string | null;
  /** Optional brand/series name — used ONLY (TP2) to derive the edition-trend feature for the target when
   *  seriesCalendarFeatures is on. Never affects the event-type classification (that stays typeKeyword-driven). */
  event_name?: string | null;
  /** Optional venue/seat capacity of the upcoming event (TP6). When seriesCensoring is on, the forecast band
   *  is capped at this — attendance can't exceed the number of seats. Ignored when censoring is off. */
  capacity?: number | null;
}

export interface CoefContribution {
  feature: string;
  beta: number; // log-space coefficient
  impactPct: number; // (exp(beta) − 1) × 100 — a model adjustment / correlation, NOT a causal claim
}

// Plain-Vietnamese display names for the model's raw feature codes (owner-facing; "wd6" means nothing to a TD).
const WEEKDAY_VN = ["Chủ nhật", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];
const HOUR_SLOT_VN = ["Khung đêm–sáng (0–6h)", "Khung sáng (6–12h)", "Khung chiều (12–18h)", "Khung tối (18–24h)"];

/** Translate a raw feature code ("weekday:wd6", "type:main", "logBuyin"…) into plain Vietnamese. */
export function describeFeature(feature: string): string {
  const [group, level] = feature.includes(":") ? feature.split(":") : [feature, ""];
  switch (group) {
    case "logBuyin":
      return "Buy-in cao";
    case "logGtd":
      return "GTD cao";
    case "gtdMissing":
      return "Không đặt GTD";
    case "weekday": {
      const d = Number(level.replace("wd", ""));
      const name = WEEKDAY_VN[d] ?? level;
      return d === 0 || d === 6 ? `Cuối tuần (${name})` : name;
    }
    case "quarter":
      return `Quý ${Number(level.replace("q", "")) + 1}`;
    case "hourSlot":
      return HOUR_SLOT_VN[Number(level.replace("hs", ""))] ?? level;
    case "type":
      return `Loại ${(TYPE_LABEL as Record<string, string>)[level] ?? level}`;
    case "isHoliday":
      return "Rơi vào dịp lễ/Tết";
    case "isPayday":
      return "Đầu tháng (ngày lương)";
    case "editionTrend":
      return "Kỳ tổ chức thứ mấy (xu hướng qua các kỳ)";
    default:
      return feature;
  }
}

export interface TurnoutForecast {
  available: boolean;
  base: number | null;
  low: number | null;
  high: number | null;
  confidence: ForecastConfidence;
  sampleSize: number; // past events (with entries) used to train
  degraded: boolean; // used the intercept + log(buy-in) fallback
  modelMapePct: number | null; // walk-forward CV error of the model
  baselineMapePct: number | null; // walk-forward CV error of the median-of-past baseline
  deltaVsBaselinePct: number | null; // baseline − model (positive ⇒ model beats baseline)
  coefContributions: CoefContribution[];
  missingDataNotes: string[];
  disclaimer: string;
}

const DISCLAIMER =
  "Khung dự báo tham khảo · chưa qua backtest chính thức · cần ≥12 giải + thắng baseline để gọi là Model Estimate. KHÔNG phải cam kết — chủ club sửa đè được.";

// ---------- pre-event feature extraction ----------
function localParts(iso: string | null): { weekday: number; quarter: number; hourSlot: number } | null {
  if (!iso) return null;
  // The supported club calendar is Vietnam business time (UTC+7).
  const d = new Date(Date.parse(iso) + 7 * 60 * 60 * 1000);
  if (Number.isNaN(d.getTime())) return null;
  return { weekday: d.getUTCDay(), quarter: Math.floor(d.getUTCMonth() / 3), hourSlot: Math.floor(d.getUTCHours() / 6) };
}

interface PreFeatures {
  logBuyin: number;
  logGtd: number | null;
  weekday: string;
  quarter: string;
  hourSlot: string;
  type: string;
  // TP2 calendar/edition numerics — only enter the design matrix when seriesCalendarFeatures is on AND
  // n ≥ MIN_FULL; computed harmlessly (and cheaply) otherwise. isHoliday/isPayday ∈ {0,1}; editionTrend = ln(edition).
  isHoliday: number;
  isPayday: number;
  editionTrend: number;
}
function preFeatures(
  buyIn: number,
  gtd: number | null,
  iso: string,
  name: string | null,
  explicitType?: string | null,
  allEvents?: SeriesEvent[],
  editionName?: string | null,
): PreFeatures | null {
  const parts = localParts(iso);
  if (!parts || !(buyIn > 0)) return null;
  // editionTrend counts only STRICTLY-earlier same-brand editions (leakage-safe by date). It is derived
  // ONLY when allEvents is supplied (i.e. calendar features are on) so the OFF path does no edition work and
  // stays byte-identical. `editionName ?? name` lets the target pass a brand distinct from its type input.
  const brand = editionName !== undefined ? editionName : name;
  const editionTrend =
    allEvents && brand && brand.trim() !== "" ? Math.log(editionOf(allEvents, brand, iso).edition) : 0;
  return {
    logBuyin: Math.log(buyIn),
    logGtd: gtd != null && gtd > 0 ? Math.log(gtd) : null,
    weekday: `wd${parts.weekday}`,
    quarter: `q${parts.quarter}`,
    hourSlot: `hs${parts.hourSlot}`,
    type: typeOf(name, explicitType),
    isHoliday: isHolidayWindow(iso) ? 1 : 0,
    isPayday: isPaydayWindow(iso) ? 1 : 0,
    editionTrend,
  };
}

/** A1 point-in-time admission of the turnout model's features at a given origin. The model's inputs are ALL
 *  StaticKnown, so this is numeric-neutral — the prediction reads `f` directly; this only enforces, fail
 *  closed, that nothing non-static could enter a fold/target without an observedAt ≤ origin. Returns the
 *  admitted bundle (with its availability metadata) so callers may retain it alongside the origin. */
function admitStaticPreFeatures(origin: ForecastOrigin, f: PreFeatures) {
  const statics: StaticFeature[] = [
    { key: "logBuyin", value: f.logBuyin },
    { key: "gtdMissing", value: f.logGtd === null ? 1 : 0 },
    { key: "weekday", value: f.weekday },
    { key: "quarter", value: f.quarter },
    { key: "hourSlot", value: f.hourSlot },
    { key: "type", value: f.type },
    { key: "isHoliday", value: f.isHoliday },
    { key: "isPayday", value: f.isPayday },
    { key: "editionTrend", value: f.editionTrend },
  ];
  if (f.logGtd !== null) statics.push({ key: "logGtd", value: f.logGtd });
  return buildFeatures(origin, statics); // throws (fail closed) if any key is not StaticKnown at origin
}

// ---------- ridge pipeline (built fresh per training set — no leakage) ----------
interface Model {
  cols: string[]; // feature names in β order; cols[0] = "intercept"
  oneHot: string[]; // the categorical "group:level" columns that survived pruning
  numMean: Record<string, number>;
  numStd: Record<string, number>;
  meanLogGtd: number; // imputation for missing GTD
  useGtd: boolean;
  useOneHot: boolean;
  useCalendar: boolean; // TP2: whether the calendar/edition numeric columns are in this model
  beta: number[];
  rmse: number;
  n: number;
}

const NUM_COLS_FULL = ["logBuyin", "logGtd", "gtdMissing"];
const CAL_COLS = ["isHoliday", "isPayday", "editionTrend"]; // TP2 numeric calendar/edition features (appended last)
const ONE_HOT_GROUPS: Array<keyof Pick<PreFeatures, "weekday" | "quarter" | "hourSlot" | "type">> = ["weekday", "quarter", "hourSlot", "type"];

/** Numeric column order for a model. Calendar cols are appended AFTER the base cols so that with the flag
 *  off the list is byte-identical to before (never reordering the existing coefficients). */
function numColsFor(useGtd: boolean, useCalendar: boolean): string[] {
  const base = useGtd ? NUM_COLS_FULL : ["logBuyin"];
  return useCalendar ? [...base, ...CAL_COLS] : base;
}

function buildModel(rows: Array<{ f: PreFeatures; y: number }>, calendarFeatures = false): Model | null {
  const n = rows.length;
  if (n < 2) return null;
  const useOneHot = evaluateModelCapability({ kind: "sample_size", sampleSize: n }).supportsFullFeatures;
  const useGtd = useOneHot && rows.some((r) => r.f.logGtd !== null);
  const useCalendar = calendarFeatures && useOneHot; // gated identically to the full one-hot tier

  // numeric columns
  const numCols = numColsFor(useGtd, useCalendar);
  const meanLogGtd = useGtd ? mean(rows.map((r) => r.f.logGtd).filter((v): v is number => v !== null)) : 0;
  const numValue = (f: PreFeatures, c: string): number => {
    if (c === "logBuyin") return f.logBuyin;
    if (c === "logGtd") return f.logGtd ?? meanLogGtd;
    if (c === "gtdMissing") return f.logGtd === null ? 1 : 0;
    if (c === "isHoliday") return f.isHoliday;
    if (c === "isPayday") return f.isPayday;
    if (c === "editionTrend") return f.editionTrend;
    return 0;
  };
  const numMean: Record<string, number> = {};
  const numStd: Record<string, number> = {};
  for (const c of numCols) {
    const vals = rows.map((r) => numValue(r.f, c));
    numMean[c] = mean(vals);
    const sd = std(vals, numMean[c]);
    numStd[c] = sd > 1e-9 ? sd : 1; // constant column → no scaling (β absorbs)
  }

  // one-hot levels with ≥2 observations (pruned)
  const oneHot: string[] = [];
  if (useOneHot) {
    for (const g of ONE_HOT_GROUPS) {
      const counts = new Map<string, number>();
      for (const r of rows) counts.set(r.f[g], (counts.get(r.f[g]) ?? 0) + 1);
      for (const [level, c] of counts) if (c >= 2) oneHot.push(`${g}:${level}`);
    }
  }

  const cols = ["intercept", ...numCols, ...oneHot];
  const rowVec = (f: PreFeatures): number[] => {
    const v = [1];
    for (const c of numCols) v.push((numValue(f, c) - numMean[c]) / numStd[c]);
    for (const oh of oneHot) {
      const [g, level] = oh.split(":");
      v.push(f[g as keyof PreFeatures] === level ? 1 : 0);
    }
    return v;
  };

  const X = rows.map((r) => rowVec(r.f));
  const y = rows.map((r) => r.y);
  const p = cols.length;
  // A = XᵀX + λI (skip intercept), b = Xᵀy
  const A = zeros(p, p);
  const b = new Array(p).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < p; j++) {
      b[j] += X[i][j] * y[i];
      for (let k = j; k < p; k++) A[j][k] += X[i][j] * X[i][k];
    }
  }
  for (let j = 0; j < p; j++) for (let k = j + 1; k < p; k++) A[k][j] = A[j][k];
  for (let j = 1; j < p; j++) A[j][j] += LAMBDA;

  let beta = choleskySolve(A, b);
  if (!beta) beta = [mean(y), ...new Array(p - 1).fill(0)]; // never crash → intercept-only fallback

  let sse = 0;
  for (let i = 0; i < n; i++) {
    let yh = 0;
    for (let j = 0; j < p; j++) yh += X[i][j] * beta[j];
    sse += (y[i] - yh) * (y[i] - yh);
  }
  const rmse = Math.sqrt(sse / n);
  return { cols, oneHot, numMean, numStd, meanLogGtd, useGtd, useOneHot, useCalendar, beta, rmse, n };
}

function predictLog(model: Model, f: PreFeatures): number {
  const numCols = numColsFor(model.useGtd, model.useCalendar);
  const numValue = (c: string): number => {
    if (c === "logBuyin") return f.logBuyin;
    if (c === "logGtd") return f.logGtd ?? model.meanLogGtd;
    if (c === "gtdMissing") return f.logGtd === null ? 1 : 0;
    if (c === "isHoliday") return f.isHoliday;
    if (c === "isPayday") return f.isPayday;
    if (c === "editionTrend") return f.editionTrend;
    return 0;
  };
  let yh = model.beta[0];
  let idx = 1;
  for (const c of numCols) yh += ((numValue(c) - model.numMean[c]) / model.numStd[c]) * model.beta[idx++];
  for (const oh of model.oneHot) {
    const [g, level] = oh.split(":"); // unknown category at predict ⇒ no level matches ⇒ contributes 0 ("other")
    yh += (f[g as keyof PreFeatures] === level ? 1 : 0) * model.beta[idx++];
  }
  return yh;
}

// ---------- public API ----------
interface TrainRow {
  eventId: string; // A2: carried so the walk-forward artifact can key ForecastPoints by event
  f: PreFeatures;
  y: number; // log entries
  date: number; // ms for sorting
  entries: number;
}

function trainRows(events: SeriesEvent[], calendarFeatures = false, censoring = false): TrainRow[] {
  const rows: TrainRow[] = [];
  // allEvents is the FULL history for editionTrend — a censored (sold-out) event still counts as a prior
  // edition even though it is not itself a training row.
  const allEvents = calendarFeatures ? events : undefined; // supplied ⇒ editionTrend computed; else 0 (off path)
  for (const e of events) {
    if (censoring && hitCapacity(e)) continue; // TP6: sold-out = truncated observation → excluded from the fit
    if (e.total_entries === null || !(e.total_entries > 0)) continue;
    if (e.buy_in === null || !(e.buy_in > 0) || e.event_date === null) continue;
    const t = new Date(e.event_date).getTime();
    if (Number.isNaN(t)) continue;
    const f = preFeatures(e.buy_in, e.gtd, e.event_date, e.event_name, undefined, allEvents);
    if (!f) continue;
    rows.push({ eventId: e.event_id, f, y: Math.log(e.total_entries), date: t, entries: e.total_entries });
  }
  return rows.sort((a, b) => a.date - b.date);
}

// ---------- A2: one walk-forward artifact (ForecastPoint) + a SEPARATE scoring layer ----------
// The engine emits ForecastPoint[] WITHOUT actuals (P0-2: a production forecast can never touch the target
// merely by sharing an object with the CV path). A separate scoring layer joins the later-known actual to
// produce ScoredForecast[]. CV error, baseline comparison, and future calibration all REDUCE over this one
// artifact — there is no second evaluation code path that could disagree or leak.
export const ENGINE_VERSION = "turnout-ridge-2"; // Vietnam business calendar features

export interface ForecastPoint {
  eventId: string;
  originTs: string; // ISO of the forecast target event; a walk-forward fold stands STRICTLY before it
  horizon: "event"; // turnout is single-step (the event itself); reserved for future multi-step
  forecast: number | null; // ridge point forecast (entries); null when the model can't produce a usable number
  baseline: number | null; // median of strictly-earlier entries — the honest "do nothing" reference
  engineVersion: string;
}
export interface ScoredForecast extends ForecastPoint {
  actual: number | null; // joined AFTER the event finalises — never visible to the engine at forecast time
  modelError: number | null; // |forecast − actual| / actual (MAPE contribution)
  baselineError: number | null; // |baseline − actual| / actual
}

// ---------- A3: canonical fold context reused by the baseline battery ----------
/** A lean prior-row projection (no PreFeatures) so sibling modules read a fold's training basis without
 *  touching engine internals. `weekday` is the PreFeatures code (wd0..wd6). */
export interface LeanFoldRow {
  entries: number;
  date: number; // ms
  weekday: string;
}
/** One canonical walk-forward fold, exposed for the A3 baseline battery — the SAME folds/origins the model CV
 *  uses (produced by the ONE walkForwardFolds machinery). Carries the already-computed model forecast + median
 *  baseline, the fold's strictly-earlier training rows, and the fold target's own outcome. `targetEntries` is
 *  for the SEPARATE scoring layer ONLY — a predictor must read `train`, never `targetEntries`. */
export interface CvFold {
  eventId: string;
  originTs: string;
  targetWeekday: string;
  targetEntries: number;
  modelForecast: number | null;
  medianBaseline: number | null;
  train: readonly LeanFoldRow[];
}
interface WalkForwardFold {
  point: ForecastPoint;
  actual: number;
  origin: ForecastOrigin;
  targetWeekday: string;
  train: readonly LeanFoldRow[];
}

/** Shared walk-forward engine over pre-built rows: for each row from CV_MIN_TRAIN on, forecast it from ONLY
 *  strictly-earlier rows (pipeline rebuilt per fold). Returns each fold's ForecastPoint paired with the
 *  POSITIONAL actual of that fold's own row (rows[i].entries). The pairing lives ONLY in this internal
 *  scoring machinery — the public artifact (walkForwardRows/walkForward) drops it, so the engine never
 *  emits the target (P0-2). Positional actuals (not id-keyed) keep the internal CV byte-identical to the
 *  pre-A2 loop even when event_id is not unique — CSV import accepts a user-supplied event_id column with
 *  no dedup, so a malformed sheet can repeat an id; positional scoring is immune to that collision. */
function walkForwardFolds(rows: TrainRow[], calendarFeatures = false): WalkForwardFold[] {
  const folds: WalkForwardFold[] = [];
  // A4a: the fold minimum is the gate's canonical MIN_TRAIN_LENGTH (was the local CV_MIN_TRAIN). Starting at
  // i = MIN_TRAIN_LENGTH is a behaviour-preserving optimisation: for i < MIN_TRAIN_LENGTH the strictly-earlier
  // train set has ≤ i < MIN_TRAIN_LENGTH rows and would be skipped anyway.
  for (let i = MIN_TRAIN_LENGTH; i < rows.length; i++) {
    // STRICTLY earlier by DATE, not by index — CSV dates are date-only, so festival days produce ties;
    // an index slice would let same-day events leak into the fold and flatter the CV (the flip gate).
    const train = rows.filter((r) => r.date < rows[i].date);
    if (train.length < MIN_TRAIN_LENGTH) continue;
    const model = buildModel(train.map((r) => ({ f: r.f, y: r.y })), calendarFeatures);
    let forecast: number | null = null;
    if (model) {
      const pred = Math.exp(predictLog(model, rows[i].f));
      if (Number.isFinite(pred) && pred > 0) forecast = pred;
    }
    const baseline = median(train.map((r) => r.entries));
    // A1: the fold's forecast origin (point-in-time anchor). Admit the fold's features against it (fail
    // closed) and retain the origin WITH the fold — the availability metadata survives into the walk-forward
    // origin without altering the public ForecastPoint shape (A2 lock). originTs stays byte-identical:
    // makeOrigin is idempotent on the canonical ISO the pre-A1 code already emitted.
    const origin = makeOrigin(new Date(rows[i].date).toISOString());
    admitStaticPreFeatures(origin, rows[i].f);
    folds.push({
      point: {
        eventId: rows[i].eventId,
        originTs: origin.originTs,
        horizon: "event",
        forecast,
        baseline,
        engineVersion: ENGINE_VERSION,
      },
      actual: rows[i].entries, // positional — the fold's OWN row; never surfaced in the public artifact
      origin, // A1: point-in-time availability anchor retained per fold (internal; not on the artifact)
      // A3: the fold's target weekday + strictly-earlier training rows (lean projection) so the baseline
      // battery reduces over the SAME folds without a second loop/split. Additive — existing consumers
      // (walkForwardRows/walkForwardCv) read only .point/.actual, so this is byte-identical.
      targetWeekday: rows[i].f.weekday,
      train: train.map((r) => ({ entries: r.entries, date: r.date, weekday: r.f.weekday })),
    });
  }
  return folds;
}

/** The public walk-forward artifact: one ForecastPoint per fold, actuals STRIPPED (P0-2). */
function walkForwardRows(rows: TrainRow[], calendarFeatures = false): ForecastPoint[] {
  return walkForwardFolds(rows, calendarFeatures).map((fold) => fold.point);
}

/** Scoring layer: join each ForecastPoint to its later-known actual and compute MAPE contributions. Keeps
 *  forecasts and targets in SEPARATE structures — the engine never receives `actual`. */
export function scoreForecasts(
  points: ForecastPoint[],
  actualByEventId: Map<string, number | null>,
): ScoredForecast[] {
  // Fail closed on duplicate event ids: a single actual-per-id map cannot resolve them, and last-wins would
  // silently score an earlier fold against a later row's actual (the A2 parity-review hazard). Valid data has
  // unique ids so this never fires on the sound path; event_id is NOT enforced unique upstream (CSV import),
  // so this is the EXTERNAL join's guard — the internal CV joins POSITIONALLY (walkForwardCv) and is immune.
  const seen = new Set<string>();
  for (const p of points) {
    if (seen.has(p.eventId)) {
      throw new Error(
        `scoreForecasts: duplicate eventId "${p.eventId}" — actuals cannot be resolved by id unambiguously; ` +
          `de-duplicate before scoring (never last-wins).`,
      );
    }
    seen.add(p.eventId);
  }
  return points.map((p) => {
    const actual = actualByEventId.get(p.eventId) ?? null;
    const rel = (v: number | null): number | null =>
      v !== null && actual !== null && actual !== 0 ? Math.abs(v - actual) / actual : null;
    return { ...p, actual, modelError: rel(p.forecast), baselineError: rel(p.baseline) };
  });
}

/** Full-history walk-forward backtest for a club's events — the canonical ForecastPoint[] artifact that CV,
 *  baseline comparison, and calibration all reduce over. Actuals are joined SEPARATELY via scoreForecasts. */
export function walkForward(events: SeriesEvent[], opts: ForecastOptions = {}): ForecastPoint[] {
  return walkForwardRows(trainRows(events, opts.calendarFeatures === true, opts.censoring === true), opts.calendarFeatures === true);
}

/** Walk-forward CV MAPEs — a pure reduction over the shared fold machinery, scored POSITIONALLY against each
 *  fold's own row (byte-identical to the pre-A2 hand-rolled loop; the A5 parity snapshot guards this). Uses
 *  the same relative-error formula as scoreForecasts, but joins by fold position — NOT by event_id — so the
 *  displayed CV numbers can never drift from the old loop on a malformed CSV with duplicate ids.
 *  Baseline = median of past entries (same protocol). */
function walkForwardCv(rows: TrainRow[], calendarFeatures = false): { modelMape: number | null; baselineMape: number | null } {
  const folds = walkForwardFolds(rows, calendarFeatures);
  // actual is always finite > 0 here (trainRows filters total_entries > 0), matching scoreForecasts' rel().
  const rel = (v: number | null, actual: number): number | null =>
    v !== null && actual !== 0 ? Math.abs(v - actual) / actual : null;
  const mApe = folds.map((f) => rel(f.point.forecast, f.actual)).filter((e): e is number => e !== null);
  const bApe = folds.map((f) => rel(f.point.baseline, f.actual)).filter((e): e is number => e !== null);
  return {
    modelMape: mApe.length ? mean(mApe) * 100 : null,
    baselineMape: bApe.length ? mean(bApe) * 100 : null,
  };
}

// ---------- A3: canonical inputs for the baseline battery (shared past-split + fold machinery) ----------
/** Rows strictly before the target — the SAME past set forecastTurnout trains its target forecast + CV on.
 *  Single-sourced so the baseline battery and the model reduce over identical folds (no second date split). */
function pastTrainRows(events: SeriesEvent[], target: UpcomingEvent, opts: ForecastOptions = {}): TrainRow[] {
  const all = trainRows(events, opts.calendarFeatures === true, opts.censoring === true);
  const targetTime = new Date(target.event_date).getTime();
  return Number.isNaN(targetTime) ? all : all.filter((r) => r.date < targetTime);
}

/** Lean prior rows (entries/date/weekday) strictly before the target — the training basis for the baseline
 *  battery's TARGET-point predictions. Same past set as the model's target forecast; no separate split. */
export function pastLeanRows(events: SeriesEvent[], target: UpcomingEvent, opts: ForecastOptions = {}): LeanFoldRow[] {
  return pastTrainRows(events, target, opts).map((r) => ({ entries: r.entries, date: r.date, weekday: r.f.weekday }));
}

/** The upcoming target's weekday code (wd0..wd6), matching the fold/PreFeatures encoding — lets the
 *  same-weekday baseline group folds and the target consistently. null when the date is unparseable. */
export function targetWeekdayCode(target: UpcomingEvent): string | null {
  const parts = localParts(target.event_date);
  return parts ? `wd${parts.weekday}` : null;
}

/** Median of a numeric list (deterministic even-count handling) — the ONE median implementation, reused by
 *  the baseline battery's historical-median so there is never a duplicate. */
export function medianOf(v: number[]): number | null {
  return median(v);
}

/** THE canonical walk-forward fold set the model CV scores over, exposed for the A3 baseline battery so every
 *  baseline reduces the SAME folds/origins/actuals as the model — no second CV loop, date split, or actual
 *  join. Each fold already carries the model forecast + median baseline; predictors read `train` only. */
export function canonicalCvFolds(events: SeriesEvent[], target: UpcomingEvent, opts: ForecastOptions = {}): CvFold[] {
  return walkForwardFolds(pastTrainRows(events, target, opts), opts.calendarFeatures === true).map((f) => ({
    eventId: f.point.eventId,
    originTs: f.point.originTs,
    targetWeekday: f.targetWeekday,
    targetEntries: f.actual,
    modelForecast: f.point.forecast,
    medianBaseline: f.point.baseline,
    train: f.train,
  }));
}

// ---------- B2: identity inputs for structured forecast provenance (pure; numeric path untouched) ----------
/** A post-admission feature vector — the model-consumed fields, NOT raw UI labels. Values are the log-numerics
 *  + one-hot categorical codes the ridge actually reads. */
export interface ProvenanceFeatureVector {
  readonly [k: string]: number | string | null;
}
/** One training row's identity fields: its feature vector AND its historical outcome `entries` (the training
 *  label). Changing a historical `entries` MUST change the training-data hash. */
export interface ProvenanceTrainingRow {
  eventId: string;
  dateIso: string; // canonical UTC ISO of the training event
  features: ProvenanceFeatureVector;
  entries: number; // the historical outcome used as the training label
}
/** The config the model ACTUALLY consumes — the inputs to modelConfigHash. */
export interface ProvenanceModelConfig {
  calendarFeatures: boolean;
  censoring: boolean;
  lambda: number;
  z: number;
  fullFeatureThreshold: number;
  highNThreshold: number;
  minTrainLength: number;
}
export interface FeatureIdentityInputs {
  targetFeatures: ProvenanceFeatureVector | null; // null when the target params are invalid
  trainingRows: ProvenanceTrainingRow[]; // strictly-earlier rows (the training window), in canonical order
  modelConfig: ProvenanceModelConfig;
}

/** Project a PreFeatures into the canonical, model-consumed feature vector for provenance hashing. Excludes
 *  raw UI labels (e.g. event_name) — only the log-numerics, the gtd-missing flag, and the categorical codes
 *  the ridge reads. `editionTrend` is the DERIVED value (0 when calendar features are off). */
function preFeaturesToVector(f: PreFeatures): ProvenanceFeatureVector {
  return {
    logBuyin: f.logBuyin,
    logGtd: f.logGtd,
    gtdMissing: f.logGtd === null ? 1 : 0,
    weekday: f.weekday,
    quarter: f.quarter,
    hourSlot: f.hourSlot,
    type: f.type,
    isHoliday: f.isHoliday,
    isPayday: f.isPayday,
    editionTrend: f.editionTrend,
  };
}

/**
 * The identity inputs that define a forecast's provenance (B2): the target's post-admission feature vector,
 * the training rows actually used (with their historical outcomes), and the config the model consumes. Pure —
 * reuses the SAME `preFeatures` + `pastTrainRows` the forecast does, so it never diverges from what was
 * predicted, and never touches the numeric path. The target's OWN future outcome is never included (it is the
 * thing being predicted); only historical training outcomes enter the training rows.
 */
export function featureIdentityInputs(
  events: SeriesEvent[],
  target: UpcomingEvent,
  opts: ForecastOptions = {},
): FeatureIdentityInputs {
  const calendarFeatures = opts.calendarFeatures === true;
  const censoring = opts.censoring === true;
  const tf = preFeatures(
    target.buy_in,
    target.gtd,
    target.event_date,
    null,
    target.typeKeyword,
    calendarFeatures ? events : undefined,
    target.event_name ?? null,
  );
  const past = pastTrainRows(events, target, opts);
  return {
    targetFeatures: tf ? preFeaturesToVector(tf) : null,
    trainingRows: past.map((r) => ({
      eventId: r.eventId,
      dateIso: new Date(r.date).toISOString(),
      features: preFeaturesToVector(r.f),
      entries: r.entries,
    })),
    modelConfig: {
      calendarFeatures,
      censoring,
      lambda: LAMBDA,
      z: Z,
      fullFeatureThreshold: FULL_FEATURE_THRESHOLD,
      highNThreshold: HIGH_N_THRESHOLD,
      minTrainLength: MIN_TRAIN_LENGTH,
    },
  };
}

function tierFor(cap: ModelCapability): ForecastConfidence {
  // Same ladder as before via the gate: n >= HIGH_N ⇒ high; n >= MIN_FULL (supportsFullFeatures) ⇒ medium; else low.
  return cap.sampleSize >= cap.highNThreshold ? "high" : cap.supportsFullFeatures ? "medium" : "low";
}
function widenFor(tier: ForecastConfidence): number {
  return tier === "high" ? 1.0 : tier === "medium" ? 1.2 : 1.5;
}

/**
 * Forecast turnout for `target`, training ONLY on events strictly before `target.event_date`.
 * Degrade ladder: N≤1 → unavailable ("cần thêm dữ liệu"); 2≤N<8 → intercept + log(buy-in) only (low);
 * N≥8 → full ridge. Always returns a band + tier + disclaimer; never a bare number, never NaN.
 */
export interface ForecastOptions {
  /** TP2 — when true, add the calendar/edition numeric features (holiday window, payday window, edition
   *  trend) to the design matrix at the full-model tier (n ≥ MIN_FULL). Off (default) ⇒ every output is
   *  byte-identical to the pre-TP2 engine. Wired from FEATURES.seriesCalendarFeatures by the panel. */
  calendarFeatures?: boolean;
  /** TP6 — when true, DROP sold-out (capacity-hit) events from the fit (their entries are a censored ceiling,
   *  not true demand) and cap the forecast band at the target's capacity. Off (default) ⇒ byte-identical. */
  censoring?: boolean;
}

export function forecastTurnout(events: SeriesEvent[], target: UpcomingEvent, opts: ForecastOptions = {}): TurnoutForecast {
  const calendarFeatures = opts.calendarFeatures === true;
  const censoring = opts.censoring === true;
  // Censoring drops capacity-hit events from the FIT (their entries are a truncated ceiling, not true demand),
  // but they still count as prior editions for editionTrend — trainRows handles that. Off ⇒ byte-identical.
  const excludedCount = censoring ? events.filter((e) => hitCapacity(e)).length : 0;
  // A3: `past` is single-sourced via pastTrainRows so the baseline battery reduces the identical fold set
  // (byte-identical to the previous inline trainRows + strictly-before-target filter).
  const past = pastTrainRows(events, target, opts);
  const n = past.length;
  // A4a: one capability evaluation drives every sample-size decision below (unavailable gate, degraded flag,
  // tier, and the ≥HIGH_N note). Same thresholds as before, sourced only from the gate.
  const capability = evaluateModelCapability({ kind: "sample_size", sampleSize: n });
  const notes: string[] = [];

  const empty = (note: string): TurnoutForecast => ({
    available: false, base: null, low: null, high: null, confidence: "low", sampleSize: n, degraded: !capability.supportsFullFeatures,
    modelMapePct: null, baselineMapePct: null, deltaVsBaselinePct: null, coefContributions: [], missingDataNotes: [note], disclaimer: DISCLAIMER,
  });

  if (!capability.supportsForecast) return empty(`Chỉ có ${n} giải trước ngày này — cần thêm dữ liệu để dự báo.`);

  // Target features: type stays typeKeyword-driven (name = null, unchanged); the brand name is passed
  // ONLY as editionName so editionTrend can count the target's prior editions. allEvents supplied only when on.
  const tf = preFeatures(
    target.buy_in,
    target.gtd,
    target.event_date,
    null,
    target.typeKeyword,
    calendarFeatures ? events : undefined,
    target.event_name ?? null,
  );
  if (!tf) return empty("Thông số giải sắp tới chưa hợp lệ (cần buy-in > 0 và ngày hợp lệ).");

  // A1: admit the target's features at the target's OWN forecast origin (fail closed) — the serving path
  // passes the same point-in-time boundary as every walk-forward fold. Numeric-neutral (the prediction below
  // reads `tf` directly); the date is valid here since tf built ⇒ localParts parsed target.event_date.
  admitStaticPreFeatures(makeOrigin(target.event_date), tf);

  const model = buildModel(past.map((r) => ({ f: r.f, y: r.y })), calendarFeatures);
  if (!model) return empty("Không dựng được mô hình từ dữ liệu hiện có.");

  const tier = tierFor(capability);
  const degraded = !model.useOneHot;
  const yh = predictLog(model, tf);
  const sigma = model.rmse * Math.sqrt(1 + 1 / n) * widenFor(tier);
  let base = Math.round(Math.exp(yh));
  let low = Math.round(Math.exp(yh - Z * sigma));
  let high = Math.round(Math.exp(yh + Z * sigma));

  const { modelMape, baselineMape } = walkForwardCv(past, calendarFeatures);
  const delta = modelMape !== null && baselineMape !== null ? baselineMape - modelMape : null;

  const coefContributions: CoefContribution[] = model.cols.slice(1).map((feature, i) => {
    const beta = model.beta[i + 1];
    return { feature, beta, impactPct: Math.round((Math.exp(beta) - 1) * 1000) / 10 };
  });

  if (degraded) notes.push(`Ít dữ liệu (${n} giải) — chỉ dùng buy-in, dải nới rộng, chỉ tham khảo.`);
  // `tier !== "high"` ⟺ the old `n < HIGH_N`; the display number reads the gate's canonical highNThreshold.
  if (tier !== "high") notes.push(`Cần ≥${capability.highNThreshold} giải để đạt độ tin cậy cao (hiện ${n}).`);
  if (tf.logGtd === null) notes.push("Giải sắp tới chưa đặt GTD — overlay sẽ không tính được.");

  // TP6 censoring — note the truncated events dropped from the fit, and cap the band at the target's capacity
  // (attendance can't exceed seats). Surfacing when the demand estimate itself exceeds capacity = sell-out risk.
  if (censoring) {
    if (excludedCount > 0)
      notes.push(`${excludedCount} giải chạm trần sức chứa đã loại khỏi mô hình (dữ liệu bị cắt — truncated).`);
    const cap = target.capacity;
    if (cap != null && cap > 0) {
      const preCapBase = base;
      high = Math.min(high, cap);
      base = Math.min(base, high);
      low = Math.min(low, high);
      notes.push(`Giới hạn theo sức chứa ${cap} — dải & dự báo không vượt số ghế.`);
      if (preCapBase > cap) notes.push(`Cầu ước tính (~${preCapBase}) vượt sức chứa → nhiều khả năng cháy vé.`);
    }
  }

  return {
    available: true,
    base,
    low: Math.max(0, low),
    high,
    confidence: tier,
    sampleSize: n,
    degraded,
    modelMapePct: modelMape === null ? null : Math.round(modelMape * 10) / 10,
    baselineMapePct: baselineMape === null ? null : Math.round(baselineMape * 10) / 10,
    deltaVsBaselinePct: delta === null ? null : Math.round(delta * 10) / 10,
    coefContributions,
    missingDataNotes: notes,
    disclaimer: DISCLAIMER,
  };
}

// ---------- tiny pure linear algebra ----------
function mean(v: number[]): number {
  return v.length ? v.reduce((a, c) => a + c, 0) / v.length : 0;
}
function std(v: number[], m: number): number {
  if (v.length < 2) return 0;
  return Math.sqrt(v.reduce((a, c) => a + (c - m) * (c - m), 0) / v.length);
}
function median(v: number[]): number | null {
  const s = v.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}
function zeros(r: number, c: number): number[][] {
  return Array.from({ length: r }, () => new Array(c).fill(0));
}
/** Solve SPD A x = b via Cholesky. Returns null if A is not positive-definite. */
function choleskySolve(A: number[][], b: number[]): number[] | null {
  const n = A.length;
  const L = zeros(n, n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = A[i][j];
      for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
      if (i === j) {
        if (sum <= 1e-12) return null;
        L[i][j] = Math.sqrt(sum);
      } else {
        L[i][j] = sum / L[j][j];
      }
    }
  }
  const yv = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= L[i][k] * yv[k];
    yv[i] = s / L[i][i];
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = yv[i];
    for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k];
    x[i] = s / L[i][i];
  }
  return x;
}
