// Read validation only: never calculate, round or repair ledger values.
// Shared by the two finance readers to fence cache incarnations without placing
// bearer tokens in query keys. This is not an authorization decision.
let nextEpoch = 0;
const sessionEpochs = new WeakMap<object, { token: string | undefined; epoch: number }>();
export function financeSessionReadEpoch(session: { access_token?: string } | null | undefined): number {
  if (!session) return 0;
  const existing = sessionEpochs.get(session);
  if (existing && existing.token === session.access_token) return existing.epoch;
  const epoch = ++nextEpoch;
  sessionEpochs.set(session, { token: session.access_token, epoch });
  return epoch;
}

export function financeRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`FINANCE_SUMMARY_INVALID: ${field}`);
  return value as Record<string, unknown>;
}
export function financeNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value))) throw new Error(`FINANCE_SUMMARY_INVALID: ${field}`);
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`FINANCE_SUMMARY_INVALID: ${field}`);
  return number;
}
function fields(object: Record<string, unknown>, required: string[], optional: string[], field: string) {
  const result: Record<string, number> = {};
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(object, key)) throw new Error(`FINANCE_SUMMARY_INVALID: ${field}.${key}`);
    result[key] = financeNumber(object[key], `${field}.${key}`);
  }
  // Only absent documented legacy fields may default in the consumer, not null.
  for (const key of optional) if (Object.prototype.hasOwnProperty.call(object, key)) result[key] = financeNumber(object[key], `${field}.${key}`);
  return result;
}
export function parseFinanceCore(value: unknown) {
  const data = financeRecord(value, 'summary');
  const revenue = fields(financeRecord(data.revenue, 'revenue'), ['stakingFees','payoutFees','rake','total'],
    ['stakingFixed','stakingPercent','stakingArchive','rakeActual','rakeExpected','rakeVariance','rakeOnline','rakeOffline','rakeReentry','serviceFee','fnb'], 'revenue');
  const cost = fields(financeRecord(data.cost, 'cost'), ['payrollNet','payrollGross','adjustments'],
    ['ptWagePaid','fnbCogs','compCogs','clubExpenses'], 'cost');
  return { data, revenue, cost, net: financeNumber(data.net, 'net') };
}
export function financeRows(value: unknown, field: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error(`FINANCE_SUMMARY_INVALID: ${field}`);
  return value.map((row, index) => financeRecord(row, `${field}[${index}]`));
}
export function financeText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`FINANCE_SUMMARY_INVALID: ${field}`);
  return value;
}
/** Permission denial is explicit; transport/contract errors are not evidence of lost access. */
export function financeReadErrorMessage(error: unknown): string {
  const detail = error && typeof error === 'object' ? error as {code?: string; status?: number; message?: string} : {};
  if (detail.code === '42501' || detail.status === 403) return 'Bạn chưa có quyền xem báo cáo tài chính của CLB này.';
  if (detail.code === 'PGRST202' || detail.code === '42883') return 'Máy chủ chưa có phiên bản báo cáo cần thiết. Không thể xác minh số liệu.';
  if (detail.message?.startsWith('FINANCE_SUMMARY_INVALID')) return 'Dữ liệu báo cáo không đầy đủ hoặc không hợp lệ. Không thể xác minh số liệu.';
  if (detail.message === 'AUTH_REQUIRED') return 'Cần xác minh lại phiên đăng nhập để đọc báo cáo.';
  return 'Không tải được báo cáo tài chính. Hãy kiểm tra kết nối và thử lại.';
}
