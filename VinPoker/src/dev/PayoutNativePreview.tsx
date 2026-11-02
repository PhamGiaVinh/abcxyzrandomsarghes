import {StockInLockTestGate} from './StockInLockTestGate';
import Notifications from "@/pages/Notifications";
import { MovePlayerDialog } from "@/components/cashier/tournament-live/MovePlayerDialog";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { TransferInstructions } from '@/components/TransferInstructions';
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { useOpsAuth } from '@/ops/auth/OpsAuthProvider';
import { opsClient } from '@/integrations/supabase/opsClient';
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { SupabaseClientProvider } from '@/integrations/supabase/SupabaseClientContext';
import {createClient} from '@supabase/supabase-js';
import {useMemo} from 'react';
import {useTournamentRedrawTv} from '@/hooks/useTournamentRedrawTv';
import {TvRedrawScreen} from '@/components/tv/TvRedrawScreen';
import type {Database} from '@/integrations/supabase/types';
import {QueryClient,QueryClientProvider,useQueryClient} from '@tanstack/react-query';
import {useDealerSwingHealth} from '@/hooks/useDealerSwingHealth';
import DealerSwingInfraHealth from '@/components/cashier/dealer-swing/DealerSwingInfraHealth';
import {MemoryRouter,Routes,Route} from 'react-router-dom';
import {useStandaloneHandInput} from '@/components/cashier/tournament-live/handinput/useStandaloneHandInput';
import {StandaloneHandInputConsole} from '@/components/cashier/tournament-live/handinput/StandaloneHandInputConsole';
import {ViewerSyncStatus} from '@/components/cashier/tournament-live/handinput/ViewerSyncStatus';
import {TrackerInputCardProvider} from '@/components/tracker/TrackerCardStyle';
import {parseReplayTarget,type ReplayTarget} from '@/components/cashier/tournament-live/viewer-hub/replayTarget';
import {PendingFinishControls} from '@/components/cashier/tournament-live/handinput/PendingFinishControls';
import {fetchBuyinReceipt,toSeatReceiptData,type BuyinReceiptSnapshot} from '@/components/tournament/seat/buyinReceipt';
import {createFloorTableControlV3Client,type FloorTableControlV3Rpc} from '@/lib/floorTableControlV3';
import type {Tournament} from '@/types/tournament';
import type {ComponentProps} from 'react';
import {parseFinalizationIntent,persistFinalizationIntent,type MultiDayFinalizationIntent} from '@/ops/floor/multiDayFinalizationIntent';
import {parseQualificationIntent,persistQualificationIntent,type MultiDayQualificationIntent} from '@/ops/floor/multiDayQualificationIntent';
import {parseRulesIntent,persistRulesIntent,type MultiDayRulesIntent} from '@/ops/floor/multiDayRulesIntent';
import {AllInConfirmation} from '@/components/cashier/tournament-live/handinput/AllInConfirmation';
import {VoidConfirmation} from '@/components/cashier/tournament-live/handinput/VoidConfirmation';
import {DealerFloorAlertControls} from '@/components/tracker/DealerFloorAlertControls';
// Match the real DealerTabletCockpit host when rendering these controls alone.
import '@/components/tracker/dealerTablet.css';
import {sessionReadEpoch} from '@/lib/sessionReadEpoch';
import {parsePrizePaymentIntent,persistPrizePaymentIntent} from '@/lib/prizePaymentIntent';
import {TournamentRankingReviewPanel} from '@/components/cashier/tournament-live/TournamentRankingReviewPanel';
// Actual optional surfaces load only when selected. The local hand probe must
// not eagerly transform the independent F&B/social/payroll/staking workspaces.
const FnbCategoryNative=lazy(()=>import('@/components/fnb/admin/CategoryManager').then(m=>({default:m.CategoryManager})));
const FnbMenuNative=lazy(()=>import('@/components/fnb/admin/MenuManager').then(m=>({default:m.MenuManager})));
const FnbIngredientNative=lazy(()=>import('@/components/fnb/admin/IngredientManager').then(m=>({default:m.IngredientManager})));
const FnbRecipeNative=lazy(()=>import('@/components/fnb/admin/RecipeEditor').then(m=>({default:m.RecipeEditor})));
const FnbStockInNative=lazy(()=>import('@/components/fnb/admin/StockInForm').then(m=>({default:m.StockInForm})));
const FnbStocktakeNative=lazy(()=>import('@/components/fnb/admin/StocktakeBoard').then(m=>({default:m.StocktakeBoard})));
const ClubsNative=lazy(()=>import('@/pages/Clubs'));
const PokerIqEditorNative=lazy(()=>import('@/components/admin/PokerIqQuestionsEditor').then(m=>({default:m.PokerIqQuestionsEditor})));
const LeaderboardNative=lazy(()=>import('@/pages/Leaderboard'));
const FnbCounter=lazy(()=>import('@/pages/FnbCounter'));
const AdminStreamManager=lazy(()=>import('@/components/admin/AdminStreamManager').then(m=>({default:m.AdminStreamManager})));
const LiveFinanceOverview=lazy(()=>import('@/components/accounting-control/live/LiveOverviewTab').then(m=>({default:m.LiveOverviewTab})));
const LiveFinancePayroll=lazy(()=>import('@/components/accounting-control/live/LivePayrollTab').then(m=>({default:m.LivePayrollTab})));
const AccountantFinanceTab=lazy(()=>import('@/components/accountant/AccountantFinanceTab').then(m=>({default:m.AccountantFinanceTab})));
const OpsFinanceWorkspace=lazy(()=>import('@/ops/finance/OpsFinanceWorkspace'));
const OpsIntelligenceCommandCenterV1=lazy(()=>import('@/ops/intelligence/OpsIntelligenceCommandCenterV1').then(m=>({default:m.OpsIntelligenceCommandCenterV1})));
const PrizeConfigurationNativePreview=lazy(()=>import('./PrizeConfigurationNativePreview'));
const ImageCodecNativePreview=lazy(()=>import('./ImageCodecNativePreview'));
const TvAssetNativePreview=lazy(()=>import('./TvAssetNativePreview'));
const TvDisplaysNative=lazy(()=>import('@/components/cashier/tournament-live/TvDisplaysPanel').then(m=>({default:m.TvDisplaysPanel})));
const FnbKitchenDisplay=lazy(()=>import('@/pages/FnbKitchenDisplay'));
const ExecuteReleaseModal=lazy(()=>import('@/pages/AdminStaking').then(m=>({default:m.ExecuteReleaseModal})));
const StakingReleaseEffectsStatus=lazy(()=>import('@/components/admin/StakingReleaseEffectsStatus').then(m=>({default:m.StakingReleaseEffectsStatus})));
const StakingPortfolio=lazy(()=>import('@/pages/StakingPortfolio'));
const DealDetailDialog=lazy(()=>import('@/pages/Marketplace').then(m=>({default:m.DealDetailDialog})));
const GroupInvite=lazy(()=>import('@/pages/GroupInvite'));
const DealerPayrollTab=lazy(()=>import('@/components/cashier/DealerPayrollTab'));
const DealerSalaryScreen=lazy(()=>import('@/components/dealer-app/salary/DealerSalaryScreen').then(m=>({default:m.DealerSalaryScreen})));
const ChatInbox=lazy(()=>import('@/pages/ChatInbox'));
const DirectChat=lazy(()=>import('@/pages/DirectChat'));
const Layout=lazy(()=>import('@/components/Layout').then(m=>({default:m.Layout})));
const TvBrandingEditor=lazy(()=>import('@/components/cashier/tournament-live/TvBrandingEditor').then(m=>({default:m.TvBrandingEditor})));
const OpsTvBrandingEditor=lazy(()=>import('@/components/cashier/tournament-live/TvBrandingEditor').then(m=>({default:m.TvBrandingEditorWorkspace})));
const OpsMultiDayEvent=lazy(()=>import('@/components/floor/MultiDayFloorEventPanel').then(m=>({default:m.MultiDayFloorEventWorkspace})));
const DealerManagementTab=lazy(()=>import('@/components/cashier/DealerManagementTab'));
const DealerPhoneCheckinSheet=lazy(()=>import('@/components/ops/dealer-swing/DealerPhoneCheckinSheet').then(m=>({default:m.DealerPhoneCheckinSheet})));
const DealerSwingNative=lazy(()=>import('@/components/cashier/DealerSwingTab'));
const PrizePayoutTrackingSection=lazy(()=>import('@/components/cashier/tournament-live/PrizePayoutTrackingSection').then(m=>({default:m.PrizePayoutTrackingSection})));
const RegistrationQueuePanel=lazy(()=>import('@/components/cashier/tournament-live/RegistrationQueuePanel').then(m=>({default:m.RegistrationQueuePanel})));
const PayoutEnginePanel=lazy(()=>import('@/components/cashier/tournament-live/PayoutEnginePanel').then(m=>({default:m.PayoutEnginePanel})));
const OpsCashierAccess=lazy(()=>import('@/components/ops/OpsCashierAccess'));
const LivePayoutTab=lazy(()=>import('@/components/accounting-control/live/LivePayoutTab').then(m=>({default:m.LivePayoutTab})));
const MultiDayInitialDrawPanel=lazy(()=>import('@/components/floor/MultiDayInitialDrawPanel').then(m=>({default:m.MultiDayInitialDrawPanel})));
const MultiDayD2ContinuePanel=lazy(()=>import('@/components/floor/MultiDayD2ContinuePanel').then(m=>({default:m.MultiDayD2ContinuePanel})));
const TableHistoryPanel=lazy(()=>import('@/components/cashier/tournament-live/viewer-hub/TableHistoryPanel').then(m=>({default:m.TableHistoryPanel})));
const NativeTournamentLiveParent=lazy(()=>import('@/components/cashier/TournamentLivePanel'));
const TournamentLiveView=lazy(()=>import('@/components/cashier/tournament-live/TournamentLiveView').then(m=>({default:m.TournamentLiveView})));
const OpsAuthProvider=lazy(()=>import('@/ops/auth/OpsAuthProvider').then(m=>({default:m.OpsAuthProvider})));
const OpsDealerControlWorkspace=lazy(()=>import('@/ops/dealer-control/OpsDealerControlWorkspace'));
const OpsChipOpsWorkspace=lazy(()=>import('@/ops/chip-ops/OpsChipOpsWorkspace'));
const OpsHandHistoryWorkspace=lazy(()=>import('@/components/cashier/tournament-live/HandHistoryWorkspace').then(m=>({default:m.HandHistoryWorkspace})));
const SePaySettlementReadPreview=lazy(()=>import('@/components/cashier/SePaySettlementTab').then(m=>({default:m.SePaySettlementTab})));
const MyStacksReadPreview=lazy(()=>import('@/pages/MyStacks'));
const MultiDayBaggingPanel=lazy(()=>import('@/ops/chip-ops/MultiDayBaggingPanel').then(m=>({default:m.MultiDayBaggingPanel})));
const MultiDayFloorEventPanel=lazy(()=>import('@/components/floor/MultiDayFloorEventPanel').then(m=>({default:m.MultiDayFloorEventPanel})));
const BlindEditorPanel=lazy(()=>import('@/components/cashier/tournament-live/BlindEditorPanel').then(m=>({default:m.BlindEditorPanel})));
const BulkScheduleDialog=lazy(()=>import('@/components/floor/BulkScheduleDialog').then(m=>({default:m.BulkScheduleDialog})));
const NewTournamentDialog=lazy(()=>import('@/components/floor/TournamentManagerShared').then(m=>({default:m.NewTournamentDialog})));
const ChipOpsManager=lazy(()=>import('@/components/chip-ops/ChipOpsManager').then(m=>({default:m.ChipOpsManager})));
const NativeColorUp613=lazy(()=>import('@/components/chip-ops/ColorUpTab').then(m=>({default:m.ColorUpTab})));
const NativeBag616=lazy(()=>import('@/components/chip-ops/BagTagTab').then(m=>({default:m.BagTagTab})));
const BankAuditTab=lazy(()=>import('@/components/chip-ops/BankAuditTab').then(m=>({default:m.BankAuditTab})));
const RegisteredBadge=lazy(()=>import('@/components/RegisteredBadge').then(m=>({default:m.RegisteredBadge})));
const SeatReceiptDialog=lazy(()=>import('@/components/tournament/seat/SeatReceiptDialog').then(m=>({default:m.SeatReceiptDialog})));
const TourCashierWorkbench=lazy(()=>import('@/pages/ops/TourCashierWorkbench'));
const OpsTrackerReadWorkspace=lazy(()=>import('@/ops/tracker/OpsTrackerWorkspace'));
const OpsFloorListReadWorkspace=lazy(()=>import('@/pages/ops/OpsTournaments'));
const OpsCapabilityProvider=lazy(()=>import('@/ops/auth/OpsCapabilityProvider').then(m=>({default:m.OpsCapabilityProvider})));
const OpsWorkspaceProvider=lazy(()=>import('@/ops/workspace/OpsWorkspaceProvider').then(m=>({default:m.OpsWorkspaceProvider})));
const TournamentRegisterModal=lazy(()=>import('@/components/TournamentRegisterModal').then(m=>({default:m.TournamentRegisterModal})));
const FloorTableMapPanelV3=lazy(()=>import('@/components/cashier/tournament-live/FloorTableMapPanelV3').then(m=>({default:m.FloorTableMapPanelV3})));
const TournamentLifecycleControls=lazy(()=>import('@/components/floor/TournamentLifecycleControls').then(m=>({default:m.TournamentLifecycleControls})));
const EditTournamentDialog=lazy(()=>import('@/components/floor/TournamentManagerShared').then(m=>({default:m.EditTournamentDialog})));
const PhysicalTableDeclaration=lazy(()=>import('@/components/cashier/dealer-swing/PhysicalTableDeclaration').then(m=>({default:m.PhysicalTableDeclaration})));
const ClockPanel=lazy(()=>import('@/components/cashier/tournament-live/ClockPanel').then(m=>({default:m.ClockPanel})));
const CloseReportDialog=lazy(()=>import('@/components/cashier/tournament-live/CloseReportDialog'));
const DealerPlanNativePreview=lazy(()=>import('./DealerPlanNativePreview').then(m=>({default:m.DealerPlanNativePreview})));
const TrackerFloorAlertLane=lazy(()=>import('@/components/cashier/tournament-live/TrackerFloorAlertLane').then(m=>({default:m.TrackerFloorAlertLane})));

