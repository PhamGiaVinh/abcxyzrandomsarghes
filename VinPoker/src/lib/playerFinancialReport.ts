import { supabase } from '@/integrations/supabase/client';

export type CustomerFinance = {
  customerRef: string; name: string; cost: number | null; rake: number | null;
  paidPrize: number; pendingPrize: number; profit: number | null; roi: number | null;
  unavailableCount: number; paidBuys: number; tournaments: number; visits: number;
  lastPaidAt: string | null; averageSpend: number | null; activeTournaments: number;
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
  history: FinancialFact[]; totalHistory: number;
};
const moneyKeys = new Set(['cost','rake','paidPrize','pendingPrize','profit','grossPaid','refunded','amount','amountDue','totalWinnings','prize','averageSpend']);
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
  validateAmounts(data);
  return data;
}
export async function loadPlayerFinancialReport(clubId: string | null, customerRef: string | null, query: string, offset: number, signal: AbortSignal) {
  const { data, error } = await supabase.rpc('get_owner_player_financial_report_v1' as never, {
    p_club_id: clubId, p_customer_ref: customerRef, p_query: query, p_offset: offset, p_limit: 25,
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
