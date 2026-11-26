import { useTranslation } from 'react-i18next';
import { PokerCard, CardBack } from '../PokerVisuals';
import { PotChips } from '../ChipStack';
import { useViewerAmountUnit, toggleViewerAmountUnit } from "@/components/tracker/viewerAmountUnit";
import { formatViewerAmount } from '@/lib/tracker-poker/viewerAmounts';
import { TRACKER_TABLE_GEOMETRY } from '@/components/tracker/trackerTableLayout';
import { TableSurface, usesCatKhoi } from '@/components/tracker/TableSurface';
import { TableLogo, TableBlinds } from '@/components/tracker/TableIdentity';
import { tableAppearanceStyle, type TableAppearance } from '@/components/tracker/tableAppearance';
import type { PublicTableSnapshot } from './publicSnapshotTypes';
import './realtimeTablesGrid.css';

export function SpectatorMiniTable({ table, appearance, onPlayerSelect }: { table: PublicTableSnapshot; appearance?: TableAppearance; onPlayerSelect?: (id: string) => void }) {
  const { t } = useTranslation();
  const playersBySeat = new Map(table.players.map(player => [player.seatNumber, player]));
  const latestActor = table.latestAction ? table.players.find(player => player.playerId === table.latestAction?.playerId && player.entryNumber === table.latestAction.entryNumber) : null;
  const unit = useViewerAmountUnit();
  const amount = (value: number | null | undefined) => formatViewerAmount(value, table.bigBlind, unit);
  const stateLabel = table.trackerState === 'waiting' ? 'Đang chờ ván bài'
    : table.trackerState === 'inactive' ? 'Bàn chưa hoạt động'
    : table.trackerState === 'closed' ? 'Phiên bàn đã đóng'
    : null;
  return <div className="spectator-mini-table" style={tableAppearanceStyle(appearance)} data-hand-id={table.handId ?? undefined} data-tracker-state={table.trackerState}>
    {usesCatKhoi(appearance) ? <TableSurface portrait={false} appearance={appearance} /> : <div className="spectator-mini-surface" aria-hidden="true" />}
    <div className="spectator-mini-center">
      <TableLogo url={appearance?.logoUrl} />
      {stateLabel && <span className="spectator-mini-state">{stateLabel}</span>}
      {table.pot != null ? (
        <button type="button" className="spectator-mini-pot tracker-num inline-flex items-center gap-1 pointer-events-auto"
          onClick={toggleViewerAmountUnit} aria-label={amount(table.pot) + " · " + (unit === "bb" ? "Chip" : "BB")}>
          {table.pot > 0 && <PotChips compact />}
          {amount(table.pot)}
        </button>
      ) : !stateLabel && <span className="spectator-mini-pot tracker-num">—</span>}
      {!!table.board?.length && <span className="spectator-mini-board">{table.board.map((card, index) => <PokerCard key={`${index}:${card}`} card={card} size="sm" className="spectator-mini-card" />)}</span>}
      <TableBlinds level={table.levelNumber} sb={table.smallBlind} bb={table.bigBlind} ante={table.ante} />
      {table.latestAction && table.trackerState === 'live' && <span className="spectator-mini-action">{latestActor?.name ?? t('tableAppearance.player')} · {table.latestAction.actionType.split('_').join(' ')}{table.latestAction.amount != null && table.latestAction.amount > 0 ? ` ${amount(table.latestAction.amount)}` : ''}</span>}
    </div>
    {Array.from({ length: 9 }, (_, index) => {
      const seatNumber = index + 1;
      const player = playersBySeat.get(seatNumber);
      const point = TRACKER_TABLE_GEOMETRY.landscape.seats[seatNumber as keyof typeof TRACKER_TABLE_GEOMETRY.landscape.seats];
      const position = { left: `${point.l}%`, top: `${point.t}%` };
      const button = table.buttonSeat === seatNumber ? <span className="spectator-mini-button" aria-label="Dealer">D</span> : null;
      if (!player) return <span key={seatNumber} className="spectator-mini-empty" style={position}>{seatNumber}{button}</span>;
      const showCards = player.isFolded === false && (table.trackerState === 'live' || (table.trackerState === 'last_completed' && player.holeCards.length > 0));
      const action = player.isFolded ? 'fold' : player.isAllIn ? 'all_in' : player.lastAction?.actionType;
      return <div key={`${player.playerId}:${player.entryNumber}`} className="spectator-mini-seat" style={position} data-seat-number={seatNumber} data-folded={Boolean(player.isFolded)} title={player.name}>
        <div className="spectator-mini-portrait z-[1]">
          {onPlayerSelect && <button type="button" aria-label={`Thống kê ${player.name}`} onClick={() => onPlayerSelect(player.playerId)} className="absolute inset-0 z-10 min-h-11 min-w-11 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" />}
          <div className="spectator-mini-avatar">{player.avatarUrl ? <img src={player.avatarUrl} alt="" /> : player.name.slice(0, 2).toUpperCase()}</div>
          {showCards && <div className="spectator-mini-holes" data-revealed={player.holeCards.length > 0} aria-label={t('tableAppearance.playerCards', { name: player.name })}>
            {[0, 1].map(index => player.holeCards?.[index] ? <PokerCard key={index} card={player.holeCards[index]} size="xs" className="spectator-mini-hole-card" /> : table.trackerState === 'live' ? <CardBack key={index} size="xs" className="spectator-mini-hole-card" /> : null)}
          </div>}
          {button}
        </div>
        <button type="button" className="spectator-mini-plate block w-full cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label={player.name + " · Chip / BB"} onClick={toggleViewerAmountUnit}>
          <div className="spectator-mini-name">{player.name}</div><div className="spectator-mini-stack tracker-num">{amount(player.stack)}</div>
        </button>
        <span className="spectator-mini-status" data-action={action}>{action && table.trackerState === 'live' && !action.startsWith('post_') ? <>{action.split('_').join('-').toUpperCase()}{!player.isFolded && (player.lastAction?.amount ?? 0) > 0 ? ` ${amount(player.lastAction!.amount)}` : ''}</> : ' '}</span>
      </div>;
    })}
  </div>;
}
