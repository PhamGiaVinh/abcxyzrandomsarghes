import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { LiquidButton, LiquidGlassCard } from "@/components/kokonutui/liquid-glass-card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { formatVND, formatStack } from "@/lib/format";
import { compressImage } from "@/lib/compressImage";
import { CheckCircle2, Copy, Loader2, Upload, Sparkles } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { buildVietQrPayload } from "@/lib/vietqr";
import { normalizeBankNameToBin } from "@/lib/vietnamBanks";
import { FEATURES } from "@/lib/featureFlags";
import { SeatReceiptDialog } from "@/components/tournament/seat/SeatReceiptDialog";
import { fetchBuyinReceipt, toSeatReceiptData, type BuyinReceiptSnapshot } from "@/components/tournament/seat/buyinReceipt";
import { z } from "zod";
import { waitForManualPlayerResponse } from "@/lib/floorManualPlayerIntent";
import { observeTrackerContextRead } from "@/lib/tournament/observeTrackerContextRead";
import { sessionReadEpoch } from "@/lib/sessionReadEpoch";

interface RegInfo {
  registration_id: string;
  reference_code: string;
  total_pay: number;
  breakdown: { buy_in: number; club_fee?: number | null; service_fee?: number | null; platform_fee?: number | null };
  bank_name: string | null;
  account_number: string | null;
  account_holder: string | null;
  qr_code_url?: string | null;
  bank_bin?: string | null;
  committed_at?: string;
  status?: string;
  transfer_proof_url?: string | null;
  transfer_proof_submitted?: boolean;
  already_registered?: boolean;
  free_rake_applied?: boolean;
  savings?: number | null;
  price_detail_available?: boolean;
}

type EdgeErrorBody = { error?: string };
type ErrorWithJsonContext = { context?: { json?: () => Promise<unknown> } };

interface Props {
  tournamentId: string;
  tournamentName: string;
  open: boolean;
  onClose: () => void;
  onCompleted?: () => void;
  /** 'register' (default) calls tournament-register; 'reentry' calls tournament-reentry. Same response
   *  shape + same VietQR/bank UI either way — only the edge fn (and thus the REENTRY code) differs. */
  mode?: "register" | "reentry";
}

const TIMEOUT_MS = 30 * 60 * 1000;
const RECEIPT_POLL_MS = 10_000;
const amount = z.number().finite().nonnegative();
const registrationResponse = z.object({
  registration_id: z.string().min(1), reference_code: z.string().min(1), total_pay: amount,
  breakdown: z.object({ buy_in: amount, club_fee: amount.nullable().optional(),
    service_fee: amount.nullable().optional(), platform_fee: amount.nullable().optional() }),
  bank_name: z.string().nullable(), account_number: z.string().nullable(), account_holder: z.string().nullable(),
  qr_code_url: z.string().nullable().optional(), bank_bin: z.string().nullable().optional(),
  transfer_proof_url: z.string().nullable().optional(), transfer_proof_submitted: z.boolean().optional(),
  committed_at: z.string().optional(), status: z.string().optional(), already_registered: z.boolean().optional(),
  free_rake_applied: z.boolean().optional(), savings: amount.nullable().optional(), price_detail_available: z.boolean().optional(),
});
const registrationUnknown = "Chưa xác minh được đăng ký. Kiểm tra danh sách Đã đăng ký trước khi thử lại; không chuyển tiền hoặc gửi đăng ký mới dựa trên màn hình này.";

const useCountdown = (deadline: number) => {
  const [remaining, setRemaining] = useState(Math.max(0, deadline - Date.now()));
  useEffect(() => {
    const id = setInterval(() => setRemaining(Math.max(0, deadline - Date.now())), 1000);
    return () => clearInterval(id);
  }, [deadline]);
  const m = Math.floor(remaining / 60000);
  const s = Math.floor((remaining % 60000) / 1000);
  return { label: `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`, expired: remaining <= 0 };
};

