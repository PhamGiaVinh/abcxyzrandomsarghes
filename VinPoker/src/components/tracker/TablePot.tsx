import { useTranslation } from 'react-i18next';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { PotLayer } from '@/lib/tracker-poker/potEngine';

export function TablePot({ total, layers, formatAmount }: {
  total: string;
  layers?: ReadonlyArray<PotLayer>;
  formatAmount: (amount: number) => string;
}) {
  const { t } = useTranslation();
  const amount = <><span className="tracker-pot-label">{t('liveHub.felt.pot', 'Pot')}</span><strong>{total}</strong></>;
  if (!layers || layers.length < 2) return <div className="tracker-pot-total">{amount}</div>;
  return <Popover>
    <PopoverTrigger asChild>
      <button type="button" className="tracker-pot-total tracker-pot-button">{amount}<span aria-hidden="true">⌄</span></button>
    </PopoverTrigger>
    <PopoverContent className="w-60 space-y-2" collisionPadding={12}>
      {layers.map((pot, i) => <div key={i} className="flex justify-between gap-3 text-sm">
        <span>{i === 0 ? t('liveHub.felt.main', 'Main') : t('liveHub.felt.side', 'Side {{i}}', { i })}</span>
        <strong>{formatAmount(pot.amount)}</strong>
        <span className="text-muted-foreground">({pot.eligible_player_ids.length})</span>
      </div>)}
    </PopoverContent>
  </Popover>;
}
