import type { TvData } from '@/types/tv';
import { useTvStackRange } from '@/hooks/useTvStackRange';
import { TvBroadcastBoardView } from './TvBroadcastBoardView';

export function TvBroadcastBoard({ data }: { data: TvData }) {
  const range = useTvStackRange(data.tournamentId, data.playersRemaining, data.totalChips);
  return <div className="tv-broadcast-viewport"><TvBroadcastBoardView data={data} range={range} /></div>;
}