export const TournamentRegisterModal = (props: Props) => {
  const { user } = useAuth();
  return <ScopedTournamentRegisterModal key={JSON.stringify([props.open, user?.id, props.tournamentId, props.mode ?? "register"])} {...props} />;
};

const ScopedTournamentRegisterModal = ({ tournamentId, tournamentName, open, onClose, onCompleted, mode = "register" }: Props) => {
  const { t } = useTranslation();
  const { user, session } = useAuth();
  const sessionEpoch = sessionReadEpoch(session);
  const [loading, setLoading] = useState(false);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [info, setInfo] = useState<RegInfo | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [proofSubmitted, setProofSubmitted] = useState(false);
  const [confirmedReceipt, setConfirmedReceipt] = useState<BuyinReceiptSnapshot | null>(null);
  const [paymentSnapshot, setPaymentSnapshot] = useState<BuyinReceiptSnapshot | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  const onCompletedRef = useRef(onCompleted);
  const completionNotified = useRef(false);
  const translateRef = useRef(t);
  onCloseRef.current = onClose;
  onCompletedRef.current = onCompleted;
  translateRef.current = t;
  const userId = user?.id;
  const cancelKey=JSON.stringify([open,userId,tournamentId,mode,sessionEpoch]);
  const cancelScope=useRef({key:cancelKey});if(cancelScope.current.key!==cancelKey)cancelScope.current={key:cancelKey};
  const cancelRun=useRef<{scope:object}|null>(null),cancelMounted=useRef(false);
  const proofRun=useRef<{scope:object}|null>(null);
  useEffect(()=>{cancelMounted.current=true;return()=>{cancelMounted.current=false;};},[]);
  const bootstrapSession = useRef(sessionEpoch);
  useEffect(() => {
    if (bootstrapSession.current === sessionEpoch) return;
    bootstrapSession.current = sessionEpoch;
    setInfo(null); setConfirmedReceipt(null); setPaymentSnapshot(null); setLoading(false);
    setBootstrapError("Phiên đăng nhập đã thay đổi. Kiểm tra danh sách Đã đăng ký trước khi mở lại; chưa tự gửi đăng ký mới.");
  }, [sessionEpoch]);

  useEffect(() => {
    if (!open || !userId) return;
    let mounted = true;
    const scope = cancelScope.current;
    const current = () => mounted && cancelScope.current === scope;
    (async () => {
      setInfo(null);
      setBootstrapError(null);
      setCancelling(false);
      setSubmitting(false);
      setUploading(false);
      completionNotified.current = false;
      setConfirmedReceipt(null);
      setPaymentSnapshot(null);
      setProofUrl(null);
      setProofSubmitted(false);
      setLoading(true);
      try {
      const { data, error } = await waitForManualPlayerResponse(supabase.functions.invoke(
        mode === "reentry" ? "tournament-reentry" : "tournament-register",
        { body: { tournament_id: tournamentId } },
      ));
      if (!current()) return;
      setLoading(false);
      const response = data as EdgeErrorBody | null;
      const reportedError = typeof response?.error === "string" && response.error ? response.error : null;
      if (error || reportedError) {
        // supabase-js reports any non-2xx as a generic "Edge Function returned a
        // non-2xx status code" and drops the body — surface the real reason
        // (e.g. "Giải đã bắt đầu hoặc kết thúc.") from the response context.
        let msg = reportedError ?? error?.message ?? translateRef.current("tournamentRegister.regError");
        const ctx = (error as ErrorWithJsonContext | null)?.context;
        if (ctx && typeof ctx.json === "function") {
          try {
            const body = await observeTrackerContextRead(ctx.json()) as EdgeErrorBody;
            if (typeof body?.error === "string" && body.error) msg = body.error;
          } catch { /* keep generic */ }
        }
        if (!current()) return;
        toast.error(msg);
        onCloseRef.current();
        return;
      }
      const parsed = registrationResponse.safeParse(data);
      if (!parsed.success) { setBootstrapError(registrationUnknown); return; }
      const r = parsed.data as RegInfo;
      setInfo(r);
      setProofUrl(r.transfer_proof_url ?? null);
      setProofSubmitted(!!r.transfer_proof_submitted);
      // Tell the mobile "Đã đăng ký" badge (RegisteredBadge) to refresh.
      window.dispatchEvent(new Event("vinpoker:registration-changed"));
      } catch {
        if (current()) setBootstrapError(registrationUnknown);
      } finally { if (current()) setLoading(false); }
    })();
    return () => { mounted = false; };
  }, [open, tournamentId, userId, mode]);

  // Polls only the read-only receipt endpoint while this payment dialog is open.
  // Do not call tournament-register again here: it can consume a free-rake slot.
  useEffect(() => {
    if (!open || !info?.registration_id || confirmedReceipt || bootstrapError) return;
    let current = true;
    const scope = cancelScope.current;
    const refreshReceipt = async () => {
      const snapshot = await fetchBuyinReceipt({ registrationId: info.registration_id });
      if (!current || cancelScope.current !== scope || !snapshot) return;
      setPaymentSnapshot(snapshot);
      if (snapshot.status !== "confirmed" || !snapshot.receipt_code) return;
      setConfirmedReceipt(snapshot);
      if (!completionNotified.current) {
        completionNotified.current = true;
        onCompletedRef.current?.();
      }
      window.dispatchEvent(new Event("vinpoker:registration-changed"));
    };
    void refreshReceipt();
    const interval = window.setInterval(() => { void refreshReceipt(); }, RECEIPT_POLL_MS);
    const timeout = window.setTimeout(() => window.clearInterval(interval), TIMEOUT_MS);
    return () => {
      current = false;
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [open, info?.registration_id, confirmedReceipt, bootstrapError]);


  const transferContent = info ? `VINPoker ${info.reference_code}` : "";
  const paidWaitingSeat = paymentSnapshot?.payment_state === "paid_waiting_seat";
  const remainingToTransfer = paymentSnapshot?.remaining_amount ?? info?.total_pay ?? 0;
  const hasBankTransfer = !!info?.bank_name && !!info.account_number && !!info.account_holder;

  // Dynamic VietQR (NAPAS): prefer the explicit bank_bin (Stage 2), else the name map (legacy/UAT).
  // Memo = the BARE reference_code (uppercased) so SePay's \y(VINREG…|REENTRY…)\y match is unambiguous.
  // Built client-side from data the modal already has; any bad input → null → static QR fallback.
  // Deterministic (no nonce/timestamp) so the QR is stable across re-renders.
  const vietqrPayload = useMemo(() => {
    if (!info?.bank_name || !info.account_number) return null;
    // Prefer an explicit bank_bin (Stage 2); treat blank/empty as absent so it falls through to the
    // name map (legacy/UAT) rather than hard-skipping the dynamic QR.
    const bin = (info.bank_bin && info.bank_bin.trim()) || normalizeBankNameToBin(info.bank_name);
    if (!bin) return null;
    try {
      return buildVietQrPayload({
        bin,
        accountNumber: info.account_number,
        amount: remainingToTransfer,
        memo: info.reference_code.toUpperCase(),
      });
    } catch {
      return null;
    }
  }, [info, remainingToTransfer]);

  const copy = (txt: string, lbl: string) => {
    navigator.clipboard.writeText(txt);
    toast.success(t("tournamentRegister.copied", { label: lbl }));
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.files?.[0];
    if (!raw || !user || !info||proofRun.current?.scope===cancelScope.current) return;
    if (!["image/jpeg","image/png","image/webp"].includes(raw.type)) {
      toast.error(t("tournamentRegister.onlyImageTypes")); return;
    }
    if (raw.size > 5 * 1024 * 1024) { toast.error(t("tournamentRegister.maxImage5")); return; }
    const run={scope:cancelScope.current};proofRun.current=run;
    const current=()=>cancelMounted.current&&cancelScope.current===run.scope;
    const input=e.target;
    setUploading(true);
    try {
      const file = await compressImage(raw, { maxEdge: 1600, quality: 0.8 });
      if(!current())return;
      const ext = file.type === "image/png" ? "png" : "jpg";
      const path = `${user.id}/tournament-regs/${info.registration_id}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("staking-proofs")
        .upload(path, file, { upsert: false, contentType: file.type, cacheControl: "3600" });
      if (upErr) throw upErr;
      if(!current())return;
      const { data: signed } = await supabase.storage
        .from("staking-proofs")
        .createSignedUrl(path, 60 * 60 * 24 * 365);
      if(!current())return;
      const url = signed?.signedUrl ?? path;
      const { data,error: updErr } = await supabase
        .from("tournament_registrations")
        .update({ transfer_proof_image_url: url })
        .eq("id", info.registration_id).eq('player_id',user.id)
        .select('id,transfer_proof_image_url').maybeSingle();
      if(!current())return;
      if (updErr||data?.id!==info.registration_id||data.transfer_proof_image_url!==url) {
        toast.error(t('tournamentRegister.proofUnverified'));return;
      }
      setProofUrl(url);
      toast.success(t("tournamentRegister.proofUploaded"));
    } catch (error) {
      if(current())toast.error(error instanceof Error ? error.message : t("tournamentRegister.uploadFailed"));
    } finally {
      if(proofRun.current===run)proofRun.current=null;
      if(current()){setUploading(false);input.value="";}
    }
  };

  const markTransferred = async () => {
    if (!info||!userId||!proofUrl||proofSubmitted||proofRun.current?.scope===cancelScope.current) return;
    const run={scope:cancelScope.current};proofRun.current=run;
    const current=()=>cancelMounted.current&&cancelScope.current===run.scope;
    setSubmitting(true);
    try{
    const { data,error } = await supabase
      .from("tournament_registrations")
      .update({ transfer_proof_submitted: true })
      .eq("id", info.registration_id).eq('player_id',userId)
      .select('id,transfer_proof_submitted').maybeSingle();
    if(!current())return;
    if (error||data?.id!==info.registration_id||data.transfer_proof_submitted!==true) {
      toast.error(t('tournamentRegister.proofUnverified'));return;
    }
    setProofSubmitted(true);
    toast.success(t("tournamentRegister.markedToast"));
    onCompletedRef.current?.();
    }catch{if(current())toast.error(t('tournamentRegister.proofUnverified'));}
    finally{if(proofRun.current===run)proofRun.current=null;if(current())setSubmitting(false);}
  };

  const cancelReg = async () => {
    if (!info||!userId||cancelRun.current?.scope===cancelScope.current) return;
    if ((paymentSnapshot?.received_amount ?? 0) > 0) {
      toast.error(t("tournamentRegister.paidCannotCancel")); return;
    }
    if (!confirm(t("tournamentRegister.confirmCancel"))) return;
    const run={scope:cancelScope.current};cancelRun.current=run;
    const current=()=>cancelMounted.current&&cancelScope.current===run.scope;
    setCancelling(true);
    try{
    const { data,error } = await supabase
      .from("tournament_registrations")
      .update({ status: "cancelled", cancellation_reason: "player_cancelled", cancelled_at: new Date().toISOString() })
      .eq("id", info.registration_id)
      .eq("player_id", userId)
      .eq("status", "pending")
      .select('id,status').maybeSingle();
    if(!current())return;
    if (error||data?.id!==info.registration_id||data.status!=='cancelled') {
      toast.error(t('tournamentRegister.cancelUnverified'));return;
    }
    toast.success(t("tournamentRegister.cancelled"));
    window.dispatchEvent(new Event("vinpoker:registration-changed"));
    onClose();
    }catch{if(current())toast.error(t('tournamentRegister.cancelUnverified'));}
    finally{if(cancelRun.current===run)cancelRun.current=null;if(current())setCancelling(false);}
  };

  if (confirmedReceipt) {
    return (
      <SeatReceiptDialog
        open={open}
        onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}
        receipt={toSeatReceiptData(confirmedReceipt)}
      />
    );
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("tournamentRegister.title")}</DialogTitle>
          <DialogDescription className="text-xs">{tournamentName}</DialogDescription>
        </DialogHeader>

        {!userId || bootstrapError ? <p role="alert" className="py-6 text-sm text-amber-200">{bootstrapError ?? "Chưa xác minh tài khoản đăng ký."}</p> : loading || !info ? (
          <div className="py-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        ) : (
          <div className="space-y-4">

            {/* Free rake banner */}
            {info.free_rake_applied && (
              <div className="rounded-xl border border-success/30 bg-success/5 p-3 flex items-start gap-2">
                <Sparkles className="w-4 h-4 text-success mt-0.5 shrink-0" />
                <div className="text-xs text-success font-semibold">
                  {typeof info.savings === "number"
                    ? t("tournamentRegister.freeRakeBanner", { savings: formatStack(info.savings) })
                    : t("tournamentRegister.historicFreeRake")}
                </div>
              </div>
            )}

            {/* Breakdown */}
            <LiquidGlassCard
              glassSize="sm"
              className="rounded-xl"
              contentClassName="space-y-1.5 text-sm"
            >
              <div className="flex justify-between"><span className="text-muted-foreground">{t("tournamentRegister.feeLabel")}</span><span className="font-mono">{formatVND(info.breakdown.buy_in)}</span></div>
              {/* Player-facing: rake + staff fee are shown together as a single "Phí dịch vụ" line. */}
              {((info.breakdown.club_fee ?? 0) + (info.breakdown.service_fee ?? 0)) > 0 && (
                <div className="flex justify-between"><span className="text-muted-foreground">{t("tournamentRegister.serviceFeeLabel")}</span><span className="font-mono">{formatVND((info.breakdown.club_fee ?? 0) + (info.breakdown.service_fee ?? 0))}</span></div>
              )}
              {typeof info.savings === "number" && info.savings > 0 && (
                <div className="flex justify-between text-success">
                  <span className="text-xs">{t("tournamentRegister.freeClubService")}</span>
                  <span className="font-mono text-xs">-{formatStack(info.savings)}</span>
                </div>
              )}
              <div className="flex justify-between pt-2 border-t border-border/60">
                <span className="font-semibold">{t("tournamentRegister.totalPay")}</span>
                <span className="font-mono font-bold text-primary text-base">{formatVND(info.total_pay)}</span>
              </div>
            </LiquidGlassCard>
            {info.price_detail_available === false && <p className="text-xs text-muted-foreground">{t("tournamentRegister.historicPriceDetail")}</p>}

            {paymentSnapshot?.payment_state === "partial" && (
              <div role="status" className="rounded-xl border border-success/40 bg-success/5 p-3 text-sm">
                {t("tournamentRegister.partialVerified", {
                  received: formatVND(paymentSnapshot.received_amount ?? 0),
                  remaining: formatVND(remainingToTransfer),
                })}
              </div>
            )}
            {paidWaitingSeat && (
              <div role="status" className="rounded-xl border border-success/40 bg-success/5 p-4 text-sm font-semibold">
                {t("tournamentRegister.paidWaitingSeat")}
              </div>
            )}
            {!paidWaitingSeat && hasBankTransfer && <p className="text-xs text-muted-foreground">{t("tournamentRegister.autoVerifyHint")}</p>}
            {!paidWaitingSeat && !hasBankTransfer && <p role="status" className="rounded-xl border border-primary/30 bg-card p-3 text-sm">{t("tournamentRegister.counterCashOnly")}</p>}


            {/* Bank info */}
            {!paidWaitingSeat && <>
            {hasBankTransfer && <div className="rounded-xl border border-primary/30 bg-card p-3 space-y-2">
              <div className="text-xs font-semibold text-primary">{t("tournamentRegister.transferInfo")}</div>
              {remainingToTransfer !== info.total_pay && <p className="text-xs text-success">{t("tournamentRegister.transferRemaining", { amount: formatVND(remainingToTransfer) })}</p>}
              <div className="text-sm">
                <div className="flex justify-between gap-2"><span className="text-muted-foreground text-xs">{t("tournamentRegister.bank")}</span><span className="font-medium">{info.bank_name}</span></div>
                <div className="flex justify-between gap-2"><span className="text-muted-foreground text-xs">{t("tournamentRegister.accountHolder")}</span><span className="font-medium">{info.account_holder}</span></div>
                <div className="flex items-center justify-between gap-2 mt-1.5 p-2 rounded-lg border border-primary/40 bg-primary/5">
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase text-muted-foreground">{t("tournamentRegister.accountNumber")}</div>
                    <div className="font-mono font-bold text-primary">{info.account_number}</div>
                  </div>
                  <Button size="icon" variant="ghost" onClick={() => copy(info.account_number!, t("tournamentRegister.labelAccountNumber"))}><Copy className="w-4 h-4" /></Button>
                </div>
              </div>
              {FEATURES.dynamicVietQr && vietqrPayload ? (
                <div className="flex flex-col items-center gap-1.5">
                  {/* QR needs a light tile + quiet zone (includeMargin) to scan on the dark theme. */}
                  <div className="bg-white p-3 rounded-lg">
                    <QRCodeSVG value={vietqrPayload} size={200} level="M" marginSize={4} />
                  </div>
                  <div className="text-[10px] text-muted-foreground text-center">{t("tournamentRegister.vietqrHint")}</div>
                </div>
              ) : (
                info.qr_code_url && (
                  <img src={info.qr_code_url} alt="QR" className="w-full max-w-[200px] mx-auto rounded border" />
                )
              )}
            </div>}

            {/* Reference code */}
            <div className="rounded-xl border border-primary/40 bg-primary/5 p-3 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[10px] uppercase text-muted-foreground">{t(hasBankTransfer ? "tournamentRegister.transferContentLabel" : "tournamentRegister.counterCodeLabel")}</div>
                <div className="font-mono font-bold text-primary truncate">{hasBankTransfer ? transferContent : info.reference_code}</div>
              </div>
              <Button size="icon" variant="ghost" onClick={() => copy(hasBankTransfer ? transferContent : info.reference_code, t("tournamentRegister.labelTransferContent"))}><Copy className="w-4 h-4" /></Button>
            </div>

            {/* Proof upload */}
            {hasBankTransfer && <div className="rounded-xl border border-border bg-card/40 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs">
                  <div className="font-semibold">{t("tournamentRegister.proofTitle")}</div>
                  <div className="text-[10px] text-muted-foreground">{t("tournamentRegister.proofHint")}</div>
                </div>
                {proofUrl ? (
                  <span className="text-xs text-success flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> {t("tournamentRegister.uploaded")}</span>
                ) : <span className="text-xs text-muted-foreground">{t("tournamentRegister.notUploaded")}</span>}
              </div>
              <input
                ref={inputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/*"
                hidden
                onChange={handleFile}
              />
              <LiquidButton type="button" variant="outline" size="sm" className="w-full" onClick={() => inputRef.current?.click()} disabled={uploading}>
                {uploading ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Upload className="w-3.5 h-3.5 mr-1" />}
                {proofUrl ? t("tournamentRegister.reupload") : t("tournamentRegister.uploadProof")}
              </LiquidButton>
              {proofUrl && (
                <a href={proofUrl} target="_blank" rel="noreferrer" className="block">
                  <img src={proofUrl} alt="Tx" className="w-full max-h-40 object-contain rounded-md border" />
                </a>
              )}
            </div>}

            {/* Actions */}
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 text-destructive border-destructive/40 hover:bg-destructive/10"
                onClick={cancelReg} disabled={cancelling || submitting || proofSubmitted || (paymentSnapshot?.received_amount ?? 0) > 0}>
                {t("tournamentRegister.cancelReg")}
              </Button>
              {hasBankTransfer && <Button className="flex-1 gradient-neon text-primary-foreground font-bold"
                onClick={markTransferred} disabled={submitting || uploading || proofSubmitted || !proofUrl}>
                {proofSubmitted ? t("tournamentRegister.sentWaiting") : submitting ? t("tournamentRegister.sending") : !proofUrl ? t("tournamentRegister.needProof") : t("tournamentRegister.transferred")}
              </Button>}
            </div>
            </>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
