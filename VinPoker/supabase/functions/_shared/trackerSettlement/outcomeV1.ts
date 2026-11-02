export const SETTLEMENT_SCHEMA_V1 = "settlement-outcome-v1" as const;
export const ODD_CHIP_RULE_V1 = "clockwise-first-eligible-winner-left-of-button/v1" as const;

export type SettlementStatusV1 = "verified" | "stale" | "needs_resettle";

export type PlayerSettlementV1 = {
  playerId: string;
  startingStack: number;
  committedTotal: number;
  potAward: number;
  refund: number;
  creditedTotal: number;
  netDelta: number;
  externalDelta: number;
  endingStack: number;
};

export type PotAllocation = {
  potId: string;
  winnerId: string;
  amount: number;
  includesOddChip: boolean;
};

export type SettledPotV1 = {
  potId: string;
  kind: "main" | "side";
  amount: number;
  eligiblePlayerIds: readonly string[];
  winnerIds: readonly string[];
  allocations: readonly PotAllocation[];
};

export type UncalledRefundV1 = {
  playerId: string;
  amount: number;
  sourceActionId: string;
};

export type SettlementTotalsV1 = {
  startingStack: number;
  committedTotal: number;
  distributablePot: number;
  refundTotal: number;
  potAward: number;
  creditedTotal: number;
  netDelta: number;
  externalDelta: number;
  endingStack: number;
};

export type PublicHandRankV1 = {
  playerId: string;
  category: string;
  bestFive: readonly string[];
  kickers: readonly string[];
};

export type PrivateHandRankV1 = PublicHandRankV1 & {
  isPublic: boolean;
  holeCards?: readonly string[];
  evaluatorInput?: unknown;
};

export type SettlementSourceSeatV1 = {
  seatNumber: number;
  playerId: string;
  startingStack: number;
};

export type SettlementSourceActionV1 = {
  actionId: string;
  actionOrder: number;
  playerId: string;
  street: string;
  actionType: string;
  amount: number;
};

export type VerifiedExternalAdjustmentV1 = {
  playerId: string;
  amount: number;
  sourceType: "reentry" | "addon" | "admin_adjustment";
  sourceId: string;
};

export type SettlementSourceHandRevisionV1 = {
  handId: string;
  handNumber: number;
  sourceRevision: number;
  sourceHash: string;
};

export type PrivateSettlementEvidenceV1 = {
  targetHandId: string;
  buttonSeat: number;
  communityCards: readonly string[];
  seats: readonly SettlementSourceSeatV1[];
  actions: readonly SettlementSourceActionV1[];
  sourceChain: readonly SettlementSourceHandRevisionV1[];
  externalAdjustments: readonly VerifiedExternalAdjustmentV1[];
  holeCardsByPlayer: Readonly<Record<string, readonly string[]>>;
  muckedHoleCardsByPlayer: Readonly<Record<string, readonly string[]>>;
  evaluatorInput?: unknown;
  correctionNotes?: string;
  actor?: {
    userId: string;
    role: string;
  };
};

type SettlementEnvelopeV1<TRank> = {
  schemaVersion: typeof SETTLEMENT_SCHEMA_V1;
  status: SettlementStatusV1;
  sourceRevision: number;
  sourceChainHash: string;
  settlementRevision: number;
  outcomeHash: string;
  ruleVersion: typeof ODD_CHIP_RULE_V1;
  players: readonly PlayerSettlementV1[];
  pots: readonly SettledPotV1[];
  refunds: readonly UncalledRefundV1[];
  handRanks: readonly TRank[];
  totals: SettlementTotalsV1;
};

export type PublicSettlementOutcomeV1 = SettlementEnvelopeV1<PublicHandRankV1>;

export type PrivateSettlementOutcomeV1 = SettlementEnvelopeV1<PrivateHandRankV1> & {
  privateEvidence: PrivateSettlementEvidenceV1;
};

export type SettlementValidationIssueV1 = {
  code: string;
  path: string;
  message: string;
};

export type SettlementValidationResultV1 =
  | { ok: true; issues: readonly [] }
  | { ok: false; issues: readonly SettlementValidationIssueV1[] };

export class SettlementContractErrorV1 extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettlementContractErrorV1";
  }
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isChip(value: unknown, signed = false): value is number {
  return Number.isSafeInteger(value) && (signed || (value as number) >= 0);
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function requireSafeSum(
  values: readonly number[],
  path: string,
  issues: SettlementValidationIssueV1[],
): number {
  const total = sum(values);
  if (!Number.isSafeInteger(total)) {
    addIssue(issues, "INTEGER_SUM_OVERFLOW", path, "integer sum exceeds Number.MAX_SAFE_INTEGER");
  }
  return total;
}

function addIssue(
  issues: SettlementValidationIssueV1[],
  code: string,
  path: string,
  message: string,
): void {
  issues.push({ code, path, message });
}

function requireChip(
  record: JsonRecord,
  key: string,
  path: string,
  issues: SettlementValidationIssueV1[],
  signed = false,
): number {
  const value = record[key];
  if (!isChip(value, signed)) {
    addIssue(issues, "INVALID_CHIP", `${path}.${key}`, `${key} must be a safe integer${signed ? "" : " >= 0"}`);
    return 0;
  }
  return value;
}

function requireString(
  record: JsonRecord,
  key: string,
  path: string,
  issues: SettlementValidationIssueV1[],
): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") {
    addIssue(issues, "INVALID_STRING", `${path}.${key}`, `${key} must be a non-empty string`);
    return "";
  }
  return value;
}

