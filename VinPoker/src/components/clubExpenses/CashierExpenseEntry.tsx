import {useEffect,useMemo,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {z} from 'zod';
import {useAuth} from '@/hooks/useAuth';
import {supabase} from '@/integrations/supabase/client';
import {sessionReadEpoch} from '@/lib/sessionReadEpoch';
import {observeTrackerContextRead} from '@/lib/tournament/observeTrackerContextRead';
import {financeBusinessToday} from '@/lib/financeSummaryRead';
import {formatDateTime,formatVND} from '@/lib/format';
import {EXPENSE_CATEGORIES,EXPENSE_CATEGORY_LABELS,type ExpenseCategory} from '@/lib/clubExpenses/types';
import {parseExpenseAmount} from '@/lib/clubExpenses/amount';
import {CASHIER_EXPENSE_LOOKUP_SELECT,cashierExpenseIntent,cashierExpenseLookup,cashierExpensePayload,cashierExpenseResult,
 clearCashierExpenseIntent,loadCashierExpenseIntent,saveCashierExpenseIntent,type CashierExpenseIntent,type CashierExpenseResult} from '@/lib/clubExpenses/cashierExpensePayment';
import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Textarea} from '@/components/ui/textarea';

const time=z.string().datetime({offset:true});
const tillSchema=z.object({id:z.string().uuid(),club_id:z.string().uuid(),opened_at:time,closed_at:time.nullable(),opening_cash:z.number().int().safe()});
const policySchema=z.object({club_id:z.string().uuid(),enabled:z.boolean(),expense_cash_source_enabled:z.boolean()});
const summarySchema=z.object({ok:z.literal(true),shift_id:z.string().uuid(),club_id:z.string().uuid(),closed_at:time.nullable(),expected_cash:z.number().int().safe()});
const unknown='Chưa xác minh được kết quả. Giữ yêu cầu cũ để kiểm tra hoặc gửi lại cùng mã; không tạo dòng chi mới.';
const selectClass='min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground';
type Source={state:'ready';till:z.infer<typeof tillSchema>;balance:number}|{state:'denied'|'disabled'|'closed'};

