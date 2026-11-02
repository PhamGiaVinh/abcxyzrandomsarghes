import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { sessionReadEpoch } from "@/lib/sessionReadEpoch";
import { waitForManualPlayerResponse } from "@/lib/floorManualPlayerIntent";

// Read-only per-place payout recipients for a tournament (W3-B2, cashier "Đã trả thưởng").
// Server-derived (SECDEF) list of IN-MONEY finished places with recipient name (resolved exactly
// as the write RPC does), prize amount, and paid status from the tournament_prize_payments ledger.
// Two-tier gate: while the read RPC is source-only (absent) it 42883/42P01s → `notApplied` (NOT a
// generic error) so the section degrades to "Cần áp dụng" instead of crashing.
// Confirmation proof requires the matching v2 backend contract; no inferred live state.

export interface PayoutRecipientPlace {
  entryId: string;
  recipientRef: string;
  confirmationToken: string;
  finishedPlace: number;
  recipientName: string;
  prizeAmount: number;
  isPaid: boolean;
  paidAt: string | null;
  method: string | null;
  multiDayEventId?: string;
  multiDayParticipationId?: string;
  obligationAmount?: number;
  paidAmount?: number;
}

export interface TournamentPayoutRecipients {
  tournamentId: string;
  itmPlaces: number | null;
  owedTotal: number;
  paidTotal: number;
  paidCount: number;
  totalCount: number;
  places: PayoutRecipientPlace[];
  mode?: "multi_day";
  eventId?: string;
  liabilityScope?: "INDIVIDUAL" | "GLOBAL";
  isPartial?: boolean;
}

function parseRecipients(value: unknown, tournamentId: string): TournamentPayoutRecipients {
  const invalid = () => { throw new Error("PAYOUT_RECIPIENTS_INVALID"); };
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const row = value as Record<string, unknown>;
  const money = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
  const count = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
  if (row.tournamentId !== tournamentId || !money(row.owedTotal) || !money(row.paidTotal)
    || !count(row.paidCount) || !count(row.totalCount)
    || (row.itmPlaces !== null && !count(row.itmPlaces)) || !Array.isArray(row.places)
    || row.totalCount !== row.places.length || Number(row.paidCount) > Number(row.totalCount)) return invalid();
  if(row.mode!==undefined&&row.mode!=="multi_day")return invalid();
  const multiDay=row.mode==='multi_day';
  if (row.liabilityScope !== undefined || row.isPartial !== undefined) {
    if (!multiDay || !["INDIVIDUAL", "GLOBAL"].includes(String(row.liabilityScope))
      || typeof row.isPartial !== "boolean"
      || row.isPartial !== (row.liabilityScope === "INDIVIDUAL")) return invalid();
  }
  if(multiDay&&(typeof row.eventId!=='string'||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(row.eventId)))return invalid();
  const seen = new Set<string>();
  const entries = new Set<string>();
  const participations=new Set<string>();
  for (const value of row.places) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
    const place = value as Record<string, unknown>;
    const uuid = (v: unknown) => typeof v === "string" && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
    if (!count(place.finishedPlace) || Number(place.finishedPlace) < 1
      || !uuid(place.entryId) || !uuid(place.recipientRef) || entries.has(String(place.entryId))
      || typeof place.confirmationToken !== "string" || !/^[a-f0-9]{32}$/.test(place.confirmationToken)
      || seen.has(String(multiDay?place.entryId:place.finishedPlace)) || typeof place.recipientName !== "string" || !place.recipientName.trim()
      || !money(place.prizeAmount) || typeof place.isPaid !== "boolean"
      || (place.paidAt !== null && (typeof place.paidAt !== "string" || !Number.isFinite(Date.parse(place.paidAt))))
      || (place.method !== null && (typeof place.method !== "string" || !["cash", "bank", "app", "other"].includes(place.method)))) return invalid();
    if(multiDay&&(!uuid(place.multiDayParticipationId)||place.multiDayEventId!==row.eventId
      ||!money(place.obligationAmount)||!money(place.paidAmount)
      ||![place.prizeAmount,place.obligationAmount,place.paidAmount].every(Number.isSafeInteger)
      ||Number(place.prizeAmount)+Number(place.paidAmount)!==Number(place.obligationAmount)
      ||place.isPaid!==(place.prizeAmount===0)||participations.has(String(place.multiDayParticipationId))))return invalid();
    if(!multiDay&&(place.multiDayEventId!==undefined||place.multiDayParticipationId!==undefined))return invalid();
    if(multiDay)participations.add(String(place.multiDayParticipationId));
    entries.add(String(place.entryId));
    seen.add(String(multiDay?place.entryId:place.finishedPlace));
  }
  if(row.places.reduce((n,p)=>n+Number(multiDay?p.obligationAmount:p.prizeAmount),0)!==row.owedTotal
    ||row.places.reduce((n,p)=>n+Number(multiDay?p.paidAmount:p.isPaid?p.prizeAmount:0),0)!==row.paidTotal
    ||row.places.filter(p=>p.isPaid).length!==row.paidCount)return invalid();
  return value as TournamentPayoutRecipients;
}

