import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { sessionReadEpoch } from "@/lib/sessionReadEpoch";
import { waitForManualPlayerResponse } from "@/lib/floorManualPlayerIntent";
import { financeRecord, financeNumber, financeText, financeRows } from "@/lib/financeSummaryRead";

// Read-only tournament prize payout liability for the owner's clubs (W3-B).
// Owed = derived from finalized finished_place × tournament_prizes (matches get_member_history).
// Paid = paid-to-date from the tournament_prize_payments ledger. Liability = owed − paid.
// Two-tier gate: while the migration is source-only (RPC absent), the RPC 42883/42P01s → the hook
// reports `notApplied` (NOT a generic error) so the tab degrades to "chưa áp dụng" + mock.
// Calendar dates go to the v2 server contract; browser timezone never sets bounds.

export interface ClubPayoutLiabilityTournament {
  tournamentId: string;
  name: string;
  closeDate: string | null;
  isClosed: boolean;
  hasFinishedPlace: boolean;
  owed: number | null;
  paid: number;
  outstanding: number | null;
  finishersCount: number;
  liabilityScope?: 'ORDINARY'|'INDIVIDUAL'|'GLOBAL';
  isPartial?: boolean;
}

export interface ClubPayoutLiability {
  periodFrom: string;
  periodTo: string;
  owedTotal: number;
  paidTotal: number;
  outstandingTotal: number;
  perTournament: ClubPayoutLiabilityTournament[];
  aging: { d0_1: number; d2_7: number; d8p: number };
}

export interface PayoutLiabilityQuery {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  clubFilter: string; // "all" | clubId
}

function parseLiability(value: unknown, query: PayoutLiabilityQuery): ClubPayoutLiability {
  const row = financeRecord(value, "liability");
  const timestamp = (value: unknown, field: string) => {
    const text = financeText(value, field);
    if (!Number.isFinite(Date.parse(text))) throw new Error("PAYOUT_LIABILITY_INVALID");
    return text;
  };
  const bool = (value: unknown): boolean => {
    if (typeof value !== "boolean") throw new Error("PAYOUT_LIABILITY_INVALID");
    return value;
  };
  if (row.fromDate !== query.from || row.toDate !== query.to
    || row.clubId !== (query.clubFilter === "all" ? null : query.clubFilter)
    || row.periodEndExclusive !== true || row.timeZone !== "Asia/Ho_Chi_Minh") throw new Error("PAYOUT_LIABILITY_INVALID");
  const periodFrom = timestamp(row.periodFrom, "periodFrom"), periodTo = timestamp(row.periodTo, "periodTo");
  if (Date.parse(periodFrom) >= Date.parse(periodTo)) throw new Error("PAYOUT_LIABILITY_INVALID");
  const seen = new Set<string>();
  const perTournament = financeRows(row.perTournament, "perTournament").map((item) => {
    const tournamentId = financeText(item.tournamentId, "tournamentId");
    const finishersCount = financeNumber(item.finishersCount, "finishersCount");
    if (seen.has(tournamentId) || !Number.isSafeInteger(finishersCount) || finishersCount < 0) throw new Error("PAYOUT_LIABILITY_INVALID");
    const hasFinishedPlace = bool(item.hasFinishedPlace);
    let liabilityScope:ClubPayoutLiabilityTournament['liabilityScope'],isPartial:boolean|undefined;
    if(item.liabilityScope!==undefined||item.isPartial!==undefined){
      const scope=item.liabilityScope,partial=item.isPartial;
      if(scope!=='ORDINARY'&&scope!=='INDIVIDUAL'&&scope!=='GLOBAL'
        ||typeof partial!=='boolean'||partial!==(scope==='INDIVIDUAL'))throw new Error('PAYOUT_LIABILITY_INVALID');
      liabilityScope=scope;isPartial=partial;
    }
    if (hasFinishedPlace ? item.owed === null || item.outstanding === null : item.owed !== null || item.outstanding !== null) throw new Error("PAYOUT_LIABILITY_INVALID");
    seen.add(tournamentId);
    return { tournamentId, name: financeText(item.name, "name"), closeDate: item.closeDate === null ? null : timestamp(item.closeDate, "closeDate"),
      isClosed: bool(item.isClosed), hasFinishedPlace, finishersCount,
      ...(liabilityScope===undefined?{}:{liabilityScope,isPartial}),
      owed: item.owed === null ? null : financeNumber(item.owed, "owed"),
      paid: financeNumber(item.paid, "paid"),
      outstanding: item.outstanding === null ? null : financeNumber(item.outstanding, "outstanding") };
  });
  const aging = financeRecord(row.aging, "aging");
  return { periodFrom, periodTo, owedTotal: financeNumber(row.owedTotal, "owedTotal"),
    paidTotal: financeNumber(row.paidTotal, "paidTotal"), outstandingTotal: financeNumber(row.outstandingTotal, "outstandingTotal"),
    perTournament, aging: { d0_1: financeNumber(aging.d0_1, "d0_1"), d2_7: financeNumber(aging.d2_7, "d2_7"),
      d8p: financeNumber(aging.d8p, "d8p") } };
}
function validReportDate(value: string) {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) || value.startsWith("0000")) return false;
  const parsed = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}