export default function CashierExpenseEntry(props:{clubId:string;allowNew?:boolean;onPendingChange?:(value:boolean)=>void}){
 const {user}=useAuth();
 return <CashierExpenseForm key={`${user?.id??''}:${props.clubId}`} {...props}/>;
}
function CashierExpenseForm({clubId,allowNew=false,onPendingChange}:{clubId:string;allowNew?:boolean;onPendingChange?:(value:boolean)=>void}){
 const {user,session,loading}=useAuth(),actor=user?.id??'',epoch=sessionReadEpoch(session),queryClient=useQueryClient();
 const context=useMemo(()=>({actor,clubId,epoch,loading}),[actor,clubId,epoch,loading]);
 const active=useRef(context);active.current=context;
 const mounted=useRef(true),lock=useRef<object|null>(null);
 const journal=useMemo(()=>{try{return {intent:actor?loadCashierExpenseIntent(sessionStorage,actor,clubId):null,error:false};}catch{return {intent:null,error:true};}},[actor,clubId]);
 const restored=useRef(journal.intent?.requestId??null);
 const [,redraw]=useState(0),[busyContext,setBusyContext]=useState<object|null>(null),[error,setError]=useState<string|null>(null),[receipt,setReceipt]=useState<{context:object;result:CashierExpenseResult}|null>(null);
 const busy=busyContext===context;
 const [amount,setAmount]=useState(journal.intent?String(journal.intent.input.amountVnd):'');
 const [category,setCategory]=useState<ExpenseCategory>(journal.intent?.input.category??'misc');
 const [date,setDate]=useState(journal.intent?.input.incurredAt.slice(0,10)??financeBusinessToday());
 const [description,setDescription]=useState(journal.intent?.input.description??'');
 const [selected,setSelected]=useState(journal.intent?.input.shiftId??'');
 const enabled=Boolean(actor&&session?.access_token&&!loading);
 const current=()=>mounted.current&&active.current===context&&enabled;
 const assertCurrent=()=>{if(!current())throw Error('Phiên chi từ két đã thay đổi. Yêu cầu cũ được giữ để kiểm tra.');};
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>onPendingChange?.(busy||Boolean(journal.intent)||journal.error),[busy,journal,journal.intent,journal.error,onPendingChange]);
 const source=useQuery({queryKey:['cashierExpenseSource',clubId,actor,epoch,loading],enabled,retry:false,
  refetchInterval:5_000,refetchOnWindowFocus:'always',refetchOnReconnect:'always',
  queryFn:async():Promise<Source>=>{
   assertCurrent();
   const permission=await observeTrackerContextRead(supabase.rpc('is_club_cashier',{_user_id:actor,_club_id:clubId}));assertCurrent();
   if(permission.error)throw permission.error;
   if(z.boolean().parse(permission.data)!==true)return {state:'denied'};
   const [policyResult,tillResult]=await observeTrackerContextRead(Promise.all([
    supabase.rpc('cashier_expense_source_status_v1' as never,{p_club_id:clubId} as never),
    supabase.from('cashier_till_shifts' as never).select('id,club_id,opening_cash,opened_at,closed_at').eq('club_id',clubId).is('closed_at',null).maybeSingle(),
   ]));assertCurrent();
   if(policyResult.error)throw policyResult.error;if(tillResult.error)throw tillResult.error;
   if(policyResult.data===null)return {state:'disabled'};
   const policy=policySchema.parse(policyResult.data);if(policy.club_id!==clubId)throw Error('CASHIER_EXPENSE_SOURCE_SCOPE');
   if(!policy.enabled||!policy.expense_cash_source_enabled)return {state:'disabled'};
   if(tillResult.data===null)return {state:'closed'};
   const till=tillSchema.parse(tillResult.data);if(till.club_id!==clubId||till.closed_at!==null)throw Error('CASHIER_EXPENSE_SOURCE_SCOPE');
   const r=await observeTrackerContextRead(supabase.rpc('cashier_shift_summary_v1' as never,{p_shift_id:till.id} as never));assertCurrent();
   if(r.error)throw r.error;const summary=summarySchema.parse(r.data);
   if(summary.shift_id!==till.id||summary.club_id!==clubId)throw Error('CASHIER_EXPENSE_SOURCE_SCOPE');
   return summary.closed_at===null?{state:'ready',till,balance:summary.expected_cash}:{state:'closed'};
  }});
 const refresh=()=>{void queryClient.invalidateQueries({queryKey:['cashierExpenseSource',clubId]});void queryClient.invalidateQueries({queryKey:['clubExpenses','summary','live',clubId]});};
 const lookup=async(intent:CashierExpenseIntent)=>{
  assertCurrent();
  const r=await observeTrackerContextRead(supabase.from('cashier_till_shifts' as never).select(CASHIER_EXPENSE_LOOKUP_SELECT)
   .eq('id',intent.input.shiftId).eq('club_id',intent.clubId)
   .eq('receipts.request_id',intent.requestId).eq('club.expenses.idempotency_key','finance-cash-expense:'+intent.requestId).maybeSingle());
  assertCurrent();if(r.error)throw r.error;return cashierExpenseLookup(intent,r.data);
 };
 const finish=(intent:CashierExpenseIntent,result:CashierExpenseResult)=>{
  assertCurrent();clearCashierExpenseIntent(sessionStorage,intent);journal.intent=null;restored.current=null;
  setReceipt({context,result});setError(null);setAmount('');setDescription('');redraw(v=>v+1);refresh();
 };
 const releaseClosed=(intent:CashierExpenseIntent)=>{
  assertCurrent();clearCashierExpenseIntent(sessionStorage,intent);journal.intent=null;restored.current=null;setSelected('');redraw(v=>v+1);
  setError('Yêu cầu cũ chưa ghi và két đã đóng. Chọn két đang mở trước khi tạo một lần chi mới.');refresh();
 };
 const checkPending=async()=>{
  if(lock.current===context||!journal.intent||journal.error||!current())return;
  lock.current=context;setBusyContext(context);const intent=journal.intent;
  try{const r=await lookup(intent);if(r.state==='committed')finish(intent,r.result);else if(r.state==='not_committed')releaseClosed(intent);else setError(unknown);}
  catch{if(current())setError(unknown);}
  finally{if(lock.current===context)lock.current=null;if(current())setBusyContext(null);}
 };
 // Recovery after reload performs only a read, never an automatic payment retry.
 const checkRef=useRef(checkPending);checkRef.current=checkPending;
 useEffect(()=>{if(enabled&&restored.current){restored.current=null;void checkRef.current();}},[context,enabled]);
 const submit=async()=>{
  if(lock.current===context||journal.error||!current())return;
  lock.current=context;setBusyContext(context);setError(null);setReceipt(null);let timer:ReturnType<typeof setTimeout>|undefined;
  try{
   assertCurrent();
   if(sessionStorage.getItem(`vinpoker:expense-record:v1:${actor}:${clubId}`)!==null)throw Error('Có lần ghi chi phí cũ cần xác minh. Không gửi thêm khoản chi từ két.');
   const existing=loadCashierExpenseIntent(sessionStorage,actor,clubId);
   let intent:CashierExpenseIntent;
   if(existing){intent=existing;}
   else{
    if(!allowNew)throw Error('Chi từ két đang tạm tắt. Chỉ kiểm tra lại yêu cầu đã lưu.');
    const value=parseExpenseAmount(amount);if(value===null||value<=0||source.data?.state!=='ready'||selected!==source.data.till.id||value>source.data.balance)throw Error('Chọn đúng két đang mở và số tiền phù hợp số dư đã ghi nhận.');
    intent=cashierExpenseIntent(actor,clubId,{shiftId:selected,category,amountVnd:value,incurredAt:`${date}T12:00:00+07:00`,description:description.trim()||null});
   }
   saveCashierExpenseIntent(sessionStorage,intent);journal.intent=intent;redraw(v=>v+1);
   let response:{data:unknown;error:{message?:string;code?:string}|null}|null=null;
   try{response=await Promise.race([Promise.resolve(supabase.rpc('record_cashier_club_expense_v1' as never,cashierExpensePayload(intent) as never)),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error(unknown)),20_000);})]);}catch{/* A transport failure is not a rollback. */}
   finally{clearTimeout(timer);}
   assertCurrent();const result=response&&!response.error?cashierExpenseResult(intent,response.data):null;
   if(result){finish(intent,result);return;}
   const recovered=await lookup(intent);
   if(recovered.state==='committed'){finish(intent,recovered.result);return;}
   if(recovered.state==='not_committed'){releaseClosed(intent);return;}
   const message=response?.error?.message;
   setError(message?.includes('INSUFFICIENT')?'Két không đủ tiền đã ghi nhận. Giữ yêu cầu cũ để đối soát rồi gửi lại.':message?.includes('DISABLED')?'Chi từ két hiện chưa được bật. Yêu cầu cũ được giữ để kiểm tra.':unknown);
  }catch(cause){if(current())setError(journal.intent?unknown:cause instanceof z.ZodError?'Kiểm tra số tiền, ngày chi phí và két trước khi gửi.':cause instanceof Error?cause.message:unknown);}
  finally{clearTimeout(timer);if(lock.current===context)lock.current=null;if(current())setBusyContext(null);}
 };
 const pending=Boolean(journal.intent),ready=enabled&&!source.isError&&source.data?.state==='ready'?source.data:null,amountValue=parseExpenseAmount(amount);
 const canSubmit=enabled&&!busy&&!journal.error&&source.data?.state!=='denied'&&(pending||(allowNew&&Boolean(ready&&selected===ready.till.id&&amountValue!==null&&amountValue>0&&amountValue<=ready.balance)));
 return <Card className="min-w-0 space-y-4 p-4">
  <div><h2 className="text-sm font-semibold">Khoản chi mới từ két Cashier</h2><p className="mt-1 text-xs text-muted-foreground">Ghi một chi phí mới và tiền thực chi từ két. Không dùng để trả lại một khoản chi đã ghi trước đó hoặc ghi giảm chi phí.</p></div>
  {receipt?.context===context&&enabled&&!source.isError&&source.data&&source.data.state!=='denied'&&<div role="status" className="rounded-md border border-primary/30 p-3 text-sm"><strong>Đã ghi chi từ két</strong><p className="mt-1 text-lg font-semibold tabular-nums">{formatVND(receipt.result.amount_vnd)}</p><p className="text-xs text-muted-foreground">Chi lúc {formatDateTime(receipt.result.paid_at)}</p><p className="mt-1 break-all text-xs">Chứng từ: {receipt.result.expense_id}</p></div>}
  {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
  {journal.error?<p role="alert" className="text-sm text-destructive">Không đọc được yêu cầu đang chờ. Chưa gửi khoản chi mới; cần kiểm tra dữ liệu lưu trên thiết bị.</p>
   :source.data?.state==='denied'&&!pending?<p role="alert" className="text-sm">Tài khoản hiện tại chưa có quyền chi từ két Cashier của CLB này.</p>
   :<form className="space-y-3" onSubmit={event=>{event.preventDefault();if(canSubmit)void submit();}}>
    {pending&&<p className="text-sm text-amber-400">Có yêu cầu chi từ két chưa xác minh. Nội dung và mã giao dịch được giữ nguyên.</p>}
    {!pending&&(source.isError?<p role="alert" className="text-sm text-destructive">Không xác minh được két. <Button type="button" variant="outline" size="sm" onClick={()=>void source.refetch()}>Kiểm tra lại két</Button></p>
     :!source.data?<p className="text-sm text-muted-foreground">Đang kiểm tra quyền và két…</p>
     :source.data.state==='disabled'?<p className="text-sm text-muted-foreground">Chi trực tiếp từ két chưa được bật cho CLB này.</p>
     :source.data.state==='closed'?<p className="text-sm text-muted-foreground">Chưa có két Cashier đang mở. Mở két ở khu Thu ngân rồi kiểm tra lại.</p>:null)}
    <fieldset disabled={busy||pending||!ready} className="min-w-0 space-y-3">
     <div className="space-y-1.5"><Label htmlFor="cash-expense-till">Két chi tiền</Label><select id="cash-expense-till" className={selectClass} value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Chọn két đang mở</option>{ready&&<option value={ready.till.id}>Két mở {formatDateTime(ready.till.opened_at)}</option>}{pending&&selected!==ready?.till.id&&<option value={selected}>Két của yêu cầu cũ · {selected.slice(-8)}</option>}</select>{ready&&<p className="text-xs text-muted-foreground">Số dư đã ghi nhận: <strong className="tabular-nums">{formatVND(ready.balance)}</strong>. Server kiểm tra lại khi chi.</p>}</div>
     <div className="space-y-1.5"><Label htmlFor="cash-expense-category">Danh mục chi phí</Label><select id="cash-expense-category" className={selectClass} value={category} onChange={e=>setCategory(e.target.value as ExpenseCategory)}>{EXPENSE_CATEGORIES.map(c=><option key={c} value={c}>{EXPENSE_CATEGORY_LABELS[c]}</option>)}</select></div>
     <div className="grid min-w-0 gap-3 min-[375px]:grid-cols-2"><div className="min-w-0 space-y-1.5"><Label htmlFor="cash-expense-amount">Số tiền chi</Label><Input id="cash-expense-amount" className="min-h-11 min-w-0" inputMode="numeric" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="1.000.000"/>{amountValue!==null&&amount&&<p className="text-xs tabular-nums">{formatVND(amountValue)}</p>}</div><div className="min-w-0 space-y-1.5"><Label htmlFor="cash-expense-date">Ngày chi phí</Label><Input id="cash-expense-date" className="min-h-11 min-w-0" type="date" value={date} onChange={e=>setDate(e.target.value)}/></div></div>
     <div className="space-y-1.5"><Label htmlFor="cash-expense-description">Nội dung chi</Label><Textarea id="cash-expense-description" value={description} onChange={e=>setDescription(e.target.value)} placeholder="Ví dụ: thanh toán vật tư mới"/></div>
    </fieldset>
    {ready&&amountValue!==null&&amountValue>ready.balance&&!pending&&<p className="text-sm text-destructive">Số tiền vượt số dư đã ghi nhận của két. Kiểm tra lại số tiền và nguồn chi.</p>}
    {pending&&<Button className="min-h-11 w-full" type="button" variant="outline" disabled={busy||!enabled} onClick={()=>void checkPending()}>Kiểm tra yêu cầu cũ</Button>}
    <Button type="submit" className="min-h-11 w-full" disabled={!canSubmit}>{busy?'Đang xác minh…':pending?'Gửi lại yêu cầu cũ':'Chi từ két'}</Button>
   </form>}
 </Card>;
}
