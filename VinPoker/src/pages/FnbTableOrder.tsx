import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { FEATURES } from "@/lib/featureFlags";
import { formatVND } from "@/lib/format";
import { mapFnbError } from "@/lib/fnbErrors";
import { buildVietQrPayload } from "@/lib/vietqr";
import { normalizeBankNameToBin } from "@/lib/vietnamBanks";
import {
  useFnbGuestLookup, useFnbGuestOrderStatus, fnbGuestCreateOrder, fnbGuestReadReceipt, fnbGuestAbandonIntent,
  type FnbGuestItem, type FnbGuestBank, type FnbGuestCreateResult,
} from "@/hooks/useFnbGuest";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Plus, Minus, Utensils, Wallet, QrCode, CheckCircle2, Clock, ArrowLeft } from "lucide-react";
import {clearResolvedFnbGuestIntent,fnbGuestIntentKey,parseFnbGuestIntent,saveFnbGuestIntent,isFnbGuestAbandonReceipt,FNB_GUEST_MAX_QTY,FNB_GUEST_MAX_LINES,type FnbGuestIntent} from '@/lib/fnbGuestIntent';
import {fnbGuestCreateOutcome} from '@/lib/fnbMutationOutcome';

/**
 * F&B GUEST QR ordering (/fnb/order?t=<token>) — the guest's phone flow. Chrome-less, SESSIONLESS
 * (anon), gated on FEATURES.fnbGuestOrder. State machine: welcome (pick seat) → menu (cart) →
 * review (name + payment) → cash-wait | bank-qr (VietQR + poll) → done | expired. Resume via
 * localStorage. All data via the anon fnb_guest_* RPCs (useFnbGuest). Hardcoded VN (F&B house style).
 */
export default function FnbTableOrder() {
  const [params] = useSearchParams();
  const token = params.get("t");
  if (!FEATURES.fnbModule || !FEATURES.fnbGuestOrder) return <Navigate to="/" replace />;
  if (!token) return <GuestShell><ErrorState msg="Thiếu mã QR — vui lòng quét lại mã trên bàn." /></GuestShell>;
  return <GuestOrderInner key={token} token={token} />;
}

const LS_KEY = (token: string) => `fnb.guest.order.${token}`;

type Phase = "welcome" | "menu" | "review" | "wait" | "abandoned";

