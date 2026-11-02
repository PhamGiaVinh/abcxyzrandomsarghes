import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FEATURES } from "@/lib/featureFlags";
import { observeTrackerContextRead } from "@/lib/tournament/observeTrackerContextRead";
import { startLiveReportRefresh } from '@/lib/liveReportRefresh';
import { waitForManualPlayerResponse } from '@/lib/floorManualPlayerIntent';
import { useAuth } from '@/hooks/useAuth';
import { sessionReadEpoch } from '@/lib/sessionReadEpoch';
import {
  deriveFtStatementStatus,
  parsePayrollStatementOnlinePreview,
  parseFtStatementRecords,
  parseFtStatementRollout,
  type FtPayrollStatementRecord,
  type FtPayrollStatementStatus,
  type PayrollStatementOnlinePreview,
} from "@/lib/payrollStatementUi";

const HSOP_CLUB_ID = "22222222-2222-2222-2222-222222222222";
type Availability = "legacy" | "loading" | "blocked" | "ready" | "unknown";
type RpcInvoker = (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;

async function rpc(name: string, args?: Record<string, unknown>, readOnly = false) {
  try {
    const response = (supabase.rpc as unknown as RpcInvoker)(name, args);
    return await (readOnly ? observeTrackerContextRead(response) : waitForManualPlayerResponse(response));
  } catch (error) {
    // Preserve the SDK's explicit error contract for rejected transports too.
    // In particular, finalize must still reconcile its immutable request ID;
    // a lost response is not evidence that the server did not commit.
    return { data: null, error: error ?? new Error("PAYROLL_STATEMENT_TRANSPORT_UNKNOWN") };
  }
}

export function useFtPayrollStatements(input: {
  clubId: string;
  periodId: string | null;
  periodStatus: string | null;
  canFinalize: boolean;
  dealerIds: string[];
}) {
  const { clubId, periodId, periodStatus, canFinalize, dealerIds } = input;
  const { user, session, loading: authLoading } = useAuth();
  const epoch = sessionReadEpoch(session);
  const readAllowed = !!user?.id && !!session?.access_token && !authLoading;
  const renderKey = `${user?.id ?? ''}:${epoch}:${authLoading}:${clubId}:${periodId ?? 'none'}`;
  const [resultScope, setResultScope] = useState('');
  const sourceEligible = clubId === HSOP_CLUB_ID || FEATURES.payrollStatementPdfAllClubs;
  const [availability, setAvailability] = useState<Availability>(sourceEligible ? "loading" : "legacy");
  const [records, setRecords] = useState<Record<string, FtPayrollStatementRecord>>({});
  const [overrides, setOverrides] = useState<Record<string, FtPayrollStatementStatus>>({});
  const [error, setError] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const currentKey = useRef("");
  const activeActions = useRef(new Map<string, number>());
  currentKey.current = renderKey;

  const fetchRecords = useCallback(async (expectedKey = renderKey, expectedVersion = requestVersion.current) => {
    if (!readAllowed || expectedKey !== currentKey.current) return { ok: false, records: {} as Record<string, FtPayrollStatementRecord> };
    if (!sourceEligible || !clubId) return { ok: true, records: {} as Record<string, FtPayrollStatementRecord> };
    if (!periodId) {
      if (expectedKey === currentKey.current && expectedVersion === requestVersion.current) {
        setRecords({});
        setOverrides({});
        setError(null);
      }
      return { ok: true, records: {} as Record<string, FtPayrollStatementRecord> };
    }
    const result = await rpc("list_full_time_payroll_statements_for_period", {
      p_club_id: clubId,
      p_payroll_period_id: periodId,
    }, true);
    if (result.error) return { ok: false, records: {} as Record<string, FtPayrollStatementRecord> };
    const parsed = parseFtStatementRecords(result.data);
    if (!parsed) return { ok: false, records: {} as Record<string, FtPayrollStatementRecord> };
    // The list RPC also returns immutable void/replacement history, newest
    // first. Never let its older row win a last-write map or expose an old PDF.
    const active = parsed.filter(row => row.state !== "voided" && row.state !== "replaced");
    const next = Object.fromEntries(active.map((row) => [row.dealer_id, row]));
    if (active.length !== Object.keys(next).length || parsed.some(row => !next[row.dealer_id])) {
      // Historical-only or ambiguous current rows need server-side review,
      // not a fabricated DRAFT or an arbitrary choice of statement identity.
      return { ok: false, records: {} as Record<string, FtPayrollStatementRecord> };
    }
    if (expectedKey === currentKey.current && expectedVersion === requestVersion.current) {
      setRecords(next);
      setOverrides({});
      setError(null);
    }
    return { ok: true, records: next };
  }, [clubId, periodId, readAllowed, renderKey, sourceEligible]);

  const refresh = useCallback(async (background = false) => {
    if (renderKey !== currentKey.current) return;
    const version = ++requestVersion.current;
    const key = currentKey.current;
    setResultScope(key);
    if (!background) setError(null);
    if (!readAllowed) {
      setAvailability('unknown'); setRecords({}); setOverrides({});
      setError('Chưa xác minh phiên đăng nhập để đọc phiếu lương.');
      return;
    }
    if (!sourceEligible || !clubId) {
      setAvailability("legacy");
      setRecords({});
      setOverrides({});
      return;
    }
    setAvailability(current => background && current === 'unknown' ? 'unknown' : 'loading');
    setRecords({});
    setOverrides({});
    const rolloutResult = await rpc("get_dealer_payroll_statement_rollout", {
      p_expected_club_id: clubId,
    }, true);
    if (version !== requestVersion.current || key !== currentKey.current) return;
    if (rolloutResult.error) {
      setAvailability("unknown");
      setError("Không xác minh được trạng thái Phiếu lương. Hành động đã được khóa an toàn.");
      return;
    }
    const rollout = parseFtStatementRollout(rolloutResult.data);
    if (!rollout) {
      setAvailability("unknown");
      setError("Phản hồi rollout không hợp lệ. Hành động đã được khóa an toàn.");
      return;
    }
    if (!rollout.allowed) {
      setAvailability("blocked");
      return;
    }
    const loaded = await fetchRecords(key, version);
    if (version !== requestVersion.current || key !== currentKey.current) return;
    if (!loaded.ok) {
      setAvailability("unknown");
      setError("Không tải được trạng thái phiếu lương. Không thể xác định phiếu đã chốt hay chưa.");
      return;
    }
    setAvailability("ready");
  }, [clubId, fetchRecords, readAllowed, renderKey, sourceEligible]);

  useEffect(() => {
    if (!sourceEligible || !clubId || !readAllowed) {
      void refresh();
      return () => { requestVersion.current += 1; };
    }
    let initial = true;
    const stop = startLiveReportRefresh(async () => {
      if (initial || !(activeActions.current.get(currentKey.current) ?? 0)) {
        const background = !initial;
        initial = false;
        await refresh(background);
      }
    });
    return () => { requestVersion.current += 1; stop(); };
  }, [clubId, readAllowed, refresh, sourceEligible]);

  const statusFor = useCallback((dealerId: string): FtPayrollStatementStatus => {
    if (!readAllowed || resultScope !== renderKey) return 'UNKNOWN';
    if (availability === "unknown") return "UNKNOWN";
    return deriveFtStatementStatus(records[dealerId], overrides[dealerId]);
  }, [availability, readAllowed, records, overrides, renderKey, resultScope]);

  const setOverride = useCallback((dealerId: string, status: FtPayrollStatementStatus) => {
    setOverrides((current) => ({ ...current, [dealerId]: status }));
  }, []);

  const reconcileDealer = useCallback(async (dealerId: string, expectedKey: string, expectedVersion = requestVersion.current) => {
    const loaded = await fetchRecords(expectedKey, expectedVersion);
    if (expectedKey !== currentKey.current || expectedVersion !== requestVersion.current) return null;
    if (!loaded.ok) {
      setOverride(dealerId, "UNKNOWN");
      return null;
    }
    return loaded.records[dealerId] ?? null;
  }, [fetchRecords, setOverride]);

  const finalize = useCallback(async (dealerId: string) => {
    if (!readAllowed || resultScope !== renderKey || renderKey !== currentKey.current
      || availability !== "ready" || !canFinalize || !periodId || periodStatus !== "locked") return false;
    const expectedKey = currentKey.current;
    const expectedVersion = requestVersion.current;
    activeActions.current.set(expectedKey, (activeActions.current.get(expectedKey) ?? 0) + 1);
    try {
    const storageKey = `payroll-statement-request:${clubId}:${periodId}:${dealerId}`;
    const requestId = sessionStorage.getItem(storageKey) ?? crypto.randomUUID();
    sessionStorage.setItem(storageKey, requestId);
    setOverride(dealerId, "FINALIZING");
    const result = await rpc("finalize_full_time_payroll_statement", {
      p_request_id: requestId,
      p_club_id: clubId,
      p_dealer_id: dealerId,
      p_payroll_period_id: periodId,
      p_reason: "Chốt phiếu lương FT từ giao diện Dealer Swing",
      p_replaces_statement_id: null,
    });
    if (expectedKey !== currentKey.current || expectedVersion !== requestVersion.current) return false;
    const reconciled = await reconcileDealer(dealerId, expectedKey, expectedVersion);
    if (expectedKey !== currentKey.current || expectedVersion !== requestVersion.current) return false;
    if (reconciled) {
      sessionStorage.removeItem(storageKey);
      return true;
    }
    if (!result.error) setOverride(dealerId, "UNKNOWN");
    return false;
    } finally {
      activeActions.current.set(expectedKey, (activeActions.current.get(expectedKey) ?? 1) - 1);
    }
  }, [availability, canFinalize, clubId, periodId, periodStatus, readAllowed, reconcileDealer, renderKey, resultScope, setOverride]);

  const invokePdf = useCallback(async (body: Record<string, string>) => {
    const { data, error: invokeError } = await waitForManualPlayerResponse(supabase.functions.invoke("render-payroll-statement", { body }));
    if (invokeError) throw invokeError;
    return data;
  }, []);

  const previewDraft = useCallback(async (dealerId: string) => {
    if (!readAllowed || resultScope !== renderKey || renderKey !== currentKey.current
      || availability !== "ready" || !periodId) throw new Error("PAYROLL_STATEMENT_UNAVAILABLE");
    const data = await invokePdf({ mode: "preview_ft_view", club_id: clubId, dealer_id: dealerId, payroll_period_id: periodId });
    if (renderKey !== currentKey.current) throw new Error('PAYROLL_STATEMENT_UNAVAILABLE');
    return payrollStatementOnlinePreview(data, true);
  }, [availability, clubId, invokePdf, periodId, readAllowed, renderKey, resultScope]);

  const previewFinal = useCallback(async (dealerId: string) => {
    const statement = records[dealerId];
    if (!readAllowed || resultScope !== renderKey || renderKey !== currentKey.current
      || availability !== "ready" || !statement) throw new Error("PAYROLL_STATEMENT_UNAVAILABLE");
    const data = await invokePdf({ mode: "preview_view", statement_id: statement.statement_id });
    if (renderKey !== currentKey.current) throw new Error('PAYROLL_STATEMENT_UNAVAILABLE');
    const preview = payrollStatementOnlinePreview(data, false);
    if (preview.statement_id !== statement.statement_id || preview.statement_hash !== statement.statement_hash) {
      throw new Error('PAYROLL_STATEMENT_PREVIEW_UNAVAILABLE');
    }
    return preview;
  }, [availability, invokePdf, readAllowed, records, renderKey, resultScope]);

  const generatePdf = useCallback(async (dealerId: string) => {
    const statement = records[dealerId];
    if (!readAllowed || resultScope !== renderKey || renderKey !== currentKey.current
      || availability !== "ready" || !statement) throw new Error("PAYROLL_STATEMENT_UNAVAILABLE");
    const expectedKey = currentKey.current;
    setOverride(dealerId, "PDF_GENERATING");
    activeActions.current.set(expectedKey, (activeActions.current.get(expectedKey) ?? 0) + 1);
    try {
      const data = await invokePdf({ mode: "final", statement_id: statement.statement_id });
      if (expectedKey !== currentKey.current) return false;
      if (!data || typeof data !== "object") {
        throw new Error("PAYROLL_PDF_SIGNED_URL_FAILED");
      }
      const payload = data as Record<string, unknown>;
      if (payload.statement_id!==statement.statement_id || typeof payload.download_url !== "string" || typeof payload.download_filename !== "string"
        || !payload.download_filename.toLowerCase().endsWith(`-${statement.statement_id.toLowerCase()}.pdf`)) {
        throw new Error("PAYROLL_PDF_SIGNED_URL_FAILED");
      }
      await downloadSignedPdf(payload.download_url, payload.download_filename,()=>expectedKey===currentKey.current);
      await reconcileDealer(dealerId, expectedKey);
      if(expectedKey!==currentKey.current)return false;
      return true;
    } catch (cause) {
      if (expectedKey === currentKey.current) await reconcileDealer(dealerId, expectedKey);
      throw cause;
    } finally {
      activeActions.current.set(expectedKey, (activeActions.current.get(expectedKey) ?? 1) - 1);
    }
  }, [availability, invokePdf, readAllowed, reconcileDealer, records, renderKey, resultScope, setOverride]);

  const counts = useMemo(() => {
    const statuses = dealerIds.map(statusFor);
    return {
      draft: availability === "ready" ? statuses.filter((s) => s === "DRAFT").length : 0,
      finalized: statuses.filter((s) => s === "FINALIZED" || s === "PDF_FAILED").length,
      generating: statuses.filter((s) => s === "PDF_GENERATING").length,
      ready: statuses.filter((s) => s === "PDF_READY").length,
    };
  }, [availability, dealerIds, statusFor]);

  return {
    availability: readAllowed && resultScope === renderKey ? availability : authLoading ? 'loading' as const : 'unknown' as const,
    error: readAllowed && resultScope === renderKey ? error : null,
    records: readAllowed && resultScope === renderKey ? records : {},
    counts,
    statusFor,
    refresh,
    finalize,
    previewDraft,
    previewFinal,
    generatePdf,
    canFinalize: readAllowed && resultScope === renderKey && availability === "ready" && canFinalize && periodStatus === "locked",
  };
}

async function downloadSignedPdf(url: string, filename: string, isCurrent:()=>boolean) {
  if (!/^phieu-luong-\d{6}-[0-9a-f-]{36}\.pdf$/i.test(filename)) {
    throw new Error("PAYROLL_PDF_INVALID_FILENAME");
  }
  const controller=new AbortController();
  let blob:Blob;
  try {
    blob=await waitForManualPlayerResponse((async()=>{
      const response=await fetch(url,{credentials:'omit',signal:controller.signal});
      if(!isCurrent())throw Error('PAYROLL_STATEMENT_UNAVAILABLE');
      if(!response.ok)throw Error('PAYROLL_PDF_DOWNLOAD_FAILED');
      return response.blob();
    })());
  } finally {
    controller.abort();
  }
  if(!isCurrent())throw Error('PAYROLL_STATEMENT_UNAVAILABLE');
  if (blob.type && blob.type !== "application/pdf") throw new Error("PAYROLL_PDF_DOWNLOAD_FAILED");
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

function payrollStatementOnlinePreview(data: unknown, draft: boolean): PayrollStatementOnlinePreview {
  const preview = parsePayrollStatementOnlinePreview(data);
  if (!preview || preview.draft !== draft) throw new Error("PAYROLL_STATEMENT_PREVIEW_UNAVAILABLE");
  return preview;
}