function requireStringArray(
  value: unknown,
  path: string,
  issues: SettlementValidationIssueV1[],
): string[] {
  if (!Array.isArray(value)) {
    addIssue(issues, "INVALID_ARRAY", path, "expected an array");
    return [];
  }
  const result: string[] = [];
  value.forEach((item, index) => {
    if (typeof item !== "string" || item.trim() === "") {
      addIssue(issues, "INVALID_STRING", `${path}[${index}]`, "expected a non-empty string");
    } else {
      result.push(item);
    }
  });
  return result;
}

function requireUnique(values: readonly string[], path: string, issues: SettlementValidationIssueV1[]): void {
  if (new Set(values).size !== values.length) {
    addIssue(issues, "DUPLICATE_ID", path, "values must be unique");
  }
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function parsePlayer(
  value: unknown,
  index: number,
  issues: SettlementValidationIssueV1[],
): PlayerSettlementV1 | null {
  const path = `players[${index}]`;
  if (!isRecord(value)) {
    addIssue(issues, "INVALID_PLAYER", path, "player settlement must be an object");
    return null;
  }
  const player: PlayerSettlementV1 = {
    playerId: requireString(value, "playerId", path, issues),
    startingStack: requireChip(value, "startingStack", path, issues),
    committedTotal: requireChip(value, "committedTotal", path, issues),
    potAward: requireChip(value, "potAward", path, issues),
    refund: requireChip(value, "refund", path, issues),
    creditedTotal: requireChip(value, "creditedTotal", path, issues),
    netDelta: requireChip(value, "netDelta", path, issues, true),
    externalDelta: requireChip(value, "externalDelta", path, issues, true),
    endingStack: requireChip(value, "endingStack", path, issues),
  };

  const creditedTotal = requireSafeSum([player.potAward, player.refund], `${path}.creditedTotal`, issues);
  const endingStack = requireSafeSum(
    [player.startingStack, player.netDelta, player.externalDelta],
    `${path}.endingStack`,
    issues,
  );
  if (player.creditedTotal !== creditedTotal) {
    addIssue(issues, "PLAYER_CREDIT_FORMULA", `${path}.creditedTotal`, "creditedTotal must equal potAward + refund");
  }
  if (player.netDelta !== player.creditedTotal - player.committedTotal) {
    addIssue(issues, "PLAYER_NET_FORMULA", `${path}.netDelta`, "netDelta must equal creditedTotal - committedTotal");
  }
  if (player.endingStack !== endingStack) {
    addIssue(issues, "PLAYER_ENDING_FORMULA", `${path}.endingStack`, "endingStack formula does not balance");
  }
  return player;
}

function parsePot(
  value: unknown,
  index: number,
  playerIds: ReadonlySet<string>,
  issues: SettlementValidationIssueV1[],
): SettledPotV1 | null {
  const path = `pots[${index}]`;
  if (!isRecord(value)) {
    addIssue(issues, "INVALID_POT", path, "settled pot must be an object");
    return null;
  }
  const potId = requireString(value, "potId", path, issues);
  const amount = requireChip(value, "amount", path, issues);
  const kind = value.kind === "main" || value.kind === "side" ? value.kind : "main";
  if (value.kind !== "main" && value.kind !== "side") {
    addIssue(issues, "INVALID_POT_KIND", `${path}.kind`, "kind must be main or side");
  }
  if (amount <= 0) addIssue(issues, "EMPTY_POT", `${path}.amount`, "settled pot amount must be > 0");

  const eligiblePlayerIds = requireStringArray(value.eligiblePlayerIds, `${path}.eligiblePlayerIds`, issues);
  const winnerIds = requireStringArray(value.winnerIds, `${path}.winnerIds`, issues);
  requireUnique(eligiblePlayerIds, `${path}.eligiblePlayerIds`, issues);
  requireUnique(winnerIds, `${path}.winnerIds`, issues);
  if (eligiblePlayerIds.length === 0) addIssue(issues, "EMPTY_ELIGIBILITY", `${path}.eligiblePlayerIds`, "pot must have eligible players");
  if (winnerIds.length === 0) addIssue(issues, "EMPTY_WINNERS", `${path}.winnerIds`, "verified pot must have winners");
  for (const playerId of eligiblePlayerIds) {
    if (!playerIds.has(playerId)) addIssue(issues, "UNKNOWN_ELIGIBLE_PLAYER", `${path}.eligiblePlayerIds`, playerId);
  }
  for (const winnerId of winnerIds) {
    if (!eligiblePlayerIds.includes(winnerId)) addIssue(issues, "INELIGIBLE_WINNER", `${path}.winnerIds`, winnerId);
  }

  const rawAllocations = Array.isArray(value.allocations) ? value.allocations : [];
  if (!Array.isArray(value.allocations)) addIssue(issues, "INVALID_ARRAY", `${path}.allocations`, "expected an array");
  const allocations: PotAllocation[] = [];
  rawAllocations.forEach((allocation, allocationIndex) => {
    const allocationPath = `${path}.allocations[${allocationIndex}]`;
    if (!isRecord(allocation)) {
      addIssue(issues, "INVALID_ALLOCATION", allocationPath, "allocation must be an object");
      return;
    }
    const parsed: PotAllocation = {
      potId: requireString(allocation, "potId", allocationPath, issues),
      winnerId: requireString(allocation, "winnerId", allocationPath, issues),
      amount: requireChip(allocation, "amount", allocationPath, issues),
      includesOddChip: allocation.includesOddChip === true,
    };
    if (typeof allocation.includesOddChip !== "boolean") {
      addIssue(issues, "INVALID_BOOLEAN", `${allocationPath}.includesOddChip`, "includesOddChip must be boolean");
    }
    if (parsed.potId !== potId) addIssue(issues, "ALLOCATION_POT_MISMATCH", `${allocationPath}.potId`, parsed.potId);
    if (!winnerIds.includes(parsed.winnerId)) addIssue(issues, "ALLOCATION_NON_WINNER", `${allocationPath}.winnerId`, parsed.winnerId);
    if (parsed.amount <= 0) addIssue(issues, "EMPTY_ALLOCATION", `${allocationPath}.amount`, "allocation amount must be > 0");
    allocations.push(parsed);
  });

  const allocationWinnerIds = allocations.map((allocation) => allocation.winnerId);
  requireUnique(allocationWinnerIds, `${path}.allocations[].winnerId`, issues);
  if (!sameSet(winnerIds, allocationWinnerIds)) {
    addIssue(issues, "WINNER_ALLOCATION_MISMATCH", `${path}.allocations`, "winnerIds must match allocation winner ids");
  }
  if (requireSafeSum(allocations.map((allocation) => allocation.amount), `${path}.allocations`, issues) !== amount) {
    addIssue(issues, "POT_ALLOCATION_SUM", `${path}.allocations`, "allocation sum must equal pot amount");
  }

  return { potId, kind, amount, eligiblePlayerIds, winnerIds, allocations };
}

function parseRefund(
  value: unknown,
  index: number,
  playerIds: ReadonlySet<string>,
  issues: SettlementValidationIssueV1[],
): UncalledRefundV1 | null {
  const path = `refunds[${index}]`;
  if (!isRecord(value)) {
    addIssue(issues, "INVALID_REFUND", path, "refund must be an object");
    return null;
  }
  const refund: UncalledRefundV1 = {
    playerId: requireString(value, "playerId", path, issues),
    amount: requireChip(value, "amount", path, issues),
    sourceActionId: requireString(value, "sourceActionId", path, issues),
  };
  if (!playerIds.has(refund.playerId)) addIssue(issues, "UNKNOWN_REFUND_PLAYER", `${path}.playerId`, refund.playerId);
  if (refund.amount <= 0) addIssue(issues, "EMPTY_REFUND", `${path}.amount`, "refund amount must be > 0");
  return refund;
}

function parseTotals(value: unknown, issues: SettlementValidationIssueV1[]): SettlementTotalsV1 | null {
  if (!isRecord(value)) {
    addIssue(issues, "INVALID_TOTALS", "totals", "totals must be an object");
    return null;
  }
  return {
    startingStack: requireChip(value, "startingStack", "totals", issues),
    committedTotal: requireChip(value, "committedTotal", "totals", issues),
    distributablePot: requireChip(value, "distributablePot", "totals", issues),
    refundTotal: requireChip(value, "refundTotal", "totals", issues),
    potAward: requireChip(value, "potAward", "totals", issues),
    creditedTotal: requireChip(value, "creditedTotal", "totals", issues),
    netDelta: requireChip(value, "netDelta", "totals", issues, true),
    externalDelta: requireChip(value, "externalDelta", "totals", issues, true),
    endingStack: requireChip(value, "endingStack", "totals", issues),
  };
}

function checkTotal(
  actual: number,
  expected: number,
  key: keyof SettlementTotalsV1,
  issues: SettlementValidationIssueV1[],
): void {
  if (actual !== expected) addIssue(issues, "TOTAL_MISMATCH", `totals.${key}`, `expected ${expected}, got ${actual}`);
}

function validateCardMap(
  value: unknown,
  path: string,
  playerIds: ReadonlySet<string>,
  issues: SettlementValidationIssueV1[],
): string[] {
  if (!isRecord(value)) {
    addIssue(issues, "INVALID_CARD_MAP", path, "card map must be an object");
    return [];
  }
  const mappedPlayers = Object.keys(value);
  for (const playerId of mappedPlayers) {
    if (!playerIds.has(playerId)) addIssue(issues, "UNKNOWN_CARD_PLAYER", `${path}.${playerId}`, playerId);
    const cards = requireStringArray(value[playerId], `${path}.${playerId}`, issues);
    if (cards.length !== 2) addIssue(issues, "INVALID_HOLE_CARD_COUNT", `${path}.${playerId}`, "hole cards must contain exactly two cards");
  }
  return mappedPlayers;
}

function validatePrivateEvidence(
  value: unknown,
  players: readonly PlayerSettlementV1[],
  refunds: readonly UncalledRefundV1[],
  expectedSourceRevision: number,
  issues: SettlementValidationIssueV1[],
): void {
  const path = "privateEvidence";
  if (!isRecord(value)) {
    addIssue(issues, "INVALID_PRIVATE_EVIDENCE", path, "private evidence must be an object");
    return;
  }
  const targetHandId = requireString(value, "targetHandId", path, issues);
  const buttonSeat = requireChip(value, "buttonSeat", path, issues);
  if (buttonSeat <= 0 || buttonSeat > 10) addIssue(issues, "INVALID_BUTTON_SEAT", `${path}.buttonSeat`, "button must be a physical seat in 1..10");
  const communityCards = requireStringArray(value.communityCards, `${path}.communityCards`, issues);
  requireUnique(communityCards, `${path}.communityCards`, issues);
  if (communityCards.length > 5) addIssue(issues, "INVALID_BOARD", `${path}.communityCards`, "board cannot contain more than five cards");

  const playerIds = new Set(players.map((player) => player.playerId));
  const playerById = new Map(players.map((player) => [player.playerId, player]));
  const rawSeats = Array.isArray(value.seats) ? value.seats : [];
  if (!Array.isArray(value.seats)) addIssue(issues, "INVALID_ARRAY", `${path}.seats`, "expected an array");
  const seatNumbers: string[] = [];
  const seatedPlayerIds: string[] = [];
  rawSeats.forEach((seat, index) => {
    const seatPath = `${path}.seats[${index}]`;
    if (!isRecord(seat)) {
      addIssue(issues, "INVALID_SOURCE_SEAT", seatPath, "source seat must be an object");
      return;
    }
    const seatNumber = requireChip(seat, "seatNumber", seatPath, issues);
    const playerId = requireString(seat, "playerId", seatPath, issues);
    const startingStack = requireChip(seat, "startingStack", seatPath, issues);
    if (seatNumber <= 0) addIssue(issues, "INVALID_SEAT_NUMBER", `${seatPath}.seatNumber`, "seat number must be > 0");
    seatNumbers.push(String(seatNumber));
    seatedPlayerIds.push(playerId);
    if (!playerIds.has(playerId)) addIssue(issues, "UNKNOWN_SOURCE_PLAYER", `${seatPath}.playerId`, playerId);
    if (playerById.get(playerId)?.startingStack !== startingStack) {
      addIssue(issues, "SOURCE_STARTING_STACK_MISMATCH", `${seatPath}.startingStack`, playerId);
    }
  });
  requireUnique(seatNumbers, `${path}.seats[].seatNumber`, issues);
  requireUnique(seatedPlayerIds, `${path}.seats[].playerId`, issues);
  if (!sameSet([...playerIds], seatedPlayerIds)) {
    addIssue(issues, "SOURCE_SEAT_SET_MISMATCH", `${path}.seats`, "source seats must match settlement players");
  }
  // Tournament dead buttons occupy a physical position, not necessarily a
  // dealt player's seat. Source/hash binding owns the recorded button identity;
  // participant membership is not a valid button-position constraint.

  const rawActions = Array.isArray(value.actions) ? value.actions : [];
  if (!Array.isArray(value.actions)) addIssue(issues, "INVALID_ARRAY", `${path}.actions`, "expected an array");
  const actionIds: string[] = [];
  const actionOrders: string[] = [];
  rawActions.forEach((action, index) => {
    const actionPath = `${path}.actions[${index}]`;
    if (!isRecord(action)) {
      addIssue(issues, "INVALID_SOURCE_ACTION", actionPath, "source action must be an object");
      return;
    }
    const actionId = requireString(action, "actionId", actionPath, issues);
    const actionOrder = requireChip(action, "actionOrder", actionPath, issues);
    const playerId = requireString(action, "playerId", actionPath, issues);
    requireString(action, "street", actionPath, issues);
    requireString(action, "actionType", actionPath, issues);
    requireChip(action, "amount", actionPath, issues);
    if (actionOrder <= 0) addIssue(issues, "INVALID_ACTION_ORDER", `${actionPath}.actionOrder`, "action order must be > 0");
    if (!playerIds.has(playerId)) addIssue(issues, "UNKNOWN_ACTION_PLAYER", `${actionPath}.playerId`, playerId);
    actionIds.push(actionId);
    actionOrders.push(String(actionOrder));
  });
  requireUnique(actionIds, `${path}.actions[].actionId`, issues);
  requireUnique(actionOrders, `${path}.actions[].actionOrder`, issues);
  for (const refund of refunds) {
    if (!actionIds.includes(refund.sourceActionId)) {
      addIssue(issues, "REFUND_ACTION_NOT_FOUND", "refunds[].sourceActionId", refund.sourceActionId);
    }
  }

  const rawSourceChain = Array.isArray(value.sourceChain) ? value.sourceChain : [];
  if (!Array.isArray(value.sourceChain)) addIssue(issues, "INVALID_ARRAY", `${path}.sourceChain`, "expected an array");
  const sourceHandIds: string[] = [];
  const sourceHandNumbers: string[] = [];
  const parsedSourceChain: SettlementSourceHandRevisionV1[] = [];
  rawSourceChain.forEach((anchor, index) => {
    const anchorPath = `${path}.sourceChain[${index}]`;
    if (!isRecord(anchor)) {
      addIssue(issues, "INVALID_SOURCE_HAND", anchorPath, "source hand anchor must be an object");
      return;
    }
    const parsed: SettlementSourceHandRevisionV1 = {
      handId: requireString(anchor, "handId", anchorPath, issues),
      handNumber: requireChip(anchor, "handNumber", anchorPath, issues),
      sourceRevision: requireChip(anchor, "sourceRevision", anchorPath, issues),
      sourceHash: requireString(anchor, "sourceHash", anchorPath, issues),
    };
    if (parsed.handNumber <= 0) addIssue(issues, "INVALID_HAND_NUMBER", `${anchorPath}.handNumber`, "hand number must be > 0");
    if (!/^[a-f0-9]{64}$/.test(parsed.sourceHash)) addIssue(issues, "INVALID_HASH", `${anchorPath}.sourceHash`, "expected lowercase SHA-256 hex");
    sourceHandIds.push(parsed.handId);
    sourceHandNumbers.push(String(parsed.handNumber));
    parsedSourceChain.push(parsed);
  });
  requireUnique(sourceHandIds, `${path}.sourceChain[].handId`, issues);
  requireUnique(sourceHandNumbers, `${path}.sourceChain[].handNumber`, issues);
  if (parsedSourceChain.length === 0) addIssue(issues, "EMPTY_SOURCE_CHAIN", `${path}.sourceChain`, "source chain must include the target hand");
  const targetAnchor = parsedSourceChain.find((anchor) => anchor.handId === targetHandId);
  if (!targetAnchor) {
    addIssue(issues, "TARGET_NOT_IN_SOURCE_CHAIN", `${path}.targetHandId`, targetHandId);
  } else if (targetAnchor.sourceRevision !== expectedSourceRevision) {
    addIssue(issues, "TARGET_REVISION_MISMATCH", `${path}.sourceChain`, "target revision must match outcome sourceRevision");
  }

  const rawAdjustments = Array.isArray(value.externalAdjustments) ? value.externalAdjustments : [];
  if (!Array.isArray(value.externalAdjustments)) {
    addIssue(issues, "INVALID_ARRAY", `${path}.externalAdjustments`, "expected an array");
  }
  const adjustmentSourceIds: string[] = [];
  const externalByPlayer = new Map<string, number>();
  rawAdjustments.forEach((adjustment, index) => {
    const adjustmentPath = `${path}.externalAdjustments[${index}]`;
    if (!isRecord(adjustment)) {
      addIssue(issues, "INVALID_EXTERNAL_ADJUSTMENT", adjustmentPath, "external adjustment must be an object");
      return;
    }
    const playerId = requireString(adjustment, "playerId", adjustmentPath, issues);
    const amount = requireChip(adjustment, "amount", adjustmentPath, issues, true);
    const sourceId = requireString(adjustment, "sourceId", adjustmentPath, issues);
    const sourceType = adjustment.sourceType;
    if (sourceType !== "reentry" && sourceType !== "addon" && sourceType !== "admin_adjustment") {
      addIssue(issues, "INVALID_EXTERNAL_SOURCE_TYPE", `${adjustmentPath}.sourceType`, "unknown external adjustment source");
    }
    if (amount === 0) addIssue(issues, "EMPTY_EXTERNAL_ADJUSTMENT", `${adjustmentPath}.amount`, "external adjustment cannot be zero");
    if (!playerIds.has(playerId)) addIssue(issues, "UNKNOWN_EXTERNAL_PLAYER", `${adjustmentPath}.playerId`, playerId);
    adjustmentSourceIds.push(sourceId);
    externalByPlayer.set(playerId, (externalByPlayer.get(playerId) ?? 0) + amount);
  });
  requireUnique(adjustmentSourceIds, `${path}.externalAdjustments[].sourceId`, issues);
  players.forEach((player, index) => {
    if (player.externalDelta !== (externalByPlayer.get(player.playerId) ?? 0)) {
      addIssue(issues, "EXTERNAL_DELTA_SOURCE_MISMATCH", `players[${index}].externalDelta`, player.playerId);
    }
  });

  const revealedPlayers = validateCardMap(value.holeCardsByPlayer, `${path}.holeCardsByPlayer`, playerIds, issues);
  const muckedPlayers = validateCardMap(value.muckedHoleCardsByPlayer, `${path}.muckedHoleCardsByPlayer`, playerIds, issues);
  for (const playerId of revealedPlayers) {
    if (muckedPlayers.includes(playerId)) {
      addIssue(issues, "CARD_VISIBILITY_CONFLICT", path, `${playerId} cannot be both revealed and mucked`);
    }
  }

  if (value.correctionNotes !== undefined && typeof value.correctionNotes !== "string") {
    addIssue(issues, "INVALID_CORRECTION_NOTES", `${path}.correctionNotes`, "correction notes must be a string");
  }
  if (value.actor !== undefined) {
    if (!isRecord(value.actor)) {
      addIssue(issues, "INVALID_ACTOR", `${path}.actor`, "actor must be an object");
    } else {
      requireString(value.actor, "userId", `${path}.actor`, issues);
      requireString(value.actor, "role", `${path}.actor`, issues);
    }
  }
}

export function validateSettlementOutcomeV1(value: unknown): SettlementValidationResultV1 {
  const issues: SettlementValidationIssueV1[] = [];
  if (!isRecord(value)) {
    return { ok: false, issues: [{ code: "INVALID_OUTCOME", path: "$", message: "outcome must be an object" }] };
  }

  if (value.schemaVersion !== SETTLEMENT_SCHEMA_V1) addIssue(issues, "SCHEMA_VERSION", "schemaVersion", SETTLEMENT_SCHEMA_V1);
  if (value.ruleVersion !== ODD_CHIP_RULE_V1) addIssue(issues, "RULE_VERSION", "ruleVersion", ODD_CHIP_RULE_V1);
  if (value.status !== "verified" && value.status !== "stale" && value.status !== "needs_resettle") {
    addIssue(issues, "INVALID_STATUS", "status", "unknown settlement status");
  }
  const sourceRevision = requireChip(value, "sourceRevision", "$", issues);
  requireChip(value, "settlementRevision", "$", issues);
  const sourceChainHash = requireString(value, "sourceChainHash", "$", issues);
  const outcomeHash = requireString(value, "outcomeHash", "$", issues);
  if (!/^[a-f0-9]{64}$/.test(sourceChainHash)) addIssue(issues, "INVALID_HASH", "sourceChainHash", "expected lowercase SHA-256 hex");
  if (!/^[a-f0-9]{64}$/.test(outcomeHash)) addIssue(issues, "INVALID_HASH", "outcomeHash", "expected lowercase SHA-256 hex");

  const rawPlayers = Array.isArray(value.players) ? value.players : [];
  if (!Array.isArray(value.players)) addIssue(issues, "INVALID_ARRAY", "players", "expected an array");
  const players = rawPlayers.map((player, index) => parsePlayer(player, index, issues)).filter((player): player is PlayerSettlementV1 => !!player);
  const playerIds = players.map((player) => player.playerId);
  requireUnique(playerIds, "players[].playerId", issues);
  const playerIdSet = new Set(playerIds);

  const rawPots = Array.isArray(value.pots) ? value.pots : [];
  if (!Array.isArray(value.pots)) addIssue(issues, "INVALID_ARRAY", "pots", "expected an array");
  const pots = rawPots.map((pot, index) => parsePot(pot, index, playerIdSet, issues)).filter((pot): pot is SettledPotV1 => !!pot);
  requireUnique(pots.map((pot) => pot.potId), "pots[].potId", issues);
  const rawRefunds = Array.isArray(value.refunds) ? value.refunds : [];
  if (!Array.isArray(value.refunds)) addIssue(issues, "INVALID_ARRAY", "refunds", "expected an array");
  const refunds = rawRefunds.map((refund, index) => parseRefund(refund, index, playerIdSet, issues)).filter((refund): refund is UncalledRefundV1 => !!refund);
  requireUnique(refunds.map((refund) => refund.sourceActionId), "refunds[].sourceActionId", issues);
  const refundOnly = rawPots.length === 0 && players.length >= 2 && refunds.length === 1
    && refunds[0].amount > 0 && Array.isArray(value.handRanks) && value.handRanks.length === 0
    && players.every((player) => player.potAward === 0 && player.netDelta === 0 && player.externalDelta === 0
      && player.startingStack === player.endingStack && player.committedTotal === player.refund
      && player.creditedTotal === player.refund);
  if (!refundOnly && pots.filter((pot) => pot.kind === "main").length !== 1) {
    addIssue(issues, "MAIN_POT_COUNT", "pots", "a settlement must contain one main pot or only a fully returned uncalled bet");
  }

  const awardsByPlayer = new Map<string, number>();
  for (const allocation of pots.flatMap((pot) => pot.allocations)) {
    awardsByPlayer.set(allocation.winnerId, (awardsByPlayer.get(allocation.winnerId) ?? 0) + allocation.amount);
  }
  const refundsByPlayer = new Map<string, number>();
  for (const refund of refunds) refundsByPlayer.set(refund.playerId, (refundsByPlayer.get(refund.playerId) ?? 0) + refund.amount);
  players.forEach((player, index) => {
    if (player.potAward !== (awardsByPlayer.get(player.playerId) ?? 0)) {
      addIssue(issues, "PLAYER_POT_AWARD_MISMATCH", `players[${index}].potAward`, player.playerId);
    }
    if (player.refund !== (refundsByPlayer.get(player.playerId) ?? 0)) {
      addIssue(issues, "PLAYER_REFUND_MISMATCH", `players[${index}].refund`, player.playerId);
    }
  });

  const totals = parseTotals(value.totals, issues);
  if (totals) {
    const computed: SettlementTotalsV1 = {
      startingStack: requireSafeSum(players.map((player) => player.startingStack), "totals.startingStack", issues),
      committedTotal: requireSafeSum(players.map((player) => player.committedTotal), "totals.committedTotal", issues),
      distributablePot: requireSafeSum(pots.map((pot) => pot.amount), "totals.distributablePot", issues),
      refundTotal: requireSafeSum(refunds.map((refund) => refund.amount), "totals.refundTotal", issues),
      potAward: requireSafeSum(players.map((player) => player.potAward), "totals.potAward", issues),
      creditedTotal: requireSafeSum(players.map((player) => player.creditedTotal), "totals.creditedTotal", issues),
      netDelta: requireSafeSum(players.map((player) => player.netDelta), "totals.netDelta", issues),
      externalDelta: requireSafeSum(players.map((player) => player.externalDelta), "totals.externalDelta", issues),
      endingStack: requireSafeSum(players.map((player) => player.endingStack), "totals.endingStack", issues),
    };
    (Object.keys(computed) as (keyof SettlementTotalsV1)[]).forEach((key) => checkTotal(totals[key], computed[key], key, issues));
    if (computed.committedTotal !== requireSafeSum([computed.distributablePot, computed.refundTotal], "totals.committedTotal", issues)) {
      addIssue(issues, "COMMITTED_CONSERVATION", "totals.committedTotal", "committed chips must equal pots + refunds");
    }
    if (computed.potAward !== computed.distributablePot) {
      addIssue(issues, "POT_CONSERVATION", "totals.potAward", "pot awards must equal distributable pots");
    }
    if (computed.creditedTotal !== requireSafeSum([computed.potAward, computed.refundTotal], "totals.creditedTotal", issues)) {
      addIssue(issues, "CREDIT_CONSERVATION", "totals.creditedTotal", "credits must equal awards + refunds");
    }
    if (requireSafeSum([computed.startingStack, computed.externalDelta], "totals.endingStack", issues) !== computed.endingStack) {
      addIssue(issues, "STACK_CONSERVATION", "totals.endingStack", "starting + external must equal ending");
    }
  }

  const rawRanks = Array.isArray(value.handRanks) ? value.handRanks : [];
  if (!Array.isArray(value.handRanks)) addIssue(issues, "INVALID_ARRAY", "handRanks", "expected an array");
  rawRanks.forEach((rank, index) => {
    const path = `handRanks[${index}]`;
    if (!isRecord(rank)) {
      addIssue(issues, "INVALID_HAND_RANK", path, "hand rank must be an object");
      return;
    }
    const playerId = requireString(rank, "playerId", path, issues);
    requireString(rank, "category", path, issues);
    requireStringArray(rank.bestFive, `${path}.bestFive`, issues);
    requireStringArray(rank.kickers, `${path}.kickers`, issues);
    if (!playerIdSet.has(playerId)) addIssue(issues, "UNKNOWN_RANK_PLAYER", `${path}.playerId`, playerId);
  });

  if (Object.prototype.hasOwnProperty.call(value, "privateEvidence")) {
    validatePrivateEvidence(value.privateEvidence, players, refunds, sourceRevision, issues);
  }

  return issues.length === 0 ? { ok: true, issues: [] } : { ok: false, issues };
}

const FORBIDDEN_PUBLIC_FIELDS = new Set([
  "privateEvidence",
  "holeCards",
  "holeCardsByPlayer",
  "muckedHoleCardsByPlayer",
  "externalAdjustments",
  "evaluatorInput",
  "correctionNotes",
  "actor",
]);

function findForbiddenPublicFields(
  value: unknown,
  path: string,
  issues: SettlementValidationIssueV1[],
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => findForbiddenPublicFields(item, `${path}[${index}]`, issues));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = path === "$" ? key : `${path}.${key}`;
    if (FORBIDDEN_PUBLIC_FIELDS.has(key)) {
      addIssue(issues, "FORBIDDEN_PUBLIC_FIELD", childPath, `${key} is private settlement data`);
      continue;
    }
    findForbiddenPublicFields(child, childPath, issues);
  }
}

