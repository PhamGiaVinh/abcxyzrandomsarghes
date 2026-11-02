import { useCallback, useEffect, useRef, useState } from "react";
import {z} from 'zod';
import { AnimatePresence, motion } from "framer-motion";
import { BadgeCheck, Hourglass, Loader2, Ticket } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {observeTrackerContextRead} from '@/lib/tournament/observeTrackerContextRead';
import { SeatReceiptDialog } from "@/components/tournament/seat/SeatReceiptDialog";
import { fetchBuyinReceipt, toSeatReceiptData, type BuyinReceiptSnapshot } from "@/components/tournament/seat/buyinReceipt";

type Registration = {
  id: string;
  status: string;
  tournamentName: string;
};

const STATUS_VI: Record<string, string> = {
  pending: "Chờ thanh toán",
  confirmed: "Đã xác nhận",
};

/**
 * Mobile entry point for the same server-backed buy-in receipt used by staff.
 * The badge never generates a code or calculates payment/seat state locally.
 */
export function RegisteredBadge({placement='floating'}:{placement?:'floating'|'inline'}) {
  const { user,loading,authError } = useAuth();
  return user&&!loading&&!authError?<ActorRegisteredBadge key={user.id} actorId={user.id} placement={placement}/>:null;
}

const registrationsSchema=z.array(z.object({id:z.string().min(1),status:z.enum(['pending','confirmed']),tournament_id:z.string().min(1)}));
const tournamentsSchema=z.array(z.object({id:z.string().min(1),name:z.string().nullable(),status:z.string().min(1)}));
function ActorRegisteredBadge({actorId,placement}:{actorId:string;placement:'floating'|'inline'}){
  const [registration, setRegistration] = useState<Registration | null>(null);
  const [open, setOpen] = useState(false);
  const [receipt, setReceipt] = useState<BuyinReceiptSnapshot | null>(null);
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [registrationError,setRegistrationError]=useState<string|null>(null);
  const [receiptError,setReceiptError]=useState<string|null>(null);
  const [receiptRetry,setReceiptRetry]=useState(0);
  const request=useRef(0),transport=useRef<AbortController|null>(null);
  const invalidateRegistrationRead=useCallback(()=>{request.current++;transport.current?.abort();},[]);

  const fetchRegistration = useCallback(async () => {
    const generation=++request.current;
    transport.current?.abort();const controller=new AbortController();transport.current=controller;
    try {
    const result=await observeTrackerContextRead((async()=>{
    const { data,error } = await supabase
      .from("tournament_registrations")
      .select("id, status, tournament_id")
      .eq("player_id", actorId)
      .in("status", ["pending", "confirmed"])
      .order("created_at", { ascending: false })
      .limit(8).abortSignal(controller.signal);
    if(error)throw error;
    if(generation!==request.current)throw Error('stale_read');
    const registrations = registrationsSchema.parse(data);
    if (!registrations.length) {
      return null;
    }

    const tournamentIds = Array.from(new Set(registrations.map((row) => row.tournament_id).filter(Boolean)));
    const { data: tournaments,error:tournamentError } = await supabase
      .from("tournaments")
      .select("id, name, status")
      .in("id", tournamentIds).abortSignal(controller.signal);
    if(tournamentError)throw tournamentError;
    const tournamentById = new Map(tournamentsSchema.parse(tournaments).map((row) => [row.id, row]));
    if(tournamentIds.some(id=>!tournamentById.has(id)))throw Error('tournament_metadata_missing');
    const active = registrations.find((row) => !["completed", "cancelled"].includes(tournamentById.get(row.tournament_id)?.status ?? ""));
    if (!active) {
      return null;
    }

    return {
      id: active.id,
      status: active.status,
      tournamentName: tournamentById.get(active.tournament_id)?.name ?? "Giải đấu",
    };
    })());
    if(generation===request.current){setRegistration(result);setRegistrationError(null);}
    }catch{if(generation===request.current)setRegistrationError('Không tải được đăng ký. Chưa xác minh được trạng thái giải.');}
    finally{controller.abort();if(transport.current===controller)transport.current=null;}
  }, [actorId]);

  useEffect(() => {
    void fetchRegistration();
    const onRegistrationChange = () => { void fetchRegistration(); };
    window.addEventListener("vinpoker:registration-changed", onRegistrationChange);
    return () => {invalidateRegistrationRead();window.removeEventListener("vinpoker:registration-changed", onRegistrationChange);};
  }, [fetchRegistration,invalidateRegistrationRead]);

  useEffect(() => {
    let current = true;
    const registrationId = registration?.id;
    if (!open || !registrationId) {
      setReceipt(null);
      setReceiptLoading(false);
      setReceiptError(null);
      return () => { current = false; };
    }
    setReceiptLoading(true);
    setReceipt(null);setReceiptError(null);
    void fetchBuyinReceipt({ registrationId }).then((snapshot) => {
      if (!current) return;
      setReceipt(snapshot);
      setReceiptError(snapshot?null:'Chưa xác minh được phiếu. Hãy thử tải lại; chưa kết luận trạng thái thanh toán.');
      setReceiptLoading(false);
    }).catch(()=>{if(current){setReceiptLoading(false);setReceiptError('Chưa xác minh được phiếu. Hãy thử tải lại; chưa kết luận trạng thái thanh toán.');}});
    return () => { current = false; };
  }, [open, registration?.id,receiptRetry]);

  if(registrationError)return <div role="alert" className={`${placement==='inline'?'mb-3':'fixed bottom-[calc(72px+env(safe-area-inset-bottom))] left-3 right-3 z-50'} rounded-lg border border-warning/40 bg-background p-3 text-sm md:hidden`}>
    <p>{registrationError}</p><button type="button" className="mt-2 underline" onClick={()=>void fetchRegistration()}>Thử tải lại đăng ký</button>
  </div>;

  if (!registration) return null;

  const confirmedReceipt = receipt?.status === "confirmed" && receipt.receipt_code
    ? toSeatReceiptData(receipt)
    : null;

  return (
    <>
      <AnimatePresence>
        <motion.button
          key="reg-pill"
          type="button"
          onClick={() => setOpen(true)}
          initial={{ opacity: 0, y: 8, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.9 }}
          transition={{ type: "spring", stiffness: 420, damping: 26 }}
          className={`${placement==='inline'?'mb-3 inline-flex':'fixed bottom-[calc(72px+env(safe-area-inset-bottom))] left-1/2 z-50 flex -translate-x-1/2'} items-center gap-1 rounded-full border border-primary/40 bg-primary px-3 py-1 text-[11px] font-bold text-primary-foreground shadow-lg shadow-primary/30 md:hidden`}
          aria-label="Xem phiếu đăng ký"
        >
          <BadgeCheck className="h-3.5 w-3.5" /> Đã đăng ký
        </motion.button>
      </AnimatePresence>

      {confirmedReceipt ? (
        <SeatReceiptDialog open={open} onOpenChange={setOpen} receipt={confirmedReceipt} />
      ) : (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="mb-[env(safe-area-inset-bottom)] w-[calc(100%-1.5rem)] max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Ticket className="h-4 w-4 text-primary" /> Phiếu đăng ký
              </DialogTitle>
              <DialogDescription className="sr-only">Trạng thái đăng ký và phiếu buy-in được đọc lại từ máy chủ.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="font-semibold">{registration.tournamentName}</div>
              <span className="inline-flex rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                {STATUS_VI[receipt?.status ?? registration.status] ?? receipt?.status ?? registration.status}
              </span>
              {receiptLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Đang tải phiếu...</div>
              ) : receiptError ? <div role="alert" className="rounded-lg border border-warning/40 p-3 text-sm text-warning">
                <p>{receiptError}</p><button type="button" className="mt-2 underline" onClick={()=>setReceiptRetry(value=>value+1)}>Thử tải lại phiếu</button>
              </div> : (
                <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-warning">
                  <Hourglass className="mt-0.5 h-4 w-4 shrink-0" />
                  <p className="text-sm">{receipt?.status === "confirmed" ? "Đã xác nhận, đang cấp phiếu xếp chỗ." : "Đang chờ xác nhận chuyển khoản. Phiếu buy-in sẽ tự hiện tại đây sau khi hệ thống xếp chỗ."}</p>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
