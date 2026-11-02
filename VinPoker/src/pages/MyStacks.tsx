import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDateTime, formatVND } from "@/lib/format";
import { Loader2, Ticket } from "lucide-react";
import { toast } from "sonner";
import { sessionReadEpoch } from "@/lib/sessionReadEpoch";
import { observeTrackerContextRead } from "@/lib/tournament/observeTrackerContextRead";
import { z } from "zod";
const registrationSchema = z.object({id:z.string().min(1),tournament_id:z.string().min(1),status:z.enum(['pending','confirmed','rejected','cancelled'])});
type RegistrationStatus = z.infer<typeof registrationSchema>['status'];
type StackRegistrationDisplay = {id:string;status:RegistrationStatus;tournament:{id:string;name:string;start_time:string;buy_in:number|null;club:{name:string}|null}|null}
 & ({kind:'legacy'}|{kind:'cashier';total_pay:number;reference_code:string});
const validVnd=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
const cashierRegistrationSchema=registrationSchema.extend({total_pay:z.number().refine(validVnd),reference_code:z.string().refine(v=>!!v.trim())});
const tournamentSchema=z.object({id:z.string().min(1),name:z.string(),start_time:z.string().refine(v=>Number.isFinite(Date.parse(v))),buy_in:z.unknown(),club:z.object({name:z.string()}).nullable()});

const MyStacks = () => {
  const {user,session}=useAuth();
  return <ScopedMyStacks key={JSON.stringify([user?.id,sessionReadEpoch(session)])}/>;
};

const ScopedMyStacks = () => {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const userId=user?.id;
  const nav = useNavigate();
  const [regs, setRegs] = useState<StackRegistrationDisplay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const alive = useRef(true), sequence = useRef(0);
  useEffect(() => {alive.current=true;return()=>{alive.current=false;};},[]);

  const load = useCallback(async () => {
    if(!alive.current)return;
    if (!userId) { setLoading(false); return; }
    const seq=++sequence.current;
    setLoading(true);
    try {
    const [legacy,current] = await observeTrackerContextRead(Promise.all([supabase.from("stack_registrations")
      .select("id,status,tournament_id")
      .eq("user_id", userId).order("created_at", { ascending: false }),
      supabase.from('tournament_registrations')
        .select('id,status,tournament_id,total_pay,reference_code')
        .eq('player_id',userId).order('created_at',{ascending:false})]));
    if(!alive.current||seq!==sequence.current)return;
    if(legacy.error||current.error||!Array.isArray(legacy.data)||!Array.isArray(current.data))throw Error('registration_read_failed');
    const legacyRows=z.array(registrationSchema).parse(legacy.data),currentRows=z.array(cashierRegistrationSchema).parse(current.data);
    const ids=[...new Set([...legacyRows,...currentRows].map(r=>r.tournament_id))];
    // Registration tables have no tournament foreign key; read referenced IDs under normal RLS.
    const tournaments=ids.length?await observeTrackerContextRead(supabase.from('tournaments')
      .select('id,name,start_time,buy_in,club:clubs(name)').in('id',ids)):{data:[],error:null};
    if(!alive.current||seq!==sequence.current)return;
    if(tournaments.error)throw Error('registration_tournament_read_failed');
    const tourRows=z.array(tournamentSchema).parse(tournaments.data);
    if(new Set(tourRows.map(r=>r.id)).size!==tourRows.length||tourRows.some(r=>!ids.includes(r.id)))throw Error('registration_tournament_scope_invalid');
    const tours=new Map(tourRows.map(r=>[r.id,{id:r.id,name:r.name,start_time:r.start_time,
      buy_in:validVnd(r.buy_in)?r.buy_in:null,club:r.club===null?null:{name:r.club.name}}]));
    if(ids.some(id=>!tours.has(id)))throw Error('registration_tournament_missing');
    setRegs([...currentRows.map(r=>({id:r.id,status:r.status,tournament:tours.get(r.tournament_id),kind:'cashier' as const,total_pay:r.total_pay,reference_code:r.reference_code})),
      ...legacyRows.map(r=>({id:r.id,status:r.status,tournament:tours.get(r.tournament_id),kind:'legacy' as const}))]);setError(false);
    } catch {
      if(!alive.current||seq!==sequence.current)return;
      setRegs([]);setError(true);
    } finally {
      if(alive.current&&seq===sequence.current)setLoading(false);
    }
  },[userId]);

  useEffect(() => {
    if (!authLoading) load();
    if (!userId) return;
    const interval = window.setInterval(() => {if(document.visibilityState==='visible'&&navigator.onLine)void load();}, 30_000);
    const onVis = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [userId, authLoading, load]);

  const cancel = async (id: string) => {
    const { error } = await supabase.from("stack_registrations").update({ status: "cancelled" }).eq("id", id);
    if (error) toast.error(error.message); else { toast.success(t("myStacks.cancelled")); load(); }
  };

  if (authLoading || loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;

  if (!user) return (
    <Card className="p-6 text-center gradient-card border-gold shadow-card">
      <Ticket className="w-10 h-10 mx-auto text-gold mb-2" />
      <h2 className="font-display text-lg">{t("myStacks.signInTitle")}</h2>
      <p className="text-sm text-muted-foreground mt-1">{t("myStacks.signInDesc")}</p>
      <Button onClick={() => nav("/auth")} className="mt-4 gradient-gold text-primary-foreground border-0">{t("myStacks.signIn")}</Button>
    </Card>
  );

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl text-gold">{t("myStacks.title")}</h1>
      {error ? <Card role="alert" className="p-6 space-y-3">
        <p>Không tải được danh sách đăng ký. Chưa thể xác minh dữ liệu mới nhất.</p>
        <Button variant="outline" onClick={()=>{void load();}}>Thử lại</Button>
      </Card> : regs.length === 0 ? (
        <Card className="p-6 text-center text-muted-foreground">{t("myStacks.empty")} <Link to="/" className="text-gold underline">{t("myStacks.viewTournaments")}</Link></Card>
      ) : regs.map(r => (
        <Card key={`${r.kind}:${r.id}`} className="gradient-card p-4 border-border">
          <div className="flex items-start justify-between gap-2">
            <Link to={`/tournament/${r.tournament?.id}`} className="min-w-0 flex-1">
              <h3 className="font-semibold break-words [overflow-wrap:anywhere]">{r.tournament?.name}</h3>
              <p className="text-xs text-muted-foreground">{r.tournament?.club?.name} · {formatDateTime(r.tournament?.start_time)}</p>
              {r.kind==='cashier'?<>
                <p className="text-xs text-muted-foreground mt-1">Mã đăng ký: {r.reference_code}</p>
                <p className="text-xs text-gold mt-1">Tổng phải trả: {formatVND(r.total_pay)}</p>
              </>:<p className="text-xs text-gold mt-1">{validVnd(r.tournament?.buy_in)?formatVND(r.tournament.buy_in):'Chưa xác minh giá'} · Đăng ký legacy</p>}
            </Link>
            <StatusBadge status={r.status} />
          </div>
          {r.kind==='legacy' && r.status === "pending" && (
            <Button variant="outline" size="sm" className="mt-3 w-full border-destructive/40 text-destructive hover:bg-destructive/10" onClick={() => cancel(r.id)}>
              {t("myStacks.cancelReg")}
            </Button>
          )}
        </Card>
      ))}
    </div>
  );
};

export default MyStacks;
