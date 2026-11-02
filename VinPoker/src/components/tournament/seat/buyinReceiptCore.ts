import type { SupabaseClient } from "@supabase/supabase-js";
import {z} from 'zod';
import {observeTrackerContextRead} from '../../../lib/tournament/observeTrackerContextRead.ts';
import type { SeatReceiptData } from "./SeatReceipt";

export type BuyinReceiptSnapshot = {
  registration_id: string | null;
  receipt_code: string | null;
  qr_value: string | null;
  reference_code: string | null;
  status: string;
  payment_state?: "unverified" | "partial" | "paid_waiting_seat" | "confirmed" | "refunded";
  received_amount?: number | null;
  remaining_amount?: number | null;
  club: {
    name: string | null;
    address: string | null;
    logo_url: string | null;
  };
  player_name: string | null;
  tournament_name: string | null;
  total_pay: number | null;
  completed_at: string | null;
  completed_at_source: "confirmed_at" | "issued_at" | null;
  table_number: number | null;
  seat_number: number | null;
  starting_stack: number | null;
};

export type BuyinReceiptLookup =
  | { registrationId: string; receiptCode?: never }
  | { receiptCode: string; registrationId?: never };

export type BuyinReceiptClient = Pick<SupabaseClient, "functions">;

const text=z.string().nullable(),amount=z.number().finite().nonnegative().nullable();
const snapshotSchema=z.object({
  registration_id:text,receipt_code:text,qr_value:text,reference_code:text,
  status:z.enum(['pending','confirmed','rejected','cancelled','refunded']),
  payment_state:z.enum(['unverified','partial','paid_waiting_seat','confirmed','refunded']).optional(),
  received_amount:amount.optional(),remaining_amount:amount.optional(),
  club:z.object({name:text,address:text,logo_url:text}),
  player_name:text,tournament_name:text,total_pay:amount,completed_at:text,
  completed_at_source:z.enum(['confirmed_at','issued_at']).nullable(),
  table_number:z.number().int().positive().nullable(),seat_number:z.number().int().positive().nullable(),starting_stack:amount,
}).refine(receipt=>receipt.qr_value===receipt.receipt_code);

/** Client-injected server-authorized receipt reader for every application shell. */
export async function fetchBuyinReceiptWithClient(
  client: BuyinReceiptClient,
  lookup: BuyinReceiptLookup,
): Promise<BuyinReceiptSnapshot | null> {
  const body = "registrationId" in lookup
    ? { registration_id: lookup.registrationId }
    : { receipt_code: lookup.receiptCode };
  const controller=new AbortController();
  try {
    const { data, error } = await observeTrackerContextRead(client.functions.invoke("get-buyin-receipt", { body,signal:controller.signal }));
    if (error) return null;
    const parsed=snapshotSchema.safeParse(data?.receipt);
    if(!parsed.success)return null;
    const receipt=parsed.data;
    if('registrationId' in lookup ? receipt.registration_id!==lookup.registrationId : receipt.receipt_code!==lookup.receiptCode)return null;
    // safeParse above enforces required fields at runtime. With strictNullChecks
    // off, Zod's inferred nullable object keys appear optional to TypeScript.
    return receipt as BuyinReceiptSnapshot;
  } catch { return null; }
  finally { controller.abort(); }
}

/** Converts the read-only server snapshot into the shared print-safe view model. */
export function toSeatReceiptData(
  snapshot: BuyinReceiptSnapshot,
  fallback?: SeatReceiptData | null,
): SeatReceiptData {
  return {
    tournamentName: snapshot.tournament_name?.trim() || fallback?.tournamentName || "",
    playerName: snapshot.player_name?.trim() || fallback?.playerName || "",
    tableNumber: snapshot.table_number ?? fallback?.tableNumber ?? null,
    seatNumber: snapshot.seat_number ?? fallback?.seatNumber ?? null,
    receiptCode: snapshot.receipt_code ?? fallback?.receiptCode ?? "",
    qrValue: snapshot.qr_value ?? fallback?.qrValue ?? "",
    startingStack: snapshot.starting_stack ?? fallback?.startingStack ?? null,
    status: snapshot.status || fallback?.status || "confirmed",
    clubName: snapshot.club?.name?.trim() || fallback?.clubName || null,
    clubAddress: snapshot.club?.address?.trim() || fallback?.clubAddress || null,
    clubLogoUrl: snapshot.club?.logo_url?.trim() || fallback?.clubLogoUrl || null,
    totalPay: snapshot.total_pay ?? fallback?.totalPay ?? null,
    completedAt: snapshot.completed_at ?? fallback?.completedAt ?? null,
    completedAtSource: snapshot.completed_at_source ?? fallback?.completedAtSource ?? null,
    confirmationCode: snapshot.reference_code ?? fallback?.confirmationCode ?? null,
  };
}