const api = "http://127.0.0.1:54329";
const RefundTab=lazy(()=>import('@/pages/CashierDashboard').then(m=>({default:m.RefundTab})));
const FundingConfirmTab=lazy(()=>import('@/pages/CashierDashboard').then(m=>({default:m.PendingConfirmTab})));
const AdminFundingConfirmTab=lazy(()=>import('@/pages/AdminStaking').then(m=>({default:m.PendingTab})));
const ReviewArchiveTab=lazy(()=>import('@/pages/AdminStaking').then(m=>({default:m.ReviewListingsTab})));
function NativePrizeReceiptRead({actor,tour,intent}:{actor:string;tour:string;intent:string}){
 const [revision,setRevision]=useState(0),[error,setError]=useState<string|null>(null);
 const [receiptEvents,setReceiptEvents]=useState({pointer:0,click:0,keyboard:0});
 const traceReceiptEvent=(target:EventTarget|null,kind:keyof typeof receiptEvents)=>{
  if(!(target instanceof Element)||target.closest("button")?.textContent?.trim()!=="Kiểm tra kết quả")return;
  setReceiptEvents(prior=>({...prior,[kind]:prior[kind]+1}));
 };
 return <section className="space-y-3" data-receipt-pointer-count={receiptEvents.pointer}
  data-receipt-click-count={receiptEvents.click} data-receipt-keyboard-count={receiptEvents.keyboard}
  onPointerDownCapture={event=>traceReceiptEvent(event.target,"pointer")}
  onClickCapture={event=>traceReceiptEvent(event.target,"click")}
  onKeyDownCapture={event=>{if(event.key==="Enter"||event.key===" ")traceReceiptEvent(event.target,"keyboard");}}>
  <p>TEST: khôi phục đúng intent từ receipt đã commit; adapter chỉ cho đọc, không có writer trả thưởng.</p>
  <Button onClick={()=>{try{
   persistPrizePaymentIntent(sessionStorage,parsePrizePaymentIntent(intent,actor,tour));
   setRevision(n=>n+1);setError(null);
  }catch{setError('Không khôi phục được intent TEST; chưa gửi yêu cầu.');}}}>Khôi phục intent payout TEST đã commit</Button>
  {error&&<p role="alert">{error}</p>}
  <PrizePayoutTrackingSection key={revision} tournamentId={tour}/>
 </section>;
}

function NativeFnbAdminRead({club,mode}:{club:string;mode:string}){
 const client=useQueryClient(),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const [queued,setQueued]=useState(false);
 useEffect(()=>()=>{if(timer.current!==null)clearTimeout(timer.current);},[]);
 const schedule=()=>{
  if(timer.current!==null)return;setQueued(true);
  timer.current=setTimeout(()=>{timer.current=null;setQueued(false);void client.invalidateQueries({queryKey:['fnb','menu',club]});},15000);
 };
 return <>{mode==='stockin'&&<StockInLockTestGate clubId={club}/>}<Button variant="outline" disabled={queued} onClick={schedule}>Đọc lại menu sau 15 giây TEST local</Button>
  {queued&&<p role="status">Đã hẹn một lần đọc lại menu TEST local.</p>}
  {mode==='category'?<FnbCategoryNative clubId={club}/>:mode==='menu'?<FnbMenuNative clubId={club} clubName="F&B local TEST"/>:mode==='ingredients'?<FnbIngredientNative clubId={club}/>:mode==='recipe'?<FnbRecipeNative clubId={club}/>:mode==='stockin'?<FnbStockInNative clubId={club}/>:<FnbStocktakeNative clubId={club}/>}</>;
}

