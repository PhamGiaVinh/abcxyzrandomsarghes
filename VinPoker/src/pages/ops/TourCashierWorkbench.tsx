import { useEffect, useRef, useState } from "react";
import { useSearchParams } from 'react-router-dom';
import {parseBookingCashierTarget,type BookingCashierTarget} from '@/lib/bookingCashierTarget';
import { AlertTriangle, ArrowLeft, Check, Clock3, Loader2, RefreshCw, Search, Wallet } from "lucide-react";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { useOpsCapabilities } from "@/ops/auth/OpsCapabilityProvider";
import { useOpsWorkspace } from "@/ops/workspace/OpsWorkspaceProvider";
import { assertMutationOk } from "@/ops/opsMutations";
import { OPS_TOUR_CASHIER_ENABLED } from "@/lib/featureFlags";
import { SeatReceiptDialog } from "@/components/tournament/seat/SeatReceiptDialog";
import type { SeatReceiptData } from "@/components/tournament/seat/SeatReceipt";
import { normalizeCashierScan } from "./cashierScan";
import { useOpsAuth } from '@/ops/auth/OpsAuthProvider';
import { sessionReadEpoch } from '@/lib/sessionReadEpoch';
import { observeTrackerContextRead } from '@/lib/tournament/observeTrackerContextRead';
import { cashPaymentJournalKey,readCashPaymentJournal,persistCashPaymentIntent,settleCashPaymentIntent,
  resolveCashPaymentIntent,type CashPaymentIntent } from '@/lib/cashPaymentIntent';

type Tour = { id: string; name: string; start_time: string | null; status: string; registration_closed_at?: string | null };
type Bucket = "counter" | "completed" | "waiting_seat" | "needs_review" | "all";
type Row = {
  id: string; tournament_id: string; tournament_name?: string; status: "pending" | "confirmed"; player_name: string; phone: string | null; member_card_id: string | null;
  reference_code: string; total_pay: number; received: number; bucket: Bucket;
  receipt_code: string | null; table_number: number | null; seat_number: number | null;
  receipt_is_historical?: boolean;
  legacy_detail_missing: boolean; cashier_seating_error: string | null;
};
type Worklist = { ok: boolean; error?: string; enabled: boolean; updated_at: string; counts: Record<string, number>; rows: Row[] };
function isWorklist(value: unknown): value is Worklist {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Partial<Worklist>;
  return result.ok === true && typeof result.enabled === "boolean" && Array.isArray(result.rows)
    && typeof result.updated_at === "string" && Number.isFinite(new Date(result.updated_at).getTime())
    && !!result.counts && typeof result.counts === "object" && !Array.isArray(result.counts)
    && ["counter", "completed", "waiting_seat", "needs_review", "total"].every((key) =>
      Number.isSafeInteger(result.counts?.[key]) && result.counts![key] >= 0);
}

type Lookup = { registration_id: string; tournament_id: string; tournament_name: string; player_name: string };
type Shift = { id: string; opening_cash: number; opened_at: string; closed_at?: string | null;
  counted_cash?: number | null; expected_cash?: number | null; variance_cash?: number | null };
type Refund = { id: string; amount: number; status: "requested" | "floor_cleared" | "paid"; reason: string };
function isRefund(value: unknown): value is Refund {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Partial<Refund>;
  return typeof result.id === "string" && !!result.id
    && typeof result.amount === "number" && Number.isSafeInteger(result.amount) && result.amount > 0
    && (result.status === "requested" || result.status === "floor_cleared" || result.status === "paid")
    && typeof result.reason === "string";
}

type RefundRead = { registrationId: string; loading: boolean; value: Refund | null; error: string | null };
type ShiftSummary = { ok: boolean; club_id: string; shift_id: string; totals: { cash_in: number; cash_out: number; bank_in: number;
  bank_out: number; unallocated_bank: number; cash_adjustments: number } };
type Issue = { kind: "surplus" | "unmatched"; bank_transaction_id: string; amount: number;
  reference_code: string | null; occurred_at: string | null };
type Issues = { ok: boolean; sepay_unavailable: boolean; shown: number; rows: Issue[] };

const formatMoney = (amount: number) => `${new Intl.NumberFormat("vi-VN").format(amount)} VND`;
const dateTime = (iso: string | null) => iso ? new Intl.DateTimeFormat("vi-VN", {
  day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
}).format(new Date(iso)) : "Chưa có";
const isKnownMoney = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const formatReportedMoney = (value: unknown) => isKnownMoney(value) ? formatMoney(value) : "chưa xác minh";
function isShiftSummary(value: unknown, shiftId: string, clubId: string): value is ShiftSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Partial<ShiftSummary>;
  return result.ok === true && result.shift_id === shiftId && result.club_id === clubId
    && !!result.totals && typeof result.totals === "object" && !Array.isArray(result.totals)
    && (["cash_in", "cash_out", "bank_in", "bank_out", "unallocated_bank", "cash_adjustments"] as const)
      .every((key) => isKnownMoney(result.totals?.[key]));
}

export default function TourCashierWorkbench() {
  const { user, session, loading } = useOpsAuth();
  const { selectedClubId } = useOpsWorkspace();
  const [params]=useSearchParams();
  const bookingTarget=parseBookingCashierTarget(params,selectedClubId);
  // Bind all private read/form state to one verified actor/session/club lifetime.
  // The opaque epoch never places a bearer token into a React key.
  return <ScopedTourCashierWorkbench key={JSON.stringify([
    user?.id ?? null, sessionReadEpoch(session), selectedClubId, loading,
    params.getAll('bookingTour'),params.getAll('bookingRegistration'),params.getAll('club'),
  ])} bookingTarget={bookingTarget}/>;
}

