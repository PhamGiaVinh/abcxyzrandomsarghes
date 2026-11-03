import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { sessionReadEpoch } from '@/lib/sessionReadEpoch';
import { loadPlayerFinancialReport, type PlayerFinancialReport as Report, type CustomerFinance } from '@/lib/playerFinancialReport';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const money = (n: number | null | undefined) => n == null ? '—' : `${n.toLocaleString('vi-VN')} ₫`;
const date = (value?: string | null) => value ? new Date(value).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : '—';
export default function PlayerFinancialReport() {
  const { user, session } = useAuth();
  return <ScopedReport key={`${user?.id}:${sessionReadEpoch(session)}`} />;
}
function ScopedReport() {
  const { t } = useTranslation(); const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const club = params.get('club'); const customer = params.get('customer');
  const [query, setQuery] = useState(''); const [offset, setOffset] = useState(0); const [fnbOffset, setFnbOffset] = useState(0); const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ key: string; data: Report } | null>(null); const [error, setError] = useState(false);
  const key = JSON.stringify([club, customer, query, offset, fnbOffset, attempt]);
  const data = state?.key === key ? state.data : null;
  useEffect(() => {
    if (!user) return;
    const controller = new AbortController(); setError(false);
    const timer = setTimeout(() => {
      void loadPlayerFinancialReport(club, customer, query, offset, controller.signal, fnbOffset)
        .then(data => { if (!controller.signal.aborted) setState({ key, data }); })
        .catch(() => { if (!controller.signal.aborted) { setState(null); setError(true); } });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [key, user?.id]);
  const navigate = (nextClub: string | null, nextCustomer: string | null) => {
    setOffset(0); setFnbOffset(0); setQuery('');
    setParams(nextClub ? { club: nextClub, ...(nextCustomer ? { customer: nextCustomer } : {}) } : {});
  };
  const metric = (row: CustomerFinance, name: keyof CustomerFinance) => name === 'roi' ? (row.roi == null ? '—' : `${row.roi.toLocaleString('vi-VN', { maximumFractionDigits: 2 })}%`) : money(row[name] as number | null);
  const columns = ['cost','rake','paidPrize','pendingPrize','profit','roi','fnbNet'] as const;
  if (!user) return <p>{t('playerFinance.signIn')}</p>;
  return <main className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="font-display text-2xl">{t('playerFinance.title')}</h1><p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t('playerFinance.scope')}</p></div><Button variant="outline" onClick={() => setAttempt(n => n + 1)}>{t('playerFinance.refresh')}</Button></div>
    <label className="block max-w-md space-y-1 text-sm"><span>{t('playerFinance.club')}</span><select value={club ?? ''} className="h-11 w-full rounded-md border border-input bg-background px-3" onChange={e => navigate(e.target.value || null, null)}><option value="">{t('playerFinance.selectClub')}</option>{state?.data.clubs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    {error ? <p role="alert">{t('playerFinance.error')}</p> : !data ? <p role="status">{t('playerFinance.loading')}</p> : !club ? <p className="text-muted-foreground">{data.clubs.length ? t('playerFinance.selectClub') : t('playerFinance.noClubs')}</p> : <>
      {data.selected ? <>
        <Button variant="outline" onClick={() => navigate(club, null)}>{t('playerFinance.back')}</Button>
        <h2 className="text-xl font-semibold">{data.selected.name}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{columns.map(c => <div key={c} className="rounded-lg border bg-card p-4"><p className="text-sm text-muted-foreground">{t(`playerFinance.${c}`)}</p><strong className="mt-2 block font-mono text-xl">{metric(data.selected!, c)}</strong></div>)}</div>
        <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-lg border p-4 text-sm">{(['paidBuys','tournaments','visits','activeTournaments'] as const).map(c => <p key={c}>{t(`playerFinance.${c}`)}: <strong>{data.selected![c]}</strong></p>)}<p>{t('playerFinance.averageSpend')}: {money(data.selected.averageSpend)}</p><p>{t('playerFinance.lastPaidAt')}: {date(data.selected.lastPaidAt)}</p></div>
        {!!data.selected.unavailableCount && <p role="status" className="text-sm text-amber-500">{t('playerFinance.quality', { count: data.selected.unavailableCount })}</p>}
        <h3 className="font-semibold">{t('playerFinance.history')} ({data.totalHistory})</h3>
        <div className="overflow-x-auto rounded-lg border"><table className="w-full text-left text-sm"><thead className="bg-muted/40"><tr>{['date','tournament','kind','cost','rake','paidPrize','pendingPrize'].map(c => <th className="p-3" key={c}>{t(`playerFinance.${c}`)}</th>)}</tr></thead><tbody>{data.history.map(row => <tr key={`${row.kind}:${row.id}`} className="border-t"><td className="p-3 whitespace-nowrap">{date(row.paidAt ?? row.at)}</td><td className="p-3"><span>{row.tournamentName}</span>{row.rank && <span className="block text-muted-foreground">#{row.rank}</span>}{row.movements?.length ? <details className="mt-2"><summary className="cursor-pointer text-primary">{t('playerFinance.receipts')} ({row.movements.length})</summary><ul className="mt-2 space-y-1">{row.movements.map(m => <li key={m.id}>{date(m.at)} · {t(`playerFinance.${m.kind}`)} · {money(m.amount)} · {m.method}</li>)}</ul></details> : null}{!row.verified && <span className="block text-amber-500">{t('playerFinance.unavailable')}</span>}</td><td className="p-3">{t(`playerFinance.${row.kind}`)}</td><td className="p-3 whitespace-nowrap">{money(row.cost)}</td><td className="p-3 whitespace-nowrap">{money(row.rake)}</td><td className="p-3 whitespace-nowrap">{money(row.paidPrize)}</td><td className="p-3 whitespace-nowrap">{money(row.pendingPrize)}</td></tr>)}</tbody></table></div>
        {!data.history.length && <p>{t('playerFinance.empty')}</p>}
        {data.fnb && <section className="space-y-3 rounded-lg border bg-card p-4" aria-label={t('playerFinance.fnbTitle')}>
          <h3 className="text-lg font-semibold">{t('playerFinance.fnbTitle')} ({data.fnb.totalCount})</h3>
          <p className="text-sm text-muted-foreground">{t('playerFinance.fnbScope')}</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{(['paid','refunded','net','pending','comp'] as const).map(k => <div key={k}><p className="text-xs text-muted-foreground">{t(`playerFinance.fnb_${k}`)}</p><strong className="font-mono">{money(data.fnb![k])}</strong></div>)}</div>
          {data.fnb.unavailableCount > 0 && <p role="status" className="text-sm text-amber-500">{t('playerFinance.unavailable')}</p>}
          {data.fnb.unlinkedOrderCount > 0 && <p className="text-sm text-muted-foreground">{t('playerFinance.fnbUnlinked', {count:data.fnb.unlinkedOrderCount})}</p>}
          <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{['date','fnbItems','fnbStatus','fnbAmount','fnb_paid','fnb_refunded','fnb_net'].map(k => <th className="p-3" key={k}>{t(`playerFinance.${k}`)}</th>)}</tr></thead><tbody>{data.fnb.orders.map(order => <tr key={order.id} className="border-t"><td className="p-3 whitespace-nowrap">{date(order.createdAt)}<span className="block text-xs text-muted-foreground">{order.id.slice(0,8)}</span></td><td className="p-3"><ul>{order.items.map(item => <li key={item.id}>{item.quantity} × {item.name} · {money(item.unitPrice)}</li>)}</ul>{order.isComp && <span>{t('playerFinance.fnb_comp')}</span>}{!order.verified && <span className="block text-amber-500">{t('playerFinance.unavailable')}</span>}</td><td className="p-3">{t(`playerFinance.fnbStatus_${order.status}`)}<span className="block text-xs text-muted-foreground">{order.method ? t(`playerFinance.fnbMethod_${order.method}`) : '—'}</span>{order.paidAt && <span className="block text-xs">{t('playerFinance.fnbPaidAt')}: {date(order.paidAt)}</span>}{order.cancelledAt && <span className="block text-xs">{t('playerFinance.fnbCancelledAt')}: {date(order.cancelledAt)}</span>}</td><td className="p-3 whitespace-nowrap font-mono">{money(order.verified ? order.amount : null)}</td>{(['paid','refunded','net'] as const).map(k => <td key={k} className="p-3 whitespace-nowrap font-mono">{money(order.verified ? order[k] : null)}</td>)}</tr>)}</tbody></table></div>
          {!data.fnb.orders.length && <p className="text-sm text-muted-foreground">{t('playerFinance.empty')}</p>}
          <div className="flex items-center gap-3"><Button variant="outline" disabled={fnbOffset===0} onClick={() => setFnbOffset(n => Math.max(0,n-25))}>{t('playerFinance.previous')}</Button><span className="text-sm">F&B · {Math.floor(fnbOffset/25)+1}</span><Button variant="outline" disabled={fnbOffset+25>=data.fnb.totalCount} onClick={() => setFnbOffset(n => n+25)}>{t('playerFinance.next')}</Button></div>
        </section>}
      </> : <>
        <label className="block max-w-md space-y-1 text-sm"><span>{t('playerFinance.search')}</span><Input value={query} maxLength={100} onChange={e => { setQuery(e.target.value); setOffset(0); }} /></label>
        <p className="text-sm text-muted-foreground">{t('playerFinance.customers', { count: data.totalCount })}</p>
        <div className="overflow-x-auto rounded-lg border"><table className="w-full text-left text-sm"><thead className="bg-muted/40"><tr><th className="p-3">{t('playerFinance.player')}</th>{columns.map(c => <th className="p-3" key={c}>{t(`playerFinance.${c}`)}</th>)}<th className="p-3">{t('playerFinance.activeTournaments')}</th></tr></thead><tbody>{data.customers.map(row => <tr className="border-t" key={row.customerRef}><td className="p-3"><button className="min-h-11 text-left font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => navigate(club, row.customerRef)}>{row.name}</button>{row.unavailableCount > 0 && <span className="block text-xs text-amber-500">{t('playerFinance.unavailable')}</span>}</td>{columns.map(c => <td className="p-3 whitespace-nowrap font-mono" key={c}>{metric(row,c)}</td>)}<td className="p-3">{row.activeTournaments}</td></tr>)}</tbody></table></div>
        {!data.customers.length && <p>{t('playerFinance.empty')}</p>}
      </>}
      <div className="flex items-center gap-3"><Button variant="outline" disabled={offset === 0} onClick={() => setOffset(n => Math.max(0,n-25))}>{t('playerFinance.previous')}</Button><span className="text-sm">{Math.floor(offset/25)+1}</span><Button variant="outline" disabled={offset + 25 >= (customer ? data.totalHistory : data.totalCount)} onClick={() => setOffset(n => n+25)}>{t('playerFinance.next')}</Button></div>
      <p className="text-xs text-muted-foreground">{t('playerFinance.asOf')}: {date(data.asOf)}</p>
    </>}
  </main>;
}
