import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { FEATURES } from "@/lib/featureFlags";
import { fnbGuestCreateOutcome } from "@/lib/fnbMutationOutcome";
import { waitForManualPlayerResponse } from "@/lib/floorManualPlayerIntent";
import {fnbGuestIntentRpcArgs,parseFnbGuestReceiptLookup,type FnbGuestIntent} from '@/lib/fnbGuestIntent';
import {z} from 'zod';

// ── Guest QR ordering (GQR) — the ANON data layer for /fnb/order?t=<token> ─────────────────────
// All three RPCs are SECURITY DEFINER + GRANTed to anon (migration 20261111000018): the supabase
// client works sessionless here (anon key, no login). Every fact derives from the secret per-table
// token in the QR URL — the club is never taken from the client.

export type FnbGuestCategory = { id: string; name: string; sort_order: number };
export type FnbGuestItem = {
  id: string; category_id: string | null; name: string; price_vnd: number;
  image_url: string | null; sort_order: number;
};
export type FnbGuestLookup = {
  club_name: string; table_name: string; bank_available: boolean;
  categories: FnbGuestCategory[]; items: FnbGuestItem[];
};
export type FnbGuestBank = {
  bank_name: string | null; bank_bin: string | null;
  account_number: string; account_holder: string | null; qr_code_url: string | null;
};
export type FnbGuestCreateResult = {
  order_id: string; idempotent: boolean; subtotal_vnd: number;
  payment_method: "cash" | "bank_transfer"; reference_code: string | null;
  expires_at: string; bank: FnbGuestBank | null;
};
export type FnbGuestOrderStatus = {
  bank_source?: 'snapshot' | 'unverified' | 'not_applicable';
  order: {
    id: string; order_status: "pending" | "paid" | "shipped" | "cancelled" | "expired";
    subtotal_vnd: number; payment_method: "cash" | "bank_transfer";
    reference_code: string | null; guest_seat: number | null;
    created_at: string; paid_at: string | null; expires_at: string;
  };
  bank: FnbGuestBank | null;
};
const guestTimestamp=z.string().refine(value=>Number.isFinite(Date.parse(value)));
const guestVnd=z.number().nonnegative().refine(Number.isSafeInteger);
const guestLookupSchema=z.object({status:z.literal('ok'),club_name:z.string().min(1),table_name:z.string().min(1),bank_available:z.boolean(),
 categories:z.array(z.object({id:z.string().uuid(),name:z.string().min(1),sort_order:z.number().int()})),
 items:z.array(z.object({id:z.string().uuid(),category_id:z.string().uuid().nullable(),name:z.string().min(1),price_vnd:guestVnd,
 image_url:z.string().nullable(),sort_order:z.number().int()}))}).refine(value=>new Set(value.items.map(x=>x.id)).size===value.items.length
 &&new Set(value.categories.map(x=>x.id)).size===value.categories.length);
const guestStatusSchema=z.object({status:z.literal('ok'),bank_source:z.enum(['snapshot','unverified','not_applicable']).optional(),order:z.object({id:z.string().uuid(),
 order_status:z.enum(['pending','paid','shipped','cancelled','expired']),
 subtotal_vnd:guestVnd,payment_method:z.enum(['cash','bank_transfer']),
 reference_code:z.string().nullable(),guest_seat:z.number().int().min(1).max(20).nullable(),
 created_at:guestTimestamp,paid_at:guestTimestamp.nullable(),expires_at:guestTimestamp}),
 bank:z.object({bank_name:z.string().nullable(),bank_bin:z.string().nullable(),account_number:z.string().min(1),
 account_holder:z.string().nullable(),qr_code_url:z.string().nullable()}).nullable()});

/** Token → "Bạn đang ở Bàn X" + the club's active menu. Errors carry the RPC's {error:CODE}. */
export function useFnbGuestLookup(token: string | null) {
  return useQuery({
    queryKey: ["fnb", "guest", "lookup", token],
    enabled: !!token && FEATURES.fnbGuestOrder,
    retry: 1,
    queryFn: async (): Promise<FnbGuestLookup> => {
      if(!token)throw Error('TOKEN_INVALID');
      const { data, error } = await waitForManualPlayerResponse(Promise.resolve(supabase.rpc("fnb_guest_lookup", { p_token: token })));
      if (error) throw error;
      if(data&&typeof data==='object'&&!Array.isArray(data)&&'error' in data&&typeof data.error==='string')throw Error(data.error);
      const parsed=guestLookupSchema.safeParse(data);
      if(!parsed.success)throw Error('FNB_GUEST_LOOKUP_INVALID');
      const value = parsed.data;
      return { ...value, club_name: value.club_name, table_name: value.table_name, bank_available: value.bank_available,
        categories: value.categories.map(c => ({ id: c.id, name: c.name, sort_order: c.sort_order })),
        items: value.items.map(i => ({ id: i.id, category_id: i.category_id, name: i.name,
          price_vnd: i.price_vnd, image_url: i.image_url, sort_order: i.sort_order })) };
    },
  });
}

