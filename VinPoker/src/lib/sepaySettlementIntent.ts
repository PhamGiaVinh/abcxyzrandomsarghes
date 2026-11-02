import {z} from 'zod';

const uuid=z.string().uuid();
const integer=z.number().int().safe().nonnegative();
const snapshotSchema=z.object({bank_amount:z.number().int().safe().nullable(),total_pay:integer.nullable()}).strict();
const intentSchema=z.object({actorId:uuid,requestId:uuid,bankId:uuid,registrationId:uuid.nullable(),clubId:uuid.nullable(),
 operation:z.enum(['confirm','ignore']),reason:z.string().max(2000).nullable(),resolved:z.boolean().optional(),snapshot:snapshotSchema.optional()}).strict()
 .refine(i=>(i.operation==='confirm'?i.registrationId!==null:i.registrationId===null)
  &&(i.reason===null||i.reason.length>0&&i.reason===i.reason.trim()),'invalid SePay intent');
export type SePayIntent=z.infer<typeof intentSchema>;
export const sepayJournalKey=(actorId:string)=>`vinpoker:sepay-pending:v1:${actorId}`;
export function sepayPayload(i:SePayIntent){
 return {operation:i.operation,bank_transaction_id:i.bankId,registration_id:i.registrationId,reason:i.reason,
  ...(i.snapshot?{snapshot:i.snapshot}:{})};
}
export function sepayIntentArgs(i:SePayIntent,mode:'commit'|'receipt'){
 intentSchema.parse(i);
 return {p_mode:mode,p_operation:i.operation,p_bank_transaction_id:i.bankId,p_registration_id:i.registrationId,
  p_reason:i.reason,p_request_id:i.requestId,...(i.snapshot?{p_expected_snapshot:i.snapshot}:{})};
}
export function parseSePayJournal(raw:string,actorId:string):SePayIntent{
 const i=intentSchema.parse(JSON.parse(raw));
 if(i.actorId!==actorId)throw Error('SEPAY_JOURNAL_ACTOR_MISMATCH');
 return i;
}
/** Persist and read back before sending. A conflicting pending intent is never discarded. */
export function saveSePayJournal(storage:Pick<Storage,'getItem'|'setItem'>,key:string,intent:SePayIntent){
 const i=intentSchema.parse(intent),raw=storage.getItem(key);
 if(raw!==null){
  const prior=parseSePayJournal(raw,i.actorId);
  const same=prior.requestId===i.requestId&&prior.bankId===i.bankId&&prior.clubId===i.clubId
   &&JSON.stringify(sepayPayload(prior))===JSON.stringify(sepayPayload(i));
  if((!prior.resolved&&!same)||(prior.requestId===i.requestId&&!same)
   ||(prior.resolved&&same&&!i.resolved))throw Error('SEPAY_JOURNAL_CONFLICT');
 }
 const serialized=JSON.stringify(i);storage.setItem(key,serialized);
 if(storage.getItem(key)!==serialized)throw Error('SEPAY_JOURNAL_WRITE_FAILED');
}
const payloadSchema=z.object({operation:z.enum(['confirm','ignore']),bank_transaction_id:uuid,
 registration_id:uuid.nullable(),reason:z.string().nullable(),snapshot:snapshotSchema.optional()}).strict();
const envelopeSchema=z.object({ok:z.literal(true),status:z.enum(['receipt_found','receipt_not_found']),actor_id:uuid,
 request_id:uuid,club_id:uuid.nullable(),payload:payloadSchema,request_hash:z.string().regex(/^[a-f0-9]{64}$/),
 receipt:z.unknown(),replayed:z.boolean()}).strict();
const record=z.record(z.unknown());
export type SePayResult={status:'missing'}|{status:'rejected';error:string}|{status:'ignored'}
 |{status:'seated';surplus:number}|{status:'partial';received:number;remaining:number;surplus:number}
 |{status:'waiting'|'review';surplus:number};
