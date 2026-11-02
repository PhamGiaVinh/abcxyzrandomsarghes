import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { sessionReadEpoch } from "@/lib/sessionReadEpoch";
import { observeTrackerContextRead } from "@/lib/tournament/observeTrackerContextRead";
import {
  computeCloseReport,
  type CloseReportInput,
  type CloseReportTotals,
  type CloseReportSource,
} from "@/lib/closeReport";
import {
  describeCloseBlockers, getTournamentCloseReadiness,
  type TournamentCloseReadiness, withServerCloseTotals,
} from "@/lib/feltLifecycleReadiness";

// Read-layer + finalize for the operator Close Report (Chốt giải).
// The reconciliation math lives in the pure ./lib/closeReport; this hook only
// fetches the immutable inputs (confirmed registrations + recorded eliminations)
// and, on lock, calls the audited source-only `close_tournament` RPC.
//
// NOTE: `close_tournament` and `tournament_close_report` are source-only (migration
// 20261213000000, owner-gated apply) so they are not in the generated Supabase types
// yet — cast to `any` (the same pattern the codebase uses for not-yet-applied objects,
// e.g. media_club_ids). The caller must gate all of this behind FEATURES.closeReport,
// so nothing here runs until both the flag is ON and the schema is applied.

function isCloseReportNumber(value: unknown, integer = false): boolean {
  if (typeof value !== "number" && (typeof value !== "string" || value.trim() === "")) return false;
  const amount = Number(value);
  return integer ? Number.isSafeInteger(amount) : Number.isFinite(amount);
}

function classifySource(referenceCode: string | null | undefined): CloseReportSource {
  const rc = (referenceCode ?? "").toUpperCase();
  if (rc.startsWith("REENTRY")) return "reentry";
  if (rc.startsWith("CASH")) return "offline";
  return "online";
}

export interface CloseTournamentResult {
  ok: boolean;
  error?: string;
  reconciled?: boolean;
  clubRevenue?: number;
}

