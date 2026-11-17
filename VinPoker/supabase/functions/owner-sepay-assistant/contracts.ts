// Shared evidence contract, not an accounting ledger or a model-generated total.
export const VERSION = 'owner-sepay-assistant-v1' as const;
export const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
export type Intent = 'cashflow' | 'transactions' | 'webhook_issues' | 'unsupported';
export type Plan = { intent: Intent; from: string; to: string; search: string | null };
export type Question = { clubId: string; requestId: string; question: string };
export class AssistantError extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AssistantError('INVALID_RESPONSE', 502);
  return value as Record<string, unknown>;
}
export function businessDay(now: Date): string {
  return new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
}
export function parseQuestion(value: unknown): Question {
  const v = record(value);
  if (Object.keys(v).sort().join(',') !== 'clubId,question,requestId'
    || typeof v.clubId !== 'string' || !UUID.test(v.clubId)
    || typeof v.requestId !== 'string' || !UUID.test(v.requestId)
    || typeof v.question !== 'string' || !v.question.trim() || v.question.length > 1000) {
    throw new AssistantError('INVALID_REQUEST');
  }
  return { clubId: v.clubId, requestId: v.requestId, question: v.question.trim() };
}
function day(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || !Number.isFinite(Date.parse(value + 'T00:00:00Z'))
    || new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value) throw new AssistantError('INVALID_DATE_RANGE');
  return value;
}
export function parsePlan(value: unknown, now: Date): Plan {
  const v = record(value);
  if (Object.keys(v).sort().join(',') !== 'from,intent,search,to'
    || !['cashflow', 'transactions', 'webhook_issues', 'unsupported'].includes(String(v.intent))) throw new AssistantError('INVALID_PLAN', 502);
  const from = day(v.from), to = day(v.to);
  if (from > to || to > businessDay(now) || Date.parse(to) - Date.parse(from) > 365 * 86400_000) throw new AssistantError('INVALID_DATE_RANGE');
  if (v.search !== null && (typeof v.search !== 'string' || v.search.trim().length < 3 || v.search.length > 100)) throw new AssistantError('INVALID_PLAN', 502);
  if (v.intent !== 'transactions' && v.search !== null) throw new AssistantError('INVALID_PLAN', 502);
  return { intent: v.intent as Intent, from, to, search: typeof v.search === 'string' ? v.search.trim() : null };
}
export function vnd(value: unknown): number {
  // No floating rounding, coercion of null/booleans, exponential notation or silent overflow.
  if (typeof value === 'string' && !/^\d+$/.test(value)) throw new AssistantError('INVALID_AMOUNT', 502);
  if (typeof value !== 'number' && typeof value !== 'string') throw new AssistantError('INVALID_AMOUNT', 502);
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new AssistantError('INVALID_AMOUNT', 502);
  return n;
}
export function addVnd(a: number, b: number): number {
  const result = a + b;
  if (!Number.isSafeInteger(result)) throw new AssistantError('AMOUNT_OVERFLOW', 502);
  return result;
}
