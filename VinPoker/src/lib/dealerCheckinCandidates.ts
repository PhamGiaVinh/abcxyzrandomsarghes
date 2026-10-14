export type CheckinCandidateStatus = "new" | "already_checked_in" | "previously_checked_out" | "ambiguous";
export interface CheckinCandidate {
  id: string;
  full_name: string;
  tier: string;
  club_id: string;
  checkinStatus: CheckinCandidateStatus;
}

type CandidateRead = { data: unknown; count: number | null; error: unknown };

/** Validate complete scoped responses before merging the two read snapshots. */
export function mergeCheckinCandidateReads(clubId: string, dealerRead: CandidateRead, openRead: CandidateRead): CheckinCandidate[] {
  const complete = (read: CandidateRead): Record<string, unknown>[] => {
    if (read.error || !Array.isArray(read.data) || read.count !== read.data.length) throw new Error("CHECKIN_READ_INCOMPLETE");
    return read.data.map((row) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("CHECKIN_READ_MALFORMED");
      return row as Record<string, unknown>;
    });
  };
  const dealers = complete(dealerRead);
  const open = complete(openRead);
  const merged = new Map<string, Record<string, unknown>>();
  for (const dealer of dealers) {
    if (dealer.club_id !== clubId || !Array.isArray(dealer.dealer_attendance)) throw new Error("CHECKIN_READ_SCOPE");
    for (const row of dealer.dealer_attendance) {
      if (!row || typeof row !== "object" || Array.isArray(row) || typeof row.id !== "string" || !row.id
        || row.dealer_id !== dealer.id || merged.has(row.id)) throw new Error("CHECKIN_READ_MALFORMED");
      merged.set(row.id, { ...row, dealers: { club_id: dealer.club_id } });
    }
  }
  const openIds = new Set<string>();
  for (const row of open) {
    if (typeof row.id !== "string" || !row.id || openIds.has(row.id)) throw new Error("CHECKIN_READ_MALFORMED");
    openIds.add(row.id);
    const previous = merged.get(row.id);
    const conflict = previous && (previous.dealer_id !== row.dealer_id || previous.status !== row.status
      || previous.check_in_time !== row.check_in_time || previous.check_out_time !== row.check_out_time);
    merged.set(row.id, { ...row, status: conflict ? "inconsistent" : row.status });
  }
  return mapCheckinCandidates(clubId, dealers, [...merged.values()]);
}

// Read-model boundary only. The canonical writer still resolves operating day,
// shift, authorization and attendance eligibility when committing an intent.
export function mapCheckinCandidates(clubId: string, dealers: unknown, attendance: unknown): CheckinCandidate[] {
  if (!clubId || !Array.isArray(dealers) || !Array.isArray(attendance)) throw new Error("CHECKIN_READ_MALFORMED");
  const record = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("CHECKIN_READ_MALFORMED");
    return value as Record<string, unknown>;
  };
  const candidates = dealers.map((value): CheckinCandidate => {
    const dealer = record(value);
    if (dealer.club_id !== clubId || typeof dealer.id !== "string" || !dealer.id
      || typeof dealer.full_name !== "string" || typeof dealer.tier !== "string") throw new Error("CHECKIN_READ_SCOPE");
    return { id: dealer.id, full_name: dealer.full_name, tier: dealer.tier, club_id: clubId, checkinStatus: "new" };
  });
  const ids = new Set(candidates.map((dealer) => dealer.id));
  if (ids.size !== candidates.length) throw new Error("CHECKIN_READ_MALFORMED");
  const rows = attendance.map((value) => {
    const row = record(value);
    if (record(row.dealers).club_id !== clubId || typeof row.dealer_id !== "string" || !ids.has(row.dealer_id)
      || typeof row.status !== "string" || !(row.check_in_time === null || typeof row.check_in_time === "string")
      || !(row.check_out_time === null || typeof row.check_out_time === "string")) throw new Error("CHECKIN_READ_SCOPE");
    return row;
  });
  return candidates.map((dealer) => {
    const history = rows.filter((row) => row.dealer_id === dealer.id);
    const invalid = history.some((row) => {
      const start = typeof row.check_in_time === "string" ? Date.parse(row.check_in_time) : NaN;
      const end = typeof row.check_out_time === "string" ? Date.parse(row.check_out_time) : NaN;
      return !Number.isFinite(start)
        || (row.check_out_time === null ? row.status !== "checked_in"
          : row.status !== "checked_out" || !Number.isFinite(end) || end < start);
    });
    const open = history.filter((row) => row.check_out_time === null);
    const checkinStatus: CheckinCandidateStatus = invalid || open.length > 1 ? "ambiguous"
      : open.length === 1 ? "already_checked_in" : history.length ? "previously_checked_out" : "new";
    return { ...dealer, checkinStatus };
  });
}
