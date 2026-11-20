import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import { startLiveReportRefresh } from '@/lib/liveReportRefresh';
import './owner-bank-feed.css';

type BankRow = { id: string; createdAt: string; occurredAt: string | null; amount: number | null; direction: 'in' | 'out' | null; status: string; verified: boolean };
type Snapshot = { version: string; clubId: string; asOf: string; rows: BankRow[] };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export function parseBankObservation(value: unknown, clubId: string): Snapshot {
  if (!object(value) || value.version !== 'owner-bank-observation-v1' || value.clubId !== clubId
    || typeof value.asOf !== 'string' || !Number.isFinite(Date.parse(value.asOf)) || !Array.isArray(value.rows) || value.rows.length > 50) throw Error('INVALID_OBSERVATION');
  const ids = new Set<string>();
  for (const row of value.rows) {
    if (!object(row) || typeof row.id !== 'string' || ids.has(row.id) || typeof row.createdAt !== 'string'
      || !Number.isFinite(Date.parse(row.createdAt)) || !(row.occurredAt === null || typeof row.occurredAt === 'string' && Number.isFinite(Date.parse(row.occurredAt)))
      || !(row.amount === null || typeof row.amount === 'number' && Number.isSafeInteger(row.amount) && row.amount >= 0)
      || !['in','out',null].includes(row.direction as never) || typeof row.status !== 'string' || typeof row.verified !== 'boolean') throw Error('INVALID_OBSERVATION');
    ids.add(row.id);
  }
  return value as unknown as Snapshot;
}
export default function OwnerBankFeed({ client, clubId, scope }: { client: SupabaseClient<Database>; clubId: string; scope: string }) {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [snapshotScope, setSnapshotScope] = useState('');
  const [error, setError] = useState(false);
  const [changed, setChanged] = useState<Set<string>>(new Set());
  const previous = useRef<Map<string,string> | null>(null);
  useEffect(() => {
    let active = true;
    let flash: ReturnType<typeof setTimeout> | undefined;
    previous.current = null; setSnapshot(null); setSnapshotScope(''); setError(false); setChanged(new Set());
    const stop = startLiveReportRefresh(async () => {
      try {
        const { data, error: failure } = await client.rpc('get_owner_bank_observation_v1' as never, { p_club_id: clubId } as never);
        if (!active) return;
        if (failure) throw failure;
        const next = parseBankObservation(data, clubId);
        const fingerprints = new Map(next.rows.map(row => [row.id, JSON.stringify(row)]));
        const updates = new Set(next.rows.filter(row => previous.current && previous.current.get(row.id) !== fingerprints.get(row.id)).map(row => row.id));
        previous.current = fingerprints; setSnapshot(next); setSnapshotScope(scope); setError(false); setChanged(updates);
        clearTimeout(flash); flash = setTimeout(() => { if (active) setChanged(new Set()); }, 1400);
      } catch {
        // A failed permission/session check must not leave old financial rows visible.
        if (active) { setSnapshot(null); setSnapshotScope(''); previous.current = null; setChanged(new Set()); setError(true); }
      }
    }, 10_000);
    return () => { active = false; stop(); clearTimeout(flash); };
  }, [client, clubId, scope]);
  const shown = snapshotScope === scope ? snapshot : null;
  return <section className="border-t border-border p-4 sm:p-5" aria-label={t('ownerAssistant.liveTitle')}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">{t('ownerAssistant.liveTitle')}</h3><span className="text-xs text-muted-foreground">{t('ownerAssistant.liveInterval')}</span></div>
    <p className="mt-1 text-xs leading-5 text-muted-foreground">{t('ownerAssistant.liveScope')}</p>
    {error ? <p role="alert" className="mt-3 text-sm text-destructive">{t('ownerAssistant.unavailable')}</p>
      : !shown ? <p role="status" className="mt-3 text-sm text-muted-foreground">{t('ownerAssistant.loading')}</p>
        : <><p className="mt-2 text-xs text-muted-foreground">{t('ownerAssistant.updated')} {new Date(shown.asOf).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})}</p>
          <ul className="mt-3 divide-y divide-border">{shown.rows.map(row => <li key={row.id} className={`flex flex-wrap items-center justify-between gap-2 rounded p-3 ${changed.has(row.id) ? 'owner-bank-row-changed' : ''}`}>
            <div><p className="text-xs text-muted-foreground">{new Date(row.occurredAt ?? row.createdAt).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})}</p><p className="mt-1 text-xs">{t(row.verified ? 'ownerAssistant.verified' : 'ownerAssistant.pendingVerification')}{changed.has(row.id) && <span className="ml-2 text-primary">{t('ownerAssistant.changed')}</span>}</p></div>
            <strong className="font-mono text-sm tabular-nums">{row.amount === null || row.direction === null ? t('ownerAssistant.unknownAmount') : `${row.direction === 'in' ? '+' : '−'}${new Intl.NumberFormat('vi-VN').format(row.amount)} ₫`}</strong>
          </li>)}</ul>{shown.rows.length === 0 && <p className="mt-3 text-sm text-muted-foreground">{t('ownerAssistant.noTransactions')}</p>}</>}
  </section>;
}
