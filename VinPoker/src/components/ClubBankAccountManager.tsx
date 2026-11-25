import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { useAuth } from "@/hooks/useAuth";
import { sessionReadEpoch } from "@/lib/sessionReadEpoch";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Image as ImageIcon, Save, CreditCard } from "lucide-react";
import { toast } from "sonner";
import { compressImage } from "@/lib/compressImage";
import { VN_BANKS } from "@/lib/vietnamBanks";

type Account = {
  id: string;
  bank_name: string;
  bank_bin: string | null;
  account_number: string;
  account_holder: string;
  qr_code_url: string | null;
  notes: string | null;
  is_active: boolean;
  account_type: string;
  club_id: string;
};

interface Props {
  clubId: string;
}

const accountPacket=z.object({
  id:z.string().uuid(),club_id:z.string().uuid(),account_type:z.literal('escrow'),
  bank_name:z.string(),bank_bin:z.string().nullable(),account_number:z.string(),account_holder:z.string(),
  qr_code_url:z.string().nullable(),notes:z.string().nullable(),is_active:z.boolean(),
});
const savedPacket=z.object({id:z.string().uuid(),club_id:z.string().uuid(),account_type:z.literal('escrow')});
const createPacket=z.object({version:z.literal(1),actor:z.string().min(1),club:z.string().uuid(),
  id:z.string().uuid(),payload:accountPacket.omit({id:true,club_id:true}).strict()}).strict();