function GuestOrderInner({ token }: { token: string }) {
  const { data: lookup, isLoading, isFetching, error, refetch } = useFnbGuestLookup(token);

  const [phase, setPhase] = useState<Phase>("welcome");
  const [seat, setSeat] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [method, setMethod] = useState<"cash" | "bank_transfer">("cash");
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<FnbGuestCreateResult | null>(null);
  const crid = useRef<string>(crypto.randomUUID());
  const alive=useRef(true);
  const busy=useRef(false);
  const [recovery,setRecovery]=useState<string|null>(null);
  const [retryIntent,setRetryIntent]=useState<FnbGuestIntent|null>(null);
  const [pendingIntent,setPendingIntent]=useState<FnbGuestIntent|null>(null);

  const recover=useCallback(async(intent:FnbGuestIntent,closeRequest=false)=>{
    if(busy.current)return;
    busy.current=true;setSubmitting(true);setRetryIntent(null);
    try{
      const result=await (closeRequest?fnbGuestAbandonIntent(intent):fnbGuestReadReceipt(intent));
      if(!alive.current)return;
      if(result.kind==='found'||result.kind==='abandoned'){
        saveFnbGuestIntent(localStorage,{...intent,resolved:true,receipt:result.receipt});
        setPendingIntent(null);setRecovery(null);
        if(result.kind==='found'){setCreated(result.receipt);setPhase('wait');}
        else{setCreated(null);setPhase('abandoned');}
      }else {
        if(result.kind==='missing')setRetryIntent(intent);
        setRecovery(result.kind==='missing'?'Server chưa ghi nhận receipt. Bạn có thể gửi lại đúng đơn đã lưu, không tạo đơn khác.':'Chưa xác minh được đơn đã gửi. Không gửi đơn mới trong lúc này.');
      }
    }catch{if(alive.current)setRecovery('Không lưu hoặc đọc được yêu cầu đã gửi. Vui lòng báo nhân viên; không đặt lại đơn.');}
    finally{busy.current=false;if(alive.current)setSubmitting(false);}
  },[]);

  // Resume an in-flight order across a refresh (localStorage). If found, jump straight to the wait screen.
  useEffect(() => {
    alive.current=true;
    try {
      const journal=localStorage.getItem(fnbGuestIntentKey(token));
      if(journal){
        const intent=parseFnbGuestIntent(journal,token);
        if(intent.resolved){
          if(isFnbGuestAbandonReceipt(intent.receipt,intent.requestId))setPhase('abandoned');
          else{setCreated(intent.receipt as FnbGuestCreateResult);setPhase('wait');}
        }
        else {setPendingIntent(intent);setRecovery('Đang kiểm tra đơn đã gửi…');void recover(intent);}
        return ()=>{alive.current=false;};
      }
      const raw = localStorage.getItem(LS_KEY(token));
      if (raw) {
        const saved = JSON.parse(raw) as FnbGuestCreateResult;
        const parsed=fnbGuestCreateOutcome(saved,saved.payment_method);
        if(parsed.kind!=='confirmed')throw Error('INVALID_SAVED_ORDER');
        setCreated(parsed.result);setPhase('wait');
      }
    } catch {setRecovery('Không đọc được đơn đã lưu. Vui lòng báo nhân viên; không đặt lại đơn.');}
    return ()=>{alive.current=false;};
  }, [token,recover]);

  const items = useMemo(() => lookup?.items ?? [], [lookup]);
  const lines = useMemo(() => items.filter((m) => cart[m.id]), [items, cart]);
  const subtotal = lines.reduce((s, m) => s + m.price_vnd * cart[m.id], 0);

  const add = (id: string) => setCart((c) => {
    if((c[id]??0)>=FNB_GUEST_MAX_QTY||(!c[id]&&Object.keys(c).length>=FNB_GUEST_MAX_LINES))return c;
    return {...c,[id]:(c[id]??0)+1};
  });
  const dec = (id: string) => setCart((c) => {
    const n = (c[id] ?? 0) - 1; const x = { ...c }; if (n <= 0) delete x[id]; else x[id] = n; return x;
  });

  const sendIntent = async (intent:FnbGuestIntent) => {
    if(busy.current)return;
    try{saveFnbGuestIntent(localStorage,intent);}catch{setRecovery('Không lưu được yêu cầu. Chưa gửi đơn; vui lòng kiểm tra bộ nhớ trình duyệt.');return;}
    setPendingIntent(intent);
    busy.current=true;
    setSubmitting(true);setRetryIntent(null);
    try{
    const { res, errorCode } = await fnbGuestCreateOrder({
      token:intent.token, seat:intent.seat, customerName:intent.customerName, note:intent.note,
      lines:intent.lines.map(line=>({menu_item_id:line.menu_item_id,qty:line.qty})),paymentMethod:intent.paymentMethod, clientRequestId:intent.requestId,
    });
    if(!alive.current)return;
    if (errorCode || !res) {setRecovery(errorCode==='FNB_MUTATION_UNKNOWN'?'Chưa xác minh được đơn đã gửi. Không gửi đơn mới trong lúc này.':mapFnbError(errorCode??''));return;}
    saveFnbGuestIntent(localStorage,{...intent,resolved:true,receipt:res});
    setPendingIntent(null);
    setCreated(res);
    setPhase("wait");setRecovery(null);
    }catch{if(alive.current)setRecovery('Chưa xác minh được đơn đã gửi. Vui lòng kiểm tra lại; không đặt đơn mới.');}
    finally{busy.current=false;if(alive.current)setSubmitting(false);}
  };
  const submit = () => {
    if(lines.length===0||busy.current||recovery)return;
    void sendIntent({version:1,token,requestId:crid.current,seat,customerName:name.trim()||null,note:note.trim()||null,
      lines:lines.map(m=>({menu_item_id:m.id,qty:cart[m.id]})),paymentMethod:method});
  };

  const startOver = () => {
    try {clearResolvedFnbGuestIntent(localStorage,token);localStorage.removeItem(LS_KEY(token));} catch {setRecovery('Không xóa được đơn đã lưu. Chưa thể đặt đơn khác.');return;}
    setCreated(null); setCart({}); setName(""); setNote(""); setMethod("cash");
    setPendingIntent(null);setRetryIntent(null);setRecovery(null);
    crid.current = crypto.randomUUID();
    setPhase("menu");
  };

  if (isLoading) return <GuestShell><div className="flex items-center gap-2 text-muted-foreground py-16 justify-center"><Loader2 className="w-5 h-5 animate-spin" /> Đang tải…</div></GuestShell>;
  if (error || !lookup) return <GuestShell><ErrorState msg={mapFnbError(error ?? 'TOKEN_INVALID')} />
    <Button variant="outline" disabled={isFetching} onClick={()=>void refetch()}>Tải lại thực đơn</Button></GuestShell>;
  if(recovery)return <GuestShell title={lookup.table_name}><div role="alert" className="space-y-4"><p>{recovery}</p>
    <Button disabled={submitting} onClick={()=>{
      try{const raw=localStorage.getItem(fnbGuestIntentKey(token));if(raw)void recover(parseFnbGuestIntent(raw,token));}
      catch{setRecovery('Không đọc được đơn đã lưu. Vui lòng báo nhân viên.');}
    }}>Kiểm tra đơn đã gửi</Button>
    {retryIntent&&<Button disabled={submitting} variant="outline" onClick={()=>void sendIntent(retryIntent)}>Gửi lại đúng đơn đã lưu</Button>}
    {pendingIntent&&<Button disabled={submitting} variant="outline" onClick={()=>void recover(pendingIntent,true)}>Đóng yêu cầu cũ để chọn lại món</Button>}
    </div></GuestShell>;
  if(phase==='abandoned')return <GuestShell title={lookup.table_name}><div role="status" className="space-y-4">
    <p>Yêu cầu cũ đã được đóng trên server, không tạo thành đơn. Bạn có thể chọn lại món.</p>
    <Button onClick={startOver}>Chọn lại món</Button>
  </div></GuestShell>;

  // ── wait screen (owns its own polling) ──────────────────────────────────────────────────────
  if (phase === "wait" && created) {
    return <GuestShell title={lookup.table_name}>
      <WaitScreen token={token} created={created} onReorder={startOver} />
    </GuestShell>;
  }

  return (
    <GuestShell title={lookup.club_name}>
      {/* ── welcome: confirm table + pick seat ── */}
      {phase === "welcome" && (
        <div className="space-y-5">
          <div className="text-center space-y-1">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Bạn đang ngồi tại</div>
            <div className="text-3xl font-bold text-primary">{lookup.table_name}</div>
          </div>
          <div>
            <div className="text-sm font-medium mb-2 text-center">Bạn ngồi ghế số mấy?</div>
            <div className="grid grid-cols-5 gap-2">
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <button key={n} onClick={() => setSeat(n)}
                  className={`h-12 rounded-lg border text-base font-semibold transition-colors ${seat === n ? "bg-primary text-primary-foreground border-primary" : "border-border text-foreground hover:border-primary/50"}`}>
                  {n}
                </button>
              ))}
            </div>
            <button onClick={() => setSeat(null)}
              className={`mt-2 w-full h-9 rounded-lg border text-xs ${seat === null ? "bg-primary/10 border-primary/40 text-foreground" : "border-border text-muted-foreground"}`}>
              Không rõ số ghế / bỏ qua
            </button>
          </div>
          <Button className="w-full h-12 text-base" onClick={() => setPhase("menu")}>
            <Utensils className="w-4 h-4 mr-1" /> Xem thực đơn
          </Button>
        </div>
      )}

      {/* ── menu: categories + items + cart ── */}
      {phase === "menu" && (
        <MenuScreen lookup={lookup} cart={cart} add={add} dec={dec}
          subtotal={subtotal} count={lines.reduce((s, m) => s + cart[m.id], 0)}
          onBack={() => setPhase("welcome")} onNext={() => setPhase("review")} />
      )}

      {/* ── review: name + note + payment choice ── */}
      {phase === "review" && (
        <div className="space-y-4">
          <button onClick={() => setPhase("menu")} className="text-xs text-muted-foreground flex items-center gap-1"><ArrowLeft className="w-3.5 h-3.5" /> Quay lại thực đơn</button>
          <Card className="p-4 space-y-2">
            <div className="text-sm font-semibold">Đơn của bạn {seat ? `· Ghế ${seat}` : ""}</div>
            {lines.map((m) => (
              <div key={m.id} className="flex justify-between text-sm">
                <span className="truncate">{cart[m.id]}× {m.name}</span>
                <span className="font-mono shrink-0">{formatVND(m.price_vnd * cart[m.id])}</span>
              </div>
            ))}
            <div className="border-t border-border pt-2 flex justify-between font-semibold">
              <span>Tổng cộng</span><span className="font-mono">{formatVND(subtotal)}</span>
            </div>
          </Card>
          <div className="space-y-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tên của bạn (tuỳ chọn)" maxLength={60} className="h-11" />
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ghi chú (vd: ít đá, không đường)" maxLength={200} className="h-11" />
          </div>
          <div className="space-y-2">
            <div className="text-sm font-medium">Hình thức thanh toán</div>
            <button onClick={() => setMethod("cash")}
              className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left ${method === "cash" ? "border-primary bg-primary/5" : "border-border"}`}>
              <Wallet className="w-5 h-5 text-primary" />
              <div><div className="font-medium text-sm">Tiền mặt</div><div className="text-xs text-muted-foreground">Nhân viên đến bàn thu tiền</div></div>
            </button>
            <button disabled={!lookup.bank_available} onClick={() => setMethod("bank_transfer")}
              className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left disabled:opacity-40 ${method === "bank_transfer" ? "border-primary bg-primary/5" : "border-border"}`}>
              <QrCode className="w-5 h-5 text-primary" />
              <div><div className="font-medium text-sm">Chuyển khoản (VietQR)</div><div className="text-xs text-muted-foreground">{lookup.bank_available ? "Quét QR ngân hàng, tự xác nhận" : "Chưa hỗ trợ tại CLB này"}</div></div>
            </button>
          </div>
          <Button className="w-full h-12 text-base" disabled={lines.length === 0 || submitting} onClick={submit}>
            {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
            {method === "cash" ? "Gửi đơn — trả tiền mặt" : "Gửi đơn & lấy mã QR"}
          </Button>
        </div>
      )}
    </GuestShell>
  );
}