type Manifest = { runId: string; tour: string; club: string; actor: string; email: string; model: string; tvAssets?:boolean; dealerPhone?:boolean; registrationReplay?:boolean; memberReceipt?:{registration:string}|null; payroll?:{dealer:string;year:number;month:number}|null; groupInvite?:{group:string;token:string}|null; staking?:{deal:string;request:string;oneStep?:boolean;state?:string;prize:number;fee:number;backer:number;player:number;purchaseDeal?:ComponentProps<typeof DealDetailDialog>['deal'];purchaseIntent?:{actor_id:string;deal_id:string;request_id:string;percent:number}|null}|null; reentry?:boolean; singleTour?:string|null; d2Event?:string|null; baggingFlight?:string|null; historyTable?:{id:string;session:string|null}|null };
type ContinueRecovery={actorId:string;tournamentId:string;batchId:string;revision:number;requestId:string};
type RecoveryManifest=Manifest&{prizeReceiptIntent?:string;payoutManual?:boolean;payoutReadOnly?:boolean;payoutJourney?:boolean;payoutRecovery?:boolean;floorAlert?:{hand:string;table:string;revision:number;reviewOnly?:boolean};tvEditor?:boolean;dealerPlan?:{table:string;session:string;assignment:string}|null;finalizationRecovery?:MultiDayFinalizationIntent|null;qualificationRecovery?:MultiDayQualificationIntent|null;continueRecovery?:ContinueRecovery|null;rulesRecovery?:MultiDayRulesIntent|null;correctionBrowser?:boolean};
function NativeContinueRecovery({intent}:{intent:ContinueRecovery}){
 const [revision,setRevision]=useState(0),[error,setError]=useState(false);
 const retain=()=>{try{
  const key=`vinpoker:d2-continue:v1:${intent.actorId}:${intent.tournamentId}`,encoded=JSON.stringify(intent);
  const prior=sessionStorage.getItem(key);
  if(prior!==null&&prior!==encoded)throw new Error('Existing intent differs');
  sessionStorage.setItem(key,encoded);
  if(sessionStorage.getItem(key)!==encoded)throw new Error('Intent not retained');
  setRevision(n=>n+1);setError(false);
 }catch{setError(true);}};
 return <main className="mx-auto max-w-2xl space-y-3 p-4 text-foreground">
  <h1>D2 Continue receipt recovery · local TEST</h1>
  <p>Existing completed TEST tour. Replay only the original committed Continue; no new clock or seating operation.</p>
  <Button onClick={retain}>Retain original TEST Continue receipt</Button>
  {error&&<p role="alert">Cannot replace a different retained Continue request.</p>}
  <MultiDayD2ContinuePanel key={revision} actorId={intent.actorId} tournamentId={intent.tournamentId}/>
 </main>;
}
type EventRecoveryProps={kind:'finalize';intent:MultiDayFinalizationIntent}|{kind:'qualify';intent:MultiDayQualificationIntent}|{kind:'rules';intent:MultiDayRulesIntent};
function NativeEventReceiptRecovery(props:EventRecoveryProps){
 const [revision,setRevision]=useState(0),[error,setError]=useState<string|null>(null);
 const label=props.kind==='qualify'?'qualification':props.kind==='rules'?'rules':'finalization';
 const retain=()=>{try{
  if(props.kind==='qualify')persistQualificationIntent(sessionStorage,parseQualificationIntent(props.intent,props.intent.actorId,props.intent.eventId));
  else if(props.kind==='rules')persistRulesIntent(sessionStorage,parseRulesIntent(props.intent,props.intent.actorId,props.intent.eventId));
  else persistFinalizationIntent(sessionStorage,parseFinalizationIntent(props.intent,props.intent.actorId,props.intent.eventId));
  setRevision(n=>n+1);setError(null);}
  catch{setError('Cannot retain the original TEST request. No new request was sent.');}};
 return <main className="mx-auto max-w-2xl space-y-3 p-4 text-foreground">
  <h1>{label} receipt recovery · local TEST</h1>
  <p>Replays only the original committed receipt. No new obligations or payments. First receipt response is withheld by the local adapter.</p>
  <Button onClick={retain}>Retain original TEST {label} receipt</Button>
  {error&&<p role="alert">{error}</p>}
  <MultiDayFloorEventPanel key={revision} eventId={props.intent.eventId} surface={props.kind==='finalize'?'payout':'design'}/>
 </main>;
}
function NativeMemberReceipt({registration}:{registration:string}){
 const [receipt,setReceipt]=useState<BuyinReceiptSnapshot|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(false),[open,setOpen]=useState(false);
 const read=async()=>{if(loading)return;setLoading(true);setError(false);
  try{const snapshot=await fetchBuyinReceipt({registrationId:registration});if(!snapshot){setError(true);return;}setReceipt(snapshot);setOpen(true);}
  finally{setLoading(false);}
 };
 return <section className="space-y-3"><p>Biên nhận TEST; chỉ đọc, không tạo giao dịch.</p>
  <Button disabled={loading} onClick={()=>void read()}>Xem lại biên nhận TEST</Button>
  {error&&<p role="alert">Chưa xác minh được biên nhận. Bấm xem lại để thử đọc lại.</p>}
  <RegisteredBadge/>
  {receipt&&<SeatReceiptDialog open={open} onOpenChange={setOpen} receipt={toSeatReceiptData(receipt)}/>}
 </section>;
}
function NativeStaking({manifest}:{manifest:Manifest}) {
 const [intentError,setIntentError]=useState<string|null>(null);
 const [open,setOpen]=useState(false),[done,setDone]=useState(false),[statusOpen,setStatusOpen]=useState(false);
 const transfer=(manifest.staking as (NonNullable<Manifest['staking']>&{transfer?:ComponentProps<typeof TransferInstructions>})|null)?.transfer;
 const data=useMemo(()=>manifest.staking?({req:{id:manifest.staking.oneStep?'':manifest.staking.request,status:'approved'},deal:{id:manifest.staking.deal,
  status:manifest.staking.state??'cosigned',result_prize_vnd:manifest.staking.prize,platform_fee_vnd:manifest.staking.fee,
  backer_payout_vnd:manifest.staking.backer,player_payout_vnd:manifest.staking.player}} as ComponentProps<typeof ExecuteReleaseModal>['data']):null,[manifest]);
 if(transfer&&new URLSearchParams(window.location.search).get('staking-transfer')==='1')return <section><h2>Chuyển khoản staking TEST — chỉ đọc ngân hàng</h2><TransferInstructions {...transfer} hideCancel/></section>;
 if(manifest.staking&&'purchaseDeal' in manifest.staking) return <>{intentError&&<p role="alert">{intentError}</p>}
 {'purchaseIntent' in manifest.staking&&manifest.staking.purchaseIntent&&<Button onClick={()=>{
  try{const intent=manifest.staking!.purchaseIntent as {actor_id:string;deal_id:string;request_id:string;percent:number};
   if(intent.actor_id!==manifest.actor||intent.deal_id!==manifest.staking!.deal)throw new Error('scope');
   localStorage.setItem(`vinpoker:staking-purchase:v1:${intent.actor_id}:${intent.deal_id}`,JSON.stringify(intent));setOpen(true);
  }catch{setIntentError('Không khôi phục được intent TEST từ receipt.');}
 }}>Khôi phục intent TEST từ receipt native</Button>}
 <Button onClick={()=>setOpen(true)}>Mở mua cam kết TEST</Button><DealDetailDialog
 deal={open?manifest.staking.purchaseDeal as ComponentProps<typeof DealDetailDialog>['deal']:null} currentUser={manifest.actor}
 onClose={()=>setOpen(false)} onPurchased={()=>setOpen(false)} onAuthRequired={()=>{}}/></>;
 if(new URLSearchParams(window.location.search).get('staking-portfolio')==='1') return <MemoryRouter><StakingPortfolio/></MemoryRouter>;
 return <section className="space-y-2"><p>Staking TEST · {manifest.staking?.request}</p><Button onClick={()=>setOpen(true)}>Mở giải ngân staking TEST</Button>
  {done&&<p role="status">Receipt giải ngân TEST đã xác minh.</p>}
  <Button variant="outline" disabled={!manifest.staking?.request} onClick={()=>setStatusOpen(true)}>Xem hậu xử lý staking TEST</Button>
  {statusOpen&&manifest.staking&&<StakingReleaseEffectsStatus requestId={manifest.staking.request} dealId={manifest.staking.deal}/>}
  <ExecuteReleaseModal data={open?data:null} onClose={()=>setOpen(false)} onDone={()=>{setDone(true);setOpen(false);}}/></section>;
}
const historyRevoked=()=>{};
function NativeCloseReport({tournamentId}:{tournamentId:string}) {
 const [open,setOpen]=useState(false);
 return <><Button onClick={()=>setOpen(true)}>Kiểm tra chốt tour TEST</Button><CloseReportDialog
  open={open} onOpenChange={setOpen} tournamentId={tournamentId} tournamentName={`Local TEST · ${tournamentId}`}/></>;
}

