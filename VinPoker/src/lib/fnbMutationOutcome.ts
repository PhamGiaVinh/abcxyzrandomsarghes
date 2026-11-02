import type { FnbGuestCreateResult } from "@/hooks/useFnbGuest";
// Existing native catalog: mark_paid/cancel_order/mark_shipped return
// {status:'ok',order_id,...}, or {error:CODE}. A transport success is not a receipt.
export type FnbOrderMutationRpc = (name: "fnb_mark_paid" | "fnb_mark_shipped" | "fnb_cancel_order",
  args: { p_order_id: string; p_line_id?: string | null; p_reason?: string }) =>
  PromiseLike<{ data: unknown; error: { message?: string; code?: string; details?: string } | null }>;

export function fnbGuestCreateOutcome(data: unknown, method: "cash" | "bank_transfer"):
 {kind:"confirmed";result:FnbGuestCreateResult}|{kind:"rejected";code:string}|{kind:"unknown"} {
  if(!data||typeof data!=="object"||Array.isArray(data))return {kind:"unknown"};
  const r=data as Record<string,unknown>;
  if(typeof r.error==="string"&&r.error.trim())return {kind:"rejected",code:r.error};
  if(r.error!=null||r.status!=="ok"||typeof r.order_id!=="string"||! /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(r.order_id)
   ||typeof r.idempotent!=="boolean"||typeof r.subtotal_vnd!=="number"||!Number.isSafeInteger(r.subtotal_vnd)||r.subtotal_vnd<0
   ||r.payment_method!==method||typeof r.expires_at!=="string"||!Number.isFinite(Date.parse(r.expires_at)))return {kind:"unknown"};
  if(method==='cash'){
    if(r.bank!==null||r.reference_code!==null)return {kind:"unknown"};
  }else{
    if(typeof r.reference_code!=="string"||!r.reference_code.trim()||!r.bank||typeof r.bank!=="object"||Array.isArray(r.bank))return {kind:"unknown"};
    const bank=r.bank as Record<string,unknown>;
    if(typeof bank.account_number!=="string"||!bank.account_number.trim()
      ||['bank_name','bank_bin','account_holder','qr_code_url'].some(k=>bank[k]!==null&&typeof bank[k]!=="string"))return {kind:"unknown"};
  }
  return {kind:"confirmed",result:r as unknown as FnbGuestCreateResult};
}
export function fnbOrderMutationOutcome(data: unknown, orderId: string):
  { kind: "confirmed"; idempotent: boolean } | { kind: "rejected"; code: string } | { kind: "unknown" } {
  if (!data || typeof data !== "object" || Array.isArray(data)) return { kind: "unknown" };
  const result = data as Record<string, unknown>;
  if (typeof result.error === "string" && result.error.trim()) return { kind: "rejected", code: result.error };
  if (result.error != null || result.status !== "ok" || result.order_id !== orderId || !orderId
    || (result.idempotent !== undefined && typeof result.idempotent !== "boolean")
    || (result.all_shipped !== undefined && typeof result.all_shipped !== "boolean")) return { kind: "unknown" };
  return { kind: "confirmed", idempotent: result.idempotent === true };
}

export type FnbCreateRpc = (name: "fnb_create_order" | "fnb_create_comp_order", args: Record<string, unknown>) =>
  PromiseLike<{ data: unknown; error: { message?: string; code?: string; details?: string } | null }>;

// Create allocates the ID on the server. Replays legitimately omit subtotal;
// never reconstruct that authoritative amount from the current client cart.
export function fnbCreateOutcome(data: unknown, comp = false):
  { kind: "confirmed"; orderId: string; idempotent: boolean; subtotal: number | null }
  | { kind: "rejected"; code: string } | { kind: "unknown" } {
  if (!data || typeof data !== "object" || Array.isArray(data)) return { kind: "unknown" };
  const result = data as Record<string, unknown>;
  if (typeof result.error === "string" && result.error.trim()) return { kind: "rejected", code: result.error };
  if (result.error != null || result.status !== "ok" || typeof result.order_id !== "string" || !result.order_id.trim()
    || typeof result.idempotent !== "boolean" || (comp && result.is_comp !== true)) return { kind: "unknown" };
  const subtotal = result.subtotal_vnd;
  if (subtotal !== undefined && (typeof subtotal !== "number" || !Number.isSafeInteger(subtotal) || subtotal < 0)) return { kind: "unknown" };
  if (!comp && !result.idempotent && subtotal === undefined) return { kind: "unknown" };
  return { kind: "confirmed", orderId: result.order_id, idempotent: result.idempotent, subtotal: typeof subtotal === "number" ? subtotal : null };
}
