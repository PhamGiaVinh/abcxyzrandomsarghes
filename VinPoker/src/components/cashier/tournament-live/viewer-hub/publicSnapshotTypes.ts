export type PublicSnapshotSection = "tables" | "ranking" | "payout";

export interface PublicFreshness {
  sourceRevision: string;
  projectedSourceRevision: string;
  sourceChangedAt: string | null;
  publishedAt: string | null;
  serverCheckedAt: string;
  oldestPendingAt: string | null;
  state: "current" | "updating" | "stale";
}

export interface PublicTablePlayer {
  entryId: string | null;
  playerId: string;
  entryNumber: number;
  seatNumber: number;
  name: string;
  avatarUrl: string | null;
  stack: number | null;
  holeCards: string[];
  isFolded?: boolean;
  isAllIn?: boolean;
  lastAction?: { actionType: string; amount: number } | null;
}

export interface PublicTableSnapshot {
  tableId: string;
  tableSessionId: string | null;
  name: string;
  handId: string | null;
  handNumber: number | null;
  buttonSeat: number | null;
  street: string | null;
  board: string[] | null;
  pot: number | null;
  levelNumber?: number | null;
  ante?: number | null;
  smallBlind: number | null;
  bigBlind: number | null;
  latestAction?: {
    playerId: string;
    entryNumber: number;
    actionType: string;
    amount: number | null;
  } | null;
  players: PublicTablePlayer[];
  /**
   * A data state returned by the public projection. Connection/loading errors
   * are deliberately kept outside this field so a last-good hand is never
   * rendered as an empty table after a failed refresh.
   */
  trackerState: "live" | "last_completed" | "waiting" | "inactive" | "closed" | "idle" | "unavailable";
}

export interface PublicTableHistoryItem {
  handId: string;
  tableId: string;
  tableSessionId: string | null;
  handNumber: number | null;
  createdAt: string;
  status: string;
  street: string | null;
  board: string[];
  pot: number | null;
  levelNumber: number | null;
  smallBlind: number | null;
  bigBlind: number | null;
  ante: number | null;
  result: { status: "pending" } | { status: "needs_attention" } | {
    status: "verified";
    recipients: Array<{
      playerId: string;
      entryNumber: number | null;
      seatNumber: number | null;
      name: string;
      avatarUrl: string | null;
      holeCards: string[];
      potAward: number;
      netDelta: number;
      potKinds: Array<"main" | "side">;
    }>;
  };
}

export interface PublicTableHistoryPage {
  ok: boolean;
  access: "public" | "revoked";
  tournamentId: string;
  tableId: string;
  items: PublicTableHistoryItem[];
  nextCursor: { createdAt: string; handId: string } | null;
}

export interface PublicTableCatalogItem {
  tableId: string;
  name: string;
  playerCount: number;
  searchPlayers: string[];
}

export interface PublicRankingRow {
  entryId: string | null;
  playerId: string;
  entryNumber: number;
  name: string;
  avatarUrl: string | null;
  chips: number | null;
  updatedAt: string | null;
}

export interface PublicPayoutRow {
  fromPlace: number;
  toPlace: number;
  amountPerPlayer: number;
  playerName: string | null;
  avatarUrl: string | null;
  resultStatus: "official" | "open";
}

export interface PublicSpectatorSnapshot {
  ok: boolean;
  access: "public" | "revoked";
  tournamentId: string;
  sections: {
    tables?: { revision: string; freshness: PublicFreshness; catalog: PublicTableCatalogItem[]; items: PublicTableSnapshot[]; removed: string[]; unchanged: boolean };
    ranking?: { revision: string; freshness: PublicFreshness; bigBlind: number | null; items: PublicRankingRow[]; unchanged: boolean };
    payout?: { revision: string; freshness: PublicFreshness; items: PublicPayoutRow[]; unchanged: boolean; published: boolean };
  };
}