type CreateIntent=z.infer<typeof createPacket>;
const accountColumns='id,club_id,account_type,bank_name,bank_bin,account_number,account_holder,qr_code_url,notes,is_active';
const samePayload=(account:Account,intent:CreateIntent)=>Object.entries(intent.payload).every(([key,value])=>account[key as keyof Account]===value);
const emptyForm=()=>({bank_name:'',bank_bin:null as string|null,account_number:'',account_holder:'',qr_code_url:null as string|null,notes:'',is_active:true});
export const ClubBankAccountManager=({clubId}:Props)=>{
  const {user,session,loading,isAdmin,isClubAdmin,isClubOwner,isCashier,isAccountant}=useAuth();
  if(loading)return <Card className="p-4" role="status">Đang xác minh phiên đăng nhập…</Card>;
  if(!user?.id||!session?.access_token)return <Card className="p-4" role="alert">Đăng nhập để xem cấu hình tài khoản của CLB.</Card>;
  const scope=JSON.stringify([user.id,sessionReadEpoch(session),clubId,isAdmin,isClubAdmin,isClubOwner,isCashier,isAccountant]);
  return <ScopedBankAccount key={scope} clubId={clubId} actor={user.id}/>;
};
function ScopedBankAccount({clubId,actor}:Props&{actor:string}){
  const [acc, setAcc] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [readError,setReadError]=useState(false);
  const [pending,setPending]=useState<CreateIntent|null>(null);
  const journalKey=`vinpoker:bank-create:v1:${actor}:${clubId}`;
  const readIntent=useCallback(()=>{
    const raw=sessionStorage.getItem(journalKey);
    if(raw===null)return null;
    const intent=createPacket.parse(JSON.parse(raw));
    if(intent.actor!==actor||intent.club!==clubId)throw Error('create scope invalid');
    return intent;
  },[journalKey,actor,clubId]);
  const clearIntent=useCallback((intent:CreateIntent)=>{
    const current=readIntent();
    if(current&&JSON.stringify(current)!==JSON.stringify(intent))throw Error('create journal changed');
    sessionStorage.removeItem(journalKey);
    if(sessionStorage.getItem(journalKey)!==null)throw Error('create journal not cleared');
    setPending(null);
  },[readIntent,journalKey]);
  const alive=useRef(true),generation=useRef(0),saveFlight=useRef(false),uploadFlight=useRef(false);
  const [form, setForm] = useState({
    bank_name: "", bank_bin: null as string | null, account_number: "", account_holder: "",
    qr_code_url: null as string | null, notes: "", is_active: true,
  });

  const load = useCallback(async () => {
    const request=++generation.current;
    setLoading(true);setReadError(false);setAcc(null);setForm(emptyForm());
    try{
    if(!z.string().uuid().safeParse(clubId).success)throw Error('invalid club');
    const intent=readIntent();setPending(intent);
    const query = supabase
      .from("platform_bank_accounts")
      .select(accountColumns)
      .eq("club_id", clubId)
      .eq("account_type", "escrow");
    const {data,error}=await (intent?query.eq('id',intent.id):query.order('created_at',{ascending:true}).limit(1)).maybeSingle();
    if(!alive.current||request!==generation.current)return;
    if(error)throw Error('read refused');
    if (data!==null) {
      // Runtime Zod validation is authoritative; this project disables strict
      // null checks, which otherwise makes inferred object keys appear optional.
      const account=accountPacket.parse(data) as Account;
      if(account.club_id!==clubId)throw Error('wrong club');
      if(intent){
        if(account.id!==intent.id||!samePayload(account,intent))throw Error('create receipt differs');
        clearIntent(intent);
      }
      setAcc(account);
      setForm({
        bank_name: account.bank_name,
        bank_bin: account.bank_bin,
        account_number: account.account_number,
        account_holder: account.account_holder,
        qr_code_url: account.qr_code_url,
        notes: account.notes ?? "",
        is_active: account.is_active,
      });
    } else {
      setAcc(null);
      setForm(intent?{...intent.payload,notes:intent.payload.notes??''} as ReturnType<typeof emptyForm>:emptyForm());
    }
    }catch{
      if(alive.current&&request===generation.current){setReadError(true);setAcc(null);setForm(emptyForm());}
    }finally{if(alive.current&&request===generation.current)setLoading(false);}
  },[clubId,readIntent,clearIntent]);

  useEffect(() => {alive.current=true;void load();return()=>{alive.current=false;};}, [load]);

  const uploadQR = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input=e.currentTarget,raw = input.files?.[0];
    if (!raw||uploadFlight.current||saveFlight.current||loading||readError) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(raw.type)) {
      toast.error("Chỉ JPG/PNG/WEBP"); return;
    }
    uploadFlight.current=true;setUploading(true);
    try {
      const file = await compressImage(raw, { maxEdge: 800, quality: 0.85 });
      if(!alive.current)return;
      const ext = file.type === "image/png" ? "png" : "jpg";
      // First folder MUST be the bare club id: the bank-qr-codes storage RLS policy
      // checks (storage.foldername(name))[1] IN clubs.id::text for owner_id=auth.uid().
      // A "club-" prefix breaks that match → "violates row-level security policy".
      const path = `${clubId}/${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("bank-qr-codes")
        .upload(path, file, { contentType: file.type, cacheControl: "3600", upsert: false });
      if(!alive.current)return;
      if (error) throw error;
      const { data: pub } = supabase.storage.from("bank-qr-codes").getPublicUrl(path);
      setForm((f) => ({ ...f, qr_code_url: pub.publicUrl }));
      toast.success("Đã tải QR");
    } catch {
      if(alive.current)toast.error("Không tải được QR. Kiểm tra lại quyền và kết nối.");
    } finally {
      uploadFlight.current=false;if(alive.current)setUploading(false);
      input.value = "";
    }
  };

  const save=async()=>{
    if(saveFlight.current||uploadFlight.current||loading||readError||!alive.current)return;
    const snapshot={...form},account=acc;
    if(!snapshot.bank_name.trim()||!snapshot.account_number.trim()||!snapshot.account_holder.trim()){
      toast.error('Vui lòng điền đầy đủ tên ngân hàng, số tài khoản và chủ tài khoản');return;
    }
    saveFlight.current=true;setSaving(true);
    try{
      if(account&&(account.club_id!==clubId||account.account_type!=='escrow'))throw Error('wrong account');
      const payload={bank_name:snapshot.bank_name.trim(),bank_bin:snapshot.bank_bin||null,
        account_number:snapshot.account_number.trim(),account_holder:snapshot.account_holder.trim(),
        qr_code_url:snapshot.qr_code_url,notes:snapshot.notes||null,is_active:snapshot.is_active,account_type:'escrow'};
      let intent:CreateIntent|null=null;
      if(!account){
        intent=readIntent();
        if(intent&&Object.entries(intent.payload).some(([key,value])=>payload[key as keyof typeof payload]!==value))throw Error('pending create differs');
        intent=intent??createPacket.parse({version:1,actor,club:clubId,id:crypto.randomUUID(),payload});
        sessionStorage.setItem(journalKey,JSON.stringify(intent));
        if(sessionStorage.getItem(journalKey)!==JSON.stringify(intent))throw Error('create journal unavailable');
        setPending(intent);
      }
      const query=account
        ?supabase.from('platform_bank_accounts').update(payload).eq('id',account.id).eq('club_id',clubId).eq('account_type','escrow')
        :supabase.from('platform_bank_accounts').insert({...payload,id:intent!.id,club_id:clubId});
      let {data,error}=await query.select('id,club_id,account_type').maybeSingle();
      if(!alive.current)return;
      // A previous identical INSERT may have committed despite a missing ACK.
      // Never upsert/overwrite: recover only our exact id and verified contents.
      if(intent&&error?.code==='23505'){
        const recovered=await supabase.from('platform_bank_accounts').select(accountColumns)
          .eq('id',intent.id).eq('club_id',clubId).eq('account_type','escrow').maybeSingle();
        if(!alive.current)return;
        const verified=accountPacket.parse(recovered.data) as Account;
        if(recovered.error||verified.id!==intent.id||verified.club_id!==clubId||!samePayload(verified,intent))throw Error('create recovery unverified');
        data=verified;error=null;
      }
      if(error)throw Error('save refused');
      const saved=savedPacket.parse(data);
      if(saved.club_id!==clubId||saved.id!==(account?.id??intent?.id))throw Error('save not confirmed');
      if(intent)clearIntent(intent);
      toast.success(account?'Đã cập nhật':'Đã tạo tài khoản');await load();
    }catch{
      if(alive.current){setReadError(true);setAcc(null);setForm(emptyForm());toast.error('Chưa xác minh được kết quả lưu. Kiểm tra lại trước khi ghi tiếp.');}
    }finally{saveFlight.current=false;if(alive.current)setSaving(false);}
  };

  if (loading) return <Card className="p-4" role="status"><Loader2 className="w-5 h-5 animate-spin text-primary" /><span className="sr-only">Đang tải tài khoản CLB</span></Card>;

  if(readError)return <Card role="alert" className="p-4 space-y-3 text-sm">
    <p>Chưa xác minh được tài khoản nhận tiền của CLB. Không tạo hoặc sửa tài khoản khi chưa tải lại thành công.</p>
    <Button variant="outline" onClick={()=>void load()}>Kiểm tra lại</Button>
  </Card>;

  const knownBins = new Set(VN_BANKS.map((b) => b.bin));
  const bankSelectValue = form.bank_bin && knownBins.has(form.bank_bin) ? form.bank_bin : "other";

  return (
    <Card className="p-4 space-y-3 border-primary/30">
      <div className="flex items-center gap-2">
        <CreditCard className="w-4 h-4 text-primary" />
        <h3 className="font-display text-primary">Tài khoản ngân hàng & QR thanh toán</h3>
      </div>
      <p className="text-xs text-muted-foreground">
        Áp dụng cho: <b>đăng ký giải</b> & <b>stake</b>. Player sẽ chuyển khoản trực tiếp vào tài khoản này của CLB.
      </p>

      {pending&&<p role="status" className="text-sm break-words">Yêu cầu tạo trước chưa được xác minh. Giữ nguyên nội dung và thử lại cùng yêu cầu để tránh tạo trùng tài khoản.</p>}
      <fieldset disabled={saving||uploading||!!pending} className="min-w-0 space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <Label htmlFor={`bank-select-${clubId}`}>Ngân hàng *</Label>
          <Select
            value={bankSelectValue}
            onValueChange={(v) => {
              if (v === "other") { setForm({ ...form, bank_bin: null }); return; }
              const b = VN_BANKS.find((x) => x.bin === v);
              if (b) setForm({ ...form, bank_name: b.shortName, bank_bin: b.bin });
            }}
          >
            <SelectTrigger id={`bank-select-${clubId}`}><SelectValue placeholder="Chọn ngân hàng" /></SelectTrigger>
            <SelectContent>
              {VN_BANKS.map((b) => (
                <SelectItem key={b.bin} value={b.bin}>{b.shortName} · {b.bin}</SelectItem>
              ))}
              <SelectItem value="other">Khác (tự nhập)</SelectItem>
            </SelectContent>
          </Select>
          {bankSelectValue === "other" && (
            <Input aria-label="Tên ngân hàng" className="mt-2" value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} placeholder="VD: Vietcombank" />
          )}
          {bankSelectValue !== "other" && (
            <p className="text-[10px] text-muted-foreground mt-1">Mã QR VietQR động sẽ dùng mã ngân hàng này.</p>
          )}
        </div>
        <div>
          <Label htmlFor={`bank-number-${clubId}`}>Số tài khoản *</Label>
          <Input id={`bank-number-${clubId}`} value={form.account_number} onChange={(e) => setForm({ ...form, account_number: e.target.value })} />
        </div>
        <div className="md:col-span-2">
          <Label htmlFor={`bank-holder-${clubId}`}>Chủ tài khoản *</Label>
          <Input id={`bank-holder-${clubId}`} value={form.account_holder} onChange={(e) => setForm({ ...form, account_holder: e.target.value })} />
        </div>
        <div className="md:col-span-2">
          <Label htmlFor={`bank-notes-${clubId}`}>Ghi chú (không bắt buộc)</Label>
          <Textarea id={`bank-notes-${clubId}`} rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>
      </div>

      <div>
        <Label>QR thanh toán</Label>
        <div className="flex items-center gap-3 mt-1">
          {form.qr_code_url
            ? <img src={form.qr_code_url} alt="qr" className="w-24 h-24 rounded border border-border object-cover" />
            : <div className="w-24 h-24 rounded border border-dashed border-border flex items-center justify-center text-muted-foreground"><ImageIcon className="w-6 h-6" /></div>}
          <input id={`qr-up-${clubId}`} type="file" hidden accept="image/jpeg,image/png,image/webp" onChange={uploadQR} />
          <Button asChild size="sm" variant="outline" disabled={uploading}>
            <label htmlFor={`qr-up-${clubId}`} className="cursor-pointer">
              {uploading ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <ImageIcon className="w-3.5 h-3.5 mr-1" />}
              {form.qr_code_url ? "Thay QR" : "Tải QR"}
            </label>
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <Label>Đang hoạt động</Label>
        <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
      </div>

      </fieldset>
      <div className="flex justify-end">
        <Button onClick={save} disabled={saving || uploading} className="gradient-neon text-primary-foreground min-h-11">
          {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
          {pending?'Thử lại cùng yêu cầu':'Lưu'}
        </Button>
      </div>
    </Card>
  );
};
