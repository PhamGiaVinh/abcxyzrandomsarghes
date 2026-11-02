import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { financeBusinessToday, parseFinanceStaffLive,parseFinanceDealerLive,parseFinanceDealerFtLive,type FinanceDealerFtLive,type FinanceDealerLive, type FinanceStaffLive } from '@/lib/financeSummaryRead';
import { observeTrackerContextRead } from '@/lib/tournament/observeTrackerContextRead';

export type FinanceRange = {
  from: string;
  to: string;
};

export type FinanceSummaryRead = {
  revenue: {
    total: number;
    rake: number;
    serviceFee: number;
    stakingFees: number;
    payoutFees: number;
    fnb: number;
  };
  cost: {
    payrollNet: number;
    ptWagePaid: number;
    fnbCogs: number;
    compCogs: number;
    clubExpenses: number;
  };
  net: number;
  staffLive?: FinanceStaffLive;
  dealerLive?:FinanceDealerLive;
  dealerFtLive?:FinanceDealerFtLive;
};

type OpsClient = SupabaseClient<Database>;

export async function loadFinanceSummary(
  client: OpsClient,
  clubId: string,
  range: FinanceRange,
): Promise<FinanceSummaryRead> {
  const result = await observeTrackerContextRead(client.rpc("get_club_finance_summary", {
    p_club_id: clubId,
    p_from: range.from,
    p_to: range.to,
  }));
  if (result.error) throw new Error("FINANCE_SUMMARY_RPC_UNAVAILABLE");
  return parseFinanceSummary(result.data);
}

export function parseFinanceSummary(value: Json): FinanceSummaryRead {
  if (!isRecord(value)) throw new Error("FINANCE_SUMMARY_MALFORMED");
  if (typeof value.error === "string") throw new Error(safeServerCode(value.error));
  if (!isRecord(value.revenue) || !isRecord(value.cost) || !isSignedAmount(value.net)) {
    throw new Error("FINANCE_SUMMARY_MALFORMED");
  }

  return {
    revenue: {
      total: readSignedAmount(value.revenue, "total"),
      rake: readAmount(value.revenue, "rake"),
      serviceFee: readAmount(value.revenue, "serviceFee"),
      stakingFees: readAmount(value.revenue, "stakingFees"),
      payoutFees: readAmount(value.revenue, "payoutFees"),
      fnb: readSignedAmount(value.revenue, "fnb"),
    },
    cost: {
      payrollNet: readAmount(value.cost, "payrollNet"),
      ptWagePaid: readAmount(value.cost, "ptWagePaid"),
      fnbCogs: readSignedAmount(value.cost, "fnbCogs"),
      compCogs: readSignedAmount(value.cost, "compCogs"),
      clubExpenses: readSignedAmount(value.cost, "clubExpenses"),
    },
    net: value.net,
    ...(Object.prototype.hasOwnProperty.call(value,'staffLive') ? {staffLive:parseFinanceStaffLive(value.staffLive)} : {}),
    ...(Object.prototype.hasOwnProperty.call(value,'dealerLive')?{dealerLive:parseFinanceDealerLive(value.dealerLive)}:{}),
    ...(Object.prototype.hasOwnProperty.call(value,'dealerFtLive')?{dealerFtLive:parseFinanceDealerFtLive(value.dealerFtLive)}:{}),
  };
}


export function currentMonthFinanceRange(now = new Date()): FinanceRange {
  // This consumer is month-to-now, not an inclusive whole-calendar-day report.
  const from = new Date(financeBusinessToday(now).slice(0,7)+'-01T00:00:00+07:00');
  return { from: from.toISOString(), to: now.toISOString() };
}

function readAmount(record: Record<string, Json | undefined>, key: string): number {
  const value = record[key];
  if (!isUnsignedAmount(value)) throw new Error("FINANCE_SUMMARY_MALFORMED");
  return value;
}

// Refunds reverse revenue and unconsumed inventory cost in their own reporting
// period. The canonical server can therefore return negative F&B movements.
function readSignedAmount(record: Record<string, Json | undefined>, key: string): number {
  const value = record[key];
  if (!isSignedAmount(value)) throw new Error("FINANCE_SUMMARY_MALFORMED");
  return value;
}

function isRecord(value: Json | undefined): value is Record<string, Json | undefined> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUnsignedAmount(value: Json | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isSignedAmount(value: Json | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function safeServerCode(value: string): string {
  return /^[A-Z][A-Z0-9_]*$/u.test(value) ? `FINANCE_${value}` : "FINANCE_SUMMARY_RPC_UNAVAILABLE";
}
