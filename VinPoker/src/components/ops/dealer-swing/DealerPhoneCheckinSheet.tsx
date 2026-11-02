import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import {
  AlertTriangle,
  Camera,
  Check,
  ClipboardPaste,
  ListChecks,
  Loader2,
  QrCode,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import {
  CHECKIN_CODE_LABELS,
  CHECKIN_OUTCOME_LABELS,
  parseDealerUserQr,
  type DealerPhoneCheckinEntry,
  type DealerPhoneCheckinResponse,
} from "@/lib/dealerSwingPhone";
import type { PublishedScheduleAssignment } from "@/hooks/usePublishedDealerSchedule";
import { cn } from "@/lib/utils";
import {readPhoneCheckinIntent,persistPhoneCheckinIntent,settlePhoneCheckinIntent,phoneCheckinReceipt,type DealerPhoneCheckinIntent} from '@/lib/dealerPhoneCheckinIntent';
import {waitForManualPlayerResponse} from '@/lib/floorManualPlayerIntent';

type DealerPhoneCheckinInputMethod = "camera" | "paste" | "manual_list";
type PickerMode = "camera" | "paste" | "manual";

interface DealerCandidate {
  id: string;
  fullName: string;
  tier: string;
}

interface DraftEntry extends DealerCandidate {
  entryId: string;
  userId: string | null;
  inputMethod: DealerPhoneCheckinInputMethod;
  shiftAssignmentId: string | null;
  reason: string;
}

interface Props {
  actorId: string | null;
  open: boolean;
  activeClubId: string;
  scheduleAssignments: PublishedScheduleAssignment[];
  onOpenChange: (open: boolean) => void;
  onCompleted: () => void;
  onRolloutDisabled: () => void;
}

interface RpcResult {
  data: unknown;
  error: { message: string } | null;
}

const rpcCheckin = supabase.rpc.bind(supabase) as unknown as (
  name: string,
  args: Record<string, unknown>,
) => PromiseLike<RpcResult>;

const SUCCESS_CODES = new Set([
  "checked_in_waiting",
  "checked_in_available",
  "already_checked_in",
]);

function assignmentsFor(
  assignments: PublishedScheduleAssignment[],
  dealerId: string,
): PublishedScheduleAssignment[] {
  return assignments.filter((assignment) => (
    assignment.dealerId === dealerId && assignment.state !== "closed"
  ));
}

export function DealerPhoneCheckinSheet(props:Props){
 return <ScopedDealerPhoneCheckinSheet key={JSON.stringify([props.actorId,props.activeClubId])} {...props}/>;
}
function ScopedDealerPhoneCheckinSheet({
  actorId,
  open,
  activeClubId,
  scheduleAssignments,
  onOpenChange,
  onCompleted,
  onRolloutDisabled,
}: Props) {
  const [pickerMode, setPickerMode] = useState<PickerMode>("camera");
  const [pasteValue, setPasteValue] = useState("");
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<DraftEntry[]>([]);
  const [manualCandidates, setManualCandidates] = useState<DealerCandidate[]>([]);
  const [manualLoading, setManualLoading] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [response, setResponse] = useState<DealerPhoneCheckinResponse | null>(null);
  const [saved]=useState(()=>{try{return {intent:actorId?readPhoneCheckinIntent(sessionStorage,{actorId,clubId:activeClubId}):null,error:!actorId};}
    catch{return {intent:null,error:true};}});
  const [pending,setPending]=useState<DealerPhoneCheckinIntent|null>(saved.intent);
  const [journalError,setJournalError]=useState(saved.error);
  const [pendingError,setPendingError]=useState<string|null>(null);
  const sending=useRef(false),mounted=useRef(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const lastFrameAtRef = useRef(0);
  const acceptingFrameRef = useRef(true);
  const resolveGeneration = useRef(0);
  const resolveUserRef = useRef<(userId: string, method: "camera" | "paste") => Promise<void>>(
    async () => undefined,
  );

  const scheduledByDealer = useMemo(
    () => new Set(scheduleAssignments.filter((assignment) => assignment.state !== "closed").map((assignment) => assignment.dealerId)),
    [scheduleAssignments],
  );

  const stopScanner = useCallback(async () => {
    const scanner = scannerRef.current;
    scannerRef.current = null;
    if (!scanner) return;
    try {
      await scanner.stop();
    } catch {
      // The scanner may already be stopped by the browser or sheet cleanup.
    }
    try {
      scanner.clear();
    } catch {
      // The reader element may already be unmounted.
    }
  }, []);

  const reset = useCallback(() => {
    resolveGeneration.current += 1;
    setResolving(false);
    setPickerMode("camera");
    setPasteValue("");
    setScanMessage(null);
    setCameraError(null);
    setDrafts([]);
    setManualCandidates([]);
    setManualError(null);
    setResponse(null);
    lastFrameAtRef.current = 0;
    acceptingFrameRef.current = true;
  }, []);

  useEffect(() => {
    resolveGeneration.current += 1;
    setResolving(false);
    return () => { resolveGeneration.current += 1; };
  }, [open, activeClubId]);

  const changeOpen = (nextOpen: boolean) => {
    if (!nextOpen) {
      void stopScanner();
      reset();
    }
    onOpenChange(nextOpen);
  };

  const addDraft = useCallback((candidate: DealerCandidate, method: DealerPhoneCheckinInputMethod, userId: string | null) => {
    const assignments = assignmentsFor(scheduleAssignments, candidate.id);
    setDrafts((current) => {
      if (current.some((entry) => entry.id === candidate.id)) {
        toast.info(`${candidate.fullName} đã có trong danh sách.`);
        return current;
      }
      return [...current, {
        ...candidate,
        entryId: crypto.randomUUID(),
        userId,
        inputMethod: method,
        shiftAssignmentId: assignments.length === 1 ? assignments[0].id : null,
        reason: "",
      }];
    });
    setResponse(null);
  }, [scheduleAssignments]);

  const resolveUser = useCallback(async (userId: string, method: "camera" | "paste") => {
    if (!open || pending || journalError) return;
    const generation = ++resolveGeneration.current;
    const current = () => generation === resolveGeneration.current;
    setResolving(true);
    setScanMessage(null);
    try {
      const { data, error } = await supabase
        .from("dealers")
        .select("id, full_name, tier, club_id, status, deleted_at")
        .eq("user_id", userId)
        .eq("club_id", activeClubId)
        .maybeSingle();
      if (!current()) return;
      if (error) throw error;
      if (!data || data.deleted_at || data.status !== "active") {
        setScanMessage("QR không thuộc dealer đang hoạt động tại CLB này.");
        return;
      }
      addDraft({ id: data.id, fullName: data.full_name, tier: data.tier }, method, userId);
      setScanMessage(`Đã thêm ${data.full_name}.`);
      setPasteValue("");
    } catch (caught) {
      if (current()) setScanMessage((caught as Error)?.message || "Không xác minh được dealer từ QR.");
    } finally {
      if (current()) setResolving(false);
    }
  }, [open, activeClubId, addDraft, pending, journalError]);
  resolveUserRef.current = resolveUser;

  useEffect(() => {
    if (!open || pending || journalError || pickerMode !== "camera") return;

    let cancelled = false;
    acceptingFrameRef.current = true;
    lastFrameAtRef.current = 0;
    setCameraError(null);
    setScanMessage(null);
    const readerId = `dealer-phone-qr-${activeClubId}`;

    void (async () => {
      try {
        const scanner = new Html5Qrcode(readerId);
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: 240 },
          (decodedText) => {
            const now = Date.now();
            if (!acceptingFrameRef.current || now - lastFrameAtRef.current < 1_500) return;
            lastFrameAtRef.current = now;
            const userId = parseDealerUserQr(decodedText);
            if (!userId) {
              setScanMessage("Mã QR không đúng định dạng VinPoker.");
              return;
            }
            acceptingFrameRef.current = false;
            void stopScanner().then(() => resolveUserRef.current(userId, "camera"));
          },
          () => undefined,
        );
        if (cancelled) await stopScanner();
      } catch (caught) {
        if (!cancelled) {
          setCameraError((caught as Error)?.message || "Không mở được camera.");
        }
      }
    })();

    return () => {
      cancelled = true;
      acceptingFrameRef.current = false;
      void stopScanner();
    };
  }, [activeClubId, open, pickerMode, stopScanner, pending, journalError]);

  useEffect(() => {
    if (!open || pending || journalError) return;
    const controller = new AbortController();
    setManualLoading(true);
    setManualError(null);

    void (async () => {
      try {
        const dealersResult = await supabase
          .from("dealers")
          .select("id, full_name, tier")
          .eq("club_id", activeClubId)
          .eq("status", "active")
          .is("deleted_at", null)
          .order("full_name")
          .abortSignal(controller.signal);
        if (dealersResult.error) throw dealersResult.error;

        const dealers = dealersResult.data ?? [];
        const dealerIds = dealers.map((dealer) => dealer.id);
        let activeDealerIds = new Set<string>();
        if (dealerIds.length > 0) {
          const attendanceResult = await supabase
            .from("dealer_attendance")
            .select("dealer_id")
            .eq("status", "checked_in")
            .in("dealer_id", dealerIds)
            .abortSignal(controller.signal);
          if (attendanceResult.error) throw attendanceResult.error;
          activeDealerIds = new Set((attendanceResult.data ?? []).map((row) => row.dealer_id));
        }

        if (!controller.signal.aborted) {
          setManualCandidates(dealers
            .filter((dealer) => !activeDealerIds.has(dealer.id))
            .map((dealer) => ({
              id: dealer.id,
              fullName: dealer.full_name,
              tier: dealer.tier,
            })));
        }
      } catch (caught) {
        if (!controller.signal.aborted) {
          setManualCandidates([]);
          setManualError((caught as Error)?.message || "Không tải được danh sách dealer.");
        }
      } finally {
        if (!controller.signal.aborted) setManualLoading(false);
      }
    })();

    return () => controller.abort();
  }, [activeClubId, open, pending, journalError]);

  const submitPaste = () => {
    const userId = parseDealerUserQr(pasteValue);
    if (!userId) {
      setScanMessage("Chỉ chấp nhận đúng vinpoker://user/{uuid}, không thêm khoảng trắng hoặc tham số.");
      return;
    }
    void resolveUser(userId, "paste");
  };

  const removeDraft = (dealerId: string) => {
    setDrafts((current) => current.filter((entry) => entry.id !== dealerId));
    setResponse(null);
  };

  const updateReason = (dealerId: string, reason: string) => {
    setDrafts((current) => current.map((entry) => (
      entry.id === dealerId ? { ...entry, reason } : entry
    )));
    setResponse(null);
  };

  const shiftUnverified = (entry: DraftEntry) => {
    const choices = assignmentsFor(scheduleAssignments, entry.id);
    if (choices.length > 1) return true;
    return entry.shiftAssignmentId
      ? !choices.some((choice) => choice.id === entry.shiftAssignmentId)
      : choices.length > 0;
  };
  const unresolvedShift = drafts.some(shiftUnverified);
  const updateShift = (dealerId: string, shiftAssignmentId: string | null) => {
    setDrafts((current) => current.map((entry) => entry.id === dealerId ? {...entry, shiftAssignmentId} : entry));
    setResponse(null);
  };

  const submit = async () => {
    if ((!pending&&drafts.length === 0) || sending.current || response || journalError || !actorId) return;
    if (drafts.length > 50) {
      toast.error("Mỗi lần chỉ check-in tối đa 50 dealer.");
      return;
    }
    if (!pending&&drafts.some((entry) => !entry.shiftAssignmentId && !entry.reason.trim())) {
      toast.error("Mỗi dealer ngoài lịch cần một lý do riêng.");
      return;
    }

    const entries: DealerPhoneCheckinEntry[] = drafts.map((entry) => ({
      entry_id: entry.entryId,
      mode: entry.shiftAssignmentId ? "scheduled" : "unscheduled",
      input_method: entry.inputMethod,
      user_id: entry.inputMethod === "manual_list" ? null : entry.userId,
      dealer_id: entry.inputMethod === "manual_list" ? entry.id : null,
      shift_assignment_id: entry.shiftAssignmentId,
      reason: entry.shiftAssignmentId ? null : entry.reason,
    }));

    const intent=pending??{actorId,clubId:activeClubId,requestId:crypto.randomUUID(),entries,
      labels:drafts.map(d=>({entryId:d.entryId,dealerId:d.id,name:d.fullName}))};
    try{persistPhoneCheckinIntent(sessionStorage,intent);}catch{
      setJournalError(true);setPendingError('Không xác minh được yêu cầu đã lưu. Chưa gửi thao tác mới.');return;
    }
    if (!pending && unresolvedShift) {
      toast.error("Chọn đúng ca hiện hành cho từng dealer trước khi check-in.");
      return;
    }
    setPending(intent);sending.current=true;setSubmitting(true);setPendingError(null);
    try {
      const result = await waitForManualPlayerResponse(rpcCheckin("operator_check_in_dealers", {
        p_request_id: intent.requestId,
        p_expected_club_id: intent.clubId,
        p_entries: intent.entries,
      }));
      if(!mounted.current)return;
      if (result.error) throw result.error;
      if(result.data&&typeof result.data==='object'&&'outcome' in result.data&&result.data.outcome==='rollout_disabled'){
        setPendingError('Tính năng đã tắt. Giữ yêu cầu cũ, chưa kết luận kết quả check-in.');onRolloutDisabled();return;
      }

      const nextResponse = phoneCheckinReceipt(result.data,intent);
      if(!nextResponse){setPendingError('Chưa xác minh được kết quả theo mã yêu cầu và từng dealer. Giữ nguyên yêu cầu để đối chiếu.');return;}
      settlePhoneCheckinIntent(sessionStorage,intent);
      setPending(null);
      setResponse(nextResponse);
      if (nextResponse.outcome === "completed" || nextResponse.outcome === "partial") {
        onCompleted();
      }
    } catch (caught) {
      if(mounted.current)setPendingError((caught as Error)?.message || 'Chưa biết kết quả check-in. Giữ nguyên mã yêu cầu, không tạo yêu cầu mới.');
    } finally {
      sending.current=false;if(mounted.current)setSubmitting(false);
    }
  };

  const restartCamera = () => {
    setPickerMode("paste");
    window.setTimeout(() => setPickerMode("camera"), 0);
  };

  const resultName = (entryId: string) => (
    drafts.find((entry) => entry.entryId === entryId)?.fullName ?? saved.intent?.labels.find(l=>l.entryId===entryId)?.name ?? "Dealer"
  );

  return (
    <Sheet open={open} onOpenChange={changeOpen}>
      <SheetContent side="bottom" className="ops-sheet max-h-[92dvh] overflow-y-auto rounded-t-[22px] border-none bg-[#0d0913] pb-8">
        <div className="ios-grabber mb-3 mt-1" />
        <SheetHeader className="pr-11 text-left">
          <SheetTitle className="text-[#f2ece6]">Check-in dealer</SheetTitle>
          <SheetDescription className="text-[#9b8e97]">
            Lịch đã phát hành được ưu tiên; dealer ngoài lịch phải ghi lý do.
          </SheetDescription>
        </SheetHeader>

        {(journalError||pendingError)&&<p role="alert">{pendingError??'Không xác minh được tài khoản hoặc yêu cầu đã lưu. Chưa gửi check-in mới.'}</p>}
        {pending&&!response&&<div className="mt-4 space-y-3">
          <p role="status">Còn yêu cầu check-in {pending.entries.length} dealer chưa được đối chiếu. Không sửa danh sách hoặc tạo mã mới.</p>
          <ul>{pending.labels.map(l=><li key={l.entryId}>{l.name}</li>)}</ul>
          <Button disabled={submitting||journalError} onClick={()=>void submit()}>Gửi lại nguyên yêu cầu check-in</Button>
        </div>}
        {!response && !pending && !journalError && (
          <>
            <div className="mt-4 grid grid-cols-3 gap-1 rounded-lg bg-white/5 p-1" role="tablist" aria-label="Cách chọn dealer">
              {([
                ["camera", Camera, "Camera"],
                ["paste", ClipboardPaste, "Dán mã"],
                ["manual", ListChecks, "Danh sách"],
              ] as const).map(([value, Icon, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={pickerMode === value}
                  onClick={() => setPickerMode(value)}
                  className={cn(
                    "flex min-h-10 items-center justify-center gap-1.5 rounded-md px-2 text-[12px] font-medium",
                    pickerMode === value ? "bg-[#2a202d] text-[#f2ece6]" : "text-[#9b8e97]",
                  )}
                >
                  <Icon className="h-4 w-4" /> {label}
                </button>
              ))}
            </div>

            {pickerMode === "camera" && (
              <div className="mt-3 space-y-2">
                <div id={`dealer-phone-qr-${activeClubId}`} className="min-h-[240px] w-full overflow-hidden rounded-lg bg-black/40" />
                {cameraError && (
                  <div className="flex items-start gap-2 text-[12px] text-amber-300">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>Không mở được camera. Chuyển sang Dán mã hoặc Danh sách.</span>
                  </div>
                )}
                {!cameraError && !acceptingFrameRef.current && (
                  <Button type="button" variant="secondary" className="w-full" onClick={restartCamera} disabled={resolving}>
                    <RotateCcw className="mr-2 h-4 w-4" /> Quét mã tiếp theo
                  </Button>
                )}
              </div>
            )}

            {pickerMode === "paste" && (
              <div className="mt-3 space-y-2">
                <label htmlFor="dealer-phone-paste" className="text-[12px] text-[#9b8e97]">Mã QR VinPoker</label>
                <div className="flex gap-2">
                  <Input
                    id="dealer-phone-paste"
                    value={pasteValue}
                    onChange={(event) => setPasteValue(event.target.value)}
                    onKeyDown={(event) => event.key === "Enter" && submitPaste()}
                    placeholder="vinpoker://user/uuid"
                    autoCapitalize="none"
                    autoCorrect="off"
                    className="border-white/10 bg-white/5 text-[#f2ece6]"
                  />
                  <Button type="button" onClick={submitPaste} disabled={!pasteValue || resolving} aria-label="Thêm dealer từ mã đã dán">
                    {resolving ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            )}

            {pickerMode === "manual" && (
              <div className="ios-group mt-3 max-h-[34vh] overflow-y-auto">
                {manualLoading ? (
                  <div className="flex items-center justify-center gap-2 px-4 py-6 text-[13px] text-[#9b8e97]">
                    <Loader2 className="h-4 w-4 animate-spin" /> Đang tải dealer…
                  </div>
                ) : manualError ? (
                  <div className="px-4 py-6 text-center text-[13px] text-rose-300">{manualError}</div>
                ) : manualCandidates.length === 0 ? (
                  <div className="px-4 py-6 text-center text-[13px] text-[#9b8e97]">Không còn dealer chưa check-in để chọn.</div>
                ) : manualCandidates.map((dealer) => {
                  const selected = drafts.some((entry) => entry.id === dealer.id);
                  const scheduled = scheduledByDealer.has(dealer.id);
                  return (
                    <button
                      type="button"
                      key={dealer.id}
                      onClick={() => selected ? removeDraft(dealer.id) : addDraft(dealer, "manual_list", null)}
                      className="ios-press-sm ios-row-inset flex w-full items-center gap-3 px-4 py-3 text-left"
                    >
                      <span className={cn(
                        "grid h-5 w-5 shrink-0 place-items-center rounded border",
                        selected ? "border-[#c9a86a] bg-[#c9a86a] text-[#241a08]" : "border-white/20 text-transparent",
                      )}><Check className="h-3.5 w-3.5" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] text-[#f2ece6]">{dealer.fullName}</span>
                        <span className="block text-[11px] text-[#9b8e97]">{scheduled ? "Có ca đã phát hành" : "Ngoài lịch"}</span>
                      </span>
                      <span className="text-[11px] text-[#9b8e97]">{dealer.tier}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {scanMessage && <p className="mt-2 text-[12px] text-[#c9a86a]">{scanMessage}</p>}

            {drafts.length > 0 && (
              <div className="mt-4 space-y-2">
                <div className="flex items-center justify-between text-[12px] text-[#9b8e97]">
                  <span>Chờ check-in</span><span>{drafts.length}/50</span>
                </div>
                <div className="ios-group">
                  {drafts.map((entry) => {
                    const choices = assignmentsFor(scheduleAssignments, entry.id);
                    const unverified = shiftUnverified(entry);
                    return (
                    <div key={entry.entryId} className="ios-row-inset px-4 py-3">
                      <div className="flex items-start gap-3">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] text-[#f2ece6]">{entry.fullName}</span>
                          <span className={cn("block text-[11px]", entry.shiftAssignmentId ? "text-emerald-300" : "text-amber-300")}>
                            {unverified ? "Chưa xác minh ca · cần chọn lại" : entry.shiftAssignmentId ? "Theo lịch đã phát hành" : "Ngoài lịch · cần lý do"}
                          </span>
                        </span>
                        <button type="button" onClick={() => removeDraft(entry.id)} className="min-h-8 px-1 text-[12px] text-rose-300">
                          Bỏ
                        </button>
                      </div>
                      {choices.length > 1 && <p role="alert" className="mt-2 text-sm text-destructive">Lịch không nhất quán: dealer có nhiều ca. Tải lại lịch trước khi check-in.</p>}
                      {unverified && choices.length === 1 && <div className="mt-2 space-y-2 text-sm">
                        <p>Ca hiện hành: {new Date(choices[0].scheduledStartAt).toLocaleString('vi-VN',{timeZone:'Asia/Bangkok'})} – {new Date(choices[0].scheduledEndAt).toLocaleString('vi-VN',{timeZone:'Asia/Bangkok'})}</p>
                        <Button type="button" variant="secondary" onClick={() => updateShift(entry.id,choices[0].id)}>Xác nhận ca hiện hành cho {entry.fullName}</Button>
                      </div>}
                      {unverified && choices.length === 0 && <Button type="button" variant="secondary" onClick={() => updateShift(entry.id,null)}>
                        Ca cũ không còn · chuyển sang ngoài lịch
                      </Button>}
                      {!entry.shiftAssignmentId && choices.length === 0 && (
                        <Input
                          value={entry.reason}
                          onChange={(event) => updateReason(entry.id, event.target.value)}
                          placeholder={`Lý do riêng cho ${entry.fullName}`}
                          className="mt-2 border-white/10 bg-white/5 text-[#f2ece6]"
                        />
                      )}
                    </div>
                  );})}
                </div>
              </div>
            )}

            <Button
              type="button"
              className="mt-4 min-h-11 w-full"
              disabled={drafts.length === 0 || submitting || resolving || unresolvedShift}
              onClick={() => void submit()}
            >
              {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
              Check-in {drafts.length} dealer
            </Button>
          </>
        )}

        {response && (
          <div className="mt-4 space-y-3">
            <div className={cn(
              "rounded-lg border px-4 py-3 text-[13px]",
              response.outcome === "completed" ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200" : "border-amber-400/20 bg-amber-400/10 text-amber-200",
            )}>
              {CHECKIN_OUTCOME_LABELS[response.outcome] ?? "Yêu cầu đã được xử lý."}
            </div>
            {(response.results ?? []).length > 0 && (
              <div className="ios-group">
                {(response.results ?? []).map((result) => (
                  <div key={result.entry_id} className="ios-row-inset flex items-start gap-3 px-4 py-3">
                    {SUCCESS_CODES.has(result.code)
                      ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                      : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />}
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] text-[#f2ece6]">{resultName(result.entry_id)}</span>
                      <span className="block text-[12px] text-[#9b8e97]">{CHECKIN_CODE_LABELS[result.code] ?? result.code}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
            <Button type="button" variant="secondary" className="w-full" onClick={() => changeOpen(false)}>Đóng</Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
