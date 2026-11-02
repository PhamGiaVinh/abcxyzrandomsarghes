import type { PublicTableHistoryItem, PublicTableHistoryPage } from "./publicSnapshotTypes";

type JsonRecord = Record<string, unknown>;

/** Public clock RPC aggregates; never substitute stale tournaments counters. */
export function parsePublicParticipationSummary(value:unknown,tournamentId:string):{playersRemaining:number;averageStack:number}|null {
  if(!Array.isArray(value)||value.length!==1)return null;
  const row=record(value[0]);
  if(!row||row.tournament_id!==tournamentId||typeof row.players_remaining!=='number'
    ||!Number.isSafeInteger(row.players_remaining)||row.players_remaining<0
    ||typeof row.average_stack!=='number'||!Number.isFinite(row.average_stack)||row.average_stack<0)return null;
  return {playersRemaining:row.players_remaining,averageStack:row.average_stack};
}

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function cards(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((card): card is string => typeof card === "string") : [];
}

function result(value: unknown): PublicTableHistoryItem["result"] {
  const raw = record(value);
  if (raw?.status === "needs_attention") return { status: "needs_attention" };
  if (raw?.status === "refunded") {
    const refund = record(raw.refund);
    const playerId = refund && string(refund.playerId);
    const amount = refund && numberOrNull(refund.amount);
    const entryNumber = refund && numberOrNull(refund.entryNumber);
    const seatNumber = refund && numberOrNull(refund.seatNumber);
    if (!refund || !playerId || amount === null || !Number.isSafeInteger(amount) || amount <= 0
      || entryNumber === null || !Number.isSafeInteger(entryNumber) || entryNumber < 1
      || seatNumber === null || !Number.isSafeInteger(seatNumber) || seatNumber < 1 || seatNumber > 10
      || raw.recipients !== undefined) return { status: "pending" };
    return { status: "refunded", refund: { playerId, amount, entryNumber, seatNumber, name: string(refund.name) ?? "Người chơi" } };
  }
  if (raw?.status !== "verified" || !Array.isArray(raw.recipients) || raw.recipients.length === 0) return { status: "pending" };
  const recipients: Extract<PublicTableHistoryItem["result"], { status: "verified" }>["recipients"] = [];
  const identities = new Set<string>();
  let totalAward=0;
  for (const value of raw.recipients) {
    const person = record(value);
    const playerId = person && string(person.playerId);
    const potAward = person && numberOrNull(person.potAward);
    const netDelta = person && numberOrNull(person.netDelta);
    if (!person || !playerId || potAward === null || !Number.isSafeInteger(potAward) || potAward <= 0 || netDelta === null || !Number.isSafeInteger(netDelta)) return { status: "pending" };
    totalAward+=potAward;if(!Number.isSafeInteger(totalAward))return {status:'pending'};
    const entryNumber = numberOrNull(person.entryNumber);
    const identity = `${playerId}:${entryNumber ?? "legacy"}`;
    if (identities.has(identity)) return { status: "pending" };
    identities.add(identity);
    const potKinds = Array.isArray(person.potKinds) ? person.potKinds : [];
    if (potKinds.length === 0 || potKinds.some((kind) => kind !== "main" && kind !== "side")) return { status: "pending" };
    recipients.push({
      playerId,
      entryNumber,
      seatNumber: numberOrNull(person.seatNumber),
      name: string(person.name) ?? "Người chơi",
      avatarUrl: string(person.avatarUrl),
      holeCards: cards(person.holeCards),
      potAward,
      netDelta,
      potKinds: [...new Set(potKinds)] as Array<"main" | "side">,
    });
  }
  return { status: "verified", recipients };
}

export type PublicTableCurrentResponse = {
  access: "public" | "revoked";
  tableId: string | null;
  tableSessionId: string | null;
  state: "live" | "last_completed" | "waiting" | "inactive" | "closed" | null;
  hand: JsonRecord | null;
};

/** Parse the RPC payload at the client boundary; malformed data never becomes a hand. */
export function parsePublicTableCurrentResponse(value: unknown): PublicTableCurrentResponse | null {
  const data = record(value);
  if (!data) return null;
  if (data.access === "revoked") return { access: "revoked", tableId: null, tableSessionId: null, state: null, hand: null };
  if (data.access !== "public") return null;
  const state = data.state;
  if (state !== "live" && state !== "last_completed" && state !== "waiting" && state !== "inactive" && state !== "closed") return null;
  return {
    access: "public",
    tableId: string(data.tableId),
    tableSessionId: string(data.tableSessionId),
    state,
    hand: record(data.hand),
  };
}

/** Parses one history page and keeps identity supplied by the scoped request. */
export function parsePublicTableHistoryPage(value: unknown, tournamentId: string, tableId: string): PublicTableHistoryPage | null {
  const data = record(value);
  if (!data) return null;
  if (data.access === "revoked") return { ok: true, access: "revoked", tournamentId, tableId, items: [], nextCursor: null };
  if (data.access !== "public" || !Array.isArray(data.items)) return null;
  const items: PublicTableHistoryItem[] = [];
  for (const raw of data.items) {
    const row = record(raw);
    const handId = row && string(row.handId);
    const createdAt = row && string(row.createdAt);
    if (!row || !handId || !createdAt) return null;
    const parsedResult=result(row.result);
    items.push({
      handId,
      tableId,
      tableSessionId: string(row.tableSessionId),
      handNumber: numberOrNull(row.handNumber),
      createdAt,
      status: "completed",
      street: null,
      board: cards(row.board),
      // Current verified awards exclude uncalled refunds; persisted pot can
      // still be gross commitments. This is display only, never settlement.
      pot: parsedResult.status==='refunded'?0:parsedResult.status==='verified'?parsedResult.recipients.reduce((sum,person)=>sum+person.potAward,0):numberOrNull(row.pot),
      levelNumber: numberOrNull(row.levelNumber),
      smallBlind: numberOrNull(row.smallBlind),
      bigBlind: numberOrNull(row.bigBlind),
      ante: numberOrNull(row.ante),
      result: parsedResult,
    });
  }
  const rawCursor = data.nextCursor === null ? null : record(data.nextCursor);
  if (data.nextCursor !== null && rawCursor === null) return null;
  const cursorCreatedAt = rawCursor && string(rawCursor.createdAt);
  const cursorHandId = rawCursor && string(rawCursor.id);
  if (rawCursor && (!cursorCreatedAt || !cursorHandId)) return null;
  return {
    ok: true,
    access: "public",
    tournamentId,
    tableId,
    items,
    nextCursor: cursorCreatedAt && cursorHandId ? { createdAt: cursorCreatedAt, handId: cursorHandId } : null,
  };
}