/** Create the guest order (cash or bank). Parent owns UI state; errors surface via mapFnbError. */
export async function fnbGuestCreateOrder(args: {
  token: string; seat: number | null; customerName: string | null; note: string | null;
  lines: { menu_item_id: string; qty: number }[];
  paymentMethod: "cash" | "bank_transfer"; clientRequestId: string;
}): Promise<{ res: FnbGuestCreateResult | null; errorCode: string | null }> {
  try {
  const { data, error } = await waitForManualPlayerResponse(Promise.resolve(supabase.rpc("fnb_guest_create_order", {
    p_token: args.token,
    p_seat: args.seat,
    p_customer_name: args.customerName,
    p_note: args.note,
    p_lines: args.lines,
    p_payment_method: args.paymentMethod,
    p_client_request_id: args.clientRequestId,
  })));
  if(error)return {res:null,errorCode:"FNB_MUTATION_UNKNOWN"};
  const outcome=fnbGuestCreateOutcome(data,args.paymentMethod);
  if(outcome.kind==='confirmed')return {res:outcome.result,errorCode:null};
  return {res:null,errorCode:outcome.kind==='rejected'?outcome.code:'FNB_MUTATION_UNKNOWN'};
  } catch {return {res:null,errorCode:'FNB_MUTATION_UNKNOWN'};}
}

/** Recover an exact persisted request. Never create or automatically retry an order. */
export async function fnbGuestReadReceipt(intent:FnbGuestIntent):Promise<ReturnType<typeof parseFnbGuestReceiptLookup>> {
  try {
    const args=fnbGuestIntentRpcArgs(intent);
    const {data,error}=await waitForManualPlayerResponse(Promise.resolve(supabase.rpc('fnb_guest_order_receipt_v1',args)));
    return error?{kind:'unknown'}:parseFnbGuestReceiptLookup(data,intent);
  } catch {return {kind:'unknown'};}
}
/** Explicitly fence an uncommitted request; never cancel an existing order. */
export async function fnbGuestAbandonIntent(intent:FnbGuestIntent):Promise<ReturnType<typeof parseFnbGuestReceiptLookup>> {
  try {
    const args=fnbGuestIntentRpcArgs(intent);
    const {data,error}=await waitForManualPlayerResponse(Promise.resolve(supabase.rpc('fnb_guest_abandon_request_v1',args)));
    if(error)return {kind:'unknown'};
    const result=parseFnbGuestReceiptLookup(data,intent);
    return result.kind==='missing'?{kind:'unknown'}:result;
  } catch {return {kind:'unknown'};}
}

/** Poll one order's status (pending → paid → shipped | expired | cancelled). 4s while waiting. */
export function useFnbGuestOrderStatus(token: string | null, orderId: string | null) {
  return useQuery({
    queryKey: ["fnb", "guest", "status", token, orderId],
    enabled: !!token && !!orderId && FEATURES.fnbGuestOrder,
    refetchInterval: (q) => {
      const st = (q.state.data as FnbGuestOrderStatus | undefined)?.order?.order_status;
      return st === "pending" || st === "paid" ? 4000 : false; // stop once terminal (shipped/expired/cancelled)
    },
    queryFn: async (): Promise<FnbGuestOrderStatus> => {
      if(!token||!orderId)throw Error('TOKEN_INVALID');
      const { data, error } = await waitForManualPlayerResponse(Promise.resolve(supabase.rpc("fnb_guest_order_status", {
        p_token: token, p_order_id: orderId,
      })));
      if (error) throw error;
      const parsed=guestStatusSchema.safeParse(data);
      if(!parsed.success||parsed.data.order.id!==orderId)throw Error('FNB_GUEST_STATUS_INVALID');
      const value = parsed.data, order = value.order, bank = value.bank;
      return { ...value, order: { id: order.id, order_status: order.order_status, subtotal_vnd: order.subtotal_vnd,
        payment_method: order.payment_method, reference_code: order.reference_code, guest_seat: order.guest_seat,
        created_at: order.created_at, paid_at: order.paid_at, expires_at: order.expires_at },
        bank: bank === null ? null : { bank_name: bank.bank_name, bank_bin: bank.bank_bin,
          account_number: bank.account_number, account_holder: bank.account_holder, qr_code_url: bank.qr_code_url } };
    },
  });
}
