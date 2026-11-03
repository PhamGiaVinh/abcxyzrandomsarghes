import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import type { PublicPlayerHudData } from '@/lib/publicPlayerHud';
import type { TrackerAnalyticsMetric } from '@/lib/trackerVoice/analytics';
import { formatChips } from '@/lib/tv/format';
import {PlayerHandHistory} from './PlayerHandHistory';
import {PublicPlayerHudHelp} from './PublicPlayerHudHelp';
import {PUBLIC_HUD_METRIC_INFO,type PublicHudMetricKey} from '@/lib/publicPlayerHudMetrics';

type MetricDisplayProps={label:string;metric?:TrackerAnalyticsMetric;metricKey:PublicHudMetricKey;onExplain:(key:PublicHudMetricKey)=>void};
function Ring({label,metric,metricKey,onExplain}:MetricDisplayProps) {
  const value=metric?.percentage,info=PUBLIC_HUD_METRIC_INFO[metricKey];
  return <button type="button" className="min-h-11 rounded-lg p-1 text-center hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" aria-label={`Giải thích ${info.label}`} onClick={()=>onExplain(metricKey)} title={`${info.title}${metric?` · ${metric.numerator}/${metric.denominator} cơ hội`:''}`}>
    <span className="relative mx-auto flex h-16 w-16 items-center justify-center">
      <svg viewBox="0 0 64 64" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden="true"><circle cx="32" cy="32" r="28" fill="none" stroke="currentColor" strokeWidth="3" className="text-muted"/>{value!=null&&<circle cx="32" cy="32" r="28" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray={`${value*1.7593} 175.93`} className={info.color}/>}</svg>
      <strong className="font-mono text-xl">{value==null?'—':`${Math.round(value)}%`}</strong>
    </span><span className="mt-1 block text-xs font-semibold">{label}</span>
  </button>;
}
function Bar({label,metric,metricKey,onExplain}:MetricDisplayProps) {
  const info=PUBLIC_HUD_METRIC_INFO[metricKey];
  return <button type="button" className="grid min-h-11 w-full grid-cols-[3.5rem_1fr_3rem] items-center gap-2 rounded px-1 text-left text-xs hover:bg-background/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" aria-label={`Giải thích ${info.label}`} onClick={()=>onExplain(metricKey)} title={metric?`${metric.numerator}/${metric.denominator} cơ hội`:'Chưa có dữ liệu đã xác minh'}>
    <span>{label}</span><span className={`h-4 overflow-hidden rounded-sm bg-background ${info.color}`}>{metric?.percentage!=null&&<span className="block h-full bg-current" style={{width:`${metric.percentage}%`}}/>}</span><span className="text-right font-mono">{metric?.percentage==null?'—':`${Math.round(metric.percentage)}%`}</span>
  </button>;
}
function RecentResultChart({results}:{results:NonNullable<PublicPlayerHudData['recentResults']>}) {
  const ordered=[...results].reverse();
  const y=(r:typeof results[number])=>r.position==null?null:r.position===1?20:r.position<=9?50:r.prize>0?80:r.total_entries && r.position<=Math.ceil(r.total_entries/2)?110:140;
  return <svg viewBox="0 0 480 170" className="mt-3 w-full text-muted-foreground" role="img" aria-label="Kết quả năm giải công khai gần nhất; Top 9 không đồng nghĩa bàn final">
    {['Won','Top 9','ITM','Top 50%','Khác'].map((label,i)=><g key={label}><text x="0" y={24+i*30} fill="currentColor" fontSize="12">{label}</text><line x1="70" x2="470" y1={20+i*30} y2={20+i*30} stroke="currentColor" opacity=".2" /></g>)}
    {ordered.map((r,i)=>{const point=y(r);return point==null?null:<g key={`${r.event_date}-${i}`}><title>{r.tournament_name}: hạng {r.position}</title><circle cx={95+i*85} cy={point} r="5" fill="hsl(var(--primary))" /><text x={95+i*85} y="165" textAnchor="middle" fill="currentColor" fontSize="10">{i+1}</text></g>;})}
  </svg>;
}
export function PublicPlayerHud({ tournamentId, playerId, onClose }: {tournamentId: string; playerId: string | null; onClose: () => void}) {
  const [helpOpen,setHelpOpen]=useState(false);
  const [helpMetric,setHelpMetric]=useState<PublicHudMetricKey>('vpip');
  const explain=(key:PublicHudMetricKey)=>{setHelpMetric(key);setHelpOpen(true);};
  const [progress,setProgress]=useState(0);
  const [result, setResult] = useState<PublicPlayerHudData | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    setResult(null); setError(false);setProgress(0);setHelpOpen(false);
    if (!playerId) return;
    const controller = new AbortController();
    void import('@/lib/publicPlayerHud').then(({loadPublicPlayerHud}) => {
      if (controller.signal.aborted) throw new Error('aborted');
      return loadPublicPlayerHud(tournamentId,playerId,controller.signal,hands=>{if(!controller.signal.aborted)setProgress(hands);});
    }).then(value => {
      if (!controller.signal.aborted) setResult(value);
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [tournamentId, playerId]);
  // Scope on render as well as cleanup: never flash the previous person's statistics.
  const current = result?.playerId === playerId && result?.tournamentId === tournamentId ? result : null;
  const metrics = current?.analytics.metrics;
  return <Dialog open={playerId != null} onOpenChange={open => { if (!open) onClose(); }}><DialogContent className="operations-typography max-h-[90svh] max-w-xl overflow-y-auto border-border bg-card p-5 text-foreground">
    <DialogTitle className="flex items-center gap-4 pr-8"><Avatar className="h-16 w-16"><AvatarImage src={current?.avatarUrl ?? undefined} alt="" /><AvatarFallback>{current?.name.slice(0,2) ?? '?'}</AvatarFallback></Avatar><span>{current?.name ?? 'Thống kê người chơi'}</span></DialogTitle>
    <DialogDescription>Chỉ số cộng dồn toàn bộ hand hoàn tất được công khai qua tất cả tour. Lịch sử stack và replay chỉ thuộc tour đang xem.</DialogDescription>
    {error ? <p role="alert">Không tải được thống kê công khai. Hãy đóng và mở lại để thử.</p> : !current ? <p role="status">Đang tổng hợp toàn bộ lịch sử… {progress>0 ? `${progress.toLocaleString('vi-VN')} hand đã xử lý` : ''}</p> : <>
      <PlayerHandHistory tournamentId={tournamentId} hands={current.handHistory ?? []}/>
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">Chỉ số cộng dồn · Tất cả tour</h3><button type="button" onClick={()=>setHelpOpen(true)} className="min-h-11 rounded-md border border-border px-3 text-xs font-semibold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">Giải thích các chỉ số</button></div>
      <div className="grid grid-cols-4 gap-2"><Ring label="VPIP" metric={metrics.vpip} metricKey="vpip" onExplain={explain} /><Ring label="PFR" metric={metrics.pfr} metricKey="pfr" onExplain={explain} /><Ring label="ATS" metric={metrics.ats} metricKey="ats" onExplain={explain} /><Ring label="3-BET" metric={metrics.threeBet} metricKey="threeBet" onExplain={explain} /></div>
      <div className="grid grid-cols-1 gap-4 rounded-lg bg-muted/40 p-3 sm:grid-cols-3">
        <section className="space-y-3"><h3 className="text-center text-sm font-bold">FLOP</h3><Bar label="C-Bet" metric={metrics.flopCbet} metricKey="flopCbet" onExplain={explain} /><Bar label="Fold CB" metric={metrics.flopFoldCbet} metricKey="flopFoldCbet" onExplain={explain} /><Bar label="Call CB" metric={metrics.flopCallCbet} metricKey="flopCallCbet" onExplain={explain} /><Bar label="Raise CB" metric={metrics.flopRaiseCbet} metricKey="flopRaiseCbet" onExplain={explain} /></section>
        <section className="space-y-3"><h3 className="text-center text-sm font-bold">TURN</h3><Bar label="C-Bet" metric={metrics.turnCbet} metricKey="turnCbet" onExplain={explain} /><Bar label="Fold CB" metric={metrics.turnFoldCbet} metricKey="turnFoldCbet" onExplain={explain} /><Bar label="Call CB" metric={metrics.turnCallCbet} metricKey="turnCallCbet" onExplain={explain} /><Bar label="Raise CB" metric={metrics.turnRaiseCbet} metricKey="turnRaiseCbet" onExplain={explain} /></section>
        <section className="space-y-3"><h3 className="text-center text-sm font-bold">RIVER / SD</h3><Bar label="WTSD" metric={metrics.wtsd} metricKey="wtsd" onExplain={explain} /><Bar label="W$SD" metric={metrics.wsd} metricKey="wsd" onExplain={explain} /><Bar label="TAF*" metric={metrics.riverAggression} metricKey="riverAggression" onExplain={explain} /><button type="button" onClick={()=>explain('hands')} aria-label="Giải thích HANDS" className="flex min-h-11 w-full items-center justify-between rounded px-1 text-xs hover:bg-background/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><span>HANDS</span><strong className="font-mono">{current.analytics.handsObserved.toLocaleString('vi-VN')}</strong></button></section>
      </div>
      <p className="text-xs text-muted-foreground">Toàn bộ lịch sử công khai: {current.lifetimeHands?.toLocaleString('vi-VN') ?? '—'} hand qua tất cả tour, không giới hạn số hand. HANDS là số ván đủ bằng chứng để tính chỉ số. Mỗi tỷ lệ dùng số cơ hội riêng; mẫu nhỏ chưa đại diện phong cách chơi. *TAF = bet/raise trên các quyết định bet/raise/call/fold ở river. WTSD và W$SD tính theo các ván thấy flop/showdown.</p>
      {!!current.omittedHands && <p className="text-xs text-amber-400">Bỏ qua {current.omittedHands} ván lịch sử thiếu bằng chứng hành động preflop.</p>}
      <section className="rounded-lg border border-border p-4"><h3 className="text-sm font-semibold">Total Winnings <strong className="float-right font-mono text-primary">{current.totalWinnings == null ? '—' : `${formatChips(current.totalWinnings)} ₫`}</strong></h3><p className="mt-2 text-xs text-muted-foreground">Tổng tiền thưởng trong các kết quả được xác minh và công khai; không phải lợi nhuận.</p><h4 className="mt-5 text-sm">Last 5 Tournaments</h4>{current.recentResults?.length ? <><RecentResultChart results={current.recentResults}/><ol className="mt-3 space-y-3">{current.recentResults.map((r,i)=><li key={`${r.event_date}-${i}`} className="flex justify-between gap-3 border-t border-border pt-2 text-xs"><span>{r.tournament_name}<span className="block text-muted-foreground">{r.event_date}</span></span><span className="text-right font-mono">{r.position == null ? '—' : `#${r.position}`}{r.total_entries ? ` / ${r.total_entries}` : ''}<span className="block text-primary">{formatChips(r.prize)} ₫</span></span></li>)}</ol></> : <p className="mt-3 text-sm text-muted-foreground">Chưa có kết quả công khai đã xác minh.</p>}</section>
      <p className="text-xs text-muted-foreground">Ô — nghĩa là chưa có cơ hội hoặc dữ liệu đã xác minh, không phải 0%. Không suy ra tiền thắng từ thay đổi stack.</p>
      <Dialog open={helpOpen} onOpenChange={setHelpOpen}><DialogContent className="operations-typography max-h-[90svh] max-w-xl overflow-y-auto border-border bg-card p-5 text-foreground"><DialogTitle>Giải thích chỉ số HUD</DialogTitle><DialogDescription>Bấm tên chỉ số để xem định nghĩa, cách tính và số cơ hội thực tế.</DialogDescription><PublicPlayerHudHelp selected={helpMetric} metrics={metrics} hands={current.analytics.handsObserved} onSelect={setHelpMetric}/></DialogContent></Dialog>
    </>}
  </DialogContent></Dialog>;
}