export function useTournamentPayoutRecipients(tournamentId: string | null | undefined) {
  const { user, session, loading: authLoading } = useAuth();
  const scope = JSON.stringify([tournamentId, user?.id, sessionReadEpoch(session), authLoading]);
  const context = useMemo(() => ({ scope }), [scope]);
  const active = useRef<typeof context | null>(null);
  const generation = useRef(0);
  const [state, setState] = useState<{
    context: typeof context | null; loading: boolean; error: string | null;
    notApplied: boolean; data: TournamentPayoutRecipients | null;
  }>({ context: null, loading: true, error: null, notApplied: false, data: null });

  const load = useCallback(async () => {
    if (active.current !== context) return;
    const request = ++generation.current;
    const current = () => active.current === context && generation.current === request;
    const publish = (next: Omit<typeof state, "context">) => {
      if (current()) setState({ context, ...next });
    };
    publish({ loading: true, error: null, notApplied: false, data: null });
    if (authLoading) return;
    if (!user?.id || !session?.access_token || !tournamentId) {
      publish({ loading: false, error: tournamentId ? "AUTH_REQUIRED" : null, notApplied: false, data: null });
      return;
    }
    try {
      const { data, error } = await waitForManualPlayerResponse(Promise.resolve(
        (supabase.rpc as unknown as (
          name: "get_tournament_payout_recipients", args: { p_tournament_id: string },
        ) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>)(
          "get_tournament_payout_recipients", { p_tournament_id: tournamentId },
        ),
      ));
      if (error) {
        const missing = ["42883", "42P01", "PGRST202"].includes(error.code ?? "");
        publish({ loading: false, error: missing ? null : error.message || "Lỗi tải danh sách trả thưởng",
          notApplied: missing, data: null });
        return;
      }
      publish({ loading: false, error: null, notApplied: false, data: parseRecipients(data, tournamentId) });
    } catch (error) {
      publish({ loading: false, error: error instanceof Error
        ? error.message === "MANUAL_PLAYER_OUTCOME_UNKNOWN" ? "Hết thời gian tải danh sách trả thưởng." : error.message
        : "Lỗi tải danh sách trả thưởng", notApplied: false, data: null });
    }
  }, [context, authLoading, user?.id, session?.access_token, tournamentId]);
  useEffect(() => {
    active.current = context;
    void load();
    return () => { if (active.current === context) active.current = null; };
  }, [context, load]);
  const visible = state.context === context ? state : { loading: true, error: null, notApplied: false, data: null };
  return { loading: visible.loading, error: visible.error, notApplied: visible.notApplied, data: visible.data, reload: load };
}
