import type { HoleCardEntry } from "./handInputEdge";

export interface ManualCardPendingIntent {
  actorId: string;
  tournamentId: string;
  tournamentTableId: string;
  handId: string;
  tableSessionId: string;
  controlEpoch: number;
  sourceRevision: number;
  requestId: string;
  cardsFingerprint: string;
}

export function normalizeManualCards(cards: HoleCardEntry[]): HoleCardEntry[] {
  return cards.map(card => ({ ...card, hole_cards: [...card.hole_cards] })).sort((a, b) =>
    a.player_id < b.player_id ? -1 : a.player_id > b.player_id ? 1 : a.entry_number - b.entry_number);
}

// This is a local draft checksum, NOT the server's PostgreSQL JSONB request hash.
export async function fingerprintManualCards(cards: HoleCardEntry[]): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(normalizeManualCards(cards))));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export function parseManualCardIntent(value: unknown, scope: Pick<ManualCardPendingIntent,
  "actorId" | "tournamentId" | "tournamentTableId" | "handId">): ManualCardPendingIntent | null {
  if (!value || typeof value !== "object") return null;
  const intent = value as ManualCardPendingIntent;
  if (intent.actorId !== scope.actorId || intent.tournamentId !== scope.tournamentId
    || intent.tournamentTableId !== scope.tournamentTableId || intent.handId !== scope.handId
    || typeof intent.tableSessionId !== "string" || !intent.tableSessionId
    || !Number.isSafeInteger(intent.controlEpoch) || intent.controlEpoch < 1
    || !Number.isSafeInteger(intent.sourceRevision) || intent.sourceRevision < 0
    || typeof intent.requestId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{11,255}$/.test(intent.requestId)
    || typeof intent.cardsFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(intent.cardsFingerprint)) return null;
  // Whitelist: browser storage never carries a raw card payload or credentials.
  return { actorId: intent.actorId, tournamentId: intent.tournamentId, tournamentTableId: intent.tournamentTableId,
    handId: intent.handId, tableSessionId: intent.tableSessionId, controlEpoch: intent.controlEpoch,
    sourceRevision: intent.sourceRevision, requestId: intent.requestId, cardsFingerprint: intent.cardsFingerprint };
}

export function isConfirmedManualCardProof(value: unknown, intent: ManualCardPendingIntent,
  entryCount: number, kind: "write" | "lookup"): boolean {
  if (!value || typeof value !== "object") return false;
  const proof = value as Record<string, unknown>;
  return proof.status === (kind === "write" ? "success" : "committed") && !proof.error
    && proof.hand_id === intent.handId && proof.table_session_id === intent.tableSessionId
    && proof.control_epoch === intent.controlEpoch && proof.expected_source_revision === intent.sourceRevision
    && proof.request_key === intent.requestId && proof.entry_count === entryCount
    && Number.isSafeInteger(proof.committed_source_revision)
    && Number(proof.committed_source_revision) > intent.sourceRevision
    && (kind === "write" || (typeof proof.request_hash === "string" && /^[a-f0-9]{64}$/.test(proof.request_hash)));
}
