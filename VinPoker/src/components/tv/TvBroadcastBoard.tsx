import type { TvData } from '@/types/tv';
import { formatClock, formatChips, bigBlindsOf } from '@/lib/tv/format';
import { mapTvDataToClock } from '@/lib/tv/mapClockData';
import { TvBrandingOverlay } from '@/components/tournament-clock/TvBrandingOverlay';
import '@/components/tournament-clock/vinPokerClock.css';
import './tvBroadcastBoard.css';
import { useTvStackRange } from '@/hooks/useTvStackRange';

/** Read-only broadcast composition. Unknown extrema must never be inferred from an average. */
export function TvBroadcastBoard({ data }: { data: TvData }) {
  const clock = mapTvDataToClock(data);
  const range = useTvStackRange(data.tournamentId, data.playersRemaining, data.totalChips);
  const paid = data.prizes.length ? new Set(data.prizes.filter(p => p.amount > 0 && Number.isSafeInteger(p.position) && p.position > 0).map(p => p.position)).size : null;
  const stack = (value: number | null | undefined) => {
    if (value == null) return '—';
    const bb = bigBlindsOf(value, data.currentLevel?.bigBlind);
    return `${formatChips(value)}${bb == null ? '' : ` (${bb} BB)`}`;
  };
  return <section className="tv-broadcast" aria-label="Bảng thông số giải đấu" style={data.clubCoverUrl ? {backgroundImage:`linear-gradient(#171305ed,#171305ed),url("${data.clubCoverUrl}")`,backgroundSize:'cover',backgroundPosition:data.brandingLayout ? `${data.brandingLayout.backgroundX}% ${data.brandingLayout.backgroundY}%` : 'center'} : undefined}>
    {data.brandingLayout && <TvBrandingOverlay layout={data.brandingLayout} logoUrl={data.clubLogoUrl} brandName={data.brandName ?? data.clubName} />}
    <header className="tv-broadcast-title">
      {data.clubLogoUrl && !data.brandingLayout && <img src={data.clubLogoUrl} alt={data.clubName} />}
      <h1>{data.tournamentName}</h1>
      <span>{data.brandName || data.clubName}</span>
    </header>
    <aside className="tv-broadcast-summary">
      <div><h2>Total Prize</h2><strong className="tv-broadcast-gold">{clock.prizePool}</strong></div>
      <div><h2>Places Paid</h2><strong className="tv-broadcast-green">{paid == null ? '—' : formatChips(paid)}</strong></div>
      <div><h2>Players Left / Entries</h2><strong className="tv-broadcast-green">{formatChips(data.playersRemaining)} / {formatChips(data.totalEntries)}</strong></div>
    </aside>
    <main className="tv-broadcast-clock">
      <h2>{data.isBreak ? 'Break' : clock.levelLabel}</h2>
      <div className="tv-broadcast-time" role="timer" aria-label="Thời gian còn lại">{formatClock(data.remainingSeconds)}</div>
      <h2>Blinds{data.currentLevel?.ante ? ' (Ante)' : ''}</h2>
      <strong className="tv-broadcast-blinds">{clock.currentLevel}</strong>
      <h2>Next</h2><p className="tv-broadcast-next">{clock.nextLevel}</p>
      <div className="tv-broadcast-break"><span>Next Break</span><strong>{clock.nextBreakSecondsLeft == null ? '—' : formatClock(clock.nextBreakSecondsLeft)}</strong></div>
      <p className="tv-broadcast-note">{clock.terminalStatus ? clock.levelLabel : data.isRunning ? 'Đang diễn ra' : 'Đồng hồ đang tạm dừng'}</p>
      <div className="tv-broadcast-stacks">
        <div><h2>Largest Stack</h2><strong title={range == null ? 'Chưa có dữ liệu tổng hợp đã xác minh' : undefined}>{stack(range?.largest ?? data.largestStack)}</strong></div>
        <div><h2>Average Stack</h2><strong>{stack(data.averageStack)}</strong></div>
        <div><h2>Smallest Stack</h2><strong title={range == null ? 'Chưa có dữ liệu tổng hợp đã xác minh' : undefined}>{stack(range?.smallest ?? data.smallestStack)}</strong></div>
      </div>
    </main>
    <aside className="tv-broadcast-payouts" aria-label="Cơ cấu giải thưởng">
      <h2>Rank awards</h2>
      {clock.payouts.length ? <ol>{clock.payouts.map((p,i) => <li key={`${p.rank}-${i}`}><span>{p.rank}</span><strong>{p.amount}</strong></li>)}</ol> : <p>Chưa công bố cơ cấu thưởng</p>}
    </aside>
    {clock.footerNote && <footer>{clock.footerNote}</footer>}
  </section>;
}