function MenuScreen({ lookup, cart, add, dec, subtotal, count, onBack, onNext }: {
  lookup: NonNullable<ReturnType<typeof useFnbGuestLookup>["data"]>;
  cart: Record<string, number>; add: (id: string) => void; dec: (id: string) => void;
  subtotal: number; count: number; onBack: () => void; onNext: () => void;
}) {
  const [activeCat, setActiveCat] = useState<string>("all");
  const items = lookup.items;
  const shown = activeCat === "all" ? items : items.filter((m) => m.category_id === activeCat);
  return (
    <div className="space-y-3 pb-24">
      <button onClick={onBack} className="text-xs text-muted-foreground flex items-center gap-1"><ArrowLeft className="w-3.5 h-3.5" /> Bàn / ghế</button>
      <div className="flex flex-wrap gap-1.5">
        <CatChip active={activeCat === "all"} onClick={() => setActiveCat("all")}>Tất cả</CatChip>
        {lookup.categories.map((c) => (
          <CatChip key={c.id} active={activeCat === c.id} onClick={() => setActiveCat(c.id)}>{c.name}</CatChip>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Tối đa {FNB_GUEST_MAX_QTY} phần mỗi món và {FNB_GUEST_MAX_LINES} món khác nhau trong một đơn.</p>
      {shown.length === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Chưa có món trong mục này.</div>
      ) : (
        <div className="space-y-2">
          {shown.map((m) => <MenuRow key={m.id} item={m} qty={cart[m.id] ?? 0} canAdd={(cart[m.id]??0)<FNB_GUEST_MAX_QTY&&(!!cart[m.id]||Object.keys(cart).length<FNB_GUEST_MAX_LINES)} add={() => add(m.id)} dec={() => dec(m.id)} />)}
        </div>
      )}
      {count > 0 && (
        <div className="fixed inset-x-0 bottom-0 p-3 bg-background/95 backdrop-blur border-t border-border">
          <Button className="w-full h-12 text-base" onClick={onNext}>
            Xem đơn ({count} món) · {formatVND(subtotal)}
          </Button>
        </div>
      )}
    </div>
  );
}

function MenuRow({ item, qty, canAdd, add, dec }: { item: FnbGuestItem; qty: number; canAdd:boolean; add: () => void; dec: () => void }) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card">
      {item.image_url ? <img src={item.image_url} alt="" className="w-14 h-14 rounded-md object-cover shrink-0" /> : null}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium leading-tight">{item.name}</div>
        <div className="text-xs text-muted-foreground font-mono mt-0.5">{formatVND(item.price_vnd)}</div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {qty > 0 && <>
          <Button aria-label={`Giảm ${item.name}`} size="icon" variant="outline" className="h-8 w-8" onClick={dec}><Minus className="w-4 h-4" /></Button>
          <span className="w-6 text-center font-mono">{qty}</span>
        </>}
        <Button aria-label={`Thêm ${item.name}`} disabled={!canAdd} size="icon" className="h-8 w-8" onClick={add}><Plus className="w-4 h-4" /></Button>
      </div>
    </div>
  );
}

