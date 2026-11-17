import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ArrowDownLeft, ArrowUpRight, MessageSquare, Send, ShieldCheck, Wallet } from 'lucide-react';
import type { Database } from '@/integrations/supabase/types';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { askOwnerAssistant, type AssistantRead } from './ownerAssistantRead';

export const OWNER_ASSISTANT_ENABLED = import.meta.env.VITE_OWNER_SEPAY_ASSISTANT === 'true';
const money = (n: number) => `${new Intl.NumberFormat('vi-VN').format(n)} ₫`;

/** Mount only for one selected club; server independently authorizes every request. */
export default function OwnerAssistantPanel({ client, clubId, clubName, actorId, sessionToken }: {
  client: SupabaseClient<Database>; clubId: string | null; clubName: string; actorId: string; sessionToken: string;
}) {
  const { t } = useTranslation();
  const fieldId = useId();
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<AssistantRead | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const scope = `${actorId}:${clubId}:${sessionToken}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const [answerScope, setAnswerScope] = useState<string | null>(null);
  useEffect(() => {
    pending.current?.abort(); pending.current = null;
    setQuestion(''); setAnswer(null); setAnswerScope(null); setError(null); setBusy(false);
    return () => { pending.current?.abort(); pending.current = null; };
  }, [client, clubId, actorId, sessionToken]);
  const send = async (text: string) => {
    if (!clubId || !actorId || !sessionToken || pending.current || !text.trim()) return;
    const controller = new AbortController();
    pending.current = controller; setBusy(true); setError(null);
    setAnswer(null); setAnswerScope(null); setQuestion(text);
    try {
      const result = await askOwnerAssistant(client, clubId, text.trim(), controller.signal);
      if (!controller.signal.aborted && currentScope.current === scope) { setAnswer(result); setAnswerScope(scope); }
    } catch (e) {
      if (!controller.signal.aborted && currentScope.current === scope) setError(e instanceof Error ? e.message : 'SOURCE_UNAVAILABLE');
    } finally {
      if (pending.current === controller) { pending.current = null; setBusy(false); }
    }
  };
  const shown = answerScope === scope ? answer : null;
  const evidence = shown?.evidence;
  const quota = error === 'FREE_QUOTA_EXHAUSTED';
  const errorKey = quota ? 'freeQuota' : error === 'SEPAY_QUOTA_EXHAUSTED' ? 'sepayQuota' : error === 'RATE_LIMITED' ? 'rateLimit'
    : error === 'FORBIDDEN' || error === 'SCOPE_CHANGED' || error === 'UNAUTHORIZED' ? 'forbidden'
      : error === 'SEPAY_NOT_CONFIGURED' || error === 'SEPAY_NOT_CONNECTED' || error === 'ACCOUNT_SCOPE_AMBIGUOUS' ? 'connect'
        : error === 'ASSISTANT_NOT_ENABLED' || error === 'FREE_TIER_NOT_CONFIGURED' ? 'preparing' : 'unavailable';
  return <section aria-labelledby={`${fieldId}-title`} className="overflow-hidden rounded-xl border border-primary/25 bg-card text-card-foreground">
    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4 sm:p-5">
      <div><h2 id={`${fieldId}-title`} className="flex items-center gap-2 text-lg font-semibold"><MessageSquare className="h-5 w-5 text-primary" aria-hidden="true" />{t('ownerAssistant.title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{clubId ? clubName : t('ownerAssistant.selectClub')}</p></div>
      <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 px-2.5 py-1 text-xs text-primary"><ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />{t('ownerAssistant.readOnly')}</span>
    </header>
    <div className="grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-4 p-4 sm:p-5">
        <p className="text-sm text-muted-foreground">{t('ownerAssistant.description')}</p>
        <div className="flex flex-wrap gap-2">{['cashflowQuestion', 'transactionsQuestion', 'webhookQuestion'].map(key => <Button key={key} type="button" variant="outline" size="sm" className="h-auto min-h-10 whitespace-normal text-left" disabled={!clubId || busy} onClick={() => { void send(t(`ownerAssistant.${key}`)); }}>{t(`ownerAssistant.${key}`)}</Button>)}</div>
        <form onSubmit={e => { e.preventDefault(); void send(question); }} className="space-y-2">
          <label htmlFor={fieldId} className="text-sm font-medium">{t('ownerAssistant.question')}</label>
          <Textarea id={fieldId} value={question} maxLength={1000} rows={3} disabled={!clubId || busy} onChange={e => setQuestion(e.target.value)} placeholder={t('ownerAssistant.placeholder')} aria-describedby={`${fieldId}-privacy`} />
          <div className="flex items-center justify-between gap-3"><p className="text-xs text-muted-foreground">{t('ownerAssistant.freeOnly')}</p>
            <Button type="submit" disabled={!clubId || busy || !question.trim()} className="min-h-11 shrink-0 gap-2"><Send className="h-4 w-4" aria-hidden="true" />{t(busy ? 'ownerAssistant.loading' : 'ownerAssistant.ask')}</Button></div>
        </form>
        <p id={`${fieldId}-privacy`} className="text-xs leading-relaxed text-muted-foreground">{t('ownerAssistant.privacy')}</p>
      </div>
      <div className="min-w-0 border-t border-border bg-muted/20 p-4 sm:p-5 lg:border-l lg:border-t-0" aria-busy={busy} aria-live="polite">
        <h3 className="mb-3 text-sm font-semibold">{t('ownerAssistant.results')}</h3>
        {busy ? <p role="status" className="text-sm text-muted-foreground">{t('ownerAssistant.loading')}</p>
          : error ? <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">{t(`ownerAssistant.${errorKey}`)}</p>
            : !shown ? <div className="rounded-lg border border-dashed border-border px-4 py-8 text-sm leading-6 text-muted-foreground"><Wallet className="mb-3 h-6 w-6" aria-hidden="true" />{t('ownerAssistant.empty')}</div>
              : !evidence ? <p className="text-sm leading-6 text-muted-foreground">{t('ownerAssistant.unsupported')}</p> : <>
                <p className="mb-3 text-xs text-muted-foreground">SePay · •••• {evidence.accountLast4} · {evidence.from} → {evidence.to} · UTC+7</p>
                {!evidence.complete ? <p className="text-sm text-amber-500">{t('ownerAssistant.partial')}</p> : evidence.totals && <dl className="grid gap-2 sm:grid-cols-2">
                  <Metric label={t('ownerAssistant.incoming')} value={money(evidence.totals.incoming)} icon="in" />
                  <Metric label={t('ownerAssistant.outgoing')} value={money(evidence.totals.outgoing)} icon="out" />
                  <Metric label={t('ownerAssistant.net')} value={money(evidence.totals.net)} />
                  <Metric label={t('ownerAssistant.recent')} value={t('ownerAssistant.count', { count: evidence.totals.countIn + evidence.totals.countOut })} />
                </dl>}
                {shown.plan.intent !== 'cashflow' && evidence.complete && <div className="mt-3 max-h-60 overflow-auto rounded-lg border border-border"><table className="w-full text-left text-xs"><caption className="sr-only">{t('ownerAssistant.recent')}</caption><tbody>{evidence.transactions.slice(0, 50).map(tx => <tr key={tx.id} className="border-b border-border last:border-0"><td className="p-2 text-muted-foreground">{new Date(tx.date).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}</td><td className="p-2 text-right font-mono tabular-nums">{tx.direction === 'in' ? '+' : '−'}{money(tx.amount)}</td></tr>)}</tbody></table>{!evidence.transactions.length && <p className="p-3">{t('ownerAssistant.noTransactions')}</p>}</div>}
                <p className="mt-3 text-xs leading-5 text-muted-foreground">{t(shown.plan.intent === 'webhook_issues' ? 'ownerAssistant.webhookNote' : 'ownerAssistant.bankNote')}</p>
                {shown.plan.intent !== 'cashflow' && evidence.transactions.length > 50 && <p className="mt-2 text-xs text-muted-foreground">{t('ownerAssistant.displayLimit')}</p>}
                <p className="mt-3 text-xs text-muted-foreground">{t('ownerAssistant.updated')} {new Date(evidence.fetchedAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}</p>
              </>}
      </div>
    </div>
  </section>;
}
function Metric({ label, value, icon }: { label: string; value: string; icon?: 'in' | 'out' }) {
  return <div className="min-w-0 rounded-lg border border-border bg-card p-3"><dt className="flex items-center gap-1.5 text-xs text-muted-foreground">{icon === 'in' && <ArrowDownLeft className="h-3.5 w-3.5 text-primary" aria-hidden="true" />}{icon === 'out' && <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />}{label}</dt><dd className="mt-1 break-words font-mono text-base font-semibold tabular-nums">{value}</dd></div>;
}
