import { useTranslation } from 'react-i18next';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { PotLayer } from '@/lib/tracker-poker/potEngine';

import { PotChips } from "../cashier/tournament-live/ChipStack";

export function TablePot({ total, layers, formatAmount, onAmountClick, amountUnitLabel }: {
  total: string;
  layers?: ReadonlyArray<Pick<PotLayer, "amount"> & Partial<Pick<PotLayer, "eligible_player_ids">>>;
  formatAmount: (amount: number) => string;
  onAmountClick?: () => void;
  amountUnitLabel?: string;
}) {
  const { t } = useTranslation();
  const amount = <><PotChips compact /><strong>{total}</strong></>;
  const sideAmount = layers?.slice(1).reduce((sum, layer) => sum + layer.amount, 0) ?? 0;
  const split = layers && sideAmount > 0;
  const groups = split ? <>
    <span className="inline-flex flex-col items-center gap-1"><PotChips compact /><strong>{formatAmount(layers[0].amount)}</strong></span>
    <span className="ml-2 border-l pl-2 inline-flex flex-col items-center gap-1"><PotChips compact /><strong>{formatAmount(sideAmount)}</strong></span>
  </> : amount;
  const detail = <Popover>
    <PopoverTrigger asChild>{onAmountClick
      ? <button type="button" className="pointer-events-auto min-h-11 px-1 text-xs underline">{t("liveHub.felt.potDetails", "Chi tiết")}</button>
      : <button type="button" className="tracker-pot-total tracker-pot-button">{groups}</button>}
    </PopoverTrigger>
    <PopoverContent className="w-60 space-y-2" collisionPadding={12}>
      {layers?.map((pot, i) => <div key={i} className="flex justify-between gap-3 text-sm">
        <span className="sr-only">{i === 0 ? t('liveHub.felt.pot', 'Pot') : t('liveHub.felt.side', 'Side {{i}}', { i })}</span>
        <strong>{formatAmount(pot.amount)}</strong>
        {pot.eligible_player_ids && <span className="text-muted-foreground">({pot.eligible_player_ids.length})</span>}
      </div>)}
    </PopoverContent>
  </Popover>;
  if (!onAmountClick) return split ? detail : <div className="tracker-pot-total">{amount}</div>;
  return <div className="inline-flex items-center gap-1">
    <button type="button" className="tracker-pot-total tracker-pot-button" onClick={onAmountClick}
      aria-label={`${total} · ${amountUnitLabel}`}>{groups}</button>
    {split && detail}
  </div>;
}
