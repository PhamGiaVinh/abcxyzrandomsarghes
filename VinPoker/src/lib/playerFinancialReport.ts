import { supabase } from '@/integrations/supabase/client';

export type CustomerFinance = {
  customerRef: string; name: string; cost: number | null; rake: number | null;
  paidPrize: number; pendingPrize: number; profit: number | null; roi: number | null;
  unavailableCount: number; paidBuys: number; tournaments: number; visits: number;
  lastPaidAt: string | null; averageSpend: number | null; activeTournaments: number; fnbNet: number | null;
};
export type FinancialFact = {
  id: string; kind: 'buyin' | 'reentry' | 'prize' | 'prize_reversal' | 'obligation';
  tournamentId: string; tournamentName: string; at: string | null; paidAt?: string | null;
  cost?: number | null; rake?: number | null; grossPaid?: number; refunded?: number;
  paidPrize?: number; pendingPrize?: number; rank?: number; verified: boolean;
  movements?: { id: string; at: string; kind: string; amount: number; method: string }[];
};
export type PlayerFinancialReport = {
  clubId: string | null; clubs: { id: string; name: string }[]; asOf?: string;
  customers: CustomerFinance[]; selected: CustomerFinance | null; totalCount: number;
  history: FinancialFact[]; totalHistory: number; fnb?: CustomerFnb;
};
export type CustomerFnb = {
  paid: number | null; refunded: number | null; net: number | null; pending: number | null; comp: number | null;
  unavailableCount: number; totalCount: number; unlinkedOrderCount: number;
  orders: {id: string; customerRef: string; createdAt: string; paidAt: string | null; cancelledAt: string | null;
    status: string; method: string | null; isComp: boolean; amount: number; paid: number; refunded: number; net: number; pending: number; verified: boolean;
    items: {id: string; name: string; quantity: number; unitPrice: number}[]}[];
};
const moneyKeys = new Set(['cost','rake','paidPrize','pendingPrize','profit','grossPaid','refunded','amount','amountDue','totalWinnings','prize','averageSpend','fnbNet','paid','net','pending','comp','unitPrice']);
function validateAmounts(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (moneyKeys.has(key) && item !== null && (typeof item !== 'number' || !Number.isSafeInteger(item))) throw new Error('Invalid financial amount');
    validateAmounts(item);
  }
}
export function parsePlayerFinancialReport(value: unknown, clubId: string | null, customerRef: string | null): PlayerFinancialReport {
  const data = value as PlayerFinancialReport;
  if (!data || data.clubId !== clubId || !Array.isArray(data.clubs) || !Array.isArray(data.customers)
    || !Array.isArray(data.history) || !Number.isSafeInteger(data.totalCount) || !Number.isSafeInteger(data.totalHistory)
    || (customerRef && data.selected?.customerRef !== customerRef)
    || data.customers.some(row => typeof row.customerRef !== 'string' || typeof row.name !== 'string')
    || data.history.some(row => typeof row.id !== 'string' || typeof row.tournamentName !== 'string')) throw new Error('Invalid financial report');
  if (data.fnb && (!Array.isArray(data.fnb.orders) || !Number.isSafeInteger(data.fnb.totalCount)
    || data.fnb.orders.some(row => row.customerRef !== customerRef || !Array.isArray(row.items)))) throw new Error('Invalid customer F&B');
  validateAmounts(data);
  return data;
}
export async function loadPlayerFinancialReport(clubId: string | null, customerRef: string | null, query: string, offset: number, signal: AbortSignal, fnbOffset = 0) {
  const { data, error } = await supabase.rpc('get_owner_player_financial_report_v1' as never, {
    p_club_id: clubId, p_customer_ref: customerRef, p_query: query, p_offset: offset, p_limit: 25, p_fnb_offset: fnbOffset,
  } as never).abortSignal(signal);
  if (error) throw error;
  return parsePlayerFinancialReport(data, clubId, customerRef);
}
export type PaidWinnings = { playerId: string; totalWinnings: number | null; complete: boolean; scope: string };
export function parsePaidWinnings(value: unknown, playerId: string): PaidWinnings {
  const data = value as PaidWinnings;
  if (!data || data.playerId !== playerId || data.scope !== 'cashier-confirmed' || typeof data.complete !== 'boolean'
    || (data.complete ? typeof data.totalWinnings !== 'number' || !Number.isSafeInteger(data.totalWinnings) || data.totalWinnings < 0 : data.totalWinnings !== null)) throw new Error('Invalid paid winnings');
  return data;
}
