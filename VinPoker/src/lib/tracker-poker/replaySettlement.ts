export const REPLAY_SETTLEMENT_SCHEMA_V1 = "settlement-outcome-v1" as const;

export interface ReplaySettlementPlayer {
  playerId: string;
  potAward: number;
  refund: number;
  netDelta: number;
}

export interface ReplaySettlementAllocation {
  potId: string;
  winnerId: string;
  amount: number;
}

export interface ReplaySettlementPot {
  potId: string;
  kind: "main" | "side";
  amount: number;
  winnerIds: string[];
  allocations: ReplaySettlementAllocation[];
}

export interface ReplaySettlementRefund {
  playerId: string;
  amount: number;
  sourceActionId: string;
}

export interface ReplaySettlementHandRank {
  playerId: string;
  category: string;
  bestFive: string[];
  kickers: string[];
}

/**
 * Narrow display projection returned by get_public_tournament_settlement.
 * The RPC proves freshness and strips hashes/revisions/private evidence before
 * this payload reaches the browser. This type intentionally contains no inputs
 * from which the client could re-settle a hand.
 */
export interface ReplayPublicSettlement {
  schemaVersion: typeof REPLAY_SETTLEMENT_SCHEMA_V1;
  status: "verified";
  players: ReplaySettlementPlayer[];
  pots: ReplaySettlementPot[];
  refunds: ReplaySettlementRefund[];
  handRanks: ReplaySettlementHandRank[];
}

type JsonRecord = Record<string, unknown>;

const FORBIDDEN_PUBLIC_FIELDS = new Set([
  "privateEvidence",
  "holeCards",
  "holeCardsByPlayer",
  "muckedHoleCardsByPlayer",
  "externalAdjustments",
  "evaluatorInput",
  "correctionNotes",
  "actor",
  "sourceChainHash",
  "outcomeHash",
  "sourceRevision",
  "settlementRevision",
  "ruleVersion",
]);

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function containsForbiddenField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenField);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, child]) => FORBIDDEN_PUBLIC_FIELDS.has(key) || containsForbiddenField(child));
}

function chip(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function signedChip(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function textArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => text(item) === null)) return null;
  return value.map((item) => item as string);
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function safeSum(values: readonly number[]): number | null {
  let total = 0;
  for (const value of values) {
    total += value;
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}

/**
 * Fail-closed decoder for the public RPC payload. It validates only display
 * consistency (allocation/refund totals and privacy); it never chooses a winner
 * or evaluates cards in the browser.
 */
export function parseReplayPublicSettlement(value: unknown): ReplayPublicSettlement | null {
  if (!isRecord(value) || Object.keys(value).length === 0 || containsForbiddenField(value)) return null;
  if (value.schemaVersion !== REPLAY_SETTLEMENT_SCHEMA_V1 || value.status !== "verified") return null;
  if (!Array.isArray(value.players) || !Array.isArray(value.pots) || !Array.isArray(value.refunds) || !Array.isArray(value.handRanks)) {
    return null;
  }

  const players: ReplaySettlementPlayer[] = [];
  for (const raw of value.players) {
    if (!isRecord(raw)) return null;
    const playerId = text(raw.playerId);
    const potAward = chip(raw.potAward);
    const refund = chip(raw.refund);
    const netDelta = signedChip(raw.netDelta);
    if (!playerId || potAward === null || refund === null || netDelta === null) return null;
    players.push({ playerId, potAward, refund, netDelta });
  }
  const playerIds = players.map((player) => player.playerId);
  if (!unique(playerIds)) return null;
  const playerIdSet = new Set(playerIds);

  const pots: ReplaySettlementPot[] = [];
  for (const raw of value.pots) {
    if (!isRecord(raw)) return null;
    const potId = text(raw.potId);
    const amount = chip(raw.amount);
    const winnerIds = textArray(raw.winnerIds);
    if (!potId || amount === null || (raw.kind !== "main" && raw.kind !== "side") || !winnerIds || !unique(winnerIds)) return null;
    if (winnerIds.length === 0 || winnerIds.some((id) => !playerIdSet.has(id)) || !Array.isArray(raw.allocations)) return null;

    const allocations: ReplaySettlementAllocation[] = [];
    for (const rawAllocation of raw.allocations) {
      if (!isRecord(rawAllocation)) return null;
      const allocationPotId = text(rawAllocation.potId);
      const winnerId = text(rawAllocation.winnerId);
      const allocationAmount = chip(rawAllocation.amount);
      if (!allocationPotId || allocationPotId !== potId || !winnerId || !winnerIds.includes(winnerId) || allocationAmount === null) return null;
      allocations.push({ potId: allocationPotId, winnerId, amount: allocationAmount });
    }
    if (safeSum(allocations.map((allocation) => allocation.amount)) !== amount) return null;
    if (new Set(allocations.map((allocation) => allocation.winnerId)).size !== winnerIds.length) return null;
    pots.push({ potId, kind: raw.kind, amount, winnerIds, allocations });
  }
  if (!unique(pots.map((pot) => pot.potId))) return null;
  if (pots.length > 0 && pots.filter((pot) => pot.kind === "main").length !== 1) return null;
  if (safeSum(pots.map((pot) => pot.amount)) === null) return null;

  const refunds: ReplaySettlementRefund[] = [];
  for (const raw of value.refunds) {
    if (!isRecord(raw)) return null;
    const playerId = text(raw.playerId);
    const amount = chip(raw.amount);
    const sourceActionId = text(raw.sourceActionId);
    if (!playerId || !playerIdSet.has(playerId) || amount === null || !sourceActionId) return null;
    refunds.push({ playerId, amount, sourceActionId });
  }
  if (!unique(refunds.map((refund) => refund.sourceActionId))) return null;

  const awardsByPlayer = new Map<string, number>();
  for (const allocation of pots.flatMap((pot) => pot.allocations)) {
    const next = safeSum([awardsByPlayer.get(allocation.winnerId) ?? 0, allocation.amount]);
    if (next === null) return null;
    awardsByPlayer.set(allocation.winnerId, next);
  }
  const refundsByPlayer = new Map<string, number>();
  for (const refund of refunds) {
    const next = safeSum([refundsByPlayer.get(refund.playerId) ?? 0, refund.amount]);
    if (next === null) return null;
    refundsByPlayer.set(refund.playerId, next);
  }
  if (players.some((player) => player.potAward !== (awardsByPlayer.get(player.playerId) ?? 0))) return null;
  if (players.some((player) => player.refund !== (refundsByPlayer.get(player.playerId) ?? 0))) return null;

  const handRanks: ReplaySettlementHandRank[] = [];
  for (const raw of value.handRanks) {
    if (!isRecord(raw)) return null;
    const playerId = text(raw.playerId);
    const category = text(raw.category);
    const bestFive = textArray(raw.bestFive);
    const kickers = textArray(raw.kickers);
    if (!playerId || !playerIdSet.has(playerId) || !category || !bestFive || bestFive.length !== 5 || !kickers) return null;
    handRanks.push({ playerId, category, bestFive, kickers });
  }
  if (!unique(handRanks.map((rank) => rank.playerId))) return null;
  if (pots.length === 0 && !(players.length >= 2 && refunds.length === 1 && refunds[0].amount > 0
    && handRanks.length === 0 && players.every((player) => player.potAward === 0 && player.netDelta === 0))) return null;

  return {
    schemaVersion: REPLAY_SETTLEMENT_SCHEMA_V1,
    status: "verified",
    players,
    pots,
    refunds,
    handRanks,
  };
}