function NativeRankingReview({tournamentId}:{tournamentId:string}) {
 const [blocked,setBlocked]=useState(true),[recorded,setRecorded]=useState(0);
 return <section className="space-y-3">
  <p role="status">{blocked?'Ranking gate: BLOCKED':'Ranking gate: READY'} · receipts observed: {recorded}</p>
  <TournamentRankingReviewPanel tournamentId={tournamentId} required enabled onBlockingChange={setBlocked} onRecorded={()=>setRecorded(n=>n+1)}/>
 </section>;
}
function NativeMoveRead({manifest}:{manifest:Manifest & {moveEntry:string;moveWriteRollback?:boolean}}) {
 const [open,setOpen]=useState(false);
 return <main className="p-4 space-y-3 text-foreground"><h1>Chuyển ghế · kiểm tra đọc local</h1>
  <p>{manifest.moveWriteRollback?'Actual dialog/SDK/native move trong transaction rollback. Auth/HTTP modeled; chỉ một intent chuyển ghế TEST, không thay đổi bền vững.':'Actual dialog/SDK/native roster; Auth/HTTP modeled. Adapter chỉ cho phép đọc, không xác nhận chuyển ghế.'}</p>
  <Button onClick={()=>setOpen(true)}>Mở chuyển ghế TEST</Button>
  <MovePlayerDialog actorId={manifest.actor} open={open} onOpenChange={setOpen} tournamentId={manifest.tour}
   entryId={manifest.moveEntry} playerName="Retained local TEST" currentTournamentTableId={null} currentSeatNumber={null} onMoved={()=>{}}/>
 </main>;
}
const NativePlayersGroupedPanel=lazy(()=>import('@/components/cashier/tournament-live/PlayersGroupedPanel').then(m=>({default:m.PlayersGroupedPanel})));
function readNativeViewport() {
 return {innerWidth:window.innerWidth,innerHeight:window.innerHeight,clientWidth:document.documentElement.clientWidth,clientHeight:document.documentElement.clientHeight,measuredAt:new Date().toISOString()};
}
function NativeViewportEvidence() {
 const [metrics,setMetrics]=useState(readNativeViewport);
 useEffect(()=>{const measure=()=>setMetrics(readNativeViewport());window.addEventListener('resize',measure);return()=>window.removeEventListener('resize',measure);},[]);
 return <section className="space-y-1 text-xs"><Button variant="outline" onClick={()=>setMetrics(readNativeViewport())}>Đo viewport TEST local</Button><output data-testid="local-viewport-evidence" className="block break-all">{JSON.stringify(metrics)}</output></section>;
}
function NativeFloor({manifest}:{manifest:Manifest}) {
 const [tour,setTour]=useState<Tournament|null>(null),[error,setError]=useState(false),[revision,setRevision]=useState(0);
 const v3=useMemo(()=>createFloorTableControlV3Client((name,args)=>(supabase.rpc as unknown as FloorTableControlV3Rpc)(name,args)),[]);
 useEffect(()=>{let active=true;
  void supabase.from('tournaments').select('*').eq('id',manifest.tour).maybeSingle().then(({data,error})=>{
   if(!active)return;
   if(error||data?.id!==manifest.tour){setError(true);return;}
   setTour(data as unknown as Tournament);
  });return()=>{active=false;};
 },[manifest.tour,revision]);
 if(error)return <p role="alert">Không đọc được tour Floor local.</p>;
 if(!tour)return <p role="status">Đang đọc tour Floor local…</p>;
 if(new URLSearchParams(window.location.search).get('players')==='1')return <MemoryRouter>{new URLSearchParams(window.location.search).get('measure')==='1'&&<NativeViewportEvidence/>}<NativePlayersGroupedPanel tournament={tour} refreshTrigger={revision}/></MemoryRouter>;
 return <MemoryRouter><section className="space-y-4">
  <TournamentLifecycleControls tournament={tour} onChanged={()=>setRevision(n=>n+1)}/>
  <PhysicalTableDeclaration actorId={manifest.actor} clubId={manifest.club}
  clubName="CLB TEST local" declareAsset={v3.declarePhysicalTable} onDeclared={()=>setRevision(n=>n+1)}/>
  <FloorTableMapPanelV3 tournament={tour} actorId={manifest.actor} refreshTrigger={revision}/></section></MemoryRouter>;
}
function NativeRegistration({tournamentId,reentry=false}:{tournamentId:string;reentry?:boolean}) {
 const [open,setOpen]=useState(false);
 return <section><Button onClick={()=>setOpen(true)}>{reentry?'Mua lại cho người chơi TEST hiện tại':'Đăng ký người chơi TEST hiện tại'}</Button>
  <TournamentRegisterModal tournamentId={tournamentId} tournamentName={`Local TEST · ${tournamentId}`}
   mode={reentry?'reentry':'register'} open={open} onClose={()=>setOpen(false)}/></section>;
}
function NativeHistory({manifest}:{manifest:Manifest}) {
 // Same public UUID deep-link contract as /live/:tournamentId. This is a
 // read-only initial target, not controller state/storage injection.
 const [selected,setSelected]=useState<ReplayTarget|null>(()=>parseReplayTarget(new URLSearchParams(window.location.search)));
 return <main className="mx-auto max-w-2xl space-y-4 p-4 text-foreground">
  <h1>History · native local</h1><p>Public projection thực thi bằng SQL role anon. Auth và Realtime transport chưa phải hosted.</p>
  <TableHistoryPanel tournamentId={manifest.tour} tableId={manifest.historyTable?.id??null}
   currentSessionId={manifest.historyTable?.session??null} onAccessRevoked={historyRevoked}
   onSelectHand={setSelected}/>
  {selected&&<TournamentLiveView tournamentId={manifest.tour} spectator
   selectedTableIdOverride={manifest.historyTable?.id??null} initialReplayTarget={selected} onReplayTargetChange={setSelected}/>}
 </main>;
}
function NativeHandInput({tournamentId}:{tournamentId:string}) {
 const hook=useStandaloneHandInput(tournamentId);
 return <TrackerInputCardProvider>
  {new URLSearchParams(window.location.search).get('tracker-alert')==='1'&&hook.tournamentTableId&&<DealerFloorAlertControls
   tournamentId={hook.tournamentId} tournamentTableId={hook.tournamentTableId} handId={hook.handId} enabled/>}
  <PendingFinishControls hook={hook}/><AllInConfirmation hook={hook}/><VoidConfirmation hook={hook}/><StandaloneHandInputConsole hook={hook}/>
 </TrackerInputCardProvider>;
}
function NativeSwingHealth({club}:{club:string}) {
 const denied='00000000-0000-4000-8000-000000000099';
 const health=useDealerSwingHealth([club,denied]);
 return <section><h2>Health local · RPC thật</h2><DealerSwingInfraHealth health={health.data}
  unavailable={health.unavailable} clubs={[{id:club,name:'CLB được phép TEST'},{id:denied,name:'CLB không có quyền TEST'}]} nowMs={Date.now()}/>
  <Button onClick={()=>{void health.refetch();}}>Tải lại health</Button></section>;
}
function NativeTvRead({tournamentId}:{tournamentId:string}) {
 const read=useTournamentRedrawTv(tournamentId,true);
 if(read.data)return <TvRedrawScreen tournamentName={read.data.tournamentName} batch={read.data}/>;
 return <p role={read.state==='error'?'alert':'status'}>{read.state==='empty'?'Chưa có batch D2 đang hiển thị.':read.state==='error'?'Không tải được TV local.':'Đang tải TV anonymous…'}</p>;
}
function NativeAnonymousTv({tournamentId}:{tournamentId:string}) {
 const anonymous=useMemo(()=>createClient<Database>(api,'native-local-anon-public-test-key',
  {auth:{storageKey:'vinpoker-native-anonymous-tv',persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}}),[]);
 return <SupabaseClientProvider client={anonymous} backendScope={api}><NativeTvRead tournamentId={tournamentId}/></SupabaseClientProvider>;
}
function NativePayout() {
  const { user, session, rolesLoading, rolesError } = useAuth();
  const [manifest, setManifest] = useState<(RecoveryManifest&{bag616?:{club:string;tour:string;rollbackOnly?:boolean};colorUp613?:{club:string;tour:string};sepay608?:{club:string;tour:string};mainEventDesign?:string;linkedMainEvent?:string;refund538?:{deal:string};funding560?:{deal:string;purchase:string;admin?:boolean;reviewArchive?:boolean}}) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const [dealerPhoneOpen,setDealerPhoneOpen]=useState(false);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    void fetch(`${api}/__local/${new URLSearchParams(window.location.search).get('edit')==='1'?'edit-manifest':'manifest'}`, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("Không đọc được manifest local.");
      const value = await response.json() as Manifest;
      if (!controller.signal.aborted) setManifest(value);
    }).catch(() => { if (active) setError("Native API local chưa sẵn sàng hoặc đã hết thời gian chờ."); })
      .finally(() => clearTimeout(timer));
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, []);
  const login = async () => {
    if (!manifest) return;
    const result = await supabase.auth.signInWithPassword({ email: manifest.email, password: "LOCAL_TEST_ONLY" });
    setError(result.error?.message ?? null);
  };
  const dropNext = async () => {
    const { data } = await supabase.auth.getSession();
    const result = await fetch(`${api}/__local/drop-next`, { method: "POST", headers: {
      authorization: `Bearer ${data.session?.access_token ?? ""}`,
    } });
    if (result.ok) setArmed(true); else setError("Không bật được fault local.");
  };
  if(manifest&&new URLSearchParams(window.location.search).get('close-read')==='1')return <main className="mx-auto max-w-2xl p-4 space-y-3 text-foreground">
   <h1>Chốt giải · read recovery TEST874</h1>
   <p>Actual dialog and native read-only PostgreSQL. Auth/HTTP modeled; all close/ranking writers denied by the adapter.</p>
   <Button onClick={()=>void login().catch(()=>setError('Không đăng nhập được TEST local.'))}>Đăng nhập TEST local</Button>
   <Button disabled={user?.id!==manifest.actor} onClick={()=>void (async()=>{
    const {data}=await supabase.auth.getSession();
    const response=await fetch(`${api}/__local/close-read-restore`,{method:'POST',headers:{authorization:`Bearer ${data.session?.access_token??''}`}});
    if(!response.ok)setError('Chưa khôi phục được read local.');
   })().catch(()=>setError('Chưa khôi phục được read local.'))}>Khôi phục read local TEST874</Button>
   {(error||rolesError)&&<p role="alert">{error||rolesError}</p>}
   {user?.id===manifest.actor&&!rolesLoading&&!rolesError&&<NativeCloseReport tournamentId={manifest.tour}/>}
  </main>;
  if(manifest&&new URLSearchParams(window.location.search).get('ranking-close')==='1')return <main className="mx-auto max-w-2xl p-4 space-y-3 text-foreground">
   <h1>Floor ranking → close · clone local TEST868</h1>
   <p>Actual CloseReportDialog, ranking panel and PostgreSQL RPC. Synthetic zero-money fixture; not canonical Finish or paid tournament acceptance.</p>
   <Button onClick={()=>void login().catch(()=>setError('Không đăng nhập được TEST local.'))}>Đăng nhập TEST local</Button>
   <Button disabled={user?.id!==manifest.actor} onClick={()=>void (async()=>{
    const {data}=await supabase.auth.getSession();
    const response=await fetch(`${api}/__local/ranking-receipt-enable`,{method:'POST',headers:{authorization:`Bearer ${data.session?.access_token??''}`}});
    if(!response.ok)setError('Không mở được đối chiếu receipt local.');
   })().catch(()=>setError('Không mở được đối chiếu receipt local.'))}>Mở đọc receipt local TEST868</Button>
   {(error||rolesError)&&<p role="alert">{error||rolesError}</p>}
   {user?.id===manifest.actor&&!rolesLoading&&!rolesError&&<NativeCloseReport tournamentId={manifest.tour}/>}
  </main>;
  if(manifest&&new URLSearchParams(window.location.search).get('ranking')==='1')return <main className="mx-auto max-w-2xl p-4 space-y-3 text-foreground">
   <h1>Floor ranking · clone local TEST867</h1>
   <p>Actual panel and PostgreSQL RPC. Auth/HTTP modeled. Synthetic entries; no canonical Finish or official close.</p>
   <Button onClick={()=>void login().catch(()=>setError('Không đăng nhập được TEST local.'))}>Đăng nhập TEST local</Button>
   <Button disabled={user?.id!==manifest.actor} onClick={()=>void (async()=>{
    const {data}=await supabase.auth.getSession();
    const response=await fetch(`${api}/__local/ranking-receipt-enable`,{method:'POST',headers:{authorization:`Bearer ${data.session?.access_token??''}`}});
    if(!response.ok)setError('Không mở được đối chiếu receipt local.');
   })().catch(()=>setError('Không mở được đối chiếu receipt local.'))}>Mở đọc receipt local TEST867</Button>
   {(error||rolesError)&&<p role="alert">{error||rolesError}</p>}
   {user?.id===manifest.actor&&!rolesLoading&&!rolesError&&<NativeRankingReview tournamentId={manifest.tour}/>}
  </main>;
  if(manifest&&(new URLSearchParams(window.location.search).get('bank-read')==='1'||new URLSearchParams(window.location.search).get('bank-write')==='1'))return <main className="mx-auto max-w-4xl p-4 space-y-3 text-foreground">
    <h1>Két chip · local canary TEST</h1>
    <p>Actual AuthProvider/component/SDK/PostgreSQL. Local adapter strictly limits the selected read or write canary.</p>
    <Button onClick={()=>void login().catch(()=>setError('Không đăng nhập được TEST local.'))}>Đăng nhập TEST local</Button>
    {new URLSearchParams(window.location.search).get('bank-write')==='1'&&user?.id===manifest.actor&&<Button onClick={()=>void dropNext()}>Mất response sau commit tiếp theo</Button>}
    {armed&&<p role="status">Response tiếp theo sẽ mất sau commit local; dùng journal và đối chiếu receipt, không tạo lệnh mới.</p>}
    {(error||rolesError)&&<p role="alert">{error||rolesError}</p>}
    {user?.id===manifest.actor&&session&&!rolesLoading&&!rolesError&&<BankAuditTab clubId={manifest.club} tournamentId={manifest.tour}/>}
  </main>;
  if(manifest?.bag616)return <main className="p-4 space-y-3 text-foreground">
    <h1>Bag &amp; Tag · TEST local</h1><p>RPC native; Auth/HTTP mô hình hóa. {manifest.bag616.rollbackOnly?'Thao tác ghi nằm trong transaction ROLLBACK, không COMMIT.':'Mọi thao tác ghi bị gateway chặn.'}</p>
    <Button onClick={login}>Đăng nhập TEST local</Button>
    {(error||rolesError)&&<p role="alert">{error||rolesError}</p>}
    {user?.id===manifest.actor&&!rolesLoading&&!rolesError&&<NativeBag616 tournamentId={manifest.bag616.tour} clubId={manifest.bag616.club}/>}
  </main>;
  if(manifest?.colorUp613)return <main className="p-4 space-y-3 text-foreground">
    <h1>Color-up coupling · rollback-only TEST</h1><p>Tồn và ledger dùng PostgreSQL local; Auth/HTTP được mô hình hóa. Không COMMIT hoặc tiền thật.</p>
    <Button onClick={login}>Đăng nhập TEST local</Button>
    {(error||rolesError)&&<p role="alert">{error||rolesError}</p>}
    {user?.id===manifest.actor&&!rolesLoading&&!rolesError&&<NativeColorUp613 tournamentId={manifest.colorUp613.tour} clubId={manifest.colorUp613.club}/>}
  </main>;
  if(manifest&&(manifest.sepay608||['sepay-read','sepay-write','sepay-confirm'].some(key=>new URLSearchParams(window.location.search).get(key)==='1')))return <main className="p-4 space-y-3 text-foreground">
    <h1>SePay worklist · native TEST</h1>
    <p>{manifest.sepay608?'SEPAY608 rollback-only: 40.000đ + 80.000đ TEST cho phí 100.000đ; không tiền thật, không COMMIT. Lý do theo lượt: TEST608 first partial / TEST608 completion.':new URLSearchParams(window.location.search).get('sepay-confirm')==='1'
      ?'Chỉ đăng ký/bank TEST306 (100.000đ mô phỏng) trong tour con305. Xác nhận đúng một lần; response mất sau COMMIT để kiểm journal. Không thu tiền thật.'
      :new URLSearchParams(window.location.search).get('sepay-write')==='1'
      ?'Chỉ bank TEST303 (1.000đ mô phỏng): nhập lý do TEST local ignore recovery303. Cho bỏ qua đúng một lần; response sẽ mất sau COMMIT để kiểm phục hồi. Không phải tiền thật.'
      :'Actual Cashier tab; settlement/ignore writes are blocked by this canary.'}</p>
    <Button onClick={()=>void login().catch(()=>setError('Không đăng nhập được TEST local.'))}>Đăng nhập TEST local</Button>
    {(error||rolesError)&&<p role="alert">{error||rolesError}</p>}
    {user?.id===manifest.actor&&!rolesLoading&&!rolesError&&<SePaySettlementReadPreview clubIds={[manifest.sepay608?.club??manifest.club]}/>}
  </main>;
  if(manifest?.tvAssets&&new URLSearchParams(window.location.search).get('tv-assets')==='1')return <main className="p-4 space-y-3 text-foreground">
    <h1>TV asset upload · linked single-day TEST</h1>
    <Button onClick={()=>void login().catch(()=>setError('Không đăng nhập được TEST local.'))}>Đăng nhập TEST local</Button>
    {(error||rolesError)&&<p role="alert">{error||rolesError}</p>}
    {user?.id===manifest.actor&&session&&!rolesLoading&&!rolesError&&<>
      <Button onClick={()=>void dropNext().catch(()=>setError('Không bật được fault local.'))}>Mất response sau commit tiếp theo</Button>
      <TvAssetNativePreview tour={manifest.tour} actor={user.id} token={session.access_token} epoch={sessionReadEpoch(session)}/>
    </>}
  </main>;
  if(manifest?.dealerPhone&&new URLSearchParams(window.location.search).get('dealer-swing')==='1')return <main className="p-4 space-y-3 text-foreground">
    <h1>Dealer Swing · same single-day native TEST</h1>
    <p>Actual product component; Auth/HTTP modeled, PostgreSQL local. Auto remains OFF.</p>
    <Button onClick={()=>void login().catch(()=>setError('Không đăng nhập được TEST local.'))}>Đăng nhập TEST local</Button>
    {(error||rolesError)&&<p role="alert">{error||rolesError}</p>}
    {user?.id===manifest.actor&&!rolesLoading&&!rolesError&&<>
      <Button onClick={()=>void dropNext().catch(()=>setError('Không bật được fault local.'))}>Mất response sau commit tiếp theo</Button>
      <Suspense fallback={<p role="status">Đang tải Dealer Swing…</p>}>
        <DealerSwingNative clubIds={[manifest.club]} clubs={[{id:manifest.club,name:'Single244 local TEST'}]}/>
      </Suspense>
    </>}
  </main>;
  if(manifest?.dealerPhone&&new URLSearchParams(window.location.search).get('dealer-phone')==='1')return <main className="mx-auto max-w-2xl p-4 space-y-3 text-foreground">
    <h1>Dealer check-in · linked single-day TEST</h1>
    <p>Actual product sheet and PostgreSQL RPC. Four TEST dealers of this same tour; no table assignment, payroll finalization or external notification.</p>
    <Button onClick={()=>void login().catch(()=>setError('Không đăng nhập được TEST local.'))}>Đăng nhập TEST local</Button>
    {(error||rolesError)&&<p role="alert">{error||rolesError}</p>}
    {user?.id===manifest.actor&&!rolesLoading&&!rolesError&&<>
      <Button onClick={()=>void dropNext().catch(()=>setError('Không bật được fault local.'))}>Mất response sau commit tiếp theo</Button>
      <Button onClick={()=>setDealerPhoneOpen(true)}>Mở check-in dealer TEST</Button>
      {armed&&<p role="status">Fault local cho phản hồi tiếp theo; không tạo lại request khi chưa biết kết quả.</p>}
      <DealerPhoneCheckinSheet actorId={user.id} activeClubId={manifest.club} open={dealerPhoneOpen}
        scheduleAssignments={[]} onOpenChange={setDealerPhoneOpen} onCompleted={()=>setArmed(false)}
        onRolloutDisabled={()=>setError('Canary gate không được xác minh; không gửi yêu cầu mới.')}/>
    </>}
  </main>;
  if((manifest?.mainEventDesign||manifest?.linkedMainEvent)&&new URLSearchParams(window.location.search).get('main-design')==='1')return <main className="mx-auto max-w-2xl p-4 space-y-3 text-foreground">
   <h1>Main Event design · linked local TEST</h1>
   <p>Actual rules RPC. Release scope exists only inside each local transaction and is restored before commit. No payment or automatic GTD funding.</p>
   <Button onClick={()=>void login().catch(()=>setError('Không đăng nhập được TEST local.'))}>Đăng nhập TEST local</Button>
   {(error||rolesError)&&<p role="alert">{error||rolesError}</p>}
   {user?.id===manifest.actor&&!rolesLoading&&!rolesError&&<MultiDayFloorEventPanel eventId={(manifest.mainEventDesign??manifest.linkedMainEvent)!} surface="design"/>}
  </main>;
  if(manifest&&new URLSearchParams(window.location.search).get('member-stacks')==='1')return <main className="p-4 space-y-3 text-foreground">
    <h1>Member registrations · local read-only TEST</h1>
    <p>Actual product list and native PostgreSQL RLS; Auth/HTTP modeled. Mutation routes denied by local adapter.</p>
    <Button onClick={()=>void login().catch(()=>setError('Không đăng nhập được TEST local.'))}>Đăng nhập TEST local</Button>
    {user?.id===manifest.actor&&<MemoryRouter><MyStacksReadPreview/></MemoryRouter>}
  </main>;
  if(manifest&&new URLSearchParams(window.location.search).get('main-create')==='1')return <main className="p-4 space-y-3 text-foreground">
   <h1>Main Event create · canonical local TEST</h1><p>Actual dialog and PostgreSQL RPC. Auth/HTTP modeled; no payments, notifications or production writes.</p>
   <Button onClick={()=>void login().catch(()=>setError('Không đăng nhập được TEST local.'))}>Đăng nhập TEST local</Button>
   <Button disabled={user?.id!==manifest.actor} onClick={()=>void dropNext()}>Mất response sau commit tiếp theo</Button>
   <Button disabled={user?.id!==manifest.actor} onClick={()=>void (async()=>{
    const {data}=await supabase.auth.getSession();
    const response=await fetch(`${api}/__local/main-event-response-recovery`,{method:'POST',headers:{authorization:`Bearer ${data.session?.access_token??''}`}});
    if(response.ok)setArmed(false);else setError('Không khôi phục được phản hồi local.');
   })().catch(()=>setError('Không khôi phục được phản hồi local.'))}>Khôi phục phản hồi local</Button>
   {armed&&<p role="status">Fault local giữ phản hồi của đúng request tạo Main Event; khôi phục rồi đọc lại receipt.</p>}
   {(error||rolesError)&&<p role="alert">{error||rolesError}</p>}
   {user?.id===manifest.actor&&!rolesLoading&&!rolesError&&<NewTournamentDialog clubs={[]} defaultClubId={manifest.club} multiClub={false} lockMode="multi" onCreated={()=>setArmed(false)}/>}
  </main>;
  if(manifest&&new URLSearchParams(window.location.search).get('edit')==='1')return <main className="p-4 space-y-3">
   <h1>Edit tournament · canonical local TEST</h1><p>Auth transport modeled; atomic context/write/receipt execute on PostgreSQL local.</p>
   <Button onClick={login}>Đăng nhập TEST local</Button><Button onClick={dropNext}>Mất response sau commit tiếp theo</Button>
   {error&&<p role="alert">{error}</p>}
   {user?.id===manifest.actor&&!rolesLoading&&!rolesError&&<EditTournamentDialog tournament={{id:manifest.tour,club_id:manifest.club}} onSaved={()=>setArmed(false)}/>}
   {armed&&<p role="status">Đã bật fault mất response cho lần ghi tiếp theo.</p>}
  </main>;
  if(manifest&&new URLSearchParams(window.location.search).get('inbox')==='1'){
    if(user?.id!==manifest.actor||rolesLoading||rolesError)return <main className="p-4 space-y-3"><h1>Inbox read recovery · local TEST</h1>
      <Button onClick={login}>Đăng nhập local TEST</Button>{rolesLoading&&<p>Đang tải quyền local…</p>}{(error||rolesError)&&<p role="alert">{error||rolesError}</p>}</main>;
    return <MemoryRouter initialEntries={['/inbox']}><Routes><Route element={<Layout/>}><Route path="/inbox" element={<ChatInbox/>}/><Route path="/dm/:userId" element={<DirectChat/>}/></Route></Routes></MemoryRouter>;
  }
  if(manifest&&new URLSearchParams(window.location.search).get('tv-operator')==='1')return <main className="mx-auto max-w-5xl p-4 space-y-3 text-foreground">
    <h1>TV operator · LOCAL rollback test</h1>
    <p>Actual operator component. Local adapter models Auth; writes must roll back. This host does not prove the normal operator route or COMMIT.</p>
    <TvDisplaysNative tournamentId={manifest.tour} tournamentName="D2 LOCAL TEST" clubId={manifest.club}
      tournaments={[{id:manifest.tour,name:'D2 LOCAL TEST',club_id:manifest.club,status:'completed'}]}/>
  </main>;
  if((manifest?.d2Event||manifest?.singleTour)&&new URLSearchParams(window.location.search).get('tv')==='1')return <NativeAnonymousTv tournamentId={manifest.tour}/>;
  if(manifest&&'moveEntry' in manifest&&typeof manifest.moveEntry==='string'&&new URLSearchParams(window.location.search).get('move-read')==='1')return <NativeMoveRead manifest={manifest as Manifest & {moveEntry:string}}/>;
  if((manifest?.singleTour||manifest?.d2Event)&&manifest.historyTable&&new URLSearchParams(window.location.search).get('observer')==='1')return <main className="p-4 text-foreground">
    <h1>Live observer · local TEST</h1><p>Public RPC projection on the exact canonical TEST table; Realtime transport is modeled.</p>
    <TournamentLiveView tournamentId={manifest.tour} spectator selectedTableIdOverride={manifest.historyTable.id}/></main>;
  if(manifest?.singleTour&&user?.id===manifest.actor&&!rolesLoading&&!rolesError&&new URLSearchParams(window.location.search).get('queue')==='1')return <main className="mx-auto max-w-3xl p-4 text-foreground"><h1>Hàng chờ · native local TEST</h1><p>Auth được mô hình hóa. Dữ liệu đọc từ PostgreSQL local.</p><RegistrationQueuePanel tournamentId={manifest.tour} tournamentName="Single244 TEST" tournamentDate={null} refreshTrigger={0}/></main>;
  if((manifest?.d2Event||manifest?.singleTour)&&new URLSearchParams(window.location.search).get('history')==='1')return <NativeHistory manifest={manifest}/>;
  if(manifest&&user?.id===manifest.actor&&!rolesLoading&&!rolesError&&new URLSearchParams(window.location.search).get('fnb'))
    return <MemoryRouter>{new URLSearchParams(window.location.search).get('fnb-session')==='1'&&<Button onClick={()=>void login()}>Đăng nhập lại TEST cùng tài khoản</Button>}{new URLSearchParams(window.location.search).get('fnb')==='kitchen'?<FnbKitchenDisplay/>:<FnbCounter/>}</MemoryRouter>;
  if(manifest?.payoutManual&&user?.id===manifest.actor&&!rolesLoading&&!rolesError&&new URLSearchParams(window.location.search).get('payout-engine')==='1')
    return <main className="mx-auto max-w-4xl space-y-3 p-4 text-foreground"><h1>Manual payout recovery · synthetic local TEST</h1>
      <p>Canary metadata riêng: không entry, không cash, không thanh toán. Auth/HTTP mô hình hóa; chỉnh payout, receipt và hủy gọi RPC/native DB thật.</p><PayoutEnginePanel tournamentId={manifest.tour}/></main>;
  if((manifest?.payoutReadOnly||manifest?.payoutJourney)&&user?.id===manifest.actor&&!rolesLoading&&!rolesError&&new URLSearchParams(window.location.search).get('payout-engine')==='1')
    return <main className="mx-auto max-w-4xl space-y-3 p-4 text-foreground"><h1>{manifest.payoutRecovery?'Payout recovery · isolated local TEST':manifest.payoutJourney?'Payout Single244 · local TEST':'Payout read recovery · local TEST'}</h1>
      <p>{manifest.payoutRecovery?'Canary riêng300K chưa kết thúc giải: lỗi503 sau COMMIT. Auth/HTTP mô hình hóa, RPC/handler/native DB thật; không thu tiền, sửa chip hoặc thanh toán.':manifest.payoutJourney?'Auth/HTTP được mô hình hóa; prepare và handler/engine/apply dùng PG local thật. Mất phản hồi sau commit; không ghi thanh toán.':'Chỉ nghiệm thu đọc và tải lại. Gateway chặn mọi thao tác ghi payout.'}</p><PayoutEnginePanel tournamentId={manifest.tour}/>
      {manifest.payoutJourney&&<section className="space-y-2"><p>Đối chiếu người nhận: chỉ đọc; gateway chặn mọi ghi nhận thanh toán.</p><PrizePayoutTrackingSection tournamentId={manifest.tour}/></section>}</main>;
  if(manifest?.payoutReadOnly&&user?.id===manifest.actor&&!rolesLoading&&!rolesError&&new URLSearchParams(window.location.search).get('operator-scope')==='1')
    return <main className="mx-auto max-w-2xl space-y-3 p-4 text-foreground"><h1>Operator scope · local read-only TEST</h1>
      <p>Auth được mô hình hóa; scope đọc từ PostgreSQL local. Không có thao tác ghi.</p><OpsCashierAccess><p>Đã xác minh quyền Cashier TEST bằng RPC local.</p></OpsCashierAccess></main>;
  if(manifest?.d2Event&&user?.id===manifest.actor&&!rolesLoading&&!rolesError
    &&manifest.finalizationRecovery)return <NativeEventReceiptRecovery kind="finalize" intent={manifest.finalizationRecovery}/>;
  if(manifest?.d2Event&&user?.id===manifest.actor&&!rolesLoading&&!rolesError
    &&manifest.qualificationRecovery)return <NativeEventReceiptRecovery kind="qualify" intent={manifest.qualificationRecovery}/>;
  if(manifest?.d2Event&&user?.id===manifest.actor&&!rolesLoading&&!rolesError
    &&manifest.continueRecovery)return <NativeContinueRecovery intent={manifest.continueRecovery}/>;
  if(manifest?.d2Event&&user?.id===manifest.actor&&!rolesLoading&&!rolesError
    &&manifest.rulesRecovery)return <NativeEventReceiptRecovery kind="rules" intent={manifest.rulesRecovery}/>;
  if(manifest?.d2Event&&user?.id===manifest.actor&&!rolesLoading&&!rolesError&&manifest.correctionBrowser&&new URLSearchParams(window.location.search).get('cashier-payout')!=='1')
    return <main className="mx-auto max-w-2xl space-y-3 p-4 text-foreground"><h1>Correction and approval · local rollback TEST</h1>
      <p>Real canonical RPCs in one isolated local transaction. All TEST payment and correction rows roll back when the adapter stops. No external payment is sent.</p>
      <MultiDayFloorEventPanel eventId={manifest.d2Event} surface="payout"/></main>;
  if(manifest?.d2Event&&user?.id===manifest.actor&&!rolesLoading&&!rolesError
    &&new URLSearchParams(window.location.search).get('cashier-payout')==='1')return <main className="mx-auto max-w-2xl p-4 text-foreground">
      <p className="break-all text-xs">Local TEST event: {manifest.d2Event}</p>
      <Button onClick={()=>{void dropNext().catch(()=>setError('Fault local thất bại.'));}}>Mất response sau commit tiếp theo</Button>
      <PrizePayoutTrackingSection tournamentId={manifest.tour}/></main>;
  if(manifest?.d2Event&&user?.id===manifest.actor&&!rolesLoading&&!rolesError
    &&new URLSearchParams(window.location.search).get('payout')==='1')return <main className="mx-auto max-w-2xl p-4 text-foreground">
      <p className="break-all text-xs">Local TEST event: {manifest.d2Event}</p>
      <p className="my-3 text-sm">Chỉ nghiệm thu local: Auth và đầu vào ngân hàng TEST được mô hình hóa, không chứng minh chuyển tiền thật. RPC/receipt/audit dùng PostgreSQL thật; scope phát hành TEST được phục hồi sau mỗi RPC. Chốt nghĩa vụ không phải thanh toán.</p>
      <MultiDayFloorEventPanel eventId={manifest.d2Event} surface="payout"/></main>;
  if(manifest?.singleTour&&user?.id===manifest.actor&&!rolesLoading&&!rolesError&&new URLSearchParams(window.location.search).get('dealer-read')==='1')
    return <main className="mx-auto max-w-5xl p-4 text-foreground"><h1>Dealer management · local read-only TEST</h1><DealerManagementTab clubIds={[manifest.club]} clubFilter={manifest.club}/></main>;
  if(manifest?.funding560)return <main className="mx-auto max-w-2xl p-4 space-y-4 text-foreground">
    <h1>{manifest.funding560.reviewArchive?'Lưu trữ phiếu':'FUNDED'} · rollback-only local TEST</h1><p>Component {manifest.funding560.reviewArchive?'Review':manifest.funding560.admin?'Admin':'Cashier'} thật; Auth/HTTP mô hình hóa, handler/RPC native. Fixture sẽ rollback; không gửi thông báo ra người thật.</p>
    <Button onClick={()=>void login().catch(()=>setError('Đăng nhập TEST local thất bại.'))}>Đăng nhập TEST local</Button>
    {(error||rolesError)&&<p role="alert">{error||rolesError}</p>}
    {user?.id===manifest.actor&&!rolesLoading&&!rolesError&&(manifest.funding560.reviewArchive?<ReviewArchiveTab/>:manifest.funding560.admin?<AdminFundingConfirmTab cashierOnlyUserId={null}/>:<FundingConfirmTab clubIds={[manifest.club]}/>)}
  </main>;
  if(manifest?.refund538)return <main className="mx-auto max-w-2xl p-4 space-y-4 text-foreground">
    <h1>Hoàn tiền · rollback-only local TEST</h1><p>Auth/HTTP mô hình hóa; handler và RPC native, email chỉ tới sink TEST. Quyền fixture chỉ tồn tại trong transaction.</p>
    <Button onClick={()=>void login().catch(()=>setError('Đăng nhập TEST local thất bại.'))}>Đăng nhập TEST local</Button>
    {(error||rolesError)&&<p role="alert">{error||rolesError}</p>}
    {user?.id===manifest.actor&&!rolesLoading&&!rolesError&&<RefundTab clubIds={[manifest.club]}/>}
  </main>;
  if(manifest?.dealerPlan&&user?.id===manifest.actor&&!rolesLoading&&!rolesError)return <DealerPlanNativePreview manifest={{actor:manifest.actor,club:manifest.club,dealerPlan:manifest.dealerPlan}}/>;
  if(manifest?.tvEditor)return <main className="p-4 space-y-3 text-foreground">
    <h1>TV editor · local TEST</h1><p>Actual editor and SQL. Auth/HTTP modeled; no Storage upload route.</p>
    <Button onClick={()=>void login().catch(()=>setError('Không đăng nhập được TEST local.'))}>Đăng nhập TEST local</Button>
    <Button disabled={user?.id!==manifest.actor} onClick={()=>void dropNext()}>Mất response sau commit tiếp theo</Button>
    {(error||rolesError)&&<p role="alert">{error||rolesError}</p>}
    {user?.id===manifest.actor&&!rolesLoading&&!rolesError&&<TvBrandingEditor tournamentId={manifest.tour}/>}
  </main>;
  if(manifest?.floorAlert)return <main className="p-4 space-y-3 text-foreground">
    <h1>{manifest.floorAlert.reviewOnly?'Floor selected-action review · rollback-only local TEST':'Floor whole-hand report · rollback-only local TEST'}</h1>
    <p>{manifest.floorAlert.reviewOnly?'Existing completed hand and synthetic legacy alert metadata; actual reader/draft only. All writes rejected; fixture rolls back on API stop.':'Actual controls and canonical SQL; fresh child hand and report roll back when API stops. No edit/resolve acceptance claim.'}</p>
    <Button onClick={()=>void login().catch(()=>setError('Không đăng nhập được TEST local.'))}>Đăng nhập TEST local</Button>
    {(error||rolesError)&&<p role="alert">{error||rolesError}</p>}
    {!manifest.floorAlert.reviewOnly&&user?.id===manifest.actor&&!rolesLoading&&!rolesError&&<DealerFloorAlertControls tournamentId={manifest.tour}
      tournamentTableId={manifest.floorAlert.table} handId={manifest.floorAlert.hand} enabled/>}
    {user?.id===manifest.actor&&!rolesLoading&&!rolesError&&new URLSearchParams(window.location.search).get('floor-lane')==='1'
      &&<MemoryRouter><TrackerFloorAlertLane key={JSON.stringify([user.id,sessionReadEpoch(session),manifest.tour])} tournamentId={manifest.tour} actorId={user.id}/></MemoryRouter>}
  </main>;
  if(manifest&&new URLSearchParams(window.location.search).get('floor-parent-read')==='1')return <main className="p-4 space-y-3 text-foreground"><h1>Floor parent read recovery · local TEST</h1><p>Actual parent and children; modeled Auth, native read-only adapter. Do not use mutation controls.</p><Button onClick={login}>Đăng nhập TEST local</Button>{(error||rolesError)&&<p role="alert">{error||rolesError}</p>}{user?.id===manifest.actor&&!rolesLoading&&!rolesError&&<MemoryRouter><NativeTournamentLiveParent clubIds={[manifest.club]} clubs={[{id:manifest.club,name:'Floor1201 local TEST'}]} mode="floor"/></MemoryRouter>}</main>;
  if(manifest?.singleTour&&new URLSearchParams(window.location.search).get('floor-active-lane')==='1')return <main className="p-4 space-y-3 text-foreground">
   <h1>Floor active correction · local TEST</h1>
   <Button onClick={()=>void login().catch(()=>setError('Không đăng nhập được TEST local.'))}>Đăng nhập TEST local</Button>
   {(error||rolesError)&&<p role="alert">{error||rolesError}</p>}
   {user?.id===manifest.actor&&!rolesLoading&&!rolesError&&<MemoryRouter><TrackerFloorAlertLane tournamentId={manifest.tour} actorId={user.id}/></MemoryRouter>}
  </main>;
  return <main className={new URLSearchParams(window.location.search).get('tracker')==='1'
    ?'space-y-4 p-4 text-foreground':'mx-auto max-w-2xl space-y-4 p-4 text-foreground'}>
    <h1 className="text-xl font-semibold">{manifest?.linkedMainEvent?'Main Event flight':manifest?.singleTour?'Single-day':manifest?.d2Event?'D2':'Payout'} · native local</h1>
    <p className="text-sm text-muted-foreground">Auth được mô hình hóa cho TEST; RPC và ledger dùng PostgreSQL local thật.</p>
    <p className="break-all text-xs">Tour: {manifest?.tour ?? "Đang tải…"}</p>
    <div className="flex flex-wrap gap-2">
      <Button disabled={!manifest} onClick={() => { void login().catch(() => setError("Đăng nhập TEST local thất bại.")); }}>Đăng nhập TEST local</Button>
      <Button variant="outline" disabled={!user || user.id !== manifest?.actor} onClick={() => { void dropNext().catch(() => setError("Fault local thất bại.")); }}>Mất response sau commit tiếp theo</Button>
    </div>
    {armed && <p role="status" className="text-sm">Đã bật fault cho request mutation tiếp theo và các retry cùng key.</p>}
    {error && <p role="alert">{error}</p>}
    {rolesLoading && user && <p>Đang đọc quyền từ DB local…</p>}
    {rolesError && <p role="alert">{rolesError}</p>}
    {manifest && user?.id === manifest.actor && !rolesLoading && !rolesError && new URLSearchParams(window.location.search).get('streams')==='1'
      ?<AdminStreamManager/>:manifest && user?.id === manifest.actor && !rolesLoading && !rolesError && new URLSearchParams(window.location.search).get('notifications')==='1'
      ?<MemoryRouter><Notifications/></MemoryRouter>:manifest?.prizeReceiptIntent && user?.id === manifest.actor && !rolesLoading && !rolesError && new URLSearchParams(window.location.search).get('prize-receipt-read')==='1'
      ?<NativePrizeReceiptRead actor={manifest.actor} tour={manifest.tour} intent={manifest.prizeReceiptIntent}/>:manifest && user?.id === manifest.actor && !rolesLoading && !rolesError && new URLSearchParams(window.location.search).get('prize-payment')==='1'
      ?<PrizePayoutTrackingSection tournamentId={manifest.tour}/>:manifest && user?.id === manifest.actor && !rolesLoading && !rolesError && new URLSearchParams(window.location.search).get('leaderboard')==='1'
      ?<MemoryRouter><LeaderboardNative/></MemoryRouter>:manifest && user?.id === manifest.actor && !rolesLoading && !rolesError && new URLSearchParams(window.location.search).get('clubs')==='1'
      ?<MemoryRouter><ClubsNative/></MemoryRouter>:manifest && user?.id === manifest.actor && !rolesLoading && !rolesError && ['recipe','stocktake','category','menu','ingredients','stockin'].includes(new URLSearchParams(window.location.search).get('fnb-admin')??'')
      ?<NativeFnbAdminRead key={manifest.club+new URLSearchParams(window.location.search).get('fnb-admin')} club={manifest.club} mode={new URLSearchParams(window.location.search).get('fnb-admin')??''}/>:manifest && user?.id === manifest.actor && !rolesLoading && !rolesError && new URLSearchParams(window.location.search).get('finance')==='1'
      ?<><LiveFinanceOverview onNavigate={()=>{}}/><LiveFinancePayroll/></>:manifest && user?.id === manifest.actor && !rolesLoading && !rolesError && new URLSearchParams(window.location.search).get('accountant-finance')==='1'
      ?<AccountantFinanceTab clubId={manifest.club}/>:<>
    {manifest && user?.id === manifest.actor && !rolesLoading && !rolesError && <>
      {manifest.memberReceipt&&!manifest.registrationReplay?<NativeMemberReceipt key={manifest.actor} registration={manifest.memberReceipt.registration}/>:<>
      {manifest.payroll&&new URLSearchParams(window.location.search).get('dealer-self')==='1'?<DealerSalaryScreen/>:<>
      {manifest.payroll?<DealerPayrollTab clubIds={[manifest.club]} clubs={[{id:manifest.club,name:manifest.d2Event?'Main Event linked local TEST':'Payroll browser local TEST'}]}/>:manifest.groupInvite?<MemoryRouter initialEntries={[`/invite/${manifest.groupInvite.token}`]}><Routes><Route path="/invite/:token" element={<GroupInvite/>}/><Route path="/group/:groupId" element={<p role="status">Receipt tham gia nhóm TEST đã xác minh. Đây chỉ là đích kiểm tra điều hướng, không thay cho nghiệm thu GroupChat.</p>}/></Routes></MemoryRouter>:manifest.staking?<NativeStaking manifest={manifest}/>:<>
      {(manifest.singleTour||manifest.d2Event)&&new URLSearchParams(window.location.search).get('close')==='1'
        ?<NativeCloseReport tournamentId={manifest.tour}/>:(manifest.singleTour||manifest.d2Event)&&new URLSearchParams(window.location.search).get('clock')==='1'
        ?<ClockPanel tournamentId={manifest.tour}/>:(manifest.singleTour||manifest.d2Event)&&new URLSearchParams(window.location.search).get('floor')==='1'
        ?<NativeFloor manifest={manifest}/>:<>
      {manifest.singleTour&&new URLSearchParams(window.location.search).get('register')==='1'
        ?<NativeRegistration tournamentId={manifest.tour} reentry={manifest.reentry}/>:<>
      {manifest.singleTour&&new URLSearchParams(window.location.search).get('cashier')==='1'
        ?<MemoryRouter initialEntries={[`/ops/cashier?club=${manifest.club}`]}><OpsAuthProvider><OpsCapabilityProvider><OpsWorkspaceProvider><TourCashierWorkbench/></OpsWorkspaceProvider></OpsCapabilityProvider></OpsAuthProvider></MemoryRouter>:<>
      {manifest.singleTour&&new URLSearchParams(window.location.search).get('chips')==='1'
        ?<MemoryRouter initialEntries={[`/chip-ops?t=${manifest.tour}`]}><ChipOpsManager/></MemoryRouter>:<>
      {new URLSearchParams(window.location.search).get('create')==='1'?<NewTournamentDialog clubs={[]} defaultClubId={manifest.club} multiClub={false} lockMode="single" onCreated={()=>{}}/>:new URLSearchParams(window.location.search).get('schedule')==='1'?<BulkScheduleDialog clubs={[]} defaultClubId={manifest.club} multiClub={false} onCreated={()=>{}}/>:new URLSearchParams(window.location.search).get('blinds')==='1'?<BlindEditorPanel tournamentId={manifest.tour}/>:manifest.d2Event&&new URLSearchParams(window.location.search).get('event')==='1'?<MultiDayFloorEventPanel eventId={manifest.d2Event}/>:manifest.baggingFlight||(manifest.linkedMainEvent&&new URLSearchParams(window.location.search).get('bagging')==='1')?<OpsAuthProvider><MultiDayBaggingPanel tournamentId={manifest.baggingFlight??manifest.tour}/></OpsAuthProvider>:new URLSearchParams(window.location.search).get('tracker')==='1'
      ?<MemoryRouter><NativeHandInput tournamentId={manifest.tour}/></MemoryRouter>:<>
      {new URLSearchParams(window.location.search).get('health')==='1'&&<NativeSwingHealth club={manifest.club}/>}
      {manifest.d2Event?<MultiDayInitialDrawPanel eventId={manifest.d2Event}/>:<><PrizePayoutTrackingSection tournamentId={manifest.tour} /><LivePayoutTab /></>}
      </>}
      </>}
      </>}
      </>}
      </>}
      </>}
      </>}
      </>}
    </>}
    </>}
  </main>;
}
type OpsSharedManifest=Manifest&{correctionHand?:string};
const NativeLiveHandFeed = lazy(() => import('@/components/cashier/tournament-live/viewer-hub/LiveHandFeed').then(m => ({ default: m.LiveHandFeed })));
function NativeAnonymousFeed() {
 const [manifest,setManifest]=useState<OpsSharedManifest|null>(null),[error,setError]=useState(false);
 useEffect(()=>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
  void fetch(`${api}/__local/manifest`,{signal:controller.signal}).then(async response=>{
   if(!response.ok)throw new Error('manifest unavailable');
   const value=await response.json() as OpsSharedManifest;
   if(!controller.signal.aborted)setManifest(value);
  }).catch(()=>setError(true)).finally(()=>clearTimeout(timer));
  return()=>{controller.abort();clearTimeout(timer);};
 },[]);
 return <main className="p-4 space-y-3"><h1>Anonymous hand feed · native local TEST</h1>
  <p>Actual feed component; public RPCs execute as anon in PG17. No mutation controls.</p>
  {error?<p role="alert">Không đọc được manifest local.</p>:manifest?.historyTable?.id
   ?<Suspense fallback={<p role="status">Đang tải feed…</p>}><NativeLiveHandFeed tournamentId={manifest.tour} featuredTableId={manifest.historyTable.id} initialTableHistory/></Suspense>
   :<p role="status">Đang đọc manifest…</p>}
 </main>;
}
function NativeOpsSharedPanels() {
 const {user,session,loading}=useOpsAuth();
 const [manifest,setManifest]=useState<OpsSharedManifest|null>(null),[error,setError]=useState<string|null>(null);
 useEffect(()=>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  void fetch(`${api}/__local/manifest`,{signal:controller.signal}).then(async response=>{
   if(!response.ok)throw new Error('Local manifest unavailable');
   const next=await response.json() as OpsSharedManifest;
   if(!controller.signal.aborted)setManifest(next);
  }).catch(()=>{if(!controller.signal.aborted)setError('Không đọc được manifest Ops local.');})
   .finally(()=>clearTimeout(timer));
  return()=>{controller.abort();clearTimeout(timer);};
 },[]);
 const login=async()=>{
  if(!manifest)return;
  try{const result=await opsClient.auth.signInWithPassword({email:manifest.email,password:'LOCAL_TEST_ONLY'});setError(result.error?.message??null);}
  catch{setError('Không đăng nhập được Ops TEST local.');}
 };
 return <main className="p-4 space-y-3"><h1>Ops-only shared panels · local TEST</h1>
  <p>OpsAuthProvider only; no public AuthProvider. Reads use canonical local RPC.</p>
  <Button disabled={!manifest} onClick={()=>void login()}>Đăng nhập Ops TEST local</Button>
  {error&&<p role="alert">{error}</p>}{loading&&<p role="status">Đang xác minh Ops session…</p>}
  {manifest&&user?.id===manifest.actor&&!loading&&(new URLSearchParams(window.location.search).get('panel')==='correction'
   ?manifest.correctionHand?<MemoryRouter><OpsHandHistoryWorkspace key={JSON.stringify([user.id,sessionReadEpoch(session),manifest.correctionHand])} tournamentId={manifest.tour} initialHandId={manifest.correctionHand} initialTableId={manifest.historyTable?.id} actorId={user.id} workspaceMode/></MemoryRouter>:<p role="alert">Manifest không có hand correction.</p>
   :new URLSearchParams(window.location.search).get('panel')==='cashier'
   ?<MemoryRouter initialEntries={[`/ops/cashier?club=${manifest.club}`]}><OpsCapabilityProvider><OpsWorkspaceProvider><TourCashierWorkbench/></OpsWorkspaceProvider></OpsCapabilityProvider></MemoryRouter>
   :new URLSearchParams(window.location.search).get('panel')==='finance'
   ?<MemoryRouter initialEntries={[`/ops/finance?club=${manifest.club}`]}><OpsCapabilityProvider><OpsWorkspaceProvider><OpsFinanceWorkspace/></OpsWorkspaceProvider></OpsCapabilityProvider></MemoryRouter>
   :new URLSearchParams(window.location.search).get('panel')==='intelligence'
   ?<OpsIntelligenceCommandCenterV1 key={`${user.id}:${manifest.club}`} clubId={manifest.club} clubName="Main Event linked local TEST" showDataHealth={false}/>
   :new URLSearchParams(window.location.search).get('panel')==='floor-list-read'
   ?<MemoryRouter initialEntries={[`/ops/floor?club=${manifest.club}`]}><OpsCapabilityProvider><OpsWorkspaceProvider><OpsFloorListReadWorkspace/></OpsWorkspaceProvider></OpsCapabilityProvider></MemoryRouter>
   :new URLSearchParams(window.location.search).get('panel')==='tracker-read'
   ?<MemoryRouter initialEntries={[`/ops/tracker?club=${manifest.club}`]}><OpsCapabilityProvider><OpsWorkspaceProvider><OpsTrackerReadWorkspace/></OpsWorkspaceProvider></OpsCapabilityProvider></MemoryRouter>
   :new URLSearchParams(window.location.search).get('panel')==='chip'
   ?<MemoryRouter initialEntries={[`/ops/chip-ops?club=${manifest.club}&t=${manifest.tour}`]}><OpsCapabilityProvider><OpsWorkspaceProvider><OpsChipOpsWorkspace/></OpsWorkspaceProvider></OpsCapabilityProvider></MemoryRouter>
   :new URLSearchParams(window.location.search).get('panel')==='bagging'
   ?<MultiDayBaggingPanel tournamentId={manifest.tour}/>
   :new URLSearchParams(window.location.search).get('panel')==='dealer'
   ?<MemoryRouter initialEntries={[`/ops/dealer-swing?club=${manifest.club}`]}><OpsCapabilityProvider><OpsWorkspaceProvider><OpsDealerControlWorkspace/></OpsWorkspaceProvider></OpsCapabilityProvider></MemoryRouter>
   :new URLSearchParams(window.location.search).get('panel')==='multi-day'
   ?manifest.d2Event?<OpsMultiDayEvent eventId={manifest.d2Event} surface="payout" actorId={user.id} sessionEpoch={sessionReadEpoch(session)}/>:<p role="alert">Manifest không có event D2.</p>
   :new URLSearchParams(window.location.search).get('panel')==='multi-day-design'
   ?manifest.d2Event?<OpsMultiDayEvent eventId={manifest.d2Event} surface="design" actorId={user.id} sessionEpoch={sessionReadEpoch(session)}/>:<p role="alert">Manifest không có event D2.</p>
   :<OpsTvBrandingEditor tournamentId={manifest.tour} actorId={user.id} sessionEpoch={sessionReadEpoch(session)}/>)}
 </main>;
}

