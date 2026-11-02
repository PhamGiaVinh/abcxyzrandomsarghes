export type StaffSalarySource = "mock" | "live";

export interface SalaryClub {
  id: string;
  name: string;
  role: "owner" | "admin" | "accountant";
}

export type SalaryEmploymentType = "full_time" | "part_time";
export type SalaryPeriodStatus = "prepared" | "submitted" | "approved" | "rejected";

export interface SalaryRow {
  staffId: string;
  fullName: string;
  department: string;
  employmentType: SalaryEmploymentType;
  workedDays?: number | null;
  workedMinutes?: number | null;
  grossVnd: number;
  manualBhxhVnd: number;
  manualTaxVnd: number;
  netVnd: number;
  alreadyLocked?: boolean; // preview rows: a locked run already exists for this staff
  runId?: string | null; // locked rows only
  status?: string | null; // locked rows only ('locked' | 'paid')
}

export interface SalaryMonthView {
  clubId: string;
  year: number;
  month: number;
  standardShifts: number | null;
  status: SalaryPeriodStatus;
  submittedAt?: string | null;
  approvedAt?: string | null;
  rejectedReason?: string | null;
  hasRuns: boolean;
  lockedRows: SalaryRow[];
  previewRows: SalaryRow[];
  totalGrossVnd: number;
  totalNetVnd: number;
}
