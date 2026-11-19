// Smart Player Card — types for the get_player_intelligence digest (read-only).
// The RPC returns Json; parsePlayerIntelligence() validates defensively.

export type ProfileStatus = "new" | "provisional" | "verified";
export type ConfidenceLevel = "low" | "medium" | "high";
export type StructureBand = "deep" | "standard" | "turbo";

export interface ScenarioWindow {
  tournaments: number;
  expectedItm: number | null;
  chanceAtLeastOneItm: number | null;
  finalTableChance?: number | null;
}

export interface PlayerIntelligence {
  profileStatus: ProfileStatus;
  confidence: ConfidenceLevel;
  verifiedSample: {
    totalEntries: number;
    uniqueEvents: number;
    reentries: number;
    lastPlayedAt: string | null;
  };
  results: {
    itmRate: number | null;
    finalTableRate: number | null;
    top3Rate: number | null;
    avgNormalizedFinish: number | null;
    recentFormDelta: number | null;
  };
  bands: {
    bestBuyInBand: string | null;
    bestFieldSizeBand: string | null;
    bestStructure: StructureBand | null;
  };
  sourceQuality: {
    finishPosition: string;
    itm: string;
    finalTable: string;
    fieldSize: string;
    structure: string;
    identity: string;
  };
  scenarioOutlook: {
    unlocked: boolean;
    reasonLocked: string | null;
    basedOn: { verifiedEntries: number; itmRate: number | null; rateMethod: string; confidence: string };
    windows: ScenarioWindow[];
  };
  locked: { scenarioOutlook: boolean; dreamLadder: boolean };
}

export type NextActionKey =
  | "play_drill"
  | "join_first_event"
  | "keep_playing_recorded"
  | "see_fit_events"
  | "track_progress";

const num = (v: unknown): number => (typeof v === "number" && isFinite(v) ? v : 0);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && isFinite(v) ? v : null);
const str = (v: unknown, fallback = "unknown"): string => (typeof v === "string" && v ? v : fallback);
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** Defensive parse of the RPC's Json result. Returns null only when input is unusable. */
export function parsePlayerIntelligence(raw: unknown): PlayerIntelligence | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, any>;
  const status = r.profileStatus;
  if (status !== "verified" && status !== "provisional" && status !== "new") return null;
  const conf: ConfidenceLevel =
    r.confidence === "high" || r.confidence === "medium" ? r.confidence : "low";
  const vs = r.verifiedSample;
  if (!vs || !count(vs.totalEntries) || !count(vs.uniqueEvents) || !count(vs.reentries)
    || vs.uniqueEvents > vs.totalEntries || vs.reentries > vs.totalEntries
    || (status === "new") !== (vs.totalEntries === 0)) return null;
  const res = r.results ?? {};
  const bands = r.bands ?? {};
  const sq = r.sourceQuality ?? {};
  const so = r.scenarioOutlook ?? {};
  const locked = r.locked ?? {};
  const windows: ScenarioWindow[] = Array.isArray(so.windows)
    ? so.windows.map((w: any) => ({
        tournaments: num(w?.tournaments),
        expectedItm: numOrNull(w?.expectedItm),
        chanceAtLeastOneItm: numOrNull(w?.chanceAtLeastOneItm),
        finalTableChance: numOrNull(w?.finalTableChance),
      }))
    : [];

  return {
    profileStatus: status,
    confidence: conf,
    verifiedSample: {
      totalEntries: vs.totalEntries,
      uniqueEvents: vs.uniqueEvents,
      reentries: vs.reentries,
      lastPlayedAt: typeof vs.lastPlayedAt === "string" && Number.isFinite(Date.parse(vs.lastPlayedAt)) ? vs.lastPlayedAt : null,
    },
    results: {
      itmRate: numOrNull(res.itmRate),
      finalTableRate: numOrNull(res.finalTableRate),
      top3Rate: numOrNull(res.top3Rate),
      avgNormalizedFinish: numOrNull(res.avgNormalizedFinish),
      recentFormDelta: numOrNull(res.recentFormDelta),
    },
    bands: {
      bestBuyInBand: typeof bands.bestBuyInBand === "string" ? bands.bestBuyInBand : null,
      bestFieldSizeBand: typeof bands.bestFieldSizeBand === "string" ? bands.bestFieldSizeBand : null,
      bestStructure:
        bands.bestStructure === "deep" || bands.bestStructure === "standard" || bands.bestStructure === "turbo"
          ? bands.bestStructure
          : null,
    },
    sourceQuality: {
      finishPosition: str(sq.finishPosition),
      itm: str(sq.itm),
      finalTable: str(sq.finalTable),
      fieldSize: str(sq.fieldSize),
      structure: str(sq.structure),
      identity: str(sq.identity),
    },
    scenarioOutlook: {
      unlocked: so.unlocked === true,
      reasonLocked: typeof so.reasonLocked === "string" ? so.reasonLocked : null,
      basedOn: {
        verifiedEntries: num(so.basedOn?.verifiedEntries),
        itmRate: numOrNull(so.basedOn?.itmRate),
        rateMethod: str(so.basedOn?.rateMethod),
        confidence: str(so.basedOn?.confidence, conf),
      },
      windows,
    },
    locked: {
      scenarioOutlook: locked.scenarioOutlook !== false,
      dreamLadder: locked.dreamLadder !== false,
    },
  };
}