const CatChip = ({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) => (
  <button onClick={onClick}
    className={`text-xs px-3 py-1.5 rounded-full border ${active ? "bg-primary/10 border-primary/40 text-foreground" : "border-border text-muted-foreground"}`}>
    {children}
  </button>
);

// ── wait screen: cash → "server coming"; bank → VietQR + poll ──────────────────────────────────
function WaitScreen({ token, created, onReorder }: { token: string; created: FnbGuestCreateResult; onReorder: () => void }) {
  const { data: status, error, isLoading, isFetching, refetch } = useFnbGuestOrderStatus(token, created.order_id);
  if(error)return <div role="alert" className="space-y-3 py-10 text-center">
    <p>Không tải được trạng thái đơn. Đơn đã ghi nhận trước đó; không đặt lại để tránh trùng.</p>
    <Button variant="outline" disabled={isFetching} onClick={()=>void refetch()}>Tải lại trạng thái</Button>
  </div>;
  if(isLoading)return <div role="status" className="py-10 text-center text-muted-foreground">Đang kiểm tra trạng thái đơn…</div>;
  const st = status?.order?.order_status ?? "pending";
  // Never replace invoice instructions with current club-bank configuration,
  // or resurrect cached instructions when the server cannot verify the proof.
  const bank: FnbGuestBank | null = status?.bank_source==='snapshot' ? status.bank : null;

  if (st === "paid" || st === "shipped") {
    return (
      <div className="text-center space-y-3 py-10">
        <CheckCircle2 className="w-16 h-16 text-success mx-auto" />
        <div className="text-xl font-bold">{st==='shipped'?'Đã giao món!':'Đã nhận đơn!'}</div>
        <div className="text-sm text-muted-foreground">{st==='shipped'?'Đơn đã được giao. Cảm ơn bạn!':'Món của bạn đang được chuẩn bị. Cảm ơn bạn!'}</div>
        <Button variant="outline" className="mt-2" onClick={onReorder}>Gọi thêm món</Button>
      </div>
    );
  }
  if (st === "expired" || st === "cancelled") {
    return (
      <div className="text-center space-y-3 py-10">
        <Clock className="w-14 h-14 text-muted-foreground mx-auto" />
        <div className="text-lg font-bold">{st==='cancelled'?'Đơn đã hủy':'Đơn đã hết hạn'}</div>
        <div className="text-sm text-muted-foreground">
          {st==='cancelled'?'Đơn đã được hủy. Nếu đã thanh toán, vui lòng liên hệ nhân viên trước khi đặt lại.':created.payment_method === "bank_transfer"
            ? "Nếu bạn đã chuyển khoản, đơn sẽ được xác nhận trong ít phút — vui lòng báo nhân viên. Hoặc gọi lại đơn mới."
            : "Đơn chưa được thu tiền kịp thời. Vui lòng gọi lại."}
        </div>
        <Button className="mt-2" onClick={onReorder}>Gọi lại</Button>
      </div>
    );
  }

  // pending — cash vs bank
  if (created.payment_method === "cash") {
    return (
      <div className="text-center space-y-3 py-10">
        <Wallet className="w-14 h-14 text-primary mx-auto" />
        <div className="text-lg font-bold">Đã gửi đơn!</div>
        <div className="text-sm text-muted-foreground">Nhân viên phục vụ sẽ đến bàn thu tiền mặt. Vui lòng chờ trong giây lát.</div>
        <div className="font-mono text-lg">{formatVND(created.subtotal_vnd)}</div>
      </div>
    );
  }
  if(status?.bank_source!=='snapshot')return <div role="alert" className="space-y-3 py-10 text-center">
    <p>Chưa xác minh được thông tin ngân hàng của đơn. Vui lòng liên hệ nhân viên, không chuyển khoản hoặc đặt lại đơn.</p>
    <Button variant="outline" disabled={isFetching} onClick={()=>void refetch()}>Tải lại trạng thái</Button>
  </div>;

  // bank pending → VietQR
  const payload = (() => {
    if (!bank) return null;
    const bin = (bank.bank_bin && bank.bank_bin.trim()) || normalizeBankNameToBin(bank.bank_name);
    if (!bin || !created.reference_code) return null;
    try {
      return buildVietQrPayload({ bin, accountNumber: bank.account_number, amount: created.subtotal_vnd, memo: created.reference_code.toUpperCase() });
    } catch { return null; }
  })();
  const hasQr=!!payload||!!bank?.qr_code_url;

  return (
    <div className="space-y-3 py-2 text-center">
      <div className="text-lg font-bold">{hasQr?'Quét mã để chuyển khoản':'Đơn chuyển khoản đang chờ'}</div>
      <div className="text-sm text-muted-foreground">{hasQr?'Mở app ngân hàng, quét mã dưới đây. Số tiền và nội dung đã điền sẵn.':'Giữ mã đơn và nhờ nhân viên kiểm tra thông tin thanh toán.'}</div>
      <div className="flex justify-center">
        {payload
          ? <div className="bg-white p-3 rounded-xl"><QRCodeSVG value={payload} size={216} level="M" marginSize={2} /></div>
          : bank?.qr_code_url
            ? <img src={bank.qr_code_url} alt="QR" className="w-56 h-56 rounded-xl object-contain bg-white p-2" />
            : <div className="text-sm text-destructive py-8">Không tạo được mã QR. Vui lòng nhờ nhân viên kiểm tra đơn đang chờ; không đặt lại đơn.</div>}
      </div>
      <Card className="p-3 text-left text-sm space-y-1">
        <Row k="Ngân hàng" v={bank?.bank_name ?? "—"} />
        <Row k="Số tài khoản" v={bank?.account_number ?? "—"} mono />
        <Row k="Chủ tài khoản" v={bank?.account_holder ?? "—"} />
        <Row k="Số tiền" v={formatVND(created.subtotal_vnd)} mono />
        <Row k="Nội dung" v={created.reference_code ?? "—"} mono />
      </Card>
      <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Đang chờ xác nhận thanh toán… (tự động, có thể mất vài phút)
      </div>
      <p className="text-xs text-muted-foreground">Muốn hủy hoặc đổi cách thanh toán, vui lòng liên hệ nhân viên. Đơn vẫn đang chờ trên server.</p>
    </div>
  );
}

const Row = ({ k, v, mono }: { k: string; v: string; mono?: boolean }) => (
  <div className="flex justify-between gap-2">
    <span className="text-muted-foreground">{k}</span>
    <span className={mono ? "font-mono font-medium text-right break-all" : "font-medium text-right"}>{v}</span>
  </div>
);

// ── chrome-less shell (no Layout nav; guest phone) ─────────────────────────────────────────────
function GuestShell({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-md px-4 py-5">
        <div className="flex items-center gap-2 mb-4">
          <Utensils className="w-5 h-5 text-primary" />
          <div className="text-sm font-semibold truncate">{title ?? "Gọi món"}</div>
        </div>
        {children}
      </div>
    </div>
  );
}

function ErrorState({ msg }: { msg: string }) {
  return (
    <div className="text-center space-y-3 py-16">
      <QrCode className="w-14 h-14 text-muted-foreground mx-auto" />
      <div className="text-base font-semibold">Không mở được trang gọi món</div>
      <div className="text-sm text-muted-foreground">{msg}</div>
    </div>
  );
}
