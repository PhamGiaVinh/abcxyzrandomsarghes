import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";

export type ChipOpsTournamentOption = {
  id: string;
  name: string;
  status: string;
  startTime: string | null;
  phase: string | null;
};

export type IssuedChipDenomination = {
  denominationId: string;
  value: number;
  color: string | null;
  issuedCount: number;
};

export type IssuedChipInventory = {
  tournamentId: string;
  denominations: IssuedChipDenomination[];
  totalIssuedChips: number;
  totalValue: number;
  reconciliationValue: number;
  reconciled: boolean;
};

export type IssuedStackSummary = {
  templates: { id: string; name: string; stackValue: number; issuedCount: number }[];
  totalIssuedStacks: number;
};

type OpsClient = SupabaseClient<Database>;

export async function loadChipOpsTournamentOptions(
  client: OpsClient,
  clubId: string,
  signal?: AbortSignal,
): Promise<ChipOpsTournamentOption[]> {
  const query = client
    .from("tournaments")
    .select("id, name, status, start_time, phase")
    .eq("club_id", clubId)
    .is("deleted_at", null)
    .order("start_time", { ascending: false })
    .limit(200);
  const result = await (signal ? query.abortSignal(signal) : query);
  if (result.error || !Array.isArray(result.data)) throw new Error("CHIP_OPS_TOURNAMENT_READ_FAILED");
  return result.data.map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    startTime: row.start_time,
    phase: row.phase,
  }));
}

export async function loadIssuedChipInventory(
  client: OpsClient,
  tournamentId: string,
  signal?: AbortSignal,
): Promise<IssuedChipInventory> {
  const query = client.rpc("get_issued_chip_inventory", {
    p_tournament_id: tournamentId,
  });
  const result = await (signal ? query.abortSignal(signal) : query);
  if (result.error) throw new Error("CHIP_OPS_INVENTORY_READ_FAILED");
  return parseIssuedChipInventory(result.data, tournamentId);
}

export async function loadIssuedStackSummary(
  client: OpsClient,
  tournamentId: string,
  signal?: AbortSignal,
): Promise<IssuedStackSummary> {
  const templatesQuery = client.from("stack_template")
    .select("id, name, stack_value")
    .eq("tournament_id", tournamentId)
    .order("stack_value", { ascending: true });
  const templatesResult = await (signal ? templatesQuery.abortSignal(signal) : templatesQuery);
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  if (templatesResult.error) throw new Error("CHIP_OPS_TEMPLATE_READ_FAILED");
  if (!Array.isArray(templatesResult.data)) throw new Error("CHIP_OPS_TEMPLATE_MALFORMED");
  const templates = templatesResult.data;
  if (!templates.length) return { templates: [], totalIssuedStacks: 0 };

  const issuanceQuery = client.from("stack_template_issuance")
    .select("stack_template_id, issued_count")
    .in("stack_template_id", templates.map((row) => row.id));
  const issuanceResult = await (signal ? issuanceQuery.abortSignal(signal) : issuanceQuery);
  if (issuanceResult.error) throw new Error("CHIP_OPS_ISSUANCE_READ_FAILED");
  if (!Array.isArray(issuanceResult.data)) throw new Error("CHIP_OPS_ISSUANCE_MALFORMED");
  return parseIssuedStackSummary(templates, issuanceResult.data);
}

export function parseIssuedStackSummary(
  templates: { id: string; name: string; stack_value: number }[],
  issuances: { stack_template_id: string; issued_count: number }[],
): IssuedStackSummary {
  const templateIds = new Set(templates.map((row) => row.id));
  if (templateIds.size !== templates.length) throw new Error("CHIP_OPS_TEMPLATE_MALFORMED");
  const issuedByTemplate = new Map<string, number>();
  for (const row of issuances) {
    if (!templateIds.has(row.stack_template_id) || !isSafeAmount(row.issued_count) || issuedByTemplate.has(row.stack_template_id)) {
      throw new Error("CHIP_OPS_ISSUANCE_MALFORMED");
    }
    issuedByTemplate.set(row.stack_template_id, row.issued_count);
  }
  const rows = templates.map((row) => {
    if (!row.id || !row.name.trim() || !isSafeAmount(row.stack_value) || row.stack_value === 0) {
      throw new Error("CHIP_OPS_TEMPLATE_MALFORMED");
    }
    return { id: row.id, name: row.name, stackValue: row.stack_value, issuedCount: issuedByTemplate.get(row.id) ?? 0 };
  });
  const totalIssuedStacks = rows.reduce((sum, row) => sum + row.issuedCount, 0);
  if (!Number.isSafeInteger(totalIssuedStacks)) throw new Error("CHIP_OPS_ISSUANCE_MALFORMED");
  return { templates: rows, totalIssuedStacks };
}

export function parseIssuedChipInventory(value: Json, expectedTournamentId: string): IssuedChipInventory {
  if (!isRecord(value)) throw new Error("CHIP_OPS_INVENTORY_MALFORMED");
  if (typeof value.error === "string") throw new Error(safeServerCode(value.error));
  if (value.tournament_id !== expectedTournamentId) throw new Error("CHIP_OPS_INVENTORY_SCOPE_MISMATCH");
  if (!Array.isArray(value.denominations)) throw new Error("CHIP_OPS_INVENTORY_MALFORMED");
  if (!isSafeAmount(value.total_value) || !isSafeAmount(value.reconciliation_value)) {
    throw new Error("CHIP_OPS_INVENTORY_MALFORMED");
  }
  if (typeof value.reconciled !== "boolean") throw new Error("CHIP_OPS_INVENTORY_MALFORMED");

  const denominations = value.denominations.map((candidate) => {
    if (!isRecord(candidate)
      || typeof candidate.denomination_id !== "string"
      || !isSafeAmount(candidate.value)
      || !isSafeAmount(candidate.issued_count_total)
      || !(candidate.color === null || typeof candidate.color === "string")) {
      throw new Error("CHIP_OPS_INVENTORY_MALFORMED");
    }
    return {
      denominationId: candidate.denomination_id,
      value: candidate.value,
      color: candidate.color as string | null,
      issuedCount: candidate.issued_count_total,
    };
  });

  const totalIssuedChips = denominations.reduce((sum, row) => sum + row.issuedCount, 0);
  if (!Number.isSafeInteger(totalIssuedChips)) throw new Error("CHIP_OPS_INVENTORY_MALFORMED");

  return {
    tournamentId: expectedTournamentId,
    denominations,
    totalIssuedChips,
    totalValue: value.total_value,
    reconciliationValue: value.reconciliation_value,
    reconciled: value.reconciled,
  };
}

function isRecord(value: Json): value is { [key: string]: Json | undefined } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeAmount(value: Json | undefined): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function safeServerCode(value: string): string {
  return /^[A-Z][A-Z0-9_]*$/u.test(value) ? `CHIP_OPS_${value}` : "CHIP_OPS_INVENTORY_READ_FAILED";
}
