export interface CurrentChipDenomination {
  denomination_id: string;
  value: number;
  color: string | null;
  current_count: number;
}

// Shared current-inventory trust boundary. An unknown count is never zero.
export function assertCurrentChipDenominations(rows: unknown): asserts rows is CurrentChipDenomination[] {
  if (!Array.isArray(rows)) throw new Error("inventory_unverified");
  const ids = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("inventory_unverified");
    const d = row as Record<string, unknown>;
    if (typeof d.denomination_id !== "string" || !d.denomination_id.trim() || ids.has(d.denomination_id)
      || typeof d.value !== "number" || !Number.isSafeInteger(d.value) || d.value <= 0
      || typeof d.current_count !== "number" || !Number.isSafeInteger(d.current_count) || d.current_count < 0
      || !Number.isSafeInteger(d.value * d.current_count)
      || (d.color !== null && typeof d.color !== "string")) throw new Error("inventory_unverified");
    ids.add(d.denomination_id);
  }
}
