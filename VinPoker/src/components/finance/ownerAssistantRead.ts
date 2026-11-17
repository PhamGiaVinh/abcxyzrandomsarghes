import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import { parsePlan, record, VERSION } from '../../../supabase/functions/owner-sepay-assistant/contracts';
import type { ReadEvidence } from '../../../supabase/functions/owner-sepay-assistant/sepayRead';

export type AssistantRead = { question: string; plan: ReturnType<typeof parsePlan>; evidence: ReadEvidence | null; answer?: string | null };
const amount = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
export async function askOwnerAssistant(client: SupabaseClient<Database>, clubId: string, question: string, signal: AbortSignal): Promise<AssistantRead> {
  const requestId = crypto.randomUUID();
  const { data, error } = await client.functions.invoke('owner-sepay-assistant', { body: { clubId, requestId, question }, signal });
  if (error) {
    let code = 'SOURCE_UNAVAILABLE';
    if (error.context instanceof Response) {
      try { const body = await error.context.json(); if (typeof body?.error === 'string' && /^[A-Z_]+$/.test(body.error)) code = body.error; } catch { /* keep unavailable */ }
    }
    throw new Error(code);
  }
  const body = record(data);
  if (body.version !== VERSION || body.clubId !== clubId || body.requestId !== requestId) throw new Error('SCOPE_CHANGED');
  const plan = parsePlan(body.plan, new Date());
  if (plan.intent === 'unsupported' && body.evidence === null) return { question, plan, evidence: null };
  const e = record(body.evidence);
  if (e.source !== 'sepay-api-v2' || typeof e.accountLast4 !== 'string' || !/^\d{4}$/.test(e.accountLast4)
    || e.from !== plan.from || e.to !== plan.to || typeof e.fetchedAt !== 'string' || !Number.isFinite(Date.parse(e.fetchedAt))
    || typeof e.complete !== 'boolean' || !Array.isArray(e.transactions) || e.transactions.length > 1000) throw new Error('SOURCE_UNAVAILABLE');
  // Validate display values; financial totals are produced by the server, never the model.
  if (e.complete) {
    const totals = record(e.totals);
    if (!['incoming', 'outgoing', 'countIn', 'countOut', 'withoutCode'].every(k => amount(totals[k]))
      || !Number.isSafeInteger(totals.net) || totals.net !== (totals.incoming as number) - (totals.outgoing as number)) throw new Error('SOURCE_UNAVAILABLE');
  } else if (e.totals !== null) throw new Error('SOURCE_UNAVAILABLE');
  const seen = new Set<string>();
  for (const item of e.transactions) {
    const tx = record(item);
    if (typeof tx.id !== 'string' || seen.has(tx.id) || typeof tx.date !== 'string' || !Number.isFinite(Date.parse(tx.date))
      || !['in', 'out'].includes(String(tx.direction)) || !amount(tx.amount)) throw new Error('SOURCE_UNAVAILABLE');
    seen.add(tx.id);
  }
  if (body.answer !== null && body.answer !== undefined && (typeof body.answer !== 'string' || body.answer.length > 1200)) throw new Error('SOURCE_UNAVAILABLE');
  return { question, plan, evidence: e as unknown as ReadEvidence, answer: typeof body.answer === 'string' && e.complete ? body.answer : null };
}
