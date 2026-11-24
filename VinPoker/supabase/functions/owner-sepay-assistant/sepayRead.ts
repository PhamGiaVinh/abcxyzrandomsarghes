import { addVnd, AssistantError, record, UUID, vnd, type Plan } from './contracts.ts';

export type AccountScope = { id: string; number: string };
type Transaction = { id: string; date: string; direction: 'in' | 'out'; amount: number; hasCode: boolean; webhookDelivered: boolean | null };
export type ReadEvidence = {
  source: 'sepay-api-v2'; accountLast4: string; from: string; to: string;
  fetchedAt: string; complete: boolean; transactions: Transaction[];
  totals: null | { incoming: number; outgoing: number; net: number; countIn: number; countOut: number; withoutCode: number };
};

/** Server-only transport: GET allowlist, fixed origin, no redirects, no secret in errors. */
export class SePayReader {
  private nextRequestAt = 0;
  constructor(private token: string, private fetchImpl: typeof fetch = fetch,
    private origin: 'https://userapi.sepay.vn' | 'https://userapi-sandbox.sepay.vn' = 'https://userapi.sepay.vn') {}
  private async page(path: '/v2/bank-accounts' | '/v2/transactions', query: URLSearchParams, signal: AbortSignal) {
    if (signal.aborted) throw new AssistantError('REQUEST_TIMEOUT', 504);
    const delay = Math.max(0, this.nextRequestAt - Date.now());
    if (delay) await new Promise<void>((resolve, reject) => {
      const cancel = () => { clearTimeout(timer); signal.removeEventListener('abort', cancel); reject(signal.reason); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, delay);
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) cancel();
    });
    this.nextRequestAt = Date.now() + 350;
    const response = await this.fetchImpl(`${this.origin}${path}?${query}`, {
      method: 'GET', redirect: 'error', headers: { Authorization: `Bearer ${this.token}` }, signal,
    });
    if (!response.ok) throw new AssistantError(response.status === 429 ? 'SEPAY_QUOTA_EXHAUSTED' : 'SEPAY_UNAVAILABLE', response.status === 429 ? 429 : 503);
    const body = record(await response.json());
    const pagination = record(record(body.meta).pagination);
    const page = Number(query.get('page'));
    const total = pagination.total;
    if (body.status !== 'success' || !Array.isArray(body.data) || body.data.length > 100
      || typeof pagination.has_more !== 'boolean'
      || pagination.current_page !== page || pagination.per_page !== 100
      || typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0
      || pagination.last_page !== Math.max(1, Math.ceil(total / 100))
      || pagination.has_more !== (page < (pagination.last_page as number))
      || body.data.length !== Math.max(0, Math.min(100, total - (page - 1) * 100))) throw new AssistantError('SEPAY_INVALID_PAGE', 502);
    return { rows: body.data, more: pagination.has_more, total };
  }
  async resolveAccount(number: string, signal: AbortSignal): Promise<AccountScope> {
    if (!/^\d{4,30}$/.test(number)) throw new AssistantError('ACCOUNT_SCOPE_REQUIRED', 503);
    const found = new Map<string, AccountScope>();
    let expectedTotal: number | null = null;
    for (let page = 1; page <= 5; page++) {
      const result = await this.page('/v2/bank-accounts', new URLSearchParams({ q: number, page: String(page), per_page: '100' }), signal);
      if (expectedTotal !== null && result.total !== expectedTotal) throw new AssistantError('SEPAY_PAGE_CHANGED', 503);
      expectedTotal = result.total;
      for (const item of result.rows) {
        const row = record(item);
        if (row.account_number !== number || !(row.active === 1 || row.active === true)) continue;
        if (typeof row.id !== 'string' || !UUID.test(row.id)) throw new AssistantError('SEPAY_ACCOUNT_INVALID', 502);
        found.set(row.id, { id: row.id, number });
      }
      if (!result.more) {
        if (found.size !== 1) throw new AssistantError('ACCOUNT_SCOPE_AMBIGUOUS', 503);
        return [...found.values()][0];
      }
    }
    throw new AssistantError('ACCOUNT_SCOPE_INCOMPLETE', 503);
  }
  async read(scope: AccountScope, plan: Plan, signal: AbortSignal, now = () => new Date()): Promise<ReadEvidence> {
    if (!UUID.test(scope.id) || !/^\d{4,30}$/.test(scope.number) || plan.intent === 'unsupported') throw new AssistantError('ACCOUNT_SCOPE_REQUIRED');
    const transactions: Transaction[] = [], seen = new Set<string>();
    let complete = false;
    let expectedTotal: number | null = null;
    for (let page = 1; page <= 10; page++) {
      const query = new URLSearchParams({ bank_account_id: scope.id, transaction_date_from: `${plan.from} 00:00:00`,
        transaction_date_to: `${plan.to} 23:59:59`, transaction_date_sort: 'asc', page: String(page), per_page: '100' });
      if (plan.search) query.set('q', plan.search);
      if (plan.intent === 'webhook_issues') query.set('webhook_success', '0');
      const result = await this.page('/v2/transactions', query, signal);
      if (expectedTotal !== null && result.total !== expectedTotal) throw new AssistantError('SEPAY_PAGE_CHANGED', 503);
      expectedTotal = result.total;
      for (const item of result.rows) {
        const row = record(item);
        // Reject foreign account results even when the provider ignored its filter.
        if (row.bank_account_id !== scope.id || row.account_number !== scope.number) throw new AssistantError('SEPAY_ACCOUNT_MISMATCH', 502);
        if (typeof row.id !== 'string' || !UUID.test(row.id) || seen.has(row.id)) throw new AssistantError('SEPAY_DUPLICATE_OR_INVALID_ID', 502);
        if (row.transfer_type !== 'in' && row.transfer_type !== 'out') throw new AssistantError('SEPAY_INVALID_DIRECTION', 502);
        if (typeof row.transaction_date !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(row.transaction_date)) throw new AssistantError('SEPAY_INVALID_DATE', 502);
        const date = new Date(row.transaction_date.replace(' ', 'T') + '+07:00');
        if (!Number.isFinite(date.getTime()) || new Date(date.getTime() + 7 * 3600_000).toISOString().slice(0, 19) !== row.transaction_date.replace(' ', 'T')
          || row.transaction_date.slice(0, 10) < plan.from || row.transaction_date.slice(0, 10) > plan.to) throw new AssistantError('SEPAY_INVALID_DATE', 502);
        const incoming = vnd(row.amount_in), outgoing = vnd(row.amount_out);
        if ((row.transfer_type === 'in' && outgoing !== 0) || (row.transfer_type === 'out' && incoming !== 0)) throw new AssistantError('SEPAY_INVALID_AMOUNT_DIRECTION', 502);
        if (row.code !== null && typeof row.code !== 'string') throw new AssistantError('SEPAY_INVALID_CODE', 502);
        const delivered = row.webhook_success === 1 || row.webhook_success === true ? true
          : row.webhook_success === 0 || row.webhook_success === false ? false : null;
        if (plan.intent === 'webhook_issues' && delivered !== false) throw new AssistantError('SEPAY_FILTER_MISMATCH', 502);
        seen.add(row.id);
        transactions.push({ id: row.id, date: date.toISOString(), direction: row.transfer_type,
          amount: row.transfer_type === 'in' ? incoming : outgoing, hasCode: typeof row.code === 'string' && !!row.code.trim(), webhookDelivered: delivered });
      }
      if (!result.more) { complete = true; break; }
    }
    let incoming = 0, outgoing = 0, countIn = 0, countOut = 0, withoutCode = 0;
    if (complete) for (const tx of transactions) {
      if (tx.direction === 'in') { incoming = addVnd(incoming, tx.amount); countIn++; if (!tx.hasCode) withoutCode++; }
      else { outgoing = addVnd(outgoing, tx.amount); countOut++; }
    }
    return { source: 'sepay-api-v2', accountLast4: scope.number.slice(-4), from: plan.from, to: plan.to,
      fetchedAt: now().toISOString(), complete, transactions,
      totals: complete ? { incoming, outgoing, net: incoming - outgoing, countIn, countOut, withoutCode } : null };
  }
}