export function validatePublicSettlementOutcomeV1(value: unknown): SettlementValidationResultV1 {
  const base = validateSettlementOutcomeV1(value);
  const issues = base.ok ? [] : [...base.issues];
  findForbiddenPublicFields(value, "$", issues);
  return issues.length === 0 ? { ok: true, issues: [] } : { ok: false, issues };
}

function copyPlayers(players: readonly PlayerSettlementV1[]): PlayerSettlementV1[] {
  return players.map((player) => ({ ...player }));
}

function copyPots(pots: readonly SettledPotV1[]): SettledPotV1[] {
  return pots.map((pot) => ({
    ...pot,
    eligiblePlayerIds: [...pot.eligiblePlayerIds],
    winnerIds: [...pot.winnerIds],
    allocations: pot.allocations.map((allocation) => ({ ...allocation })),
  }));
}

export function projectPublicSettlementV1(outcome: PrivateSettlementOutcomeV1): PublicSettlementOutcomeV1 {
  return {
    schemaVersion: outcome.schemaVersion,
    status: outcome.status,
    sourceRevision: outcome.sourceRevision,
    sourceChainHash: outcome.sourceChainHash,
    settlementRevision: outcome.settlementRevision,
    outcomeHash: outcome.outcomeHash,
    ruleVersion: outcome.ruleVersion,
    players: copyPlayers(outcome.players),
    pots: copyPots(outcome.pots),
    refunds: outcome.refunds.map((refund) => ({ ...refund })),
    handRanks: outcome.handRanks
      .filter((rank) => rank.isPublic)
      .map((rank) => ({
        playerId: rank.playerId,
        category: rank.category,
        bestFive: [...rank.bestFive],
        kickers: [...rank.kickers],
      })),
    totals: { ...outcome.totals },
  };
}