export function useCloseReport(tournamentId: string | null | undefined) {
  const {user,session,loading:authLoading}=useAuth();
  const scopeKey=JSON.stringify([tournamentId,user?.id,sessionReadEpoch(session),authLoading]);
  const context=useMemo(()=>({scopeKey}),[scopeKey]);
  const active=useRef<typeof context|null>(null);
  const [snapshotContext,setSnapshotContext]=useState<typeof context|null>(null);
  const closing=useRef(false);
  const unresolvedClose=useRef<typeof context|null>(null);
  const [report, setReport] = useState<CloseReportTotals | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alreadyClosed, setAlreadyClosed] = useState(false);
  const [readiness, setReadiness] = useState<TournamentCloseReadiness | null>(null);
  const requestSeq = useRef(0);
  const readController = useRef<AbortController | null>(null);

  const reload = useCallback(async () => {
    if(active.current!==context)return;
    const seq = ++requestSeq.current;
    readController.current?.abort();
    readController.current=null;
    const current=()=>active.current===context&&seq===requestSeq.current;
    setSnapshotContext(context);
    setLoading(true);
    setError(null);
    setReport(null);
    setAlreadyClosed(false);
    setReadiness(null);
    if(authLoading)return;
    if(!tournamentId||!user?.id||!session?.access_token){
      setLoading(false);setError(tournamentId?'AUTH_REQUIRED':null);return;
    }
    const controller=new AbortController();readController.current=controller;
    try {
      const [regsRes, elimsRes, serverReadiness] = await observeTrackerContextRead(Promise.all([
        supabase
          .from("tournament_registrations")
          .select("buy_in, total_pay, reference_code, status")
          .eq("tournament_id", tournamentId)
          .eq("status", "confirmed").abortSignal(controller.signal),
        supabase
          .from("tournament_eliminations")
          .select("position, prize")
          .eq("tournament_id", tournamentId).abortSignal(controller.signal),
        getTournamentCloseReadiness(tournamentId,controller.signal),
      ]));

      if (regsRes.error) throw regsRes.error;
      if (elimsRes.error) throw elimsRes.error;
      if (!Array.isArray(regsRes.data)||!Array.isArray(elimsRes.data)) throw new Error("Chưa xác minh được dữ liệu báo cáo chốt. Hãy tải lại.");
      if (!serverReadiness.ok) throw new Error(serverReadiness.error ?? "readiness_failed");
      if (regsRes.data.some(row => !row || !isCloseReportNumber(row.buy_in, true) || !isCloseReportNumber(row.total_pay, true))
        || elimsRes.data.some(row => !row || !isCloseReportNumber(row.position, true)
          || (row.prize !== null && !isCloseReportNumber(row.prize)))) {
        throw new Error("Chưa xác minh được số liệu tiền trong báo cáo chốt. Hãy tải lại.");
      }


      const input: CloseReportInput = {
        entries: (regsRes.data ?? []).map((r) => {
          const buyIn = Number(r.buy_in);
          const totalPay = Number(r.total_pay);
          return {
            totalPay,
            buyIn,
            // Combined club revenue (rake + service) attributed to one bucket; the
            // server snapshot computes the identical figure via Σ(total_pay − buy_in).
            rakeCharged: Math.max(0, totalPay - buyIn),
            serviceCharged: 0,
            source: classifySource(r.reference_code),
            usedFreeRake: false,
          };
        }),
        payouts: (elimsRes.data ?? []).map((e) => ({
          position: Number(e.position),
          prize: Number(e.prize ?? 0),
        })),
      };

      const computed = computeCloseReport(input);
      if (!current()) return;
      // The server's close_tournament RPC owns these amounts. The old client
      // projection clamped negative revenue and could disagree with its report.
      unresolvedClose.current=null;
      setReport(withServerCloseTotals(computed, serverReadiness));
      setReadiness(serverReadiness);
      setAlreadyClosed(serverReadiness.alreadyClosed);
    } catch (caught) {
      if (!current()) return;
      setError(caught instanceof Error && caught.message==='tracker_context_read_timeout'
        ? 'Chưa tải được báo cáo chốt trong thời gian chờ. Hãy thử tải lại.'
        : caught instanceof Error ? caught.message : "load_failed");
      setReport(null);
      setReadiness(null);
    } finally {
      if (current()) setLoading(false);
      controller.abort();if(readController.current===controller)readController.current=null;
    }
  }, [tournamentId,context,authLoading,user?.id,session?.access_token]);

  useEffect(() => {
    active.current=context;
    void reload();
    return()=>{if(active.current===context)active.current=null;readController.current?.abort();};
  }, [context,reload]);

  const closeTournament = useCallback(
    async (reason?: string): Promise<CloseTournamentResult> => {
      if (!tournamentId) return { ok: false, error: "no_tournament" };
      if(active.current!==context)return {ok:false,error:'close_scope_changed'};
      if(authLoading||!user?.id||!session?.access_token)return {ok:false,error:'AUTH_REQUIRED'};
      if(closing.current)return {ok:false,error:'close_in_progress'};
      if(unresolvedClose.current===context)return {ok:false,error:'Không xác minh được kết quả chốt. Hãy tải lại trạng thái giải trước khi thử tiếp.'};
      closing.current=true;
      const ownsScope=()=>active.current===context;
      const unknownOutcome=()=>{
        const message='Không xác minh được kết quả chốt. Hãy tải lại trạng thái giải trước khi thử tiếp.';
        if(ownsScope()){unresolvedClose.current=context;setReport(null);setReadiness(null);setError(message);}
        return {ok:false,error:message};
      };
      const controller=new AbortController();readController.current?.abort();readController.current=controller;
      try {
      const seq=++requestSeq.current;
      setLoading(false);
      let current: TournamentCloseReadiness;
      try {
        current = await observeTrackerContextRead(getTournamentCloseReadiness(tournamentId,controller.signal));
      } catch (caught) {
        if(!ownsScope()||seq!==requestSeq.current)return {ok:false,error:'close_scope_changed'};
        const message=caught instanceof Error && caught.message==='tracker_context_read_timeout'
          ? 'Chưa xác minh được trạng thái chốt trong thời gian chờ. Hãy tải lại báo cáo.'
          : caught instanceof Error ? caught.message : "readiness_failed";
        setError(message);setReport(null);setReadiness(null);
        return { ok: false, error: message };
      }
      if(!ownsScope()||seq!==requestSeq.current||controller.signal.aborted)return {ok:false,error:'close_scope_changed'};
      controller.abort();if(readController.current===controller)readController.current=null;
      setReadiness(current);
      if (!current.ok) return { ok: false, error: current.error ?? "readiness_failed" };
      if (current.alreadyClosed) return { ok: false, error: "Giải đã được chốt trước đó." };
      if (!current.ready) {
        return { ok: false, error: `Còn việc cần xử lý: ${describeCloseBlockers(current.blockers)}` };
      }
      // Bound observation only; never abort or automatically retry this mutation.
      let observationTimer: ReturnType<typeof setTimeout>|undefined;
      const writer=supabase.rpc("close_tournament", {
        p_tournament_id: tournamentId,
        p_reason: reason ?? null,
      });
      const {data,error:rpcErr}=await Promise.race([
        Promise.resolve(writer),
        new Promise<never>((_,reject)=>{observationTimer=setTimeout(()=>reject(new Error('close_outcome_unknown')),10_000);}),
      ]).finally(()=>clearTimeout(observationTimer));
      const res = data as
        | { ok?: boolean; error?: string; outcome?: string; report_id?: string; reconciled?: boolean; club_revenue?: number }
        | null;
      if(!ownsScope())return {ok:false,error:'close_scope_changed'};
      if (rpcErr || !res || typeof res!=='object' || Array.isArray(res)) return unknownOutcome();
      if (res.ok===false) {
        return { ok: false, error: res?.error ?? rpcErr?.message ?? "close_failed" };
      }
      if(res.ok!==true||!['closed','already_closed'].includes(res.outcome??'')
        ||typeof res.report_id!=='string'||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(res.report_id)
        ||typeof res.reconciled!=='boolean'||!Number.isSafeInteger(res.club_revenue))return unknownOutcome();
      setAlreadyClosed(true);
      setReadiness({ ...current, alreadyClosed: true });
      return { ok: true, reconciled: res.reconciled, clubRevenue: res.club_revenue };
      } catch {
        // A lost response is not evidence that close rolled back. Read readiness
        // before any new confirmation; never retry the writer automatically.
        return unknownOutcome();
      } finally {controller.abort();if(readController.current===controller)readController.current=null;closing.current=false;}
    },
    [tournamentId,context,authLoading,user?.id,session?.access_token],
  );

  const visible=snapshotContext===context;
  return { report:visible?report:null, loading:visible?loading:true,
    error:visible?error:null, alreadyClosed:visible?alreadyClosed:false,
    readiness:visible?readiness:null, scopeKey, reload, closeTournament };
}