function NativeSyncFocusProbe() {
 const [failed,setFailed]=useState(false);
 return <main className="p-4 space-y-4 text-foreground">
  <h1>Sync alert visibility · local UI TEST</h1>
  <p>Component sản phẩm thật; chỉ mô phỏng trạng thái lỗi UI, không gửi RPC hoặc ghi DB.</p>
  <ViewerSyncStatus phase={failed?'error':'idle'} lastLabel={failed?'Chưa xác minh được hand/session/epoch để lưu. Hãy tải lại bàn.':null}/>
  <div className="min-h-screen" aria-hidden="true"/>
  <Button onClick={()=>setFailed(true)}>Mô phỏng lỗi Submit TEST</Button>
 </main>;
}

export default function PayoutNativePreview() {
  const [queryClient]=useState(()=>new QueryClient({defaultOptions:{queries:{retry:false,...(new URLSearchParams(window.location.search).get('fnb-session')==='1'?{staleTime:5*60*1000}:{})}}}));
  if (!import.meta.env.DEV || import.meta.env.VITE_SUPABASE_URL !== api
    || window.location.hostname !== "127.0.0.1") {
    return <p>Native local harness yêu cầu loopback và cấu hình TEST.</p>;
  }
  if(new URLSearchParams(window.location.search).get('sync-focus')==='1')return <NativeSyncFocusProbe/>;
  if(new URLSearchParams(window.location.search).get('anonymous-feed')==='1')return <NativeAnonymousFeed/>;
  if(new URLSearchParams(window.location.search).get('ops-shared')==='1')return <QueryClientProvider client={queryClient}>
   <Suspense fallback={<p role="status">Đang tải Ops TEST…</p>}><OpsAuthProvider><Toaster/><NativeOpsSharedPanels/></OpsAuthProvider></Suspense>
  </QueryClientProvider>;
  if(new URLSearchParams(window.location.search).get('config217')==='1')return <Suspense fallback={<p role="status">Đang tải payout clone…</p>}><PrizeConfigurationNativePreview/></Suspense>;
  if(new URLSearchParams(window.location.search).get('image-codec')==='1')return <Suspense fallback={<p role="status">Đang tải codec TEST…</p>}><ImageCodecNativePreview/></Suspense>;
  if(new URLSearchParams(window.location.search).get('iq-author-read')==='1')return <QueryClientProvider client={queryClient}><main className="mx-auto max-w-3xl space-y-4 p-4"><p>TEST local: component soạn câu hỏi thật; chỉ nghiệm thu đọc, không thay thế quyền admin của router.</p><Toaster/><Suspense fallback={<p role="status">Đang tải câu hỏi TEST…</p>}><PokerIqEditorNative/></Suspense></main></QueryClientProvider>;
  return <QueryClientProvider client={queryClient}><SupabaseClientProvider client={supabase} backendScope={api}><AuthProvider><Toaster /><Suspense fallback={<p role="status">Đang tải màn hình TEST local…</p>}><NativePayout /></Suspense></AuthProvider></SupabaseClientProvider></QueryClientProvider>;
}