function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new SettlementContractErrorV1("canonical JSON accepts safe integers only");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
      .join(",")}}`;
  }
  throw new SettlementContractErrorV1(`unsupported canonical JSON value: ${typeof value}`);
}

export function canonicalJsonV1(value: unknown): string {
  return canonicalize(value);
}

function sortStrings(values: readonly string[]): string[] {
  return [...values].sort(compareText);
}

function normalizePublicOutcomeForHash(outcome: PublicSettlementOutcomeV1): Omit<PublicSettlementOutcomeV1, "outcomeHash"> {
  return {
    schemaVersion: outcome.schemaVersion,
    status: outcome.status,
    sourceRevision: outcome.sourceRevision,
    sourceChainHash: outcome.sourceChainHash,
    settlementRevision: outcome.settlementRevision,
    ruleVersion: outcome.ruleVersion,
    players: copyPlayers(outcome.players).sort((left, right) => compareText(left.playerId, right.playerId)),
    pots: copyPots(outcome.pots)
      .map((pot) => ({
        ...pot,
        eligiblePlayerIds: sortStrings(pot.eligiblePlayerIds),
        winnerIds: sortStrings(pot.winnerIds),
        allocations: [...pot.allocations].sort((left, right) => compareText(left.winnerId, right.winnerId)),
      }))
      .sort((left, right) => compareText(left.potId, right.potId)),
    refunds: outcome.refunds
      .map((refund) => ({ ...refund }))
      .sort((left, right) => compareText(left.sourceActionId, right.sourceActionId) || compareText(left.playerId, right.playerId)),
    handRanks: outcome.handRanks
      .map((rank) => ({ ...rank, bestFive: [...rank.bestFive], kickers: [...rank.kickers] }))
      .sort((left, right) => compareText(left.playerId, right.playerId)),
    totals: { ...outcome.totals },
  };
}

function normalizeSourceEvidenceForHash(evidence: PrivateSettlementEvidenceV1): unknown {
  return {
    targetHandId: evidence.targetHandId,
    buttonSeat: evidence.buttonSeat,
    communityCards: [...evidence.communityCards],
    seats: evidence.seats
      .map((seat) => ({ ...seat }))
      .sort((left, right) => left.seatNumber - right.seatNumber || compareText(left.playerId, right.playerId)),
    actions: evidence.actions
      .map((action) => ({ ...action }))
      .sort((left, right) => left.actionOrder - right.actionOrder || compareText(left.actionId, right.actionId)),
    sourceChain: evidence.sourceChain
      .map((anchor) => ({ ...anchor }))
      .sort((left, right) => left.handNumber - right.handNumber || compareText(left.handId, right.handId)),
    externalAdjustments: evidence.externalAdjustments
      .map((adjustment) => ({ ...adjustment }))
      .sort((left, right) => compareText(left.sourceId, right.sourceId)),
    holeCardsByPlayer: evidence.holeCardsByPlayer,
    muckedHoleCardsByPlayer: evidence.muckedHoleCardsByPlayer,
  };
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function computeSourceChainHashV1(evidence: PrivateSettlementEvidenceV1): Promise<string> {
  return sha256Hex(canonicalJsonV1(normalizeSourceEvidenceForHash(evidence)));
}

export async function computeOutcomeHashV1(
  outcome: PrivateSettlementOutcomeV1 | PublicSettlementOutcomeV1,
): Promise<string> {
  const publicOutcome = "privateEvidence" in outcome ? projectPublicSettlementV1(outcome) : outcome;
  return sha256Hex(canonicalJsonV1(normalizePublicOutcomeForHash(publicOutcome)));
}

export async function verifyOutcomeHashV1(
  outcome: PrivateSettlementOutcomeV1 | PublicSettlementOutcomeV1,
): Promise<boolean> {
  return outcome.outcomeHash === await computeOutcomeHashV1(outcome);
}

export type ManualWinnerIntentV1 = {
  winnerIds: readonly string[];
};

export type ManualSinglePotInputV1 = {
  potId: string;
  kind: "main" | "side";
  amount: number;
  eligiblePlayerIds: readonly string[];
  refunds: readonly UncalledRefundV1[];
  clockwisePlayerIdsLeftOfButton: readonly string[];
  hasMissingActions: boolean;
  hasMalformedStack: boolean;
  intent: ManualWinnerIntentV1;
};

export function allocateManualSinglePotV1(input: ManualSinglePotInputV1): PotAllocation[] {
  if (input.kind !== "main") throw new SettlementContractErrorV1("manual settlement is disabled for side pots");
  if (input.refunds.length > 0) throw new SettlementContractErrorV1("manual settlement is disabled when a refund exists");
  if (input.hasMissingActions || input.hasMalformedStack) {
    throw new SettlementContractErrorV1("manual settlement requires a complete action and stack chain");
  }
  if (!isChip(input.amount) || input.amount <= 0) throw new SettlementContractErrorV1("pot amount must be a positive safe integer");

  const eligible = [...input.eligiblePlayerIds];
  const winners = [...input.intent.winnerIds];
  const clockwise = [...input.clockwisePlayerIdsLeftOfButton];
  if (new Set(eligible).size !== eligible.length || new Set(winners).size !== winners.length || new Set(clockwise).size !== clockwise.length) {
    throw new SettlementContractErrorV1("manual settlement ids must be unique");
  }
  if (winners.length === 0) throw new SettlementContractErrorV1("manual winner intent is empty");
  if (!sameSet(eligible, clockwise)) throw new SettlementContractErrorV1("clockwise order must contain the complete eligibility set");
  if (winners.some((winnerId) => !eligible.includes(winnerId))) throw new SettlementContractErrorV1("manual winner is not eligible for the pot");
  if (input.amount < winners.length) throw new SettlementContractErrorV1("pot is too small to allocate at least one chip per winner");

  const orderedWinners = clockwise.filter((playerId) => winners.includes(playerId));
  const baseShare = Math.floor(input.amount / orderedWinners.length);
  let oddChips = input.amount - baseShare * orderedWinners.length;
  return orderedWinners.map((winnerId) => {
    const includesOddChip = oddChips > 0;
    if (includesOddChip) oddChips -= 1;
    return {
      potId: input.potId,
      winnerId,
      amount: baseShare + (includesOddChip ? 1 : 0),
      includesOddChip,
    };
  });
}