export function useClubPayoutLiability({ from, to, clubFilter }: PayoutLiabilityQuery) {
  const { user, session, loading: authLoading } = useAuth();
  const scope = JSON.stringify([from, to, clubFilter, user?.id, sessionReadEpoch(session), authLoading]);
  const context = useMemo(() => ({ scope }), [scope]);
  const active = useRef<typeof context | null>(null), generation = useRef(0);
  const [state, setState] = useState<{ context: typeof context | null; loading: boolean; error: string | null;
    notApplied: boolean; data: ClubPayoutLiability | null }>({ context: null, loading: true, error: null, notApplied: false, data: null });
  const load = useCallback(async () => {
    if (active.current !== context) return;
    const request = ++generation.current;
    const publish = (next: Omit<typeof state, "context">) => {
      if (active.current === context && generation.current === request) setState({ context, ...next });
    };
    publish({ loading: true, error: null, notApplied: false, data: null });
    if (authLoading) return;
    if (!user?.id || !session?.access_token) {
      publish({ loading: false, error: "AUTH_REQUIRED", notApplied: false, data: null }); return;
    }
    try {
      if (!validReportDate(from) || !validReportDate(to) || to < from) throw new Error("Ngày báo cáo không hợp lệ.");
      const { data, error } = await waitForManualPlayerResponse(Promise.resolve((supabase.rpc as unknown as (
        name: "get_club_payout_liability_v2", args: { p_from_date: string; p_to_date: string; p_club_id: string | null },
      ) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>)(
        "get_club_payout_liability_v2", { p_from_date: from, p_to_date: to, p_club_id: clubFilter === "all" ? null : clubFilter },
      )));
      if (error) {
        const missing = ["42883", "42P01", "PGRST202"].includes(error.code ?? "");
        publish({ loading: false, error: missing ? null : error.message || "Lỗi tải phải-trả-giải", notApplied: missing, data: null }); return;
      }
      publish({ loading: false, error: null, notApplied: false, data: parseLiability(data, { from, to, clubFilter }) });
    } catch (error) {
      let message = error instanceof Error ? error.message : "Lỗi tải phải-trả-giải";
      if (/^(FINANCE_SUMMARY_INVALID|PAYOUT_LIABILITY_INVALID)/.test(message)) message = "Dữ liệu phải-trả giải không hợp lệ.";
      if (message === "MANUAL_PLAYER_OUTCOME_UNKNOWN") message = "Hết thời gian tải phải-trả giải.";
      publish({ loading: false, error: message, notApplied: false, data: null });
    }
  }, [context, authLoading, user?.id, session?.access_token, from, to, clubFilter]);
  useEffect(() => {
    active.current = context; void load();
    return () => { if (active.current === context) active.current = null; };
  }, [context, load]);
  const visible = state.context === context ? state : { loading: true, error: null, notApplied: false, data: null };
  return { loading: visible.loading, error: visible.error, notApplied: visible.notApplied, data: visible.data, reload: load };
}