export function sepayRejectionMessage(code:string):string{
 const messages:Record<string,string>={unauthorized:'Phiên đăng nhập hết hạn — đăng nhập lại.',actor_not_allowed:'Tài khoản không có quyền cho CLB này.',
  bank_txn_not_found:'Không tìm thấy giao dịch.',registration_not_found:'Không tìm thấy đăng ký.',club_unresolved:'Không xác định được CLB của giao dịch.',
  club_mismatch:'Tiền của CLB khác — không thể xác nhận cho đăng ký này.',already_settled:'Giao dịch đã được xử lý; kiểm tra đối soát.',
  registration_already_settled:'Đăng ký đã được thanh toán bằng giao dịch khác.',amount_missing:'Giao dịch chưa có số tiền.',
  reason_required_on_mismatch:'Số tiền lệch — bắt buộc nhập lý do.',seating_failed:'Hết bàn/ghế — kiểm tra trạng thái thanh toán trước khi thử lại.',
  club_unresolved_super_admin_only:'Không xác định được CLB — chỉ super admin xử lý.',cashier_tour_disabled:'Chức năng Cashier của CLB đang tắt.',
  invalid_priced_registration:'Thông tin hoặc trạng thái đăng ký không còn hợp lệ.',invalid_incoming_bank_transfer:'Giao dịch không phải khoản chuyển vào hợp lệ.',
  bank_movement_already_recorded:'Khoản tiền đã được ghi nhận; không thu lại.',bank_not_actionable:'Giao dịch không còn ở trạng thái cần xử lý.',
  registration_closed:'Giải đã đóng đăng ký.',sepay_snapshot_changed:'Số tiền đã thay đổi. Yêu cầu cũ đã bị từ chối; tải lại đối soát trước khi xác nhận.'};
 return messages[code]??'Máy chủ từ chối yêu cầu. Kiểm tra đối soát trước khi gửi yêu cầu mới.';
}
/** A recognized, exact-scoped server receipt is required before settling a journal. */
export function parseSePayReceipt(value:unknown,i:SePayIntent):SePayResult{
 const r=envelopeSchema.parse(value),expected=sepayPayload(i);
 if(r.actor_id!==i.actorId||r.request_id!==i.requestId||(i.clubId!==null&&r.club_id!==i.clubId)
  ||(['operation','bank_transaction_id','registration_id','reason'] as const).some(k=>r.payload[k]!==expected[k])
  ||(r.payload.snapshot===undefined)!==(i.snapshot===undefined)
  ||r.payload.snapshot?.bank_amount!==i.snapshot?.bank_amount||r.payload.snapshot?.total_pay!==i.snapshot?.total_pay)throw Error('SEPAY_RECEIPT_SCOPE');
 if(r.status==='receipt_not_found'){
  if(r.receipt!==null)throw Error('SEPAY_RECEIPT_ABSENCE');
  return {status:'missing'};
 }
 const result=record.parse(r.receipt);
 if(result.ok===false){return {status:'rejected',error:z.string().min(1).parse(result.error)};}
 if(result.ok!==true)throw Error('SEPAY_RESULT_UNKNOWN');
 if(i.operation==='ignore'){
  if((result.already_ignored===true&&result.outcome==null)
   ||(result.outcome==='dismissed'&&result.club_id===r.club_id))return {status:'ignored'};
  throw Error('SEPAY_IGNORE_UNKNOWN');
 }
 if(result.registration_id!==i.registrationId||result.club_id!==r.club_id||r.club_id===null)throw Error('SEPAY_RESULT_SCOPE');
 // Unpriced legacy confirm has no surplus field; zero is part of that contract,
 // not a fallback for malformed new allocation outcomes.
 const surplus=result.outcome==='manual_confirmed'&&result.surplus===undefined?0:integer.parse(result.surplus);
 if(result.outcome==='partial_received'&&result.payment_state==='partial'){
  integer.parse(result.applied);
  return {status:'partial',received:integer.parse(result.received),remaining:integer.positive().parse(result.remaining),surplus};
 }
 const seated=record.parse(result.confirm);
 if(result.outcome==='manual_confirmed'&&seated.ok===true&&seated.registration_id===i.registrationId
  &&['entry_id','seat_id','receipt_id','table_id'].every(k=>uuid.safeParse(seated[k]).success)
  &&integer.positive().safeParse(seated.seat_number).success)return {status:'seated',surplus};
 if(result.payment_state==='paid'&&seated.payment_state==='paid'){
  integer.parse(result.applied);
  if(result.outcome==='paid_waiting_seat'&&seated.ok===true&&seated.seating_state==='waiting')return {status:'waiting',surplus};
  if(result.outcome==='paid_seating_review'&&seated.ok===false&&seated.seating_state==='needs_review'
   &&typeof seated.error==='string'&&seated.error)return {status:'review',surplus};
 }
 throw Error('SEPAY_CONFIRM_UNKNOWN');
}
