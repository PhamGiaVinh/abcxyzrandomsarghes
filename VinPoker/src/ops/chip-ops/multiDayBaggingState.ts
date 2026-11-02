export type BagRow = {
  playerId: string; seatNumber: number; trackedStack: number;
  bagCode: string | null; bagTotal: number | null; bagRevision: number;
  sealed: boolean; sealedVersion: number | null;
};
export type BagState = {
  status: "bagging" | "locked"; dayNumber: number; dayVersion: number;
  rosterHash: string; manager: boolean; rows: BagRow[];
};

/** Validate the mutation receipt against the exact submitted intent and frozen read. */
export function validBaggingReceipt(name: string, args: Record<string, unknown>, state: BagState, value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  if (r.ok !== true || typeof r.idempotent !== 'boolean') return false;
  if (name === 'multi_day_close_bagging_v1') {
    const total = state.rows.reduce((sum, row) => sum + row.trackedStack, 0);
    return Number.isSafeInteger(total) && r.status === 'locked' && r.rosterHash === state.rosterHash
      && r.bagCount === state.rows.length && r.expectedTotal === total && r.countedTotal === total
      && r.dayVersion === Number(args.p_expected_day_version) + 1;
  }
  const row = state.rows.find(row => row.playerId === args.p_player_id);
  if (!row || typeof r.bagId !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(r.bagId)
    || r.revision !== Number(args.p_expected_revision) + 1 || r.trackedStack !== row.trackedStack) return false;
  if (name === 'multi_day_record_bag_v1') return r.sealed === false && r.bagTotal === args.p_total_value
    && r.variance === Number(args.p_total_value) - row.trackedStack;
  if (name === 'multi_day_seal_bag_v1') return r.sealed === true && r.sealedVersion === r.revision
    && r.bagCode === row.bagCode && r.bagTotal === row.bagTotal;
  return false;
}

export function parseMultiDayBaggingState(value: unknown): BagState {
  if (!value || typeof value !== "object") throw new Error("Bagging response is unavailable.");
  const item = value as Record<string, unknown>;
  if ((item.status !== "bagging" && item.status !== "locked")
    || !Number.isSafeInteger(item.dayNumber) || !Number.isSafeInteger(item.dayVersion)
    || typeof item.rosterHash !== "string" || typeof item.manager !== "boolean"
    || !Array.isArray(item.rows)) throw new Error("Bagging response is invalid.");
  const rows = item.rows.map((entry: unknown) => {
    if (!entry || typeof entry !== "object") throw new Error("Bagging roster is invalid.");
    const row = entry as Record<string, unknown>;
    if (typeof row.playerId !== "string" || !Number.isSafeInteger(row.seatNumber)
      || !Number.isSafeInteger(row.trackedStack) || !Number.isSafeInteger(row.bagRevision)
      || !(row.bagCode === null || typeof row.bagCode === "string")
      || !(row.bagTotal === null || Number.isSafeInteger(row.bagTotal))
      || typeof row.sealed !== "boolean"
      || !(row.sealedVersion === null || Number.isSafeInteger(row.sealedVersion))) {
      throw new Error("Bagging roster is invalid.");
    }
    return row as BagRow;
  });
  return { status: item.status, dayNumber: item.dayNumber as number,
    dayVersion: item.dayVersion as number, rosterHash: item.rosterHash,
    manager: item.manager, rows };
}
