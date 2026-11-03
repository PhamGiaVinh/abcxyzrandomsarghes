import {lazy,Suspense,useState} from 'react';
import {Link} from 'react-router-dom';
import {useTranslation} from 'react-i18next';
import {useAuth} from '@/hooks/useAuth';
import {Button} from '@/components/ui/button';
import {FEATURES} from '@/lib/featureFlags';
import {sessionReadEpoch} from '@/lib/sessionReadEpoch';
import {tournamentStatusLabel} from '@/lib/tournament/statusPresentation';

const CloseReportDialog=lazy(()=>import('@/components/cashier/tournament-live/CloseReportDialog'));
type Props={tournament:{id:string;club_id?:string|null;name:string;status:string};onChanged:()=>void};

/** Status is an observed fact, not a substitute for clock/settlement intents. */
export function TournamentLifecycleControls(props:Props){
 const {user,session,loading}=useAuth();
 return <ScopedLifecycleControls key={JSON.stringify([user?.id,sessionReadEpoch(session),loading,props.tournament.id,props.tournament.club_id])} {...props}/>;
}
function ScopedLifecycleControls({tournament,onChanged}:Props){
 const {user,loading}=useAuth();const {t}=useTranslation();const [closeOpen,setCloseOpen]=useState(false);
 const ready=!!user&&!loading&&!!tournament.club_id;
 const clock=`/ops/floor/tournaments/${encodeURIComponent(tournament.id)}/clock?club=${encodeURIComponent(tournament.club_id??'')}`;
 return <section className="space-y-2 text-sm" aria-label="Vòng đời giải">
  <p>Trạng thái giải: <span className="font-medium">{tournamentStatusLabel(tournament.status,t)}</span></p>
  <p className="text-xs text-muted-foreground">Bắt đầu, tạm dừng và tiếp tục tại Đồng hồ. Kết thúc qua Chốt giải để kiểm tra bàn, hand và kết quả; không đổi trạng thái trực tiếp.</p>
  <div className="flex flex-wrap gap-2">
   {ready?<Button asChild size="sm" variant="outline"><Link reloadDocument to={clock}>Đồng hồ &amp; bắt đầu giải</Link></Button>
    :<Button size="sm" variant="outline" disabled>Đồng hồ &amp; bắt đầu giải</Button>}
   {FEATURES.closeReport&&<Button size="sm" variant="outline" disabled={!ready} onClick={()=>setCloseOpen(true)}>
    {tournament.status==='completed'?'Xem báo cáo chốt giải':'Chốt giải'}
   </Button>}
  </div>
  {closeOpen&&ready&&<Suspense fallback={<p role="status">Đang tải báo cáo chốt giải…</p>}>
   <CloseReportDialog open={closeOpen} onOpenChange={setCloseOpen} tournamentId={tournament.id}
    tournamentName={tournament.name} onClosed={onChanged}/>
  </Suspense>}
 </section>;
}
