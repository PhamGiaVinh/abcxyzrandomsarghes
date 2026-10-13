/** Issuance intent/receipt trust boundary. No inventory arithmetic. */
export type IssuanceScope = { actorId: string; clubId: string; tournamentId: string; templateId: string };
export type IssuanceIntent = IssuanceScope & { count: number; revision: number; requestId: string; resolved?: boolean };
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const integer = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
export const validIssuanceCount = (v: unknown): v is number => integer(v) && v <= 2147483647;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export function issuancePayload(i: IssuanceIntent) { return { stack_template_id: i.templateId, issued_count: i.count, expected_revision: i.revision }; }
export function issuanceArgs(i: IssuanceIntent) { return { p_stack_template_id: i.templateId, p_issued_count: i.count, p_expected_revision: i.revision, p_request_id: i.requestId, p_expected_actor: i.actorId }; }
export function readIssuanceIntent(raw: string, scope: IssuanceScope): IssuanceIntent {
  const i: unknown = JSON.parse(raw);
  if (!record(i) || ![i.actorId, i.clubId, i.tournamentId, i.templateId, i.requestId].every(uuid)
    || Object.entries(scope).some(([k, v]) => i[k] !== v) || !validIssuanceCount(i.count) || !integer(i.revision)
    || (i.resolved !== undefined && typeof i.resolved !== "boolean")) throw Error("ISSUANCE_JOURNAL_INVALID");
  return i as IssuanceIntent;
}
export function readIssuanceState(v: unknown, scope: IssuanceScope): { count: number; revision: number } {
  if (!record(v) || v.status !== "ok" || v.actor_id !== scope.actorId || v.club_id !== scope.clubId
    || v.tournament_id !== scope.tournamentId || v.stack_template_id !== scope.templateId
    || !validIssuanceCount(v.issued_count) || !integer(v.revision)) throw Error("ISSUANCE_STATE_UNVERIFIED");
  return { count: v.issued_count, revision: v.revision };
}
export function validateIssuanceReceipt(i: IssuanceIntent, v: unknown):
  { status: "unknown" } | { status: "rejected"; error: string } | { status: "committed"; coupled: boolean } {
  if (!record(v) || v.actor_id !== i.actorId || v.request_id !== i.requestId || v.club_id !== i.clubId
    || v.tournament_id !== i.tournamentId || !record(v.payload)) return { status: "unknown" };
  const expected = issuancePayload(i), payload = v.payload;
  if (Object.keys(payload).length !== 3 || Object.entries(expected).some(([k, value]) => payload[k] !== value)) return { status: "unknown" };
  if (typeof v.error === "string" && v.error && v.status !== "ok") return { status: "rejected", error: v.error };
  if (v.status !== "ok" || v.error !== undefined || v.stack_template_id !== i.templateId || v.issued_count !== i.count
    || !integer(v.revision) || v.revision < i.revision || v.revision > i.revision + 1 || typeof v.coupled !== "boolean") return { status: "unknown" };
  return { status: "committed", coupled: v.coupled };
}
export function settleIssuanceIntent(storage: Pick<Storage, "getItem" | "setItem">, key: string, i: IssuanceIntent) {
  const raw = storage.getItem(key), settled = JSON.stringify({ ...i, resolved: true });
  if (raw !== null && raw !== JSON.stringify(i) && raw !== settled) throw Error("ISSUANCE_JOURNAL_CHANGED");
  storage.setItem(key, settled);
  if (storage.getItem(key) !== settled) throw Error("ISSUANCE_JOURNAL_SETTLE_FAILED");
}
