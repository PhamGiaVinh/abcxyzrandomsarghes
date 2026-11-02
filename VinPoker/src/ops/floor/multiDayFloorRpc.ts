import type { OpsClient } from "@/ops/opsMutations";
import {verifyMultiDayFloorRead} from './multiDayFloorRead';
import {parsePrizeConfigurationSaveReceipt,parsePrizeConfigurationReceiptLookup} from './multiDayPrizeConfigurationIntent';

type RpcResult = { data: unknown; error: { message?: string; code?: string } | null };
type MultiDayRpcClient = { rpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult> };

/** Delegated Ops RPC seam. The shell supplies its authenticated client. */
export async function callMultiDayFloorRpc<T>(
  client: OpsClient,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await (client as unknown as MultiDayRpcClient).rpc(name, args);
  if (error) throw error;
  verifyMultiDayFloorRead(name,data,args.p_event_id);
  if(name==='multi_day_save_prize_configuration_v1')parsePrizeConfigurationSaveReceipt(data,args);
  if(name==='multi_day_prize_configuration_receipt_v1')parsePrizeConfigurationReceiptLookup(data,args);
  const mutations=['multi_day_set_qualification_rules_v2','multi_day_lock_qualification_v1',
    'multi_day_request_payout_correction_v1','multi_day_approve_payout_correction_v1'];
  if(mutations.includes(name)) {
    const r=data&&typeof data==='object'&&!Array.isArray(data)?data as Record<string,unknown>:null;
    const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
    const hash=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{32}$/.test(v);
    let valid=!!r&&r.ok===true&&typeof r.idempotent==='boolean';
    if(r&&valid) {
      if(name==='multi_day_set_qualification_rules_v2')valid=typeof r.itmPercent==='number'&&Number.isFinite(r.itmPercent)
        &&r.itmPercent>0&&r.itmPercent<=100&&r.day2Percent===args.p_day2_percent;
      else if(name==='multi_day_lock_qualification_v1')valid=r.eventId===args.p_event_id&&r.sourceHash===args.p_expected_source_hash
        &&uuid(r.finalTournamentId)&&hash(r.selectionHash)&&Number.isSafeInteger(r.participationCount)&&Number(r.participationCount)>0
        &&['SELECT_LARGEST','SUM_STACKS'].includes(String(r.policy))&&r.fundingState==='NOT_VERIFIED'&&r.seatingState==='HELD'&&r.payoutFinalization==='HELD';
      else if(name==='multi_day_request_payout_correction_v1')valid=r.requestId===args.p_request_id&&r.state==='PENDING_APPROVAL';
      else valid=uuid(r.correctionId)&&hash(r.revision)&&(r.idempotent===true||r.paymentExecution==='NOT_PERFORMED');
    }
    if(!valid)throw new Error('Multi-day mutation outcome is unverified. Keep the request and refresh its status.');
  }
  if(name==='multi_day_finalize_payout_v1') {
    const receipt=data&&typeof data==='object'&&!Array.isArray(data)?data as Record<string,unknown>:null;
    const expected={eventId:args.p_event_id,rulesVersion:args.p_expected_rules_version,
      fundingRevision:args.p_expected_funding_revision,qualificationRevision:args.p_expected_qualification_revision,
      payoutInputHash:args.p_expected_payout_input_hash};
    if(!receipt||receipt.ok!==true||receipt.state!=='FINALIZED_OBLIGATIONS'
      ||receipt.paymentExecution!=='NOT_PERFORMED'||typeof receipt.idempotent!=='boolean'
      ||Object.entries(expected).some(([key,value])=>receipt[key]!==value)) {
      throw new Error('Multi-day finalization outcome is unverified. Keep the request and refresh its status.');
    }
  }
  return data as T;
}