function ScopedTourCashierWorkbench({bookingTarget}:{bookingTarget:BookingCashierTarget}) {
  const client = useSupabaseClient();
  const { user,session,loading:authLoading } = useOpsAuth();
  const capabilities = useOpsCapabilities();
  const { selectedClubId } = useOpsWorkspace();
  const clubId = !capabilities.loading && !capabilities.scopeError && selectedClubId
    && (capabilities.isSuperAdmin || capabilities.cashierClubIds.includes(selectedClubId))
    ? selectedClubId : null;
  const clubName = capabilities.clubs.find((club) => club.id === clubId)?.name ?? "CLB";
  const [tours, setTours] = useState<Tour[]>([]);
  const [tourId, setTourId] = useState<string | null>(null);
  const [bookingFocus]=useState(bookingTarget.kind==='target'?bookingTarget:null);
  const bookingOpened=useRef(false);
  const invalidBooking=bookingTarget.kind==='invalid';
  const [bucket, setBucket] = useState<Bucket>(bookingTarget.kind==='target'?"all":"counter");
  const [issuesView, setIssuesView] = useState(false);
  const [query, setQuery] = useState(bookingTarget.kind==='target'?bookingTarget.registrationId:"");
  const [page, setPage] = useState(0);
  const [worklist, setWorklist] = useState<Worklist | null>(null);
  const [lookup, setLookup] = useState<Lookup[]>([]);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Row | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<SeatReceiptData | null>(null);
  const [cashAmount, setCashAmount] = useState("");
  const [openingCash, setOpeningCash] = useState("");
  const [countedCash, setCountedCash] = useState("");
  const [shift, setShift] = useState<Shift | null>(null);
  const [closedShifts, setClosedShifts] = useState<Shift[]>([]);
  const [closedShiftId, setClosedShiftId] = useState<string | null>(null);
  const [closedShiftSummary, setClosedShiftSummary] = useState<ShiftSummary | null>(null);
  const [closedShiftSummaryError, setClosedShiftSummaryError] = useState<string | null>(null);
  const [adjustDirection, setAdjustDirection] = useState<"in" | "out">("in");
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const adjustAttempt = useRef<string | null>(null);
  const [shiftSummary, setShiftSummary] = useState<ShiftSummary | null>(null);
  const [shiftSummaryError, setShiftSummaryError] = useState<string | null>(null);
  const [issues, setIssues] = useState<Issues | null>(null);
  const [issuesError, setIssuesError] = useState<string | null>(null);
  const [refundRead, setRefundRead] = useState<RefundRead | null>(null);
  const [refundReason, setRefundReason] = useState("");
  const [refundCash, setRefundCash] = useState("");
  const [refundBank, setRefundBank] = useState("");
  const [refundBankRef, setRefundBankRef] = useState("");
  const [refundEvidence, setRefundEvidence] = useState("");
  const [mutationBusy, setBusy] = useState(false);
  const [bootstrapReady,setBootstrapReady]=useState(false);
  const [bootstrapError,setBootstrapError]=useState<string|null>(null);
  const busy=mutationBusy||!bootstrapReady;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const requestVersion = useRef(0);
  const lookupSelectionVersion = useRef(0);
  const lookupSelectionRead = useRef<AbortController | null>(null);
  useEffect(() => () => {
    lookupSelectionVersion.current++;
    lookupSelectionRead.current?.abort();
  }, []);
  const mutationLock = useRef(false);
  const cashScope=JSON.stringify([user?.id,clubId,sessionReadEpoch(session),authLoading,capabilities.loading]);
  const activeCashScope=useRef(cashScope);activeCashScope.current=cashScope;
  const [cashJournal,setCashJournal]=useState<{scope:string;pending:CashPaymentIntent|null;error:string|null}|null>(null);
  const currentCashJournal=cashJournal?.scope===cashScope?cashJournal:null;
  const cashReady=!!user?.id&&!!session?.access_token&&!authLoading&&!capabilities.loading&&!!clubId;
  useEffect(()=>{
    activeCashScope.current=cashScope;
    const load=()=>{
      if(activeCashScope.current!==cashScope)return;
      if(!cashReady||!user?.id||!clubId){setCashJournal(null);return;}
      try{const saved=readCashPaymentJournal(localStorage,user.id,clubId);
        setCashJournal({scope:cashScope,pending:saved?.state==='pending'?saved.intent:null,error:null});
      }catch{setCashJournal({scope:cashScope,pending:null,error:'Không đọc được journal khoản thu. Chưa thể thu thêm; giữ nguyên dữ liệu để đối chiếu.'});}
    };
    load();
    const changed=(event:StorageEvent)=>{if(event.key===null||event.key===cashPaymentJournalKey(user?.id??'',clubId??''))load();};
    window.addEventListener('storage',changed);return()=>{
      window.removeEventListener('storage',changed);
      if(activeCashScope.current===cashScope)activeCashScope.current='';
    };
  },[cashScope,cashReady,user?.id,clubId]);
  const scanPending = useRef(false);
  const scanner = useRef<HTMLInputElement>(null);
  const cashInput = useRef<HTMLInputElement>(null);
  const closeDetail = useRef<HTMLButtonElement>(null);
  const activeTour = tours.find((tour) => tour.id === tourId) ?? null;
  const selectedTour = tours.find((tour) => tour.id === selected?.tournament_id) ?? null;
  const selectedTourName = selected?.tournament_name ?? selectedTour?.name ?? "Không xác định";
  const shiftId = shift?.id ?? null;
  const closedShift = closedShifts.find((item) => item.id === closedShiftId) ?? null;
  const selectedId = selected?.id ?? null;
  const currentRefundRead = refundRead?.registrationId === selectedId ? refundRead : null;
  const refund = currentRefundRead?.value ?? null;
  const issueCountLabel = !issues ? "—" : issues.shown >= 100 ? "≥100" : String(issues.shown);

  useEffect(() => {
    if (!selectedId) return;
    if (window.matchMedia("(max-width: 1023px)").matches) closeDetail.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !mutationLock.current) { setSelected(null); scanner.current?.focus(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedId]);

  useEffect(() => {
    if (!clubId || capabilities.loading || invalidBooking) return;
    let active = true;
    const controller=new AbortController();
    setBootstrapReady(false);
    let tourRead=client.from("tournaments").select("id,name,start_time,status,registration_closed_at")
      .eq("club_id",clubId).is("deleted_at",null);
    if(bookingFocus)tourRead=tourRead.eq('id',bookingFocus.tournamentId);
    void observeTrackerContextRead(Promise.all([
      tourRead.abortSignal(controller.signal).order("start_time", { ascending: false }).limit(80),
      client.from("cashier_till_shifts" as never).select("id,opening_cash,opened_at")
        .eq("club_id", clubId).is("closed_at", null).abortSignal(controller.signal).maybeSingle(),
      client.from("cashier_till_shifts" as never)
        .select("id,opening_cash,opened_at,closed_at,counted_cash,expected_cash,variance_cash")
        .eq("club_id", clubId).not("closed_at", "is", null).abortSignal(controller.signal)
        .order("closed_at", { ascending: false }).limit(20),
    ])).then(([tourResult, shiftResult, closedShiftResult]) => {
      if (!active) return;
      if (tourResult.error) throw tourResult.error;
      if (shiftResult.error) throw shiftResult.error;
      if (closedShiftResult.error) throw closedShiftResult.error;
      if(!Array.isArray(tourResult.data)||!Array.isArray(closedShiftResult.data))throw new Error('Không tải được danh sách tour hoặc ca thu ngân. Bấm Làm mới để thử lại.');
      const nextTours = tourResult.data as Tour[];
      if(bookingFocus&&!nextTours.some(tour=>tour.id===bookingFocus.tournamentId))throw new Error('Không xác minh được tour từ chat trong CLB này.');
      setTours(nextTours);
      const stored = sessionStorage.getItem(`cashier-tour:${clubId}`);
      setTourId((current) => bookingFocus?bookingFocus.tournamentId:current && nextTours.some((tour) => tour.id === current) ? current
        : stored && nextTours.some((tour) => tour.id === stored) ? stored : null);
      setShift(shiftResult.data as unknown as Shift | null);
      const nextClosedShifts = closedShiftResult.data as unknown as Shift[];
      setClosedShifts(nextClosedShifts);
      setClosedShiftId((current) => current && nextClosedShifts.some((item) => item.id === current)
        ? current : nextClosedShifts[0]?.id ?? null);
      setBootstrapError(null);setBootstrapReady(true);
    }).catch((cause: unknown) => {
      if (active) {
        setShift(null); setClosedShifts([]); setClosedShiftId(null);
        setBootstrapError(cause instanceof Error ? cause.message==='tracker_context_read_timeout'
          ?'Không tải được danh sách tour hoặc ca thu ngân. Bấm Làm mới để thử lại.':cause.message : "Không tải được tour hoặc ca thu ngân.");
      }
    }).finally(()=>controller.abort());
    return () => { active = false;controller.abort(); };
  }, [client, clubId, capabilities.loading, revision,bookingFocus,invalidBooking]);

  useEffect(() => {
    if (!clubId || !tourId) { setWorklist(null); return; }
    let active = true;
    let pollTimer: number | undefined;
    let deadline: number | undefined;
    let controller: AbortController | undefined;
    let inFlight = false;
    let failed = false;
    const load = async () => {
      if (!active || inFlight || failed || document.visibilityState === "hidden" || navigator.onLine === false) return;
      inFlight = true;
      const version = ++requestVersion.current;
      setLoading(true);
      controller = new AbortController();
      try {
        const { data, error: rpcError }: { data: unknown; error: unknown } = await Promise.race([
          client.rpc("cashier_tour_worklist_v1" as never, {
            p_club_id: clubId, p_tournament_id: tourId, p_query: query.trim(), p_bucket: bucket,
            p_page: page, p_limit: 50,
          } as never).abortSignal(controller.signal),
          new Promise<never>((_, reject) => {
            deadline = window.setTimeout(() => {
              controller?.abort();
              reject(new Error("WORKLIST_TIMEOUT"));
            }, 10_000);
          }),
        ]);
        window.clearTimeout(deadline);
        if (!active || version !== requestVersion.current) return;
        setLoading(false);
        if (rpcError) throw rpcError;
        if (!isWorklist(data)) throw new Error("INVALID_WORKLIST");
        const result = data;
        if(bookingFocus&&(result.rows.length!==1||result.rows[0].id!==bookingFocus.registrationId||result.rows[0].tournament_id!==bookingFocus.tournamentId))throw new Error('BOOKING_TARGET_NOT_CONFIRMED');
        setError(null);
        setWorklist(result);
        if(bookingFocus&&!bookingOpened.current){bookingOpened.current=true;setSelected(result.rows[0]);}
        setSelected((current) => current ? current.tournament_id !== tourId ? current
          : result.rows.find((row) => row.id === current.id) ?? null : null);
        if (scanPending.current) {
          scanPending.current = false;
          if (result.rows.length === 1) {
            const row = result.rows[0];
            setSelected(row);
            setCashAmount(row.bucket === "counter" ? String(Math.max(0,row.total_pay-row.received)) : "");
            setRefundRead(null); setRefundReason(""); setRefundCash(""); setRefundBank("");
            setRefundBankRef(""); setRefundEvidence("");
            window.setTimeout(() => cashInput.current?.focus(), 0);
          }
        }
        pollTimer = window.setTimeout(() => { void load(); }, 10_000);
      } catch {
        if (!active || version !== requestVersion.current) return;
        failed = true;
        scanPending.current = false;
        setLoading(false);
        setWorklist(null);
        setSelected(null);
        setCashAmount("");
        setError(bookingFocus?"Không xác minh được đúng đăng ký từ chat. Chưa thể thu tiền; tải lại hoặc mở quầy không kèm ngữ cảnh chat.":"Không xác minh được danh sách tour. Bấm Làm mới để thử lại.");
      } finally {
        inFlight = false;
        window.clearTimeout(deadline);
      }
    };
    const resume = () => {
      if (document.visibilityState === "hidden" || navigator.onLine === false || inFlight || failed) return;
      window.clearTimeout(pollTimer);
      void load();
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    void load();
    return () => {
      active = false;
      controller?.abort();
      window.clearTimeout(deadline);
      window.clearTimeout(pollTimer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
    };
  }, [client, clubId, tourId, query, bucket, page, revision,bookingFocus]);

  useEffect(() => {
    if (!shiftId || !clubId) { setShiftSummary(null); setShiftSummaryError(null); return; }
    let active = true;
    setShiftSummary(null); setShiftSummaryError(null);
    const load = async () => {
      const { data, error: rpcError } = await client.rpc("cashier_shift_summary_v1" as never, { p_shift_id: shiftId } as never);
      if (!active) return;
      if (rpcError || !isShiftSummary(data, shiftId, clubId)) {
        setShiftSummary(null);
        setShiftSummaryError(rpcError?.message ?? "Không đọc được báo cáo ca.");
      } else {
        setShiftSummary(data);
        setShiftSummaryError(null);
      }
    };
    void load();
    const timer = window.setInterval(() => { void load(); }, 10_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [client, clubId, shiftId, revision]);

  useEffect(() => {
    if (!closedShift?.id || !clubId) { setClosedShiftSummary(null); setClosedShiftSummaryError(null); return; }
    let active = true;
    setClosedShiftSummary(null); setClosedShiftSummaryError(null);
    void client.rpc("cashier_shift_summary_v1" as never, { p_shift_id: closedShift.id } as never)
      .then(({ data, error: rpcError }) => {
        if (!active) return;
        if (rpcError || !isShiftSummary(data, closedShift.id, clubId)) {
          setClosedShiftSummary(null);
          setClosedShiftSummaryError(rpcError?.message ?? "Không đọc được ca vừa chốt.");
        } else {
          setClosedShiftSummary(data);
          setClosedShiftSummaryError(null);
        }
      });
    return () => { active = false; };
  }, [client, clubId, closedShift?.id, revision]);

  useEffect(() => {
    if (!clubId) { setIssues(null); setIssuesError(null); return; }
    let active = true;
    let inFlight = false;
    let failed = false;
    let controller: AbortController | undefined;
    let deadline: number | undefined;
    let timer: number | undefined;
    setIssues(null); setIssuesError(null);
    const load = async () => {
      if (!active || inFlight || failed || document.visibilityState === "hidden" || navigator.onLine === false) return;
      inFlight = true;
      controller = new AbortController();
      try {
        const { data, error: rpcError } = await Promise.race([
          client.rpc("cashier_tour_issues_v1" as never, {p_club_id:clubId,p_tournament_id:tourId} as never).abortSignal(controller.signal),
          new Promise<never>((_,reject) => {deadline=window.setTimeout(() => {
            controller?.abort();reject(new Error("ISSUES_TIMEOUT"));
          },10_000);}),
        ]);
        if (!active) return;
        const result = data as unknown as Issues | null;
        if (rpcError) throw rpcError;
        if (!result?.ok) throw new Error("INVALID_ISSUES");
        setIssues(result);
        setIssuesError(null);
        timer=window.setTimeout(() => {void load();},10_000);
      } catch {
        if (!active) return;
        failed=true;setIssues(null);
        setIssuesError("Không đọc được khoản SePay cần xử lý. Bấm Làm mới để thử lại.");
      } finally {
        inFlight=false;window.clearTimeout(deadline);
      }
    };
    const resume=() => {
      if (document.visibilityState === "hidden" || navigator.onLine === false || inFlight || failed) return;
      window.clearTimeout(timer);void load();
    };
    document.addEventListener("visibilitychange",resume);window.addEventListener("online",resume);
    void load();
    return () => {
      active=false;controller?.abort();window.clearTimeout(timer);window.clearTimeout(deadline);
      document.removeEventListener("visibilitychange",resume);window.removeEventListener("online",resume);
    };
  }, [client, clubId, tourId, revision]);

  useEffect(() => {
    if (!clubId || !tourId || query.trim().length < 3) {
      setLookup([]); setLookupError(null); return;
    }
    let active = true;
    const controller = new AbortController();
    setLookup([]); setLookupError(null);
    const timer = window.setTimeout(async () => {
      try {
        const { data, error: rpcError } = await observeTrackerContextRead(
          client.rpc("cashier_lookup_tour_v1" as never, {
            p_club_id: clubId, p_serving_tournament_id: tourId, p_query: query.trim(),
          } as never).abortSignal(controller.signal),
        );
        if (!active) return;
        const result = data as { ok?: boolean; rows?: Lookup[] } | null;
        if (rpcError || result?.ok !== true || !Array.isArray(result.rows)
          || result.rows.some((row) => !row || typeof row.registration_id !== "string" || !row.registration_id
            || typeof row.tournament_id !== "string" || !row.tournament_id
            || typeof row.tournament_name !== "string" || typeof row.player_name !== "string")) {
          throw new Error("INVALID_CASHIER_LOOKUP");
        }
        setLookup(result.rows);
      } catch {
        if (!active) return;
        setLookup([]);
        setLookupError("Không đọc được đăng ký ở tour khác. Bấm Làm mới để thử lại.");
      } finally {
        controller.abort();
      }
    }, 250);
    return () => { active = false; controller.abort(); window.clearTimeout(timer); };
  }, [client, clubId, query, tourId, revision]);

  useEffect(() => {
    if (!selectedId) { setRefundRead(null); return; }
    let active = true;
    let inFlight = false;
    let failed = false;
    let timer: number | undefined;
    let controller: AbortController | undefined;
    setRefundRead({ registrationId: selectedId, loading: true, value: null, error: null });
    const load = async () => {
      if (!active || failed || inFlight || document.visibilityState === "hidden" || navigator.onLine === false) return;
      inFlight = true;
      controller = new AbortController();
      try {
        const { data, error: readError } = await observeTrackerContextRead(
          client.from("cashier_refund_requests" as never)
            .select("id,amount,status,reason").eq("registration_id", selectedId)
            .abortSignal(controller.signal).maybeSingle(),
        );
        if (!active) return;
        if (readError) throw readError;
        if (data !== null && !isRefund(data)) throw new Error("INVALID_REFUND_READ");
        setRefundRead({ registrationId: selectedId, loading: false, value: data as unknown as Refund | null, error: null });
        timer = window.setTimeout(() => { void load(); }, 10_000);
      } catch {
        if (!active) return;
        failed = true;
        setRefundRead({ registrationId: selectedId, loading: false, value: null,
          error: "Chưa xác minh được dữ liệu. Đóng chi tiết và chọn lại khách để thử lại" });
      } finally {
        inFlight = false;
        controller.abort();
      }
    };
    const resume = () => {
      if (!active || failed || inFlight || document.visibilityState === "hidden" || navigator.onLine === false) return;
      window.clearTimeout(timer);
      void load();
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    void load();
    return () => {
      active = false; controller?.abort(); window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
    };
  }, [client, selectedId, revision]);

  const changeTour = (next: string | null) => {
    if (mutationLock.current || bookingFocus) return;
    requestVersion.current++;
    lookupSelectionVersion.current++;
    setTourId(next);
    if (clubId) {
      if (next) sessionStorage.setItem(`cashier-tour:${clubId}`, next);
      else sessionStorage.removeItem(`cashier-tour:${clubId}`);
    }
    setSelected(null); setCashAmount(""); setQuery(""); setLookup([]); setLookupError(null); setBucket("counter"); setIssuesView(false); setPage(0);
    setRefundRead(null); setRefundReason(""); setRefundCash(""); setRefundBank("");
    setRefundBankRef(""); setRefundEvidence("");
    setWorklist(null);
    setIssues(null); setIssuesError(null);
    scanPending.current = false;
    window.setTimeout(() => scanner.current?.focus(), 0);
  };
  const refresh = () => {setBootstrapReady(false);setRevision((current) => current + 1);};

  const selectRow = (row: Row) => {
    if (mutationLock.current) return;
    lookupSelectionVersion.current++;
    setSelected(row);
    setCashAmount(row.bucket === "counter" ? String(Math.max(0, row.total_pay-row.received)) : "");
    setRefundRead(null); setRefundReason(""); setRefundCash(""); setRefundBank("");
    setRefundBankRef(""); setRefundEvidence("");
  };

  const selectOtherTourRegistration = async (match: Lookup) => {
    if (!clubId || mutationLock.current) return;
    const version = ++lookupSelectionVersion.current;
    lookupSelectionRead.current?.abort();
    const controller = new AbortController();
    lookupSelectionRead.current = controller;
    setLookupError(null);
    try {
      const { data, error: rpcError }: { data: unknown; error: unknown } = await observeTrackerContextRead(
        client.rpc("cashier_tour_worklist_v1" as never, {
          p_club_id: clubId, p_tournament_id: match.tournament_id,
          p_query: match.registration_id, p_bucket: "all", p_page: 0, p_limit: 1,
        } as never).abortSignal(controller.signal),
      );
      if (version !== lookupSelectionVersion.current) return;
      const result = isWorklist(data) ? data : null;
      const row = result?.rows.find((item) => item.id === match.registration_id && item.tournament_id === match.tournament_id);
      if (rpcError || !result?.enabled || !row) throw new Error("INVALID_CASHIER_LOOKUP_SELECTION");
      selectRow({ ...row, tournament_name: match.tournament_name });
    } catch {
      if (version === lookupSelectionVersion.current) {
        setLookupError("Không đọc được đăng ký thuộc tour này. Bấm Xem đăng ký tour này để thử lại.");
      }
    } finally {
      controller.abort();
      if (lookupSelectionRead.current === controller) lookupSelectionRead.current = null;
    }
  };

  const mutate = async (name: string, args: Record<string, unknown>, onSuccess: (result: Record<string, unknown>) => void) => {
    if (!OPS_TOUR_CASHIER_ENABLED || !bootstrapReady || mutationLock.current) return;
    mutationLock.current = true; setBusy(true); setError(null); setNotice(null);
    try {
      const { data, error: rpcError } = await client.rpc(name as never, args as never);
      const result = assertMutationOk(data, rpcError);
      onSuccess(result);
      refresh();
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "";
      setError(code === "verified_payment_history_required"
        ? "Chưa đối chiếu đủ khoản thu trong sổ giao dịch; không thể hoàn tự động. Cần đối soát riêng."
        : code === "active_seat_or_chips"
          ? "Lượt này đã có ghế hoặc chip hoạt động; chưa thể hoàn tại quầy."
          : code === "floor_clearance_required"
            ? "Lượt này từng được xếp ghế hoặc đã chơi; cần Floor xử lý theo quy trình cũ trước khi chi hoàn."
          : code || "Máy chủ chưa xác nhận thao tác.");
    } finally {
      mutationLock.current = false; setBusy(false);
    }
  };

  const runCashIntent=async(action:'record'|'read'|'cancel',amount?:number)=>{
    if(action==='record'&&!bootstrapReady)return;
    if(mutationLock.current||!cashReady||!user?.id||!clubId||!currentCashJournal||currentCashJournal.error)return;
    if(!navigator.locks){setError('Trình duyệt chưa hỗ trợ khóa journal giữa các tab; chưa thể ghi nhận khoản thu.');return;}
    const scope=cashScope,actor=user.id,club=clubId,key=cashPaymentJournalKey(actor,club);
    mutationLock.current=true;setBusy(true);setError(null);setNotice(null);
    try{
      const intent=await navigator.locks.request(key,()=>{
        if(activeCashScope.current!==scope)throw new Error('CASH_SCOPE_CHANGED');
        const saved=readCashPaymentJournal(localStorage,actor,club);
        if(action!=='record'){
          if(saved?.state!=='pending')throw new Error('CASH_JOURNAL_CHANGED');
          return saved.intent;
        }
        if(saved?.state==='pending')throw new Error('CASH_INTENT_UNRESOLVED');
        if(!selected||!tourId||!amount)throw new Error('CASH_SCOPE_CHANGED');
        const next:CashPaymentIntent={actor_id:actor,club_id:club,tournament_id:tourId,
          registration_id:selected.id,amount,request_id:crypto.randomUUID()};
        persistCashPaymentIntent(localStorage,next);return next;
      });
      if(activeCashScope.current!==scope)return;
      setCashJournal({scope,pending:intent,error:null});
      const result=await resolveCashPaymentIntent(client.rpc.bind(client) as unknown as Parameters<typeof resolveCashPaymentIntent>[0],intent,action);
      if(activeCashScope.current!==scope)return;
      if(result.status==='unknown'){
        setError('Chưa xác minh được khoản thu trước. Không thu lại; kiểm tra hoặc đóng yêu cầu chưa ghi nhận bằng nút bên trên.');return;
      }
      await navigator.locks.request(key,()=>{
        if(activeCashScope.current!==scope)throw new Error('CASH_SCOPE_CHANGED');
        settleCashPaymentIntent(localStorage,intent);
      });
      if(activeCashScope.current!==scope)return;
      setCashJournal({scope,pending:null,error:null});
      if(result.status==='rejected')setError(`Khoản thu bị từ chối: ${String(result.result.error)}`);
      else setNotice(result.status==='cancelled'
        ? 'Đã đóng yêu cầu chưa ghi nhận. Không xóa hoặc hoàn khoản tiền đã thu.'
        : `Đã xác minh khoản thu ${formatMoney(intent.amount)}. Trạng thái ghế được tải lại từ máy chủ.`);
      requestVersion.current++;setSelected(null);setCashAmount('');setWorklist(null);refresh();
    }catch{
      if(activeCashScope.current===scope){
        try{const saved=readCashPaymentJournal(localStorage,actor,club);setCashJournal({scope,pending:saved?.state==='pending'?saved.intent:null,error:null});}
        catch{setCashJournal({scope,pending:null,error:'Không đọc được journal khoản thu. Chưa thể thu thêm.'});}
        setError('Không thể xác minh journal khoản thu. Không tạo yêu cầu mới khi khoản trước chưa được xử lý.');
      }
    }finally{mutationLock.current=false;setBusy(false);}
  };
  const recordCash = () => {
    if (!selected || !tourId || !shift || selected.legacy_detail_missing) return;
    const amount = Number(cashAmount);
    const remaining = selected.total_pay - selected.received;
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > remaining) {
      setError(`Số tiền mặt phải từ 1 đến ${formatMoney(remaining)}.`); return;
    }
    void runCashIntent('record',amount);
  };

  if (capabilities.loading) return <p className="p-6 text-white">Đang kiểm tra quyền Cashier…</p>;
  if (capabilities.scopeError) return <section role="alert" className="space-y-3 p-6 text-amber-200">
    <p>Chưa xác minh được quyền Cashier. Không thực hiện thu tiền; hãy thử tải lại phạm vi CLB.</p>
    <button type="button" onClick={capabilities.refresh} className="min-h-11 rounded-xl border border-white/15 px-3">Thử tải lại quyền Cashier</button>
  </section>;
  if (!clubId) return <p className="p-6 text-amber-200">Không có quyền Cashier tại CLB đã chọn.</p>;
  const plainCashierUrl='/ops/cashier/tour?'+new URLSearchParams({club:clubId}).toString();
  if(invalidBooking)return <section role="alert" className="space-y-3 p-6 text-amber-200"><p>Liên kết từ chat không hợp lệ. Chưa chọn tour hoặc đăng ký để thu tiền.</p><a className="underline" href={plainCashierUrl}>Mở quầy không kèm ngữ cảnh chat</a></section>;
  return <div className="min-w-0 space-y-4 pb-8 text-[#eef5ef]">
    {bookingFocus&&<section role="status" className="space-y-2 rounded-xl border border-emerald-300/30 p-3 text-sm"><p>Đang xem đúng đăng ký được chọn từ chat. Đây chỉ là đối chiếu; chưa ghi nhận khoản thu nào. Kiểm tra người chơi, tour và số tiền trước khi thao tác.</p><a className="underline" href={plainCashierUrl}>Mở quầy không kèm ngữ cảnh chat</a></section>}
    {currentCashJournal?.error&&<p role="alert" className="rounded-xl border border-amber-300/40 p-4 text-sm text-amber-200">{currentCashJournal.error}</p>}
    {currentCashJournal?.pending&&<section role="status" className="space-y-2 rounded-xl border border-amber-300/40 p-4 text-sm text-amber-200">
      <p>Khoản thu {formatMoney(currentCashJournal.pending.amount)} đang chờ xác minh. Không thu lại, kể cả khi đổi khách hoặc tải lại trang.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={mutationBusy} onClick={()=>void runCashIntent('read')} className="min-h-11 rounded-lg border border-amber-300/40 px-3">Kiểm tra khoản thu trước</button>
        <button type="button" disabled={mutationBusy} onClick={()=>void runCashIntent('cancel')} className="min-h-11 rounded-lg border border-amber-300/40 px-3">Đóng yêu cầu chưa ghi nhận</button>
      </div>
    </section>}
    <header className="rounded-2xl border border-emerald-300/20 bg-[#0a1813] p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-emerald-300">Quầy Buy-in · {clubName}</p>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">{activeTour?.name ?? "Chọn tour đang phục vụ"}</h1>
          <p className="mt-1 text-sm text-[#a9baae]">{activeTour ? `${dateTime(activeTour.start_time)} · ${activeTour.registration_closed_at ? "Đã đóng đăng ký" : activeTour.status}` : "Màn Tất cả chỉ theo dõi; chọn một tour trước khi thu tiền."}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={refresh} className="min-h-11 rounded-xl border border-white/15 px-3" aria-label="Làm mới"><RefreshCw className="h-4 w-4" /></button>
          <button type="button" disabled={!!bookingFocus} onClick={() => changeTour(null)} className="min-h-11 rounded-xl border border-white/15 px-4 text-sm">Tất cả tour</button>
        </div>
      </div>
      <div className="mt-4 flex gap-2 overflow-x-auto pb-1" aria-label="Chọn tour phục vụ">
        {tours.map((tour) => <button key={tour.id} type="button" disabled={busy||!!bookingFocus} onClick={() => changeTour(tour.id)}
          className={`min-h-11 shrink-0 rounded-xl px-4 text-left text-sm ${tourId === tour.id ? "bg-[#89ef9e] font-bold text-[#092014]" : "border border-white/15 bg-white/5"}`}>
          {tour.name} · {dateTime(tour.start_time)}
        </button>)}
      </div>
    </header>

    {bootstrapError&&<p role="alert" className="rounded-xl border border-rose-300/30 bg-rose-950/30 p-3 text-sm text-rose-100">{bootstrapError}</p>}
    {error && <p role="alert" className="rounded-xl border border-rose-300/30 bg-rose-950/30 p-3 text-sm text-rose-100"><AlertTriangle className="mr-2 inline h-4 w-4" />{error}</p>}
    {shiftSummaryError && <p role="alert" className="rounded-xl border border-rose-300/30 bg-rose-950/30 p-3 text-sm text-rose-100">{shiftSummaryError} Không dùng số cũ để chốt ca.</p>}
    {closedShiftSummaryError && <p role="alert" className="rounded-xl border border-rose-300/30 bg-rose-950/30 p-3 text-sm text-rose-100">{closedShiftSummaryError} Không ghi điều chỉnh khi chưa đọc được ca đã chốt.</p>}
    {issuesError && <p role="alert" className="rounded-xl border border-rose-300/30 bg-rose-950/30 p-3 text-sm text-rose-100">{issuesError} Mở Đối soát SePay để kiểm tra trước khi xử lý.</p>}
    {notice && <p role="status" className="rounded-xl border border-emerald-300/30 bg-emerald-950/30 p-3 text-sm text-emerald-100"><Check className="mr-2 inline h-4 w-4" />{notice}</p>}
    {tourId && worklist && !worklist.enabled && <p role="status" className="rounded-xl border border-amber-300/30 bg-amber-950/20 p-3 text-sm text-amber-100">Cashier V1 chưa được owner bật tại CLB này. Không nhận buy-in mới; ca và yêu cầu hoàn cũ vẫn có thể xử lý an toàn.</p>}
    {issues?.sepay_unavailable && <p role="alert" className="rounded-xl border border-amber-300/30 bg-amber-950/20 p-3 text-sm text-amber-100">Kênh quét SePay đang lỗi. Không xác nhận chuyển khoản bằng ảnh; kiểm tra Đối soát SePay trước khi thu phần còn thiếu.</p>}

    <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-[#101c17] p-3 text-sm">
      <Wallet className="h-5 w-5 text-[#89ef9e]" />
      {shift ? <><span>Ca chung mở lúc {dateTime(shift.opened_at)}</span>
        <label className="ml-auto flex items-center gap-2">Thực đếm khi chốt
          <input inputMode="numeric" value={countedCash} onChange={(event) => setCountedCash(event.target.value)} placeholder="VND"
            className="w-28 rounded-lg border border-white/15 bg-[#08110c] p-2 text-white" /></label>
        <button type="button" disabled={busy} onClick={() => {
          const amount = Number(countedCash);
          if (!Number.isSafeInteger(amount) || amount < 0) { setError("Nhập số tiền thực đếm hợp lệ."); return; }
          if (!window.confirm(`Chốt ca chung với tiền mặt thực đếm ${formatMoney(amount)}?`)) return;
          void mutate("cashier_close_shift_v1", { p_shift_id: shift.id, p_counted_cash: amount }, (result) => {
            setNotice(`Đã chốt ca. Chênh lệch: ${formatReportedMoney(result.variance_cash)}.`);
            setShift(null); setCountedCash("");
          });
        }} className="min-h-11 rounded-xl border border-amber-300/30 px-4 text-amber-200 disabled:opacity-50">Chốt ca</button></>
        : <><span>Chưa mở ca · không thể nhận tiền mặt</span>
          <input inputMode="numeric" value={openingCash} onChange={(event) => setOpeningCash(event.target.value)} placeholder="Tiền đầu ca (VND)"
            className="ml-auto w-40 rounded-lg border border-white/15 bg-[#08110c] p-2 text-white" />
          <button type="button" disabled={busy || !worklist?.enabled} onClick={() => {
            const amount = Number(openingCash);
            if (!Number.isSafeInteger(amount) || amount < 0) { setError("Nhập tiền đầu ca hợp lệ."); return; }
            void mutate("cashier_open_shift_v1", { p_club_id: clubId, p_opening_cash: amount }, () => {
              setNotice("Đã mở ca chung."); setOpeningCash("");
            });
          }} className="min-h-11 rounded-xl bg-[#89ef9e] px-4 font-bold text-[#092014] disabled:opacity-50">Mở ca</button></>}
    </section>
    {shiftSummary?.ok && <section className="grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-[#101c17] p-3 text-xs sm:grid-cols-4" aria-label="Báo cáo ca hiện tại">
      <span>Tiền mặt nhận<strong className="block text-sm text-white">{formatMoney(shiftSummary.totals.cash_in)}</strong></span>
      <span>Tiền mặt hoàn<strong className="block text-sm text-white">{formatMoney(shiftSummary.totals.cash_out)}</strong></span>
      <span>Ngân hàng nhận<strong className="block text-sm text-white">{formatMoney(shiftSummary.totals.bank_in)}</strong></span>
      <span>Khoản thừa chưa phân bổ<strong className="block text-sm text-amber-200">{formatMoney(shiftSummary.totals.unallocated_bank)}</strong></span>
      <p className="col-span-full text-[#9fb1a6]">Tiền ngân hàng không cộng vào tiền mặt phải kiểm đếm. Số này chỉ là các khoản trên sổ giao dịch mới của ca.</p>
    </section>}
    {closedShift && <section className="rounded-2xl border border-white/10 bg-[#101c17] p-3 text-sm" aria-label="Điều chỉnh ca đã chốt">
      <h2 className="font-semibold">Điều chỉnh ca đã chốt</h2>
      <label className="mt-2 block text-xs">Chọn ca đã chốt
        <select value={closedShift.id} onChange={(event) => {
          setClosedShiftId(event.target.value); setAdjustAmount(""); setAdjustReason(""); adjustAttempt.current = null;
        }} className="mt-1 block min-h-11 max-w-full rounded-lg border border-white/15 bg-[#08110c] px-2 text-white">
          {closedShifts.map((item) => <option key={item.id} value={item.id}>Mở {dateTime(item.opened_at)} · chốt {dateTime(item.closed_at ?? null)}</option>)}
        </select>
      </label>
      <p className="mt-1 text-[#a9baae]">Thực đếm {formatReportedMoney(closedShift.counted_cash)} · Chênh lệch {formatReportedMoney(closedShift.variance_cash)}. Các số đã chốt không thay đổi.</p>
      {closedShiftSummary?.ok && closedShiftSummary.shift_id === closedShift.id && <p className="mt-1 text-[#a9baae]">Điều chỉnh ghi bổ sung: {formatMoney(closedShiftSummary.totals.cash_adjustments)}. Không cộng vào doanh thu buy-in.</p>}
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="text-xs">Chiều điều chỉnh<select value={adjustDirection} onChange={(event) => { setAdjustDirection(event.target.value as "in" | "out"); adjustAttempt.current = null; }} className="mt-1 block min-h-11 rounded-lg border border-white/15 bg-[#08110c] px-2 text-white"><option value="in">Ghi tăng</option><option value="out">Ghi giảm</option></select></label>
        <label className="text-xs">Số tiền (VND)<input inputMode="numeric" value={adjustAmount} onChange={(event) => { setAdjustAmount(event.target.value); adjustAttempt.current = null; }} className="mt-1 block min-h-11 w-36 rounded-lg border border-white/15 bg-[#08110c] px-2 text-white" /></label>
        <label className="min-w-48 flex-1 text-xs">Lý do<input value={adjustReason} onChange={(event) => { setAdjustReason(event.target.value); adjustAttempt.current = null; }} className="mt-1 block min-h-11 w-full rounded-lg border border-white/15 bg-[#08110c] px-2 text-white" /></label>
        <button type="button" disabled={busy || !closedShiftSummary?.ok || closedShiftSummary.shift_id !== closedShift.id} onClick={() => {
          const amount = Number(adjustAmount);
          if (!Number.isSafeInteger(amount) || amount < 1 || adjustReason.trim().length < 8) {
            setError("Nhập số tiền dương và lý do ít nhất 8 ký tự."); return;
          }
          if (!window.confirm(`Ghi ${adjustDirection === "in" ? "tăng" : "giảm"} ${formatMoney(amount)} cho ca đã chốt? Đây là bản ghi mới, không sửa số đã chốt.`)) return;
          adjustAttempt.current ??= crypto.randomUUID();
          void mutate("cashier_adjust_shift_v1", {
            p_shift_id: closedShift.id, p_direction: adjustDirection, p_amount: amount,
            p_reason: adjustReason.trim(), p_request_id: adjustAttempt.current,
          }, () => {
            setNotice("Đã ghi điều chỉnh ca bằng giao dịch mới.");
            setAdjustAmount(""); setAdjustReason(""); adjustAttempt.current = null;
          });
        }} className="min-h-11 rounded-xl border border-amber-300/30 px-4 text-amber-200 disabled:opacity-50">Ghi điều chỉnh</button>
      </div>
    </section>}

    {!tourId ? <section className="rounded-2xl border border-white/10 bg-[#101c17] p-5">
      <h2 className="text-lg font-semibold">Các tour tại {clubName}</h2>
      <p className="mt-1 text-sm text-[#a9baae]">Chọn tour một lần, quét liên tục. Hệ thống không tự đổi tour theo đồng hồ.</p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">{tours.map((tour) => <button key={tour.id} type="button" disabled={busy} onClick={() => changeTour(tour.id)}
        className="min-h-16 rounded-xl border border-white/10 p-3 text-left hover:border-emerald-300/50">{tour.name}<span className="block text-xs text-[#a9baae]">{dateTime(tour.start_time)} · {tour.status}</span></button>)}</div>
      <p className="mt-4 text-sm text-amber-200">Chưa phân bổ / khoản thừa toàn CLB: {issueCountLabel}. <a href="/cashier?tab=sepay_settlement" className="underline underline-offset-2">Mở đối soát SePay</a></p>
    </section> : <>
      <label className="relative block"><Search className="absolute left-4 top-3.5 h-5 w-5 text-[#9caf9f]" />
        <input ref={scanner} autoFocus disabled={busy||!!bookingFocus} value={query} onChange={(event) => {
          requestVersion.current++; lookupSelectionVersion.current++;
          setQuery(event.target.value); setPage(0); setWorklist(null); setSelected(null);
          setCashAmount(""); scanPending.current = false;
        }}
          onKeyDown={(event) => { if (event.key === "Enter" && !mutationLock.current) {
            requestVersion.current++; lookupSelectionVersion.current++;
            event.preventDefault(); scanPending.current = true; setBucket("all"); setPage(0); setWorklist(null); setSelected(null);
            setQuery(normalizeCashierScan(query)); refresh();
          } }}
          placeholder="Quét QR, thẻ hội viên, mã CK; hoặc tìm tên, số điện thoại"
          className="min-h-12 w-full rounded-xl border border-emerald-300/30 bg-[#08120d] py-3 pl-12 pr-4 text-white outline-none focus:ring-2 focus:ring-emerald-300" />
      </label>
      {lookup.length > 0 && <div role="status" className="rounded-xl border border-amber-300/30 bg-amber-950/20 p-3 text-sm text-amber-100">
        {lookup.map((match) => <div key={match.registration_id} className="flex flex-wrap items-center justify-between gap-2 py-1">
          <span>{match.player_name} · {match.tournament_name}</span>
          <button type="button" disabled={busy} onClick={() => void selectOtherTourRegistration(match)} className="min-h-11 rounded-lg border border-amber-300/50 px-3">Xem đăng ký tour này</button>
        </div>)}
      </div>}
      {lookupError && <p role="alert" className="rounded-xl border border-rose-300/30 bg-rose-950/30 p-3 text-sm text-rose-100">{lookupError} Chưa thể thu tiền cho đăng ký này.</p>}
      <nav className="flex gap-2 overflow-x-auto pb-1" aria-label="Nhóm khách">
        {([ ["counter","Chờ tại quầy"], ["completed","Đã tự hoàn tất"], ["waiting_seat","Chờ ghế"], ["needs_review","Cần xử lý"], ["all","Tất cả"] ] as const)
          .map(([key,label]) => <button type="button" key={key} disabled={busy||!!bookingFocus} onClick={() => { requestVersion.current++; setBucket(key); setIssuesView(false); setPage(0); setSelected(null); setWorklist(null); }}
            className={`min-h-11 shrink-0 rounded-xl px-4 text-sm ${bucket===key && !issuesView ? "bg-[#89ef9e] font-bold text-[#092014]" : "border border-white/15"}`}>
            {label} · {worklist ? key === "all" ? worklist.counts.total : worklist.counts[key] : "—"}</button>)}
        <button type="button" disabled={busy} onClick={() => { setIssuesView(true); setSelected(null); }} className={`min-h-11 shrink-0 rounded-xl px-4 text-sm ${issuesView ? "bg-amber-300 font-bold text-[#241807]" : "border border-amber-300/30 text-amber-200"}`}>Chuyển khoản cần xử lý · {issueCountLabel}</button>
      </nav>
      <p className="flex items-center gap-2 text-xs text-[#9fb1a6]"><Clock3 className="h-3.5 w-3.5" /> Cập nhật {dateTime(worklist?.updated_at ?? null)} · tự làm mới mỗi 10 giây {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}</p>
      {issuesView ? <section className="rounded-2xl border border-amber-300/20 bg-[#101c17] p-4">
        <h2 className="font-semibold">Cần xử lý tại {clubName}</h2>
        <p className="mt-1 text-xs text-[#a9baae]">Khoản thừa của tour đang chọn và chuyển khoản chưa ghép mã của toàn CLB. Không thu hoặc hoàn tiền dựa trên ảnh; xử lý bằng đối soát có quyền.</p>
        {issuesError ? <p role="alert" className="mt-4 text-sm text-rose-200">Chưa tải được danh sách, không thể kết luận là không có khoản cần xử lý.</p>
          : !issues ? <p role="status" className="mt-4 text-sm text-[#a9baae]">Đang tải khoản cần xử lý…</p>
          : !issues.rows.length ? <p className="mt-4 text-sm text-[#a9baae]">Chưa có khoản nào trong nhóm này.</p>
          : issues.rows.map((issue) => <div key={`${issue.kind}:${issue.bank_transaction_id}`} className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3 text-sm">
            <span>{issue.kind === "surplus" ? "Khoản thừa" : "Chưa phân bổ"} · {issue.reference_code ?? "không có mã khớp"}<span className="block text-xs text-[#a9baae]">{dateTime(issue.occurred_at)}</span></span>
            <strong className="text-amber-200">{formatMoney(issue.amount)}</strong>
          </div>)}
        <a href="/cashier?tab=sepay_settlement" className="mt-4 inline-flex min-h-11 items-center rounded-lg border border-amber-300/40 px-4 text-sm text-amber-100">Mở đối soát SePay</a>
      </section> : <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
        <section className="min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-[#101c17]">
          {!worklist ? <p role="status" className="p-5 text-sm text-[#a9baae]">{loading ? "Đang tải danh sách tour…" : "Chưa đọc được danh sách; bấm Làm mới để thử lại."}</p>
            : !worklist.rows.length ? <p className="p-5 text-sm text-[#a9baae]">Không có khách trong nhóm này.</p> : worklist.rows.map((row) => {
            const remaining = row.status === "confirmed" ? 0 : Math.max(0,row.total_pay-row.received);
            return <button type="button" key={row.id} disabled={busy} onClick={() => selectRow(row)}
              className={`flex min-h-20 w-full flex-col gap-1 border-b border-white/10 p-4 text-left last:border-0 hover:bg-white/5 ${selected?.id === row.id ? "bg-emerald-300/10" : ""}`}>
              <span className="flex w-full flex-wrap items-center justify-between gap-2"><strong className="min-w-0 truncate">{row.player_name}</strong><span className="font-mono text-sm">Còn {formatMoney(remaining)}</span></span>
              <span className="flex w-full flex-wrap justify-between gap-2 text-xs text-[#a9baae]"><span className="min-w-0 break-all">{row.reference_code}{(row.phone ?? row.member_card_id) && <span> · {row.phone ?? row.member_card_id}</span>}</span>
                <span>{row.legacy_detail_missing ? "Lịch sử: thiếu chi tiết khoản thu" : `Đã xác minh ${formatMoney(row.received)}`} · {row.receipt_code ? `${row.receipt_is_historical ? 'Phiếu lịch sử' : 'Phiếu đã cấp'}: bàn ${row.table_number}, ghế ${row.seat_number}` : row.status === "confirmed" ? "Đã xác nhận · thiếu phiếu" : row.bucket === "needs_review" ? `Ghế lỗi: ${row.cashier_seating_error ?? "cần kiểm tra"}` : row.bucket === "waiting_seat" ? "Chờ ghế" : "Chờ thanh toán"}</span></span>
            </button>;
          })}
          <div className="flex justify-between p-3 text-sm"><button type="button" disabled={busy || page===0 || !worklist} onClick={() => { requestVersion.current++; setPage((value) => value-1); setSelected(null); setWorklist(null); }} className="min-h-11 rounded-lg border border-white/15 px-3 disabled:opacity-40">Trước</button>
            <span className="self-center">Trang {page+1}</span><button type="button" disabled={busy || !worklist || worklist.rows.length<50} onClick={() => { requestVersion.current++; setPage((value) => value+1); setSelected(null); setWorklist(null); }} className="min-h-11 rounded-lg border border-white/15 px-3 disabled:opacity-40">Tiếp</button></div>
        </section>
        {selected && <aside role="dialog" aria-label={`Chi tiết buy-in ${selected.player_name}`} className="fixed inset-0 z-50 min-w-0 overflow-y-auto bg-[#09120e] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] lg:static lg:z-auto lg:rounded-2xl lg:border lg:border-white/10 lg:bg-[#101c17] lg:p-5">
          <button ref={closeDetail} type="button" disabled={busy} onClick={() => { setSelected(null); scanner.current?.focus(); }} className="mb-4 flex min-h-11 items-center gap-2 text-sm text-[#b7c9bc]"><ArrowLeft className="h-4 w-4" /> Đóng · khách tiếp theo</button>
          <h2 className="break-words text-xl font-bold">{selected.player_name}</h2>
          <p className="mt-1 text-sm text-amber-200">Tour của lượt này: {selectedTourName}</p>
          <p className="mt-1 break-all font-mono text-xs text-[#a9baae]">{selected.reference_code}</p>
          <div className="mt-5 space-y-2 rounded-xl border border-white/10 p-4 text-sm">
            <p className="flex justify-between gap-3"><span>Buy-in đã chốt</span><strong>{formatMoney(selected.total_pay)}</strong></p>
            <p className="flex justify-between gap-3"><span>Đã xác minh</span><strong>{selected.legacy_detail_missing ? "Thiếu chi tiết lịch sử" : formatMoney(selected.received)}</strong></p>
            <p className="flex justify-between gap-3 border-t border-white/10 pt-2"><span>Còn thiếu</span><strong className="text-[#89ef9e]">{selected.status === "confirmed" ? "Không thu thêm" : formatMoney(Math.max(0,selected.total_pay-selected.received))}</strong></p>
          </div>
          {selected.receipt_code ? <div className="mt-5 space-y-2 text-sm text-emerald-200">
              <p>{selected.receipt_is_historical ? 'Phiếu lịch sử' : 'Đã cấp phiếu'} · bàn {selected.table_number}, ghế {selected.seat_number}. {selected.receipt_is_historical ? 'Chỉ dùng đối chiếu, không xác nhận ghế đang hoạt động.' : 'Người chơi xem phiếu trên app.'}</p>
              <button type="button" onClick={() => setReceiptPreview({
                tournamentName: selectedTourName, playerName: selected.player_name,
                tableNumber: selected.table_number, seatNumber: selected.seat_number,
                receiptCode: selected.receipt_code!, qrValue: selected.receipt_code!,
                clubName, totalPay: selected.total_pay, confirmationCode: selected.reference_code,
              })} className="min-h-11 rounded-lg border border-emerald-300/40 px-4 text-sm">Xem / in lại phiếu</button>
            </div>
            : selected.bucket === "completed" ? <p className="mt-5 text-sm text-amber-200">Đăng ký cũ đã xác nhận nhưng không tìm thấy phiếu hiện hành. Chuyển Cần xử lý; không thu thêm tiền.</p>
            : selected.status === "confirmed" ? <p className="mt-5 text-sm text-amber-200">Đăng ký đã xác nhận nhưng không tìm thấy phiếu hiện hành. Không thu thêm tiền; báo Floor và đối soát kiểm tra.</p>
            : selected.bucket === "needs_review" ? <p className="mt-5 text-sm text-amber-200">Đã nhận đủ tiền nhưng không xếp ghế được: {selected.cashier_seating_error ?? "cần kiểm tra"}. Không thu lại tiền; báo Floor kiểm tra.</p>
            : selected.bucket === "waiting_seat" ? <p className="mt-5 text-sm text-amber-200">Đã đủ tiền, chưa có ghế. Không thu lại tiền; hệ thống sẽ thử xếp khi có chỗ.</p>
              : <div className="mt-5 space-y-3"><label className="block text-sm">Nhận tiền mặt (VND)
                <input ref={cashInput} inputMode="numeric" disabled={busy||!!currentCashJournal?.pending} value={cashAmount} onChange={(event) => { setCashAmount(event.target.value); }}
                  className="mt-1 min-h-12 w-full rounded-xl border border-white/15 bg-[#08120d] p-3 text-lg text-white" /></label>
                <button type="button" disabled={!shift || busy || !cashReady || !currentCashJournal || !!currentCashJournal.pending || !!currentCashJournal.error || selected.legacy_detail_missing || !OPS_TOUR_CASHIER_ENABLED || !worklist?.enabled} onClick={recordCash}
                  className="min-h-12 w-full rounded-xl bg-[#89ef9e] px-4 font-bold text-[#092014] disabled:opacity-40">{busy ? "Đang ghi nhận…" : "Ghi nhận tiền mặt"}</button>
                {!shift && <p className="text-xs text-amber-200">Mở ca chung trước khi nhận tiền mặt.</p>}
                {selected.legacy_detail_missing && <p className="text-xs text-amber-200">Đăng ký cũ chưa có giá server đã chốt. Không thu qua quầy mới; đối soát hoặc tạo lại đăng ký hợp lệ sau khi xử lý bản cũ.</p>}
              </div>}
          <p className="mt-5 text-xs text-[#a9baae]">Khách chưa có tài khoản cần đăng ký app trước; sau đó <a className="underline underline-offset-2" href="/cashier?tab=members">duyệt liên kết hội viên</a>. In thẻ là tùy chọn. Không dùng ảnh chuyển khoản thay xác minh SePay.</p>
          {(selected.bucket === "completed" || selected.bucket === "waiting_seat" || selected.bucket === "needs_review") &&
            <div className="mt-6 space-y-3 border-t border-white/10 pt-5">
              <h3 className="font-semibold">Hoàn tiền lượt buy-in</h3>
              {!currentRefundRead || currentRefundRead.loading ? <p role="status" className="text-sm text-[#a9baae]">Đang kiểm tra trạng thái hoàn tiền…</p>
                : currentRefundRead.error ? <p role="alert" className="text-sm text-rose-200">Không đọc được trạng thái hoàn tiền: {currentRefundRead.error}. Chưa thể thao tác; hãy tải lại.</p>
                : !refund ? <><p className="text-xs text-[#a9baae]">Chỉ hoàn đúng khoản đã ghi trong sổ giao dịch. Khách ở hàng chờ, chưa có ghế/chip hoạt động, không cần Floor xác nhận.</p>
                <label className="block text-sm">Lý do
                  <input value={refundReason} onChange={(event) => setRefundReason(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-white/15 bg-[#08120d] p-2" /></label>
                <button type="button" disabled={busy || refundReason.trim().length < 8}
                  onClick={() => void mutate("cashier_request_refund_v1", { p_registration_id: selected.id, p_reason: refundReason }, () => setNotice("Đã ghi nhận yêu cầu hoàn; thu ngân kiểm tra và ghi chi thực tế."))}
                  className="min-h-11 rounded-lg border border-amber-300/40 px-4 text-sm text-amber-200 disabled:opacity-40">Yêu cầu hoàn tiền</button>
                {selected.legacy_detail_missing && <p className="text-xs text-amber-200">Lượt cũ có thể thiếu sổ khoản thu. Máy chủ chỉ chấp nhận nếu đối chiếu đủ tiền; nếu bị từ chối, cần đối soát riêng, không tự tính lại.</p>}</>
                : refund.status === "paid" ? <p className="text-sm text-emerald-200">Đã ghi nhận hoàn {formatMoney(refund.amount)}.</p>
                  : <><p className="text-sm text-emerald-200">Cần ghi nhận chi hoàn {formatMoney(refund.amount)}.</p>
                      <div className="grid grid-cols-2 gap-2"><label className="text-xs">Tiền mặt
                        <input inputMode="numeric" value={refundCash} onChange={(event) => setRefundCash(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-white/15 bg-[#08120d] p-2 text-sm" /></label>
                        <label className="text-xs">Chuyển khoản
                          <input inputMode="numeric" value={refundBank} onChange={(event) => setRefundBank(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-white/15 bg-[#08120d] p-2 text-sm" /></label></div>
                      <label className="block text-xs">Mã giao dịch hoàn qua ngân hàng (nếu có)
                        <input value={refundBankRef} onChange={(event) => setRefundBankRef(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-white/15 bg-[#08120d] p-2 text-sm" /></label>
                      <label className="block text-xs">Bằng chứng chi hoàn
                        <input value={refundEvidence} onChange={(event) => setRefundEvidence(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-white/15 bg-[#08120d] p-2 text-sm" /></label>
                      <button type="button" disabled={busy} onClick={() => {
                        const cash = Number(refundCash || 0); const bank = Number(refundBank || 0);
                        if (!Number.isSafeInteger(cash) || !Number.isSafeInteger(bank) || cash < 0 || bank < 0 || cash + bank !== refund.amount) {
                          setError(`Tiền mặt + chuyển khoản phải đúng ${formatMoney(refund.amount)}.`); return;
                        }
                        if (!window.confirm(`Bạn xác nhận đã thực chi ${formatMoney(refund.amount)} cho lượt này?`)) return;
                        void mutate("cashier_complete_refund_v1", { p_refund_id: refund.id, p_cash_amount: cash,
                          p_bank_amount: bank, p_bank_reference: refundBankRef, p_evidence: refundEvidence }, () => {
                          setNotice("Đã ghi nhận chi hoàn; lịch sử ván không bị xóa."); setSelected(null);
                        });
                      }} className="min-h-11 w-full rounded-lg border border-rose-300/50 px-4 text-sm text-rose-100 disabled:opacity-40">Ghi nhận đã chi hoàn</button>
                      <p className="text-xs text-[#a9baae]">Chỉ bấm sau khi thực sự đã chi tiền. Chuyển khoản hoàn là bằng chứng thu ngân khai báo, không phải xác minh SePay.</p>
                    </>}
            </div>}
        </aside>}
      </div>}
    </>}
    <SeatReceiptDialog open={receiptPreview !== null} onOpenChange={(open) => { if (!open) setReceiptPreview(null); }} receipt={receiptPreview} />
  </div>;
}
