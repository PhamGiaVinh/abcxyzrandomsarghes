import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/integrations/supabase/client';
import { parsePaidWinnings, type PaidWinnings } from '@/lib/playerFinancialReport';

export function PublicPaidWinnings({ playerId, live = true }: { playerId: string; live?: boolean }) {
  const { t } = useTranslation();
  const [result, setResult] = useState<PaidWinnings | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    setResult(null); setFailed(false);
    const load = async () => {
      try {
        const { data, error } = await supabase.rpc('get_public_player_paid_winnings_v1' as never, { p_player_id: playerId } as never).abortSignal(controller.signal);
        if (error) throw error;
        const next = parsePaidWinnings(data, playerId);
        if (!controller.signal.aborted) { setResult(next); setFailed(false); }
      } catch { if (!controller.signal.aborted) { setResult(null); setFailed(true); } }
      if (!controller.signal.aborted && live) timer = setTimeout(load, 15_000);
    };
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [playerId, live]);
  const current = result?.playerId === playerId ? result : null;
  return <section className="rounded-lg border border-border bg-card p-4">
    <h3 className="flex flex-wrap justify-between gap-2 text-sm font-semibold"><span>Total Winnings</span><strong className="font-mono text-primary">{current?.totalWinnings == null ? '—' : `${current.totalWinnings.toLocaleString('vi-VN')} ₫`}</strong></h3>
    <p className="mt-2 text-xs text-muted-foreground">{t('playerFinance.publicScope')}</p>
    {(failed || current?.complete === false) && <p role="status" className="mt-2 text-xs text-muted-foreground">{t('playerFinance.unavailable')}</p>}
  </section>;
}
