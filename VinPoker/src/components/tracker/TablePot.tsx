import { useTranslation } from 'react-i18next';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { PotLayer } from '@/lib/tracker-poker/potEngine';

import { PotChips } from "../cashier/tournament-live/ChipStack";

export function TablePot({ total, layers, formatAmount }: {
  total: string;
  layers?: ReadonlyArray<PotLayer>;
  formatAmount: (amount: number) => string;
}) {
  const { t } = useTranslation();
  const amount = <><PotChips compact /><strong>{total}</strong></>;
  const sideAmount = layers?.slice(1).reduce((sum, layer) => sum + layer.amount, 0) ?? 0;
  if (!layers || sideAmount <= 0) return <div className="tracker-pot-total">{amount}</div>;
  return <Popover>
    <PopoverTrigger asChild>
      <button type="button" className="tracker-pot-total tracker-pot-button">
        <span className="inline-flex flex-col items-center gap-1"><PotChips compact /><strong>{formatAmount(layers[0].amount)}</strong></span>
        <span className="ml-2 border-l pl-2 inline-flex flex-col items-center gap-1"><PotChips compact /><strong>{formatAmount(sideAmount)}</strong></span>
      </button>
    </PopoverTrigger>
    <PopoverContent className="w-60 space-y-2" collisionPadding={12}>
      {layers.map((pot, i) => <div key={i} className="flex justify-between gap-3 text-sm">
        <span className="sr-only">{i === 0 ? t('liveHub.felt.pot', 'Pot') : t('liveHub.felt.side', 'Side {{i}}', { i })}</span>
        <strong>{formatAmount(pot.amount)}</strong>
        <span className="text-muted-foreground">({pot.eligible_player_ids.length})</span>
      </div>)}
    </PopoverContent>
  </Popover>;
}
