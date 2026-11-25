import type { ClubExpenseRow, ClubExpensesSummary, ExpenseClub, ExpenseCategory, ExpensePaymentSource, ExpensePaymentStatus } from "./types";

const KEY = "vinpoker.clubExpenses.mockRows";

export function mockExpenseClubs(): ExpenseClub[] {
  return [
    { id: "club-saigon", name: "VinPoker Sài Gòn" },
    { id: "club-danang", name: "VinPoker Đà Nẵng" },
  ];
}

function currentMonthDate(day: number): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}-${String(day).padStart(2, "0")}T09:00:00+07:00`;
}

function seedRows(clubId: string): ClubExpenseRow[] {
  return [
    {
      id: `${clubId}-rent`,
      clubId,
      category: "rent",
      amountVnd: 42_000_000,
      description: "Tiền mặt bằng tháng này",
      incurredAt: currentMonthDate(2),
      paymentStatus: "paid",
      paymentSource: "bank",
      createdAt: currentMonthDate(2),
    },
    {
      id: `${clubId}-poster`,
      clubId,
      category: "marketing",
      amountVnd: 2_400_000,
      description: "In poster series cuối tuần",
      incurredAt: currentMonthDate(8),
      paymentStatus: "unpaid",
      paymentSource: null,
      createdAt: currentMonthDate(8),
    },
    {
      id: `${clubId}-supplies`,
      clubId,
      category: "supplies",
      amountVnd: 1_150_000,
      description: "Sleeve bài, giấy in, bút marker",
      incurredAt: currentMonthDate(12),
      paymentStatus: "paid",
      paymentSource: "cash",
      createdAt: currentMonthDate(12),
    },
  ];
}

function readAll(): Record<string, ClubExpenseRow[]> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(KEY) || "{}");
  } catch {
    return {};
  }
}

function writeAll(value: Record<string, ClubExpenseRow[]>): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(value));
}

export function readMockExpenses(clubId: string, from: string, to: string): ClubExpensesSummary {
  const all = readAll();
  if (!all[clubId]) {
    all[clubId] = seedRows(clubId);
    writeAll(all);
  }
  const rows = all[clubId]
    .filter((row) => row.incurredAt >= from && row.incurredAt < to)
    .sort((a, b) => b.incurredAt.localeCompare(a.incurredAt));
  return summarize(clubId, from, to, rows);
}

export function mockRecordExpense(input: {
  clubId: string;
  category: ExpenseCategory;
  amountVnd: number;
  incurredAt: string;
  description?: string;
  paymentStatus: ExpensePaymentStatus;
  paymentSource?: ExpensePaymentSource | null;
  tournamentId?: string;
  seriesId?: string;
  attachmentUrl?: string;
}): ClubExpenseRow {
  const all = readAll();
  const rows = all[input.clubId] ?? seedRows(input.clubId);
  const row: ClubExpenseRow = {
    id: `${input.clubId}-${Date.now()}`,
    clubId: input.clubId,
    category: input.category,
    amountVnd: input.amountVnd,
    incurredAt: input.incurredAt,
    description: input.description,
    paymentStatus: input.paymentStatus,
    paymentSource: input.paymentSource ?? null,
    tournamentId:input.tournamentId??null,
    seriesId:input.seriesId??null,
    attachmentUrl:input.attachmentUrl??null,
    createdAt: new Date().toISOString(),
  };
  all[input.clubId] = [row, ...rows];
  writeAll(all);
  return row;
}

export function summarize(clubId: string, from: string, to: string, rows: ClubExpenseRow[]): ClubExpensesSummary {
  const byCategory: ClubExpensesSummary["byCategory"] = {};
  for (const row of rows) byCategory[row.category] = (byCategory[row.category] ?? 0) + row.amountVnd;
  return {
    clubId,
    from,
    to,
    rows,
    totalVnd: rows.reduce((sum, row) => sum + row.amountVnd, 0),
    paidVnd: rows.filter((row) => row.paymentStatus === "paid").reduce((sum, row) => sum + row.amountVnd, 0),
    unpaidVnd: rows.filter((row) => row.paymentStatus === "unpaid").reduce((sum, row) => sum + row.amountVnd, 0),
    byCategory,
  };
}

