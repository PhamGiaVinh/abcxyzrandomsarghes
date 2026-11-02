import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID, randomBytes, createHmac } from 'node:crypto';
import {runTrackerBrowserEdge,readTrackerAlertCounts} from '../trackerVoice/trackerBrowserEdge.local.mjs';
import {runRegisterBrowserEdge} from './registerBrowserEdge.local.mjs';
import {runClockBrowserEdge} from './clockBrowserEdge.local.mjs';
import {retrySingleTourPaidNative} from './singleTourPaidRetry.native.mjs';
import {runFnbBrowserEdge} from './fnbBrowserEdge.local.mjs';
import {createStakingBrowserEdge} from './stakingBrowserEdge.local.mjs';
import {createGroupInviteBrowser} from './groupInviteBrowser.local.mjs';
import {seedPayrollBrowserFixture,createPayrollBrowser} from './payrollBrowser.local.mjs';
import {createNativeReceiptHandler} from './buyinReceiptHandler.local.mjs';
import {createMultiDayCorrectionBrowser} from './multiDayCorrectionBrowser.local.mjs';
import {createDealerPlanBrowser} from './dealerPlanBrowser.local.mjs';
import {createHistoricalDisplayBrowser} from '../trackerSettlement/historicalDisplayBrowser.local.mjs';
import {createFloorAlertBrowser} from '../trackerVoice/floorAlertBrowser.local.mjs';
import {createCorrectionBrowser} from '../trackerSettlement/correctionBrowser.local.mjs';
import {createTvProjection166Browser} from './tvProjection166.browser.local.mjs';
import {createMainEvent167Design} from './mainEvent167.design.local.mjs';
import {createTv258Assets} from '../tvBrandingStorage/assets258.browser.local.mjs';
import {createBank272Browser} from '../chipOps/bank272.browser.local.mjs';
import {createDirect275Browser} from './direct275.browser.local.mjs';
import {createFeedInvalidation288} from '../trackerSettlement/feedInvalidation288.browser.local.mjs';
import {createSePay303Browser} from './sepay303.browser.local.mjs';
import {createSePay306Browser} from './sepay306.browser.local.mjs';
import {createFnb341Browser} from './fnb341.browser.local.mjs';
import {createPayout379Read} from './payout379.read.local.mjs';
import {createSingle699Payout} from './single699.payout-browser.local.mjs';
import {createPayout704Manual} from './payout704.manual-browser.local.mjs';
import {createSingle706PayrollRead} from '../dealerSwing/single706.payroll-read.local.mjs';
import {createFnb384Kitchen} from './fnb384.kitchen-browser.local.mjs';
import {createFnb731Shift} from './fnb731.shift-browser.local.mjs';
import {createSePay608Browser} from './sepay608.browser.local.mjs';
import {createCoupling613Browser} from '../chipOps/coupling613.browser.local.mjs';
import {createBag630Browser} from '../chipOps/bag630.browser.local.mjs';
import {createRefund538Browser} from './refund538.browser.local.mjs';
import {createFunding560Browser} from './funding560.browser.local.mjs';
import {createStream579Browser} from './stream579.browser.local.mjs';
import {createOps601Read} from './ops601.read.local.mjs';
import {createSingle643Reads} from '../dealerSwing/single643.swing-read.local.mjs';
import {createSingle644Assignment} from '../dealerSwing/single644.assign-bridge.local.mjs';
import {createSingle661ManualSwing} from '../dealerSwing/single661.manual-swing.local.mjs';
import {createSingle677Redraw} from '../floorTableControlV3/single677.redraw-browser.local.mjs';
import {createFloor791Read} from './floor791.read.local.mjs';
if(process.env.VINPOKER_CHECKOUT817_BROWSER==='1'){
 const {runCheckout817Browser}=await import('../dealerSwing/checkout817.browser.local.mjs');
 await runCheckout817Browser();process.exit(0);
}
let single677Bridge=null;
let single678UndoScope=null;
let single643Reads=null;
let single644Assign=null;
let stream579Bridge=null;
let refund538Bridge=null;
let funding560Bridge=null;
let sepay608Bridge=null;
let coupling613Bridge=null;
let bag630Bridge=null;
let bag616Proof=null,bag616Fault=true;

assert.equal(process.env.VINPOKER_NATIVE_BROWSER, '1');
if(process.env.VINPOKER_BAG635_ACTIVE==='1')assert.equal(process.env.VINPOKER_BAG630_BROWSER,'1');
if(process.env.VINPOKER_BAG630_BROWSER==='1'){
 assert.equal(process.env.VINPOKER_LINKED_D2_184,'1');assert.equal(process.env.VINPOKER_D2_EVENT,'dbb49f8d-7d47-4c2c-afd9-f57062c9971d');
 for(const key of ['VINPOKER_BAG616_READONLY','VINPOKER_COUPLING613_BROWSER','VINPOKER_CORRECTION_BROWSER','VINPOKER_SEPAY608_BROWSER'])assert.notEqual(process.env[key],'1');
}
if(process.env.VINPOKER_BAG616_READONLY==='1'){
 assert.equal(process.env.VINPOKER_LINKED_D2_184,'1');assert.equal(process.env.VINPOKER_D2_EVENT,'dbb49f8d-7d47-4c2c-afd9-f57062c9971d');
 for(const key of ['VINPOKER_COUPLING613_BROWSER','VINPOKER_CORRECTION_BROWSER','VINPOKER_SEPAY608_BROWSER'])assert.notEqual(process.env[key],'1');
}
if(process.env.VINPOKER_COUPLING614_NEGATIVE==='1')assert.equal(process.env.VINPOKER_COUPLING613_BROWSER,'1');
if(process.env.VINPOKER_COUPLING613_BROWSER==='1'){
 assert.equal(process.env.VINPOKER_LINKED_D2_184,'1');assert.equal(process.env.VINPOKER_D2_EVENT,'dbb49f8d-7d47-4c2c-afd9-f57062c9971d');
 for(const flag of ['VINPOKER_CORRECTION_BROWSER','VINPOKER_PAYMENT461_BROWSER','VINPOKER_SEPAY608_BROWSER','VINPOKER_FNB384_KITCHEN'])assert.notEqual(process.env[flag],'1');
}
if(process.env.VINPOKER_SEPAY608_BROWSER==='1'){
 assert.equal(process.env.VINPOKER_LINKED_D2_184,'1');assert.equal(process.env.VINPOKER_D2_EVENT,'dbb49f8d-7d47-4c2c-afd9-f57062c9971d');
 assert.notEqual(process.env.VINPOKER_FNB384_KITCHEN,'1');assert.notEqual(process.env.VINPOKER_FINANCE583_READONLY,'1');
}
if(process.env.VINPOKER_FNB607_SESSION_READ==='1'){
 assert.equal(process.env.VINPOKER_FNB384_KITCHEN,'1');assert.equal(process.env.VINPOKER_FNB385_READONLY,'1');
 assert.match(process.env.VINPOKER_FNB607_EXPECTED_FACTS??'',/^[a-f0-9]{32}$/);
}
// A read-only finance launch must never fall through to fixture creation.
if(process.env.VINPOKER_FINANCE583_READONLY==='1'){
  assert.equal(process.env.VINPOKER_LINKED_D2_184,'1','finance read requires retained Main167');
  assert.equal(process.env.VINPOKER_D2_EVENT,'dbb49f8d-7d47-4c2c-afd9-f57062c9971d','finance read requires exact event');
}
const d2847=process.env.VINPOKER_D2_847_READ_ONLY==='1';
if(d2847){
 const allowed=new Set(['VINPOKER_NATIVE_BROWSER','VINPOKER_D2_847_READ_ONLY','VINPOKER_FLOOR791_READ','VINPOKER_D2_EVENT']);
 for(const [key,value] of Object.entries(process.env))if(key.startsWith('VINPOKER_')&&value)assert.ok(allowed.has(key),`847 unexpected mode ${key}`);
}
const distro = 'PokerVision-P16-4C-Eval', database = d2847?'vinpoker_checkout814_race_local':'vinpoker_ops_cash115_qualified_c';
const parent = '/tmp/vinpoker-sol-local-20261016-0e79a729';
const wsl = (...args) => execFileSync('wsl', ['-d', distro, '--', ...args], { encoding: 'utf8', timeout: 30000, maxBuffer: 2e6 }).trim();
const sql = (input) => execFileSync('wsl', ['-d', distro, '--', 'env', 'PGHOST=127.0.0.1', 'PGPORT=55441',
  'PGUSER=postgres', `PGDATABASE=${database}`, 'psql', '-w', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'],
{ input, encoding: 'utf8', timeout: 30000, maxBuffer: 2e6 }).trim();
const ctl = ['runuser', '-u', 'postgres', '--', '/usr/lib/postgresql/17/bin/pg_ctl', '-D', `${parent}/data`];
assert.equal(wsl('realpath', `${parent}/data`), `${parent}/data`);
assert.equal(wsl('cat', `${parent}/data/PG_VERSION`), '17');
const status = spawnSync('wsl', ['-d', distro, '--', ...ctl, 'status'], { encoding: 'utf8', timeout: 30000 });
assert.ok([0, 3].includes(status.status));
let owned = false, server, d2GateBefore=null, d2OpsBefore=null, d2Club=null, stakingBridge=null, inviteBridge=null, payrollBridge=null, chipReadSnapshot=null, chipReadBefore=null,memberReadProof=null,finalizationReadProof=null,qualificationReadProof=null,continueReadProof=null,rulesReadProof=null,correctionBridge=null,dealerBridge=null,sum807Proof=null;
const stop = () => { if (owned) { wsl(...ctl, '-m', 'fast', '-w', 'stop'); owned = false; } };
let historyObserverProof=null,inboxDmFixture=null,sidepotFinancialProof=null,sidepotActionReadProof=null,tvEditorProof=null,freshRegistrationProof=null,historicalDisplayBridge=null,floorAlertBridge=null,opsSharedReadProof=null,dealerControlReadProof=null,handCorrectionBridge=null,tv166Bridge=null,main167Bridge=null,bank265Proof=null;
let notificationReadProof=null;
let stakingBuyerProof=null;
let feed288Bridge=null,feed291Proof=null;
let feedCatalogFault313=false;
let feedCatalogHang326=false;
let clean244Proof=null,clean244Player=null,clean244DealerIds=[];
let tv258Bridge=null;
let bank270Proof=null;
let bank272Bridge=null;
let direct275Bridge=null;
let sepay303Bridge=null;
let sepay306Bridge=null;
let fnb341Bridge=null;
let payout379Bridge=null;
let single699Bridge=null;
let payout704Bridge=null;
let single706Payroll=null;
let fnb384Bridge=null;
let fnb731Bridge=null;
const uuid = (value) => typeof value === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
try {
  if (status.status === 3) {
    // Crash recovery can fsync the retained local catalog for >30s. This is
    // startup only; SQL/HTTP deadlines remain unchanged, never delete lock files.
    execFileSync('wsl',['-d',distro,'--',...ctl,'-l',`${parent}/server.log`,'-o',`-h 127.0.0.1 -p 55441 -k ${parent}/socket -c shared_buffers=16MB -c work_mem=1MB -c maintenance_work_mem=16MB -c max_connections=10 -c max_worker_processes=0 -c max_parallel_workers=0 -c autovacuum=off -c wal_buffers=1MB -c max_wal_size=64MB -c min_wal_size=32MB`,'-t','110','-w','start'],{encoding:'utf8',timeout:120000,maxBuffer:2e6});
    owned = true;
  }
  assert.equal(sql('SHOW data_directory;'), `${parent}/data`);
  assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('server_version_num')::int/10000;"), `${database}|127.0.0.1|55441|17`);
  assert.equal(sql("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net');"), 'f');
  assert.equal(sql("SELECT to_regprocedure('public.get_tournament_payout_recipients(uuid)') IS NOT NULL;"), 't');
  const d2Event=process.env.VINPOKER_D2_EVENT;
  const sum807=process.env.VINPOKER_SUM807_READ_ONLY==='1';
  if(d2847){
   assert.equal(d2Event,'e6551af0-e6d0-4fb0-9342-fdd7465fcaf2');assert.equal(process.env.VINPOKER_FLOOR791_READ,'1');
   assert.equal(sql("SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();"),'VINPOKER_CHECKOUT814_OWNED_LOCAL_CLONE_SOURCE_vinpoker_fnb719_gate_local_HEAD_ef6a26948');
   assert.equal(sql("SELECT stages->-1->>'stage' FROM private.d2_seed846_commit_fixture WHERE id;"),'complete');
   assert.equal(sql("SELECT md5(pg_get_functiondef('public.multi_day_final_roster_v1(uuid)'::regprocedure))=installed_digest FROM private.d2_held849_install WHERE id;"),'t');
  }
  if(sum807){assert.equal(d2Event,'1cb64e29-c5d8-43e3-b8d9-7815905749b1');assert.equal(process.env.VINPOKER_FLOOR791_READ,'1');assert.notEqual(process.env.VINPOKER_LINKED_D2_184,'1');}
  const fnbKitchen384=process.env.VINPOKER_FNB384_KITCHEN==='1';
  const fnbShift731=process.env.VINPOKER_FNB731_SHIFT==='1';
  if(fnbShift731){
    assert.ok(fnbKitchen384&&process.stdin.isTTY,'731 needs exact retained FNB fixture and graceful stop protocol');
    assert.notEqual(process.env.VINPOKER_FNB385_READONLY,'1');assert.notEqual(process.env.VINPOKER_FNB607_SESSION_READ,'1');
  }
  if(fnbKitchen384)assert.ok(!d2Event&&!process.env.VINPOKER_EXISTING_SINGLE_TOUR&&!process.env.VINPOKER_PAYOUT379_READONLY,'isolated FNB384 only');
  const payout379ReadOnly=process.env.VINPOKER_PAYOUT379_READONLY==='1';
  const payout700Recovery=process.env.VINPOKER_PAYOUT700_RECOVERY==='1';
  const payout704Manual=process.env.VINPOKER_PAYOUT704_MANUAL==='1';
  if(payout704Manual)assert.ok(payout379ReadOnly&&!payout700Recovery&&process.stdin.isTTY,'exact retained703 canary, isolated auth model and graceful PTY only');
  if(payout700Recovery)assert.ok(payout379ReadOnly&&process.stdin.isTTY&&!process.env.VINPOKER_CLEAN244_SETUP,'exact separate300K canary and graceful PTY only');
  if(payout379ReadOnly)assert.ok(!d2Event&&!process.env.VINPOKER_EXISTING_SINGLE_TOUR&&!process.env.VINPOKER_SEPAY_WRITE306,'isolated read-only379 scope');
  const linkedD2=process.env.VINPOKER_LINKED_D2_184==='1';
  const memberStacks323=process.env.VINPOKER_MEMBER_STACKS323==='1';
  if(memberStacks323)assert.ok(linkedD2,'member list canary reuses exact retained TEST actor');
  const sepayRead292=process.env.VINPOKER_SEPAY_READ292==='1';
  const sepayWrite303=process.env.VINPOKER_SEPAY_WRITE303==='1';
  const sepayWrite306=process.env.VINPOKER_SEPAY_WRITE306==='1';
  if(sepayWrite306)assert.ok(!d2Event&&!linkedD2&&!sepayRead292&&!sepayWrite303&&!process.env.VINPOKER_EXISTING_SINGLE_TOUR,'isolated306 fixture only');
  if(sepayWrite303)assert.ok(linkedD2&&!sepayRead292,'only exact303 isolated ignore in retained-owner browser context');
  if(sepayRead292)assert.ok(linkedD2,'read-only SePay canary requires retained Main167');
  let sepayReadFault292=sepayRead292;
  const bank272Browser=process.env.VINPOKER_BANK272_BROWSER==='1';
  if(bank272Browser)assert.ok(!d2Event&&!process.env.VINPOKER_EXISTING_SINGLE_TOUR&&!process.env.VINPOKER_CLEAN244_SETUP&&!process.env.VINPOKER_BANK264_CASHIER_READONLY,'isolated retained bank272 only');
  const bank270ReadOnly=process.env.VINPOKER_BANK270_READONLY==='1';
  if(bank270ReadOnly)assert.ok(linkedD2,'bank read only uses retained Main167, never creates a fixture');
  const notificationReadOnly=process.env.VINPOKER_NOTIFICATION_READ_ONLY233==='1';
  if(notificationReadOnly)assert.ok(linkedD2,'notification read canary uses the exact retained Main Event actor');
  let notificationReadHang=process.env.VINPOKER_NOTIFICATION_READ_HANG243==='1';
  if(notificationReadHang)assert.ok(notificationReadOnly);
  let authRoleDelayOnce=process.env.VINPOKER_AUTH_ROLE_DELAY_ONCE==='1';
  if(authRoleDelayOnce)assert.ok(linkedD2);
  const uuidTv220=process.env.VINPOKER_UUID_TV220_BROWSER==='1';
  if(uuidTv220)assert.ok(linkedD2);
  if(linkedD2)assert.equal(d2Event,'dbb49f8d-7d47-4c2c-afd9-f57062c9971d');
  const handCorrectionScope=process.env.VINPOKER_HAND_CORRECTION_SCOPE?JSON.parse(process.env.VINPOKER_HAND_CORRECTION_SCOPE):null;
  const feedRead291=process.env.VINPOKER_FEED_READ291==='1';
  if(feedRead291){
    assert.deepEqual(handCorrectionScope,{tour:'46cab483-91e7-4220-aacf-e17bdf05269c',club:'a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',actor:'675fe35e-60a8-4452-bb90-e79486d54da6',hand:'4aa376ee-4a27-4963-9c69-dd0a2cd17abf',table:'d294f4a4-082b-4efc-a6ca-1f96579ea344',sourceRevision:'25'});
    assert.equal(sql("SELECT count(*) FROM public.tournament_settlement_outcomes WHERE hand_id='4aa376ee-4a27-4963-9c69-dd0a2cd17abf' AND source_revision=25 AND verification_scope='chain' AND status='verified' AND idempotency_key='5498a0ed-eef4-48be-86c2-4ada113741ba';"),'1');
    const fingerprint=()=>sql(`SELECT md5(jsonb_build_object(
      'hands',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_hands x),
      'players',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.hand_players x),
      'actions',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.hand_actions x),
      'seats',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x),
      'cash',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
      'prizes',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x))::text);`);
    feed291Proof={fingerprint,before:fingerprint()};
  }
  if(handCorrectionScope){
    assert.ok(!d2Event&&!process.env.VINPOKER_TRACKER_SIDEPOT_SCOPE&&!process.env.VINPOKER_EXISTING_SINGLE_TOUR&&!process.env.VINPOKER_EXISTING_CLOSED_TOUR);
    for(const key of ['tour','club','actor','hand','table'])assert.match(handCorrectionScope[key],/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i);
  }
  const opsSharedReadOnly=process.env.VINPOKER_OPS_SHARED_READONLY==='1';
  const bank265ReadOnly=process.env.VINPOKER_BANK264_CASHIER_READONLY==='1';
  if(bank265ReadOnly)assert.ok(!d2Event&&!process.env.VINPOKER_EXISTING_SINGLE_TOUR&&!process.env.VINPOKER_CLEAN244_SETUP,'isolated retained bank264 read only');
  if(opsSharedReadOnly)assert.equal(d2Event,'b8ebfbc7-ff78-4515-8812-7d748b828d0b');
  const tvEditorTour=process.env.VINPOKER_TV_EDITOR_TOUR;
  if(tvEditorTour){
    assert.match(tvEditorTour,/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i);
    assert.ok(!d2Event&&!process.env.VINPOKER_TRACKER_SIDEPOT_SCOPE&&!process.env.VINPOKER_EXISTING_SINGLE_TOUR&&!process.env.VINPOKER_EXISTING_CLOSED_TOUR);
  }
  const activeMemberScope=process.env.VINPOKER_ACTIVE_MEMBER_RECEIPT_SCOPE?JSON.parse(process.env.VINPOKER_ACTIVE_MEMBER_RECEIPT_SCOPE):null;
  if(activeMemberScope){
    assert.equal(process.env.VINPOKER_MEMBER_RECEIPT_BROWSER,'1');
    assert.ok(!d2Event&&!process.env.VINPOKER_TRACKER_SIDEPOT_SCOPE&&!process.env.VINPOKER_EXISTING_SINGLE_TOUR&&!process.env.VINPOKER_EXISTING_CLOSED_TOUR);
    assert.deepEqual(Object.keys(activeMemberScope).sort(),['registration','tour']);
    for(const value of Object.values(activeMemberScope))assert.match(value,/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i);
  }
  const sidepotScope=process.env.VINPOKER_TRACKER_SIDEPOT_SCOPE?JSON.parse(process.env.VINPOKER_TRACKER_SIDEPOT_SCOPE):null;
  if(sidepotScope){
    assert.ok(!d2Event&&!process.env.VINPOKER_HISTORY_READ_ONLY&&!process.env.VINPOKER_INBOX_BROWSER);
    for(const key of ['tour','club','actor','entry','player','registration','seedHand','table','session'])assert.match(sidepotScope[key],/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i);
  }
  const dealerScope=process.env.VINPOKER_DEALER_BROWSER_SCOPE?JSON.parse(process.env.VINPOKER_DEALER_BROWSER_SCOPE):null;
  if(dealerScope){
    assert.ok(!d2Event&&!process.env.VINPOKER_EXISTING_SINGLE_TOUR&&!process.env.VINPOKER_PAYROLL_BROWSER,'independent dealer canary only');
    for(const key of ['actor','club','table','session','incoming','tour'])assert.match(dealerScope[key],/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i);
  }
  const historyReadOnly=process.env.VINPOKER_HISTORY_READ_ONLY==='1';
  const historyObserver=process.env.VINPOKER_HISTORY_OBSERVER_HAND;
  const multiple113Observer=process.env.VINPOKER_MULTIPLE113_OBSERVER==='1';
  if(multiple113Observer){
    assert.equal(historyObserver,'6bcc874f-828e-4e87-beb0-3ecbe9deda19');
    assert.ok(historyReadOnly&&!sidepotScope&&!handCorrectionScope&&!process.env.VINPOKER_INBOX_BROWSER&&!process.env.VINPOKER_HISTORY_OBSERVER_CORRECT);
  }
  const inboxBrowser=process.env.VINPOKER_INBOX_BROWSER==='1';
  const inboxDmChat=process.env.VINPOKER_INBOX_DM_CHAT;
  const dm277Send=process.env.VINPOKER_DM277_SEND==='1';
  const dm275Send=process.env.VINPOKER_DM275_SEND==='1'||dm277Send;let dm275Loss=dm275Send;
  if(dm275Send)assert.ok(inboxBrowser&&inboxDmChat==='6cc70861-ad37-4049-932f-eabfb46e8089'&&historyReadOnly,'exact retained private DM only');
  if(inboxDmChat){assert.ok(inboxBrowser);assert.match(inboxDmChat,/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i);}
  let dmFault=process.env.VINPOKER_INBOX_DM_FAULT==='1';
  let dmHang=process.env.VINPOKER_INBOX_DM_HANG==='1';
  const dmPairHang=process.env.VINPOKER_INBOX_DM_PAIR_HANG==='1';
  if(dmPairHang)assert.ok(inboxDmChat,'pair-only hang requires the exact private TEST chat');
  if(dmHang)assert.ok(inboxBrowser,'DM hang only in qualified Inbox read canary');
  if(dmFault)assert.ok(inboxBrowser,'DM read fault only in qualified Inbox canary');
  let unreadFault=inboxBrowser&&!dmFault&&!inboxDmChat;
  if(inboxBrowser)assert.ok(historyReadOnly&&historyObserver,'Inbox read-only TEST requires qualified canary');
  const liveObserverCorrection=process.env.VINPOKER_HISTORY_OBSERVER_CORRECT==='1';
  if(liveObserverCorrection)assert.equal(historyObserver,'055121ac-b49f-4b4b-9d17-a13cdee903e3','one exact independent TEST hand only');
  let observerFixture=null;
  const mixed230Observer=process.env.VINPOKER_MIXED230_OBSERVER==='1';
  const hand555Observer=process.env.VINPOKER_HAND555_OBSERVER==='1';
  const hand589Observer=process.env.VINPOKER_HAND589_OBSERVER==='1';
  if(hand589Observer){assert.equal(historyObserver,'985238ea-a213-4f59-a0ab-295f25b4ab5b');assert.ok(historyReadOnly&&!hand555Observer&&!multiple113Observer&&!mixed230Observer&&!liveObserverCorrection&&!inboxBrowser);}
  if(hand555Observer){assert.equal(historyObserver,'3787718f-ef28-485d-aef6-342241c6fe40');assert.ok(historyReadOnly&&!multiple113Observer&&!mixed230Observer&&!liveObserverCorrection&&!inboxBrowser);}
  if(mixed230Observer){assert.equal(historyObserver,'c14ee05a-86bb-4f10-9dcd-819c3fc521f0');assert.ok(historyReadOnly&&!multiple113Observer&&!liveObserverCorrection&&!inboxBrowser);}
  if(historyObserver){
    assert.match(historyObserver,/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i);
    assert.ok(historyReadOnly&&!d2Event&&!dealerScope&&!process.env.VINPOKER_EXISTING_SINGLE_TOUR,'independent read-only corrected hand only');
    if(hand555Observer||hand589Observer){
      observerFixture=JSON.parse(sql(`SELECT jsonb_build_object('tour',t.id,'club',c.id) FROM public.tournament_hands h
       JOIN public.tournaments t ON t.id=h.tournament_id JOIN public.clubs c ON c.id=t.club_id
       JOIN public.club_settings cs ON cs.club_id=c.id
       CROSS JOIN LATERAL public.get_tournament_historical_display_source_hash(h.id) s
       WHERE h.id='${historyObserver}' AND t.id='46cab483-91e7-4220-aacf-e17bdf05269c'
        AND c.id='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760' AND c.owner_id='675fe35e-60a8-4452-bb90-e79486d54da6'
        AND t.name='Cash identity local TEST' AND c.name='Cash identity local TEST' AND NOT cs.auto_swing_enabled
        AND h.created_by=c.owner_id AND h.status='completed' AND NOT h.is_voided AND h.hand_number=${hand589Observer?36:35} AND h.source_revision=${hand589Observer?23:15} AND h.pot_size=${hand589Observer?1600:2200}
        AND h.tournament_table_id='d294f4a4-082b-4efc-a6ca-1f96579ea344' AND h.table_session_id='ee2b9393-0c96-42f9-8667-7f306edeb9bc'
        AND h.community_cards='${hand589Observer?'["9c","Th","Jd","Qs","Kc"]':'["2c","3d","4h","5s","6c"]'}'::jsonb
        AND (SELECT count(*) FROM public.hand_players WHERE hand_id=h.id)=2
        AND EXISTS(SELECT 1 FROM public.table_operation_receipts r WHERE request_id='${hand589Observer?'8dd75121-3cef-47a4-b5b9-7de60166a2c9':'65a6a27a-3673-4d49-b753-2f4a43611c50'}'
          AND actor_id=c.owner_id AND result->>'hand_id'=h.id::text AND result->>'status'='success')
        AND EXISTS(SELECT 1 FROM public.tournament_settlement_outcomes o WHERE o.hand_id=h.id AND o.verification_scope='historical_display'
          AND o.status='verified' AND o.source_revision=s.source_revision AND o.source_chain_hash=s.source_chain_hash);`)||'null');
    }else if(multiple113Observer){
      observerFixture=JSON.parse(sql(`SELECT jsonb_build_object('tour',t.id,'club',c.id) FROM public.tournament_hands h
       JOIN public.tournaments t ON t.id=h.tournament_id JOIN public.clubs c ON c.id=t.club_id
       JOIN public.club_settings cs ON cs.club_id=c.id
       CROSS JOIN LATERAL (SELECT public.get_tracker_historical_display_snapshot(h.id,t.id) snapshot) s
       WHERE h.id='${historyObserver}' AND t.id='d24e3aed-f125-4bc5-ab11-49836c435e30' AND c.id='8e5239a5-36f2-4a0b-a0a3-cb7a236f51b2'
        AND c.owner_id='f793a5b3-6025-4766-bc1b-49f16aa1b44a' AND h.created_by=c.owner_id
        AND t.name='Cash identity local TEST' AND c.name='Cash identity local TEST' AND cs.auto_swing_enabled=false
        AND h.status='completed' AND NOT h.is_voided AND h.hand_number=3 AND h.source_revision=21 AND h.pot_size=79799
        AND h.tournament_table_id='22d4d681-6379-41fa-82c3-db2960fcd3b5' AND h.table_session_id='53e06f2b-44df-4a70-bb2e-ca42a33b984f'
        AND h.community_cards='["2c","3d","7h","9s","Tc"]'::jsonb
        AND (SELECT sum(applied_amount) FROM public.cashier_buyin_movements WHERE tournament_id=t.id)=400000
        AND EXISTS(SELECT 1 FROM public.tournament_settlement_outcomes o WHERE o.hand_id=h.id AND o.verification_scope='historical_display'
          AND o.status='verified' AND o.source_revision=(s.snapshot->>'sourceRevision')::bigint AND o.source_chain_hash=s.snapshot->>'sourceChainHash');`)||'null');
    }else if(mixed230Observer){
      observerFixture=JSON.parse(sql(`SELECT jsonb_build_object('tour',t.id,'club',c.id) FROM public.tournament_hands h
        JOIN public.tournaments t ON t.id=h.tournament_id JOIN public.clubs c ON c.id=t.club_id JOIN public.club_settings cs ON cs.club_id=c.id
        WHERE h.id='${historyObserver}' AND h.tournament_id='371c106a-97ad-40e8-a63d-7fc2b15a8ecc'
        AND c.id='aa892f65-ee9d-4248-a24c-8dfabd8b05a8' AND c.owner_id='34a88927-047d-401a-a4de-af49c391849b'
        AND t.name='Cash identity local TEST' AND NOT cs.auto_swing_enabled AND h.status='completed' AND NOT h.is_voided
        AND h.source_revision=20 AND h.hand_number=2 AND h.pot_size=59900
        AND h.tournament_table_id='c239e871-47c2-4ba8-829f-87d339f88112' AND h.table_session_id='253708f1-064b-47ef-8685-e08a0ff0898f'
        AND (SELECT sum(applied_amount) FROM public.cashier_buyin_movements WHERE tournament_id=t.id)=300000
        AND (SELECT count(*) FROM public.hand_actions WHERE hand_id=h.id)=7
        AND (SELECT count(*) FROM public.hand_players WHERE hand_id=h.id)=3
        AND EXISTS(SELECT 1 FROM public.tournament_settlement_outcomes o
          CROSS JOIN LATERAL (SELECT public.get_tracker_historical_display_snapshot(h.id,t.id) snapshot) s
          WHERE o.hand_id=h.id AND o.status='verified' AND o.verification_scope='historical_display'
          AND o.source_revision=(s.snapshot->>'sourceRevision')::bigint AND o.source_chain_hash=s.snapshot->>'sourceChainHash');`)||'null');
    }else observerFixture=JSON.parse(sql(`SELECT jsonb_build_object('tour',t.id,'club',t.club_id) FROM public.tournament_hands h
      JOIN public.tournaments t ON t.id=h.tournament_id JOIN public.clubs c ON c.id=t.club_id
      JOIN public.club_settings cs ON cs.club_id=c.id JOIN public.tournament_events e ON e.id=t.event_id AND e.club_id=c.id
      WHERE h.id='${historyObserver}' AND h.status='completed' AND NOT h.is_voided
      AND t.name='Cash identity local TEST' AND c.name='Cash identity local TEST' AND e.name='Shared paid event TEST'
      AND cs.auto_swing_enabled=false AND EXISTS(SELECT 1 FROM public.tournament_settlement_outcomes o
        WHERE o.hand_id=h.id AND o.source_revision=h.source_revision AND o.status='verified'
          AND o.correction_reason IN('TEST correct persisted board','TEST serialized correction resolver overlap'));`)||'null');
    assert.ok(observerFixture,'exact corrected canonical TEST fixture required');
    const fingerprint=()=>sql(`SELECT md5(jsonb_build_object(
      'hand',(SELECT to_jsonb(h) FROM public.tournament_hands h WHERE id='${historyObserver}'),
      'outcomes',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM public.tournament_settlement_outcomes o WHERE hand_id='${historyObserver}'),
      'queue',(SELECT jsonb_agg(to_jsonb(q) ORDER BY source_revision) FROM public.tracker_historical_display_queue q WHERE hand_id='${historyObserver}'))::text);`);
    historyObserverProof={fingerprint,before:fingerprint(),kind:multiple113Observer?'multiple113':mixed230Observer?'mixed230':'corrected'};
  }
  if(historyReadOnly){
    assert.ok((d2Event||observerFixture)&&!process.env.VINPOKER_BAGGING_FLIGHT,'read-only History requires the existing local fixture');
    if(process.env.VINPOKER_EXISTING_SINGLE_TOUR)assert.equal(process.env.VINPOKER_EXISTING_SINGLE_TOUR,'829e61fe-0ac8-4ced-950d-ab76cb8dadc5');
  }
  const baggingFlight=process.env.VINPOKER_BAGGING_FLIGHT;
  const freshRegistrationScope=process.env.VINPOKER_FRESH_REGISTRATION_SCOPE?JSON.parse(process.env.VINPOKER_FRESH_REGISTRATION_SCOPE):null;
  let registrationMalformed=process.env.VINPOKER_REGISTRATION_MALFORMED_RESPONSE==='1';
  if(registrationMalformed)assert.ok(freshRegistrationScope,'registration malformed fault requires exact isolated fixture');
  if(freshRegistrationScope){
    assert.deepEqual(freshRegistrationScope,{tour:'4130002a-8f5a-4d58-8472-1f42810b460e',player:'d997a135-c2b4-451a-b1e7-b5be493b1062'});
    assert.ok(!d2Event&&!sidepotScope&&!activeMemberScope&&!process.env.VINPOKER_EXISTING_SINGLE_TOUR);
  }
  const closedFixture=process.env.VINPOKER_EXISTING_CLOSED_TOUR;
  const clean244Mode=process.env.VINPOKER_CLEAN244_SETUP==='1';
  const single699Payout=process.env.VINPOKER_SINGLE699_PAYOUT==='1';
  if(single699Payout){
    assert.ok(clean244Mode&&process.stdin.isTTY,'exact original payout canary requires graceful PTY cleanup');
    for(const key of ['VINPOKER_CLEAN244_MEMBER','VINPOKER_CLEAN244_CASHIER_READ','VINPOKER_CLEAN244_FLOOR','VINPOKER_CLEAN244_DEALER','VINPOKER_SINGLE668_ISSUE','VINPOKER_PAYOUT379_READONLY'])assert.notEqual(process.env[key],'1');
  }
  const single668Issue=process.env.VINPOKER_SINGLE668_ISSUE==='1';
  if(single668Issue)assert.ok(clean244Mode&&!process.env.VINPOKER_CLEAN244_MEMBER&&!process.env.VINPOKER_CLEAN244_CASHIER_READ&&!process.env.VINPOKER_CLEAN244_FLOOR&&!process.env.VINPOKER_CLEAN244_DEALER,'only original-template issuance delta');
  const clean244Member=process.env.VINPOKER_CLEAN244_MEMBER==='1';
  const single666Reentry=process.env.VINPOKER_SINGLE666_REENTRY==='1';
  if(single666Reentry){assert.ok(clean244Member);assert.equal(process.env.VINPOKER_CLEAN244_MEMBER_INDEX,'8');}
  const clean244Floor=process.env.VINPOKER_CLEAN244_FLOOR==='1';
  const single677Redraw=process.env.VINPOKER_SINGLE677_REDRAW==='1';
  if(single677Redraw){
    assert.ok(process.stdin.isTTY||process.argv.includes('--smoke'),'single677 interactive canary requires tty=true for graceful stop and verified cleanup');
    assert.ok(clean244Mode&&clean244Floor);
    for(const key of ['VINPOKER_SINGLE645_MODE','VINPOKER_SINGLE646_START','VINPOKER_SINGLE647_HAND','VINPOKER_SINGLE649_RESTORE','VINPOKER_SINGLE654_COLOR','VINPOKER_SINGLE655_BREAK','VINPOKER_SINGLE657_HISTORY','VINPOKER_SINGLE664_HAND'])assert.notEqual(process.env[key],'1');
  }
  const single654Color=process.env.VINPOKER_SINGLE654_COLOR==='1';
  if(single654Color)assert.ok(clean244Mode&&clean244Floor,'color-up only on retained original tour');
  const single657Read=process.env.VINPOKER_SINGLE657_HISTORY==='1';
  if(single657Read)assert.ok(clean244Mode&&clean244Floor&&!single654Color,'exact current original history reader');
  const single679Read=process.env.VINPOKER_SINGLE679_HISTORY==='1';
  if(single679Read)assert.ok(single657Read&&process.stdin.isTTY,'current verified hand4 history canary requires PTY and original read scope');
  const single655Break=process.env.VINPOKER_SINGLE655_BREAK==='1';
  if(single655Break)assert.ok(clean244Mode&&clean244Floor&&!single654Color,'exact original destination-hand/break preview stage');
  const single655Queue=process.env.VINPOKER_SINGLE655_QUEUE==='1';
  if(single655Queue){assert.ok(single655Break);assert.equal(sql("SELECT EXISTS(SELECT 1 FROM public.tournament_hands WHERE id='2ee4ebe0-f8bd-49a5-b3ed-dd0a2ea4e4a8' AND tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND status='in_progress' AND hand_number=2);"),'t');}
  const single656Finish=process.env.VINPOKER_SINGLE656_FINISH==='1';
  if(single656Finish){assert.ok(single655Break&&!single655Queue);assert.equal(sql("SELECT EXISTS(SELECT 1 FROM public.tournament_hands WHERE id='2ee4ebe0-f8bd-49a5-b3ed-dd0a2ea4e4a8' AND status='in_progress' AND hand_number=2);"),'t');assert.equal(sql("SELECT current_state FROM public.dealer_attendance WHERE id='e03c9a69-7c3d-4431-aa98-a801015dfae5';"),'assigned');}
  const single645Mode=process.env.VINPOKER_SINGLE645_MODE==='1';
  if(single645Mode)assert.ok(clean244Mode&&clean244Floor,'occupied mode stage requires exact original Floor canary');
  const single646Start=process.env.VINPOKER_SINGLE646_START==='1';
  if(single646Start)assert.ok(clean244Mode&&clean244Floor&&!single645Mode,'original occupied Tracker start stage only');
  const single664Hand=process.env.VINPOKER_SINGLE664_HAND==='1';
  const single678Hand=process.env.VINPOKER_SINGLE678_HAND==='1';
  const single682Hand=process.env.VINPOKER_SINGLE682_HAND==='1';
  const single684Hand=process.env.VINPOKER_SINGLE684_HAND==='1';
  const singleFinalHand=Number(process.env.VINPOKER_SINGLE_FINAL_HAND??0);
  if(process.env.VINPOKER_SINGLE_FINAL_HAND!==undefined)assert.match(process.env.VINPOKER_SINGLE_FINAL_HAND,/^(7|8|9|10)$/,'only the four remaining named TEST hand checkpoints');
  const single647Hand=process.env.VINPOKER_SINGLE647_HAND==='1'||single664Hand||single678Hand||single682Hand||single684Hand||singleFinalHand!==0;
  const single694Close=process.env.VINPOKER_SINGLE694_CLOSE==='1';
  if(single694Close){
    assert.ok(clean244Mode&&clean244Floor&&process.stdin.isTTY,'final close requires original retained tour and graceful PTY cleanup');
    assert.ok(!single647Hand&&!single657Read&&!single645Mode&&!single646Start&&!single655Break&&!single654Color&&!single677Redraw);
    assert.equal(sql("SELECT count(*)||'|'||sum(chip_count) FROM public.tournament_seats WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND is_active AND entry_id='129884e6-d2e4-4795-ade1-5bb1905e784f' AND seat_number=2 AND table_session_id='b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5';"),'1|180000');
    assert.equal(sql("SELECT count(*) FROM public.tournament_seats WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND is_active;"),'1');
    assert.equal(sql("SELECT EXISTS(SELECT 1 FROM public.table_sessions WHERE id='b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5' AND closed_at IS NULL AND revision=20 AND control_epoch=5 AND redraw_hold_batch_id IS NULL);"),'t');
    assert.equal(sql("SELECT floor_private.felt_official_results_close_status_v1('c367013a-3ed3-48af-ad48-3915acadc50e');"),'{"field": 8, "status": "ready_to_finalize"}');
    assert.equal(sql("SELECT count(*)||'|'||sum(applied_amount) FROM public.cashier_buyin_movements WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e';"),'9|900000');
    assert.equal(sql("SELECT count(*) FROM public.tournament_close_report WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e';"),'0','closed constructor consumed; never reset');
    assert.equal(sql(`SELECT count(*) FROM public.tournament_settlement_outcomes o CROSS JOIN LATERAL public.get_tournament_historical_display_source_hash(o.hand_id) s
      WHERE o.hand_id='ba4eede3-8cf4-4866-bc1b-ff916aad161f' AND o.source_revision=15 AND o.source_revision=s.source_revision
      AND o.source_chain_hash=s.source_chain_hash AND o.status='verified' AND o.verification_scope='historical_display';`),'1');
    assert.equal(sql("SELECT EXISTS(SELECT 1 FROM public.tournament_hands WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND (status='in_progress' OR hand_number>10));"),'f');
  }
  if(singleFinalHand){
    assert.ok(clean244Mode&&clean244Floor&&process.stdin.isTTY,'one final hand requires exact retained tour and PTY cleanup');
    for(const key of ['VINPOKER_SINGLE647_HAND','VINPOKER_SINGLE684_HAND','VINPOKER_SINGLE682_HAND','VINPOKER_SINGLE678_HAND','VINPOKER_SINGLE677_REDRAW','VINPOKER_SINGLE664_HAND','VINPOKER_SINGLE655_BREAK','VINPOKER_SINGLE645_MODE','VINPOKER_SINGLE657_HISTORY'])assert.notEqual(process.env[key],'1');
    assert.equal(sql("SELECT EXISTS(SELECT 1 FROM public.table_sessions WHERE id='b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5' AND closed_at IS NULL AND control_mode='tracker' AND control_epoch=5 AND redraw_hold_batch_id IS NULL);"),'t');
    assert.equal(sql("SELECT count(*)||'|'||sum(chip_count) FROM public.tournament_seats WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND is_active;"),`${12-singleFinalHand}|180000`);
    assert.equal(sql(`SELECT count(*) FROM public.tournament_settlement_outcomes o JOIN public.tournament_hands h ON h.id=o.hand_id
     CROSS JOIN LATERAL public.get_tournament_historical_display_source_hash(o.hand_id) s WHERE h.tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e'
     AND h.tournament_table_id='c2ce77c0-2b61-4a19-bd43-4752232cc55a' AND h.table_session_id='b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5'
     AND h.hand_number=${singleFinalHand-1} AND h.status='completed' AND NOT h.is_voided
     AND o.source_revision=h.source_revision AND o.source_revision=s.source_revision AND o.source_chain_hash=s.source_chain_hash
     AND o.status='verified' AND o.verification_scope='historical_display'
     AND EXISTS(SELECT 1 FROM public.table_operation_receipts r WHERE r.actor_id='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e'
       AND r.operation_type='record_tracker_manual_hand_v1' AND r.result->>'hand_id'=h.id::text);`),'1');
    assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM public.tournament_hands WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e'
     AND (hand_number>${singleFinalHand} OR hand_number=${singleFinalHand} AND status<>'in_progress'));`),'f','selected final-hand constructor consumed; never reset');
    assert.equal(sql("SELECT count(*)||'|'||sum(applied_amount) FROM public.cashier_buyin_movements WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e';"),'9|900000');
  }
  if(single684Hand){
    assert.ok(clean244Mode&&clean244Floor&&process.stdin.isTTY,'hand6 requires exact retained tour and graceful PTY cleanup');
    for(const key of ['VINPOKER_SINGLE682_HAND','VINPOKER_SINGLE678_HAND','VINPOKER_SINGLE677_REDRAW','VINPOKER_SINGLE664_HAND','VINPOKER_SINGLE655_BREAK','VINPOKER_SINGLE645_MODE','VINPOKER_SINGLE657_HISTORY'])assert.notEqual(process.env[key],'1');
    assert.equal(sql("SELECT EXISTS(SELECT 1 FROM public.table_sessions WHERE id='b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5' AND closed_at IS NULL AND control_mode='tracker' AND control_epoch=5 AND redraw_hold_batch_id IS NULL);"),'t');
    assert.equal(sql("SELECT count(*)||'|'||sum(chip_count) FROM public.tournament_seats WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND is_active;"),'6|180000');
    assert.equal(sql("SELECT count(*) FROM public.tournament_settlement_outcomes o CROSS JOIN LATERAL public.get_tournament_historical_display_source_hash(o.hand_id) s WHERE o.hand_id='42999d26-6dd8-413f-bbfd-71b0e33dfe54' AND o.source_revision=30 AND o.source_revision=s.source_revision AND o.source_chain_hash=s.source_chain_hash AND o.status='verified' AND o.verification_scope='historical_display';"),'1');
    assert.equal(sql("SELECT EXISTS(SELECT 1 FROM public.tournament_hands WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND (hand_number>6 OR hand_number=6 AND status<>'in_progress'));"),'f','consumed hand6 canary must not restart');
  }
  if(single682Hand){
    assert.ok(clean244Mode&&clean244Floor&&process.stdin.isTTY,'hand5 requires exact retained tour and graceful PTY cleanup');
    for(const key of ['VINPOKER_SINGLE678_HAND','VINPOKER_SINGLE677_REDRAW','VINPOKER_SINGLE664_HAND','VINPOKER_SINGLE655_BREAK','VINPOKER_SINGLE645_MODE','VINPOKER_SINGLE657_HISTORY'])assert.notEqual(process.env[key],'1');
    assert.equal(sql("SELECT EXISTS(SELECT 1 FROM public.table_sessions WHERE id='b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5' AND closed_at IS NULL AND control_mode='tracker' AND control_epoch=5 AND redraw_hold_batch_id IS NULL);"),'t');
    assert.equal(sql("SELECT count(*)||'|'||sum(chip_count) FROM public.tournament_seats WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND is_active;"),'7|180000');
    assert.equal(sql("SELECT count(*) FROM public.tournament_settlement_outcomes o CROSS JOIN LATERAL public.get_tournament_historical_display_source_hash(o.hand_id) s WHERE o.hand_id='6eb869b7-49da-4b84-bdee-80a5b5feea25' AND o.source_revision=33 AND o.source_revision=s.source_revision AND o.source_chain_hash=s.source_chain_hash AND o.status='verified' AND o.verification_scope='historical_display';"),'1');
    assert.equal(sql("SELECT EXISTS(SELECT 1 FROM public.tournament_hands WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND (hand_number>5 OR hand_number=5 AND status<>'in_progress'));"),'f','consumed hand5 canary must not restart');
  }
  if(single678Hand){
    assert.ok(clean244Mode&&clean244Floor&&process.stdin.isTTY,'post-redraw hand4 requires exact original canary and PTY cleanup');
    for(const key of ['VINPOKER_SINGLE677_REDRAW','VINPOKER_SINGLE664_HAND','VINPOKER_SINGLE655_BREAK','VINPOKER_SINGLE645_MODE'])assert.notEqual(process.env[key],'1');
    assert.equal(sql("SELECT EXISTS(SELECT 1 FROM public.table_sessions WHERE id='b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5' AND closed_at IS NULL AND control_mode='tracker' AND control_epoch=5 AND redraw_hold_batch_id IS NULL);"),'t');
    assert.equal(sql("SELECT count(*)||'|'||sum(chip_count) FROM public.tournament_seats WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND is_active;"),'8|180000');
    assert.equal(sql("SELECT EXISTS(SELECT 1 FROM public.tournament_hands WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND (hand_number>4 OR hand_number=4 AND status<>'in_progress'));"),'f','do not rerun a consumed hand4 canary');
  }
  const single649Restore=process.env.VINPOKER_SINGLE649_RESTORE==='1';
  if(single649Restore){
    assert.ok(clean244Mode&&clean244Floor&&!single645Mode&&!single646Start&&!single647Hand,'original evidenced bust/restore only');
    assert.equal(sql("SELECT EXISTS(SELECT 1 FROM public.tournament_hands WHERE id='4f120026-cf38-4db3-bb05-ae6feaabf59a' AND tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND status='completed' AND source_revision=19);"),'t');
    assert.equal(sql("SELECT EXISTS(SELECT 1 FROM public.tournament_entries WHERE id='c08959a4-38f8-4df9-8fd4-033c1bdf8a9e' AND tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND entry_no=1 AND (status='seated' AND current_stack=19900 OR status='busted' AND current_stack=0));"),'t');
  }
  if(single647Hand){
    assert.ok(clean244Mode&&clean244Floor&&!single645Mode&&!single646Start,'original active first hand only');
    assert.equal(sql("SELECT EXISTS(SELECT 1 FROM public.tournament_hands h WHERE id='4f120026-cf38-4db3-bb05-ae6feaabf59a' AND tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND table_session_id='b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5' AND hand_number=1 AND (status='in_progress' OR status='completed' AND EXISTS(SELECT 1 FROM floor_private.floor_table_v3_existing_receipt('febf2b51-fdb7-42ff-886c-b3bb1fffdc3e','record_tracker_manual_hand_v1','62671214-a5a8-492b-af17-64219d0e8061') r WHERE r.result->>'hand_id'=h.id::text)));"),'t');
  }
  const clean244Dealer=process.env.VINPOKER_CLEAN244_DEALER==='1';
  const clean642Dealer=process.env.VINPOKER_CLEAN642_DEALER==='1';
  const single643Read=process.env.VINPOKER_SINGLE643_SWING_READ==='1';
  const single706Read=process.env.VINPOKER_SINGLE706_PAYROLL_READ==='1';
  if(single706Read)assert.ok(clean244Mode&&clean244Dealer&&clean642Dealer&&single643Read,'exact retained current dealer scope; read only');
  const single644Write=process.env.VINPOKER_SINGLE644_ASSIGN==='1';
  if(single644Write)assert.ok(single643Read&&clean642Dealer,'exact current dealer/two-session canary required');
  const single659Assign=process.env.VINPOKER_SINGLE659_ASSIGN==='1';
  const single661Swing=process.env.VINPOKER_SINGLE661_SWING==='1';
  const single662Plan=process.env.VINPOKER_SINGLE662_PLAN==='1';
  if(single662Plan)assert.ok(single643Read&&clean642Dealer&&!single644Write&&!single661Swing,'next31 plan only');
  if(single661Swing)assert.ok(single643Read&&clean642Dealer&&!single644Write,'manual Swing only, not initial acquisition');
  if(single659Assign)assert.ok(single644Write,'new-session assignment reuses actual644 handler');
  if(single643Read)assert.ok(clean642Dealer,'Swing tab reads require exact current642 scope');
  if(clean642Dealer)assert.ok(clean244Mode&&clean244Dealer,'current dealer stage requires exact existing Single244 dealer UI');
  const clean244TvAssets=process.env.VINPOKER_CLEAN244_TV_ASSETS==='1';
  if(clean244TvAssets)assert.ok(clean244Mode&&!clean244Dealer&&!clean244Member&&!clean244Floor&&!process.env.VINPOKER_CLEAN244_CASHIER_READ,'TV assets only on retained same clean tour');
  if(clean244Dealer)assert.ok(clean244Mode&&!clean244Member&&!clean244Floor&&!process.env.VINPOKER_CLEAN244_CASHIER_READ,'Dealer stage only, no payments/seating/setup writes');
  if(clean244Floor)assert.ok(clean244Mode&&!clean244Member&&!process.env.VINPOKER_CLEAN244_CASHIER_READ,'Floor stage uses exact owner and no Cashier writes');
  const clean244CashierRead=process.env.VINPOKER_CLEAN244_CASHIER_READ==='1';
  const clean244CashierPay=process.env.VINPOKER_CLEAN244_CASHIER_PAY==='1';
  const single745CashierRead=process.env.VINPOKER_SINGLE745_CASHIER_READ==='1';
  const single748ChipRead=process.env.VINPOKER_SINGLE748_CHIP_READ==='1';
  const terminalSingleRead=single745CashierRead||single748ChipRead;
  if(single748ChipRead)assert.ok(clean244Mode&&!clean244CashierRead&&!clean244CashierPay&&!clean244Floor&&!clean244Dealer&&!clean244Member,'terminal original chip read only; no setup or inventory writers');
  if(single745CashierRead)assert.ok(clean244Mode&&clean244CashierRead&&!clean244CashierPay&&!clean244Floor&&!clean244Dealer&&!clean244Member,'terminal original single tour READ ONLY, no collection or lifecycle writes');
  const single667Pay=process.env.VINPOKER_SINGLE667_PAY==='1';
  if(single667Pay)assert.ok(clean244CashierPay&&!clean244Member,'owner cashier only for exact pending reentry');
  const clean637Seat=process.env.VINPOKER_CLEAN637_SEAT==='1';
  let clean637AllowedPlayers=[];
  if(clean637Seat)assert.ok(clean244Mode&&clean244CashierRead&&!clean244CashierPay&&!clean244Floor&&!clean244Dealer&&!clean244Member,'exact retained paid seating only; no collection/dealer writer');
  if(clean244CashierPay)assert.ok(clean244CashierRead,'payment stage requires exact cashier scope');
  if(clean244CashierRead)assert.ok(clean244Mode&&!clean244Member,'cashier read uses retained owner, not member');
  if(clean244Member)assert.ok(clean244Mode,'clean member requires retained clean244 scope');
  if(clean244Mode)assert.ok(!d2Event&&!sidepotScope&&!closedFixture&&!process.env.VINPOKER_EXISTING_SINGLE_TOUR&&!historyReadOnly);
  const chipSetupTour=process.env.VINPOKER_CHIP_SETUP_TOUR;
  const chipTemplateTour=process.env.VINPOKER_CHIP_TEMPLATE_TOUR;
  const chipMetadataTour=process.env.VINPOKER_CHIP_METADATA_TOUR;
  const existingEventFlight=process.env.VINPOKER_EXISTING_EVENT_FLIGHT;
  if(existingEventFlight){
    assert.ok(['782a5196-5ea1-44ed-8a27-1b872d5f88d9','fdf91018-09f3-4cdc-b76a-f688eb216cee'].includes(existingEventFlight));
    assert.ok(!d2Event&&!sidepotScope&&!closedFixture&&!chipSetupTour&&!chipTemplateTour&&!chipMetadataTour
      &&!process.env.VINPOKER_EXISTING_SINGLE_TOUR&&!handCorrectionScope&&!activeMemberScope&&!freshRegistrationScope);
  }
  if(chipMetadataTour)assert.ok(d2Event&&!process.env.VINPOKER_EXISTING_SINGLE_TOUR&&!closedFixture&&!chipSetupTour&&!chipTemplateTour,'metadata canary must be independent of completed journeys');
  if(chipTemplateTour)assert.ok(d2Event&&!process.env.VINPOKER_EXISTING_SINGLE_TOUR&&!closedFixture&&!chipSetupTour,'template canary must be independent of completed journeys');
  if(chipSetupTour)assert.ok(d2Event&&!process.env.VINPOKER_EXISTING_SINGLE_TOUR&&!closedFixture,'independent Chip Setup canary cannot replace a completed journey');
  const singleTour=(fnbKitchen384?'a5af353d-2d97-4891-9078-0bc84b7a8237':null)??(sepayWrite306||payout379ReadOnly?'6a7fb4a3-8b46-44be-a71a-ca12a052ee08':null)??(bank272Browser?'e2720000-0000-4000-8000-000000000020':null)??(bank265ReadOnly?'e68e9748-00d8-47b1-b3cc-e68530802b71':null)??(clean244Mode?'c367013a-3ed3-48af-ad48-3915acadc50e':null)??existingEventFlight??process.env.VINPOKER_EXISTING_SINGLE_TOUR??closedFixture??chipSetupTour??chipTemplateTour??chipMetadataTour??observerFixture?.tour??sidepotScope?.tour??activeMemberScope?.tour??freshRegistrationScope?.tour??handCorrectionScope?.tour;
  if(singleTour){
    assert.ok(fnbKitchen384||payout379ReadOnly||sepayWrite306||bank272Browser||bank265ReadOnly||clean244Mode||existingEventFlight||d2Event||closedFixture||observerFixture||sidepotScope||activeMemberScope||freshRegistrationScope||handCorrectionScope,'explicit local authority fixture required');
    if(closedFixture)assert.ok(!d2Event&&!process.env.VINPOKER_EXISTING_SINGLE_TOUR,'closed fixture has independent scope');
    assert.ok(!baggingFlight,'single-day and flight targets are mutually exclusive');
    assert.match(singleTour,/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i);
  }
  if(baggingFlight){assert.ok(d2Event);assert.match(baggingFlight,/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i);}
  if(d2Event)assert.match(d2Event,/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i);
  let fixture;
  if(fnbKitchen384){
    const f=JSON.parse(sql('SELECT fixture FROM floor_private.fnb384_fixture;'));
    assert.equal(f.tour,singleTour);assert.equal(f.club,'349ecf35-50ba-4c71-a581-15dc45f1cd01');assert.equal(f.actor,'a364de8e-06b1-4428-a20d-ac614ec406e5');fixture={tour:f.tour,club:f.club};
  }else if(sepayWrite306||payout379ReadOnly){
    const f=JSON.parse(sql('SELECT fixture FROM floor_private.sepay305_fixture;'));
    assert.equal(f.tour,singleTour);assert.equal(f.club,'7f3c6f90-3667-4c8c-9a00-6f00da680d84');
    assert.equal(f.actor,'40b8f243-bf3b-4aaa-962b-db788380207c');fixture={tour:f.tour,club:f.club};
  }else if(bank272Browser){
    fixture=JSON.parse(sql(`SELECT jsonb_build_object('tour',t.id,'club',t.club_id) FROM public.tournaments t JOIN public.clubs c ON c.id=t.club_id
      WHERE t.id='${singleTour}' AND c.id='e2720000-0000-4000-8000-000000000010' AND c.owner_id='e2720000-0000-4000-8000-000000000001'
      AND t.name='Bank272 isolated TEST' AND NOT EXISTS(SELECT 1 FROM public.tournament_entries WHERE tournament_id=t.id);`)||'null');
    assert.ok(fixture,'exact retained bank canary required; no creation fallback');
  }else if(bank265ReadOnly){
    fixture=JSON.parse(sql(`SELECT jsonb_build_object('tour',t.id,'club',c.id) FROM public.tournaments t JOIN public.clubs c ON c.id=t.club_id
     JOIN public.club_settings cs ON cs.club_id=c.id WHERE t.id='${singleTour}' AND c.id='ad0dde9e-864a-42cc-9eb9-fb97b2f0fe90'
     AND c.owner_id='79918c47-6fb3-47ce-94ea-b7eeeb742b01' AND NOT cs.auto_swing_enabled AND t.buy_in=100000
     AND (SELECT count(*) FROM public.tournament_entries WHERE tournament_id=t.id)=3
     AND (SELECT sum(amount-applied_amount) FROM public.cashier_buyin_movements WHERE tournament_id=t.id)=20000;`)||'null');
    assert.ok(fixture,'exact retained bank264 facts required, never create fallback');
    const fingerprint=()=>sql(`SELECT md5(jsonb_build_array(
     (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
     (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.bank_transactions x),
     (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_entries x),
     (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x),
     (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.notifications x),
     (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_inventory_ledger x),
     (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_bank_ledger x),
     (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x))::text);`);
    bank265Proof={fingerprint,before:fingerprint()};
  }else if(clean244Mode){
    const retained=JSON.parse(sql('SELECT fixture FROM public.clean244_fixture_641c3e81f65f4e76ab90c7b8237b8682;'));
    assert.equal(retained.tour,singleTour);assert.equal(retained.actor,'febf2b51-fdb7-42ff-886c-b3bb1fffdc3e');
    const players=retained.players??[retained.player];
    if(clean637Seat)clean637AllowedPlayers=players;
    if(clean244Dealer){
      const dealerFixture=clean642Dealer?JSON.parse(sql('SELECT fixture FROM floor_private.single642_dealer_fixture;')):retained;
      assert.equal(dealerFixture.club,retained.club);assert.equal(dealerFixture.tour,retained.tour);
      assert.equal(dealerFixture.actor,retained.actor);assert.equal(dealerFixture.dealerShift,retained.dealerShift);
      clean244DealerIds=dealerFixture.dealers;
      assert.ok(Array.isArray(clean244DealerIds)&&clean244DealerIds.length===4&&clean244DealerIds.every(uuid)&&new Set(clean244DealerIds).size===4);
      assert.ok(uuid(retained.dealerShift));
      assert.equal(sql(`SELECT count(*) FROM public.dealers WHERE id IN(${clean244DealerIds.map(id=>`'${id}'::uuid`).join(',')}) AND club_id='d4427834-5f5f-48ef-bde5-e2dc388ed00b' AND status='active' AND full_name LIKE 'Clean R11 TEST dealer %';`),'4');
      assert.equal(sql('SELECT count(*) FROM public.dealer_swing_phone_rollout;'),'0');
      assert.equal(sql("SELECT md5(replace(pg_get_functiondef('public._enter_dealer_pool(uuid,uuid,timestamptz)'::regprocedure),chr(13),''));"),'b2e73c62a399869000a1928a2a28cf5e');
    }
    assert.ok(Array.isArray(players)&&players.length<=8&&players.every(uuid)&&new Set(players).size===players.length);
    assert.equal(players[0],'a11b1317-4885-4835-8d2e-fb435f7b24e2');
    if(clean244Member){
      const index=Number(process.env.VINPOKER_CLEAN244_MEMBER_INDEX??1);
      assert.ok(Number.isSafeInteger(index)&&index>=1&&index<=players.length);
      clean244Player=players[index-1];
      assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM auth.users u JOIN public.profiles p ON p.user_id=u.id WHERE u.id='${clean244Player}' AND p.display_name='Clean R11 TEST player ${index}');`),'t');
    }
    fixture=JSON.parse(sql(`SELECT jsonb_build_object('tour',t.id,'club',c.id) FROM public.tournaments t JOIN public.clubs c ON c.id=t.club_id
     JOIN public.club_settings cs ON cs.club_id=c.id WHERE t.id='${singleTour}' AND c.id='d4427834-5f5f-48ef-bde5-e2dc388ed00b'
      AND c.owner_id='${retained.actor}' AND t.name='Cash identity local TEST' AND t.event_id IS NULL
      AND t.buy_in=100000 AND t.starting_stack=20000 AND NOT cs.auto_swing_enabled
      AND (NOT EXISTS(SELECT 1 FROM public.tournament_registrations WHERE tournament_id=t.id)
       OR ${terminalSingleRead||clean244Member||clean244CashierRead||clean244Floor||clean244Dealer||clean244TvAssets||single668Issue||single699Payout?'true':'false'} AND NOT EXISTS(SELECT 1 FROM public.tournament_registrations WHERE tournament_id=t.id AND player_id NOT IN(${players.map(id=>`'${id}'::uuid`).join(',')})))
      AND (NOT EXISTS(SELECT 1 FROM public.tournament_entries WHERE tournament_id=t.id)
       OR ${terminalSingleRead||clean244CashierPay||clean244Floor||clean637Seat||clean642Dealer||single666Reentry||single668Issue||single699Payout?'true':'false'} AND NOT EXISTS(SELECT 1 FROM public.tournament_entries WHERE tournament_id=t.id AND player_id NOT IN(${players.map(id=>`'${id}'::uuid`).join(',')})))
      AND (NOT EXISTS(SELECT 1 FROM public.tournament_tables WHERE tournament_id=t.id)
       OR ${terminalSingleRead||clean244Floor||clean637Seat||clean642Dealer||single666Reentry||single667Pay||single668Issue||single699Payout?'true':'false'} AND NOT EXISTS(SELECT 1 FROM public.tournament_tables tt LEFT JOIN public.game_tables g ON g.id=tt.game_table_id
         WHERE tt.tournament_id=t.id AND (g.id IS NULL OR g.club_id<>c.id OR g.table_number NOT IN(30,31))));`)||'null');
    assert.ok(fixture,'exact clean244 pre-registration setup scope required');
    if(terminalSingleRead)assert.equal(sql(`SELECT status='completed'
      AND (SELECT count(*) FROM public.tournament_entries WHERE tournament_id=t.id)=9
      AND (SELECT count(*) FROM public.tournament_tables WHERE tournament_id=t.id)=3
      AND (SELECT count(*) FROM public.cashier_buyin_movements WHERE tournament_id=t.id)=9
      AND (SELECT sum(amount) FROM public.cashier_buyin_movements WHERE tournament_id=t.id)=900000
      AND NOT EXISTS(SELECT 1 FROM public.tournament_seats WHERE tournament_id=t.id AND is_active)
      FROM public.tournaments t WHERE id='${fixture.tour}';`),'t','exact terminal original Single244 facts; never restore an earlier stage');
    const priorCash=JSON.parse(sql(`SELECT coalesce(jsonb_agg(id),'[]') FROM public.cashier_buyin_movements WHERE tournament_id='${fixture.tour}';`));
    const priorAttendance=clean244Dealer?JSON.parse(sql(`SELECT coalesce(jsonb_agg(id),'[]') FROM public.dealer_attendance WHERE dealer_id IN(${clean244DealerIds.map(id=>`'${id}'::uuid`).join(',')});`)):[];
    assert.ok(priorAttendance.every(uuid));
    assert.ok(priorCash.every(uuid));
    const color654PriorLedger=single654Color||single668Issue?JSON.parse(sql(`SELECT coalesce(jsonb_agg(id),'[]') FROM public.chip_inventory_ledger WHERE tournament_id='${fixture.tour}';`)):[];
    assert.ok(color654PriorLedger.every(uuid));
    const plan662AttendanceProof=single662Plan?()=>sql(`SELECT md5(jsonb_agg(CASE WHEN id='1f3f1e56-db9d-46b9-9e3b-531845da5802' THEN to_jsonb(a)-'current_state'-'updated_at'-'pre_assigned_at'-'pre_assigned_table_id' ELSE to_jsonb(a) END ORDER BY id)::text) FROM public.dealer_attendance a;`):null;
    const plan662AttendanceBefore=plan662AttendanceProof?.();
    const fingerprint=()=>sql(`SELECT md5(jsonb_build_array(
     (SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m
      ${clean244CashierPay?`WHERE m.tournament_id IS DISTINCT FROM '${fixture.tour}'::uuid OR m.id IN(${priorCash.length?priorCash.map(id=>`'${id}'::uuid`).join(','):'NULL::uuid'})`:''}),
     (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.tournament_prize_payments p),
     (SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.chip_inventory_ledger l
      ${single654Color||single668Issue?`WHERE l.tournament_id IS DISTINCT FROM '${fixture.tour}'::uuid OR l.id IN(${color654PriorLedger.length?color654PriorLedger.map(id=>`'${id}'::uuid`).join(','):'NULL::uuid'})`:''}),
     (SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.chip_bank_ledger l),
     (SELECT jsonb_agg(${single677Redraw?`CASE WHEN a.id IN('6b2ea4bd-67d4-47ef-94e2-5cfe7e5a6c4a','1f3f1e56-db9d-46b9-9e3b-531845da5802') THEN to_jsonb(a)-'current_state'-'updated_at'-'pre_assigned_at'-'pre_assigned_table_id' ELSE to_jsonb(a) END`:single662Plan?`CASE WHEN a.id='1f3f1e56-db9d-46b9-9e3b-531845da5802' THEN to_jsonb(a)-'current_state'-'updated_at'-'pre_assigned_at'-'pre_assigned_table_id' ELSE to_jsonb(a) END`:single661Swing?`CASE WHEN a.id IN('47323bd1-60a3-42a8-99c6-ede1c33f5f90','e03c9a69-7c3d-4431-aa98-a801015dfae5') THEN to_jsonb(a)-'current_state'-'updated_at'-'pre_assigned_at'-'pre_assigned_table_id'-'last_released_at' ELSE to_jsonb(a) END`:single659Assign?`CASE WHEN a.id='6b2ea4bd-67d4-47ef-94e2-5cfe7e5a6c4a' THEN to_jsonb(a)-'current_state'-'updated_at' ELSE to_jsonb(a) END`:single656Finish||single694Close?`CASE WHEN a.id='e03c9a69-7c3d-4431-aa98-a801015dfae5' THEN to_jsonb(a)-'current_state'-'updated_at' ELSE to_jsonb(a) END`:single644Write?`CASE WHEN a.dealer_id IN(${clean244DealerIds.map(id=>`'${id}'::uuid`).join(',')}) THEN to_jsonb(a)-'current_state'-'updated_at' ELSE to_jsonb(a) END`:'to_jsonb(a)'} ORDER BY id) FROM public.dealer_attendance a
       ${clean244Dealer&&!single644Write&&!single661Swing?`WHERE a.dealer_id NOT IN(${clean244DealerIds.map(id=>`'${id}'::uuid`).join(',')}) OR a.id IN(${priorAttendance.length?priorAttendance.map(id=>`'${id}'::uuid`).join(','):'NULL::uuid'})`:''}),
     (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.chip_set s WHERE club_id<>'${fixture.club}'),
     (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.stack_template s WHERE club_id<>'${fixture.club}')
     )::text);`);
    const close694Protected=single694Close?()=>sql(`SELECT md5(jsonb_build_array(
      ${['tournament_hands','hand_players','hand_actions','tournament_settlement_outcomes','tracker_historical_display_queue'].map(table=>`(SELECT jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text) FROM public.${table} r)`).join(',')},
      (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.tournament_entries r WHERE tournament_id<>'${fixture.tour}'),
      (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.tournament_seats r WHERE tournament_id<>'${fixture.tour}'),
      (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.dealer_assignments r WHERE id<>'e70ae2f2-3aef-40d7-b8b3-37fda915d2fd'))::text);`):null;
    const close694Before=close694Protected?.();
    const protectedFingerprint=()=>{if(close694Protected)assert.equal(close694Protected(),close694Before,'close changed hand/proof or unrelated entry/seat/assignment');if(plan662AttendanceProof)assert.equal(plan662AttendanceProof(),plan662AttendanceBefore,'only exact dealer4 plan fields may change');return fingerprint();};
    clean244Proof={fingerprint:protectedFingerprint,before:protectedFingerprint(),label:single694Close?'LOCAL_SINGLE694_CASH_CHIP_HAND_PROOF_OTHER_SCOPE_ATTENDANCE_EXCEPT_EXACT_RELEASE_FIELDS_UNCHANGED_PASS':single662Plan?'LOCAL_SINGLE662_MONEY_CHIP_OTHER_SCOPE_AND_ATTENDANCE_EXCEPT_EXACT_PLAN_FIELDS_UNCHANGED_PASS':single656Finish?'LOCAL_SINGLE656_MONEY_CHIP_AND_ATTENDANCE_EXCEPT_EXACT_RELEASE_STATE_TIMESTAMP_UNCHANGED_PASS':single654Color?'LOCAL_SINGLE654_CASH_PAYOUT_BANK_PRIOR_INVENTORY_LEDGER_ATTENDANCE_OTHER_SCOPE_UNCHANGED_PASS':clean244Dealer?'LOCAL_CLEAN256_ALL_MONEY_CHIP_PRIOR_ATTENDANCE_OTHER_SCOPE_UNCHANGED_PASS':clean244CashierPay?'LOCAL_CLEAN244_OTHER_CASH_AND_PRIOR_OWN_ROWS_PAYOUT_CHIP_LEDGERS_ATTENDANCE_UNCHANGED_PASS':'LOCAL_CLEAN244_SETUP_GLOBAL_MONEY_CHIP_LEDGER_ATTENDANCE_OTHER_SCOPE_UNCHANGED_PASS'};
    if(single679Read){
      assert.equal(sql("SELECT count(*) FROM public.tournament_settlement_outcomes WHERE hand_id='6eb869b7-49da-4b84-bdee-80a5b5feea25' AND source_revision=33 AND status='verified' AND verification_scope='historical_display';"),'1');
      const fingerprint=()=>sql(`SELECT md5(jsonb_build_array(${['table_sessions','tournament_hands','hand_players','hand_actions','tournament_entries','tournament_seats','tournament_settlement_outcomes','tracker_historical_display_queue','cashier_buyin_movements','chip_inventory_ledger','chip_bank_ledger','dealer_attendance','seat_draw_receipts'].map(table=>`(SELECT jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text) FROM public.${table} r)`).join(',')})::text);`);
      historyObserverProof={fingerprint,before:fingerprint(),kind:'single679'};
    }
  }else if(existingEventFlight){
    fixture=JSON.parse(sql(`SELECT jsonb_build_object('tour',t.id,'club',t.club_id,'event',e.id)
     FROM public.tournaments t JOIN public.tournament_events e ON e.id=t.event_id AND e.club_id=t.club_id
     JOIN public.clubs c ON c.id=t.club_id JOIN public.multi_day_qualification_rules_v1 r ON r.event_id=e.id
     WHERE t.id='${existingEventFlight}' AND e.id='dbb49f8d-7d47-4c2c-afd9-f57062c9971d'
      AND e.name='Main Event browser local TEST 164' AND e.guarantee_amount=2500000
      AND t.phase='flight' AND t.name IN('Main Event browser local TEST 164 · Flight A','Main Event browser local TEST 164 · Flight B')
      AND c.id='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760' AND c.owner_id='675fe35e-60a8-4452-bb90-e79486d54da6'
      AND r.policy='SELECT_LARGEST' AND r.itm_percent=15 AND r.day2_percent=100 AND r.min_cash_x=1
      AND t.buy_in=100000 AND t.rake_amount=10000 AND t.service_fee_amount=5000 AND t.deleted_at IS NULL;`)||'null');
    assert.ok(fixture,'exact linked Main Event flight required; never substitute a paid single-day fixture');
    console.log('LOCAL_EXISTING_MAIN_EVENT_FLIGHT_VERIFIED',JSON.stringify(fixture));
  }else if(handCorrectionScope){
    fixture=JSON.parse(sql(`SELECT jsonb_build_object('tour',t.id,'club',c.id) FROM public.tournaments t
      JOIN public.clubs c ON c.id=t.club_id JOIN public.tournament_hands h ON h.tournament_id=t.id
      WHERE t.id='${singleTour}' AND c.id='${handCorrectionScope.club}' AND c.owner_id='${handCorrectionScope.actor}'
       AND h.id='${handCorrectionScope.hand}' AND h.tournament_table_id='${handCorrectionScope.table}'
       AND t.name='Cash identity local TEST' AND c.name='Cash identity local TEST';`)||'null');
    assert.ok(fixture,'exact emitted correction TEST required');
  }else if(freshRegistrationScope){
    fixture=JSON.parse(sql(`SELECT jsonb_build_object('tour',t.id,'club',c.id) FROM public.tournaments t
      JOIN public.clubs c ON c.id=t.club_id JOIN public.club_settings cs ON cs.club_id=c.id
      WHERE t.id='${singleTour}' AND t.name='Cash identity local TEST' AND c.name='Cash identity local TEST'
      AND cs.auto_swing_enabled=false AND t.buy_in=100000 AND t.rake_amount=10000 AND t.service_fee_amount=5000
      AND t.free_rake_used=2 AND t.free_rake_slots=2
      AND EXISTS(SELECT 1 FROM auth.users WHERE id='${freshRegistrationScope.player}')
      AND EXISTS(SELECT 1 FROM public.platform_bank_accounts WHERE club_id=c.id AND account_number='TEST-'||c.id::text);`)||'null');
    assert.ok(fixture,'exact retained fresh-registration TEST required');
    const fingerprint=()=>sql(`SELECT md5(jsonb_build_object('tour',(SELECT to_jsonb(t) FROM public.tournaments t WHERE id='${fixture.tour}'),
      'otherRegistrations',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_registrations r WHERE tournament_id='${fixture.tour}' AND player_id<>'${freshRegistrationScope.player}'),
      'cash',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m WHERE tournament_id='${fixture.tour}'),
      'entries',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tournament_entries e WHERE tournament_id='${fixture.tour}'),
      'seats',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.tournament_seats s WHERE tournament_id='${fixture.tour}'))::text);`);
    freshRegistrationProof={fingerprint,before:fingerprint(),player:freshRegistrationScope.player,tour:fixture.tour};
  }else if(tvEditorTour){
    fixture=JSON.parse(sql(`SELECT jsonb_build_object('tour',t.id,'club',c.id) FROM public.tournaments t
      JOIN public.clubs c ON c.id=t.club_id JOIN public.tournament_events e ON e.id=t.event_id AND e.club_id=c.id
      JOIN public.tv_tournament_layouts l ON l.event_id=e.id
      WHERE t.id='${tvEditorTour}' AND t.name='Cash identity local TEST' AND c.name='Cash identity local TEST'
      AND e.name='Native shared TV event TEST' AND l.revision>=5
      AND NOT EXISTS(SELECT 1 FROM public.club_settings cs WHERE cs.club_id=c.id AND cs.auto_swing_enabled);`)||'null');
    assert.ok(fixture,'exact retained native TV TEST canary only');
    const fingerprint=()=>sql(`SELECT md5(jsonb_build_object(
      'tours',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tournaments t WHERE club_id='${fixture.club}'),
      'entries',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tournament_entries e WHERE tournament_id IN(SELECT id FROM public.tournaments WHERE club_id='${fixture.club}')),
      'cash',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m WHERE tournament_id IN(SELECT id FROM public.tournaments WHERE club_id='${fixture.club}')),
      'prizes',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.tournament_prize_payments p WHERE tournament_id IN(SELECT id FROM public.tournaments WHERE club_id='${fixture.club}')),
      'assets',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM storage.objects o WHERE name LIKE (SELECT owner_id::text||'/tv/%' FROM public.clubs WHERE id='${fixture.club}'))
    )::text);`);
    const gate=JSON.parse(sql('SELECT to_jsonb(r) FROM public.centerpoint_tournament_ops_release r WHERE id;'));
    assert.equal(gate.enabled,false);tvEditorProof={fingerprint,before:fingerprint(),gate};
    sql(`UPDATE public.centerpoint_tournament_ops_release SET enabled=true,allowed_club_ids=ARRAY['${fixture.club}'::uuid] WHERE id;`);
  }else if(activeMemberScope){
    fixture=JSON.parse(sql(`SELECT jsonb_build_object('tour',t.id,'club',c.id) FROM public.tournaments t JOIN public.clubs c ON c.id=t.club_id
      JOIN public.club_settings cs ON cs.club_id=c.id JOIN public.tournament_registrations r ON r.tournament_id=t.id
      WHERE t.id='${singleTour}' AND r.id='${activeMemberScope.registration}' AND r.status='confirmed'
      AND t.name='Cash identity local TEST' AND c.name='Cash identity local TEST' AND t.status IN('active','live') AND cs.auto_swing_enabled=false
      AND (SELECT count(*) FROM public.cashier_buyin_movements m WHERE m.registration_id=r.id AND m.method='bank')=2
      AND (SELECT sum(applied_amount) FROM public.cashier_buyin_movements m WHERE m.registration_id=r.id)=100000
      AND EXISTS(SELECT 1 FROM public.tournament_hands h WHERE h.tournament_id=t.id AND h.status='in_progress')
      AND EXISTS(SELECT 1 FROM public.tournament_entries e JOIN public.tournament_seats s ON s.entry_id=e.id AND s.is_active
        JOIN public.seat_draw_receipts d ON d.entry_id=e.id AND d.status='issued' WHERE e.registration_id=r.id);`)||'null');
    assert.ok(fixture,'exact active paid-waiting/reopened TEST receipt required');
  }else if(sidepotScope){
    const f=sidepotScope;
    fixture=JSON.parse(sql(`SELECT jsonb_build_object('tour',t.id,'club',c.id) FROM public.tournaments t JOIN public.clubs c ON c.id=t.club_id
      JOIN public.club_settings cs ON cs.club_id=c.id JOIN public.tournament_entries e ON e.id='${f.entry}' AND e.tournament_id=t.id
      JOIN public.tournament_hands h ON h.id='${f.seedHand}' AND h.tournament_id=t.id
      JOIN public.tournament_tables tt ON tt.id='${f.table}' AND tt.tournament_id=t.id AND tt.table_session_id='${f.session}'
      WHERE t.id='${f.tour}' AND c.id='${f.club}' AND c.owner_id='${f.actor}' AND e.player_id='${f.player}' AND e.registration_id='${f.registration}'
       AND t.name='Cash identity local TEST' AND c.name='Cash identity local TEST' AND t.status IN('active','live') AND cs.auto_swing_enabled=false
       AND h.status='completed' AND h.hand_number=1 AND h.pot_size=200 AND tt.status='active'
       AND (SELECT count(*) FROM public.cashier_buyin_movements m WHERE m.tournament_id=t.id AND m.amount=100000)=3
       AND (SELECT sum(chip_count) FROM public.tournament_seats s WHERE s.tournament_id=t.id AND s.is_active)=60000;`)||'null');
    assert.ok(fixture,'exact canonical paid unequal-stack sidepot TEST required');
    const fingerprint=()=>sql(`SELECT md5(jsonb_build_object('registrations',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_registrations r WHERE tournament_id='${f.tour}'),
      'cash',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m WHERE tournament_id='${f.tour}'),
      'payments',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.tournament_prize_payments p WHERE tournament_id='${f.tour}'))::text);`);
    sidepotFinancialProof={fingerprint,before:fingerprint()};
  } else if(observerFixture){fixture=observerFixture;
  } else if(dealerScope){fixture={tour:dealerScope.tour,club:dealerScope.club};
  } else if(process.env.VINPOKER_PAYROLL_BROWSER==='1') {
    assert.ok(!d2Event&&!singleTour&&!baggingFlight,'payroll canary is independent of completed tour fixtures');
    fixture=seedPayrollBrowserFixture(sql);
  } else if(closedFixture) {
    fixture=JSON.parse(sql(`SELECT jsonb_build_object('tour',t.id,'club',t.club_id) FROM public.tournaments t
      JOIN public.clubs c ON c.id=t.club_id JOIN public.tournament_close_report r ON r.tournament_id=t.id
      WHERE t.id='${singleTour}' AND t.event_id IS NULL AND t.name='Cash identity local TEST'
      AND c.name='Cash identity local TEST' AND t.status='completed'
      AND r.reason='TEST canonical official close' AND r.detail->'official_results'->>'status'='finalized';`)||'null');
    assert.ok(fixture,'only exact closed native journey fixture allowed');
  } else if(d2Event) {
    if(linkedD2){
      assert.ok(!baggingFlight&&!singleTour);
      fixture=JSON.parse(sql(`SELECT jsonb_build_object('tour',t.id,'club',t.club_id,'event',e.id,'final',e.final_tournament_id)
       FROM public.tournaments t JOIN public.tournament_events e ON e.id=t.event_id JOIN public.clubs c ON c.id=t.club_id
       WHERE e.id='${d2Event}' AND e.name='Main Event browser local TEST 164' AND e.guarantee_amount=2500000
        AND t.id=e.final_tournament_id AND t.id='4cd3af4d-7e1d-4042-855f-04fb6777e580' AND t.phase='final'
        AND t.name='Main Event browser local TEST 164 · Final Day' AND t.club_id=e.club_id
        AND c.id='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760' AND c.owner_id='675fe35e-60a8-4452-bb90-e79486d54da6';`)||'null');
      assert.ok(fixture,'exact linked Final Day required');
    }else{
    fixture=JSON.parse(sql(`SELECT jsonb_build_object('tour',t.id,'club',t.club_id,'event',e.id,'final',e.final_tournament_id)
      FROM public.tournaments t JOIN public.tournament_events e ON e.id=t.event_id
      WHERE e.id='${d2Event}' AND ${baggingFlight?`t.id='${baggingFlight}' AND t.phase='flight' AND t.name LIKE 'Multi-day Flight % local TEST'`:"t.id=e.final_tournament_id AND t.phase='final' AND t.name='Multi-day Final local TEST'"}
      AND e.name IN('Multi-day SUM_STACKS local TEST','Multi-day SELECT_LARGEST local TEST');`));
    assert.equal(fixture.event,d2Event);
    if(!sum807&&!d2847&&!historyReadOnly&&!chipTemplateTour&&!chipMetadataTour&&process.env.VINPOKER_FNB_BROWSER!=='1'&&process.env.VINPOKER_STAKING_BROWSER!=='1'&&process.env.VINPOKER_GROUP_INVITE_BROWSER!=='1'){
    d2GateBefore=JSON.parse(sql("SELECT coalesce(jsonb_agg(to_jsonb(g)),'[]'::jsonb) FROM public.multi_day_package_release_v1 g;"));
    d2Club=fixture.club;
    d2OpsBefore=JSON.parse(sql("SELECT coalesce(jsonb_agg(to_jsonb(g)),'[]'::jsonb) FROM public.centerpoint_tournament_ops_release g;"));
    assert.equal(d2OpsBefore.length,1);
    sql(`UPDATE public.centerpoint_tournament_ops_release SET enabled=true,allowed_club_ids=ARRAY['${fixture.club}'::uuid] WHERE id;`);
    sql(`INSERT INTO public.multi_day_package_release_v1(id,enabled,allowed_club_ids) VALUES(true,true,ARRAY['${fixture.club}'::uuid])
      ON CONFLICT(id) DO UPDATE SET enabled=true,allowed_club_ids=excluded.allowed_club_ids;`);
    }
    }
  } else {
  const output = execFileSync(process.execPath, ['tests/cashier/crossFlowItm.native.mjs'], {
    encoding: 'utf8', timeout: 120000, maxBuffer: 2e6, env: { ...process.env, PGHOST: '127.0.0.1', PGPORT: '55441',
      PGUSER: 'postgres', PGDATABASE: database, VINPOKER_NATIVE_CROSS_FLOW: '1' },
  });
  const line = output.split('\n').find((row) => row.startsWith('SEQUENTIAL_ITM_OUT_RANK_PAYOUT_AND_RETRY_LOCAL_PASS '));
  assert.ok(line);
  fixture = JSON.parse(line.slice(line.indexOf('{')));
  }
  if(opsSharedReadOnly){
    const fingerprint=()=>sql(`SELECT md5(jsonb_build_object(
      'event',(SELECT to_jsonb(e) FROM public.tournament_events e WHERE id='${d2Event}'),
      'tours',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tournaments t WHERE event_id='${d2Event}'),
      'entries',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tournament_entries e WHERE tournament_id IN(SELECT id FROM public.tournaments WHERE event_id='${d2Event}')),
      'seats',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.tournament_seats s WHERE tournament_id IN(SELECT id FROM public.tournaments WHERE event_id='${d2Event}')),
      'hands',(SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM public.tournament_hands h WHERE tournament_id IN(SELECT id FROM public.tournaments WHERE event_id='${d2Event}')),
      'cash',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.cashier_buyin_movements c WHERE tournament_id IN(SELECT id FROM public.tournaments WHERE event_id='${d2Event}')),
      'payments',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.tournament_prize_payments p),
      'qualification',(SELECT to_jsonb(l) FROM public.multi_day_qualification_locks_v1 l WHERE event_id='${d2Event}'),
      'finalization',(SELECT to_jsonb(f) FROM public.multi_day_payout_finalizations_v1 f WHERE event_id='${d2Event}'))::text);`);
    opsSharedReadProof={fingerprint,before:fingerprint()};
  }
  if(singleTour&&!fnbKitchen384&&!payout379ReadOnly&&!sepayWrite306&&!bank272Browser&&!bank265ReadOnly&&!clean244Mode&&!existingEventFlight&&!closedFixture&&!observerFixture&&!sidepotScope&&!activeMemberScope&&!freshRegistrationScope&&!handCorrectionScope){
    const target=JSON.parse(sql(`SELECT jsonb_build_object('tour',id,'club',club_id) FROM public.tournaments
      WHERE id='${singleTour}' AND club_id='${fixture.club}' AND event_id IS NULL
      AND ${chipMetadataTour?"name LIKE 'Metadata overlap local TEST %'":chipTemplateTour?"name LIKE 'Template overlap local TEST %'":`name='${chipSetupTour?'Chip atomic overlap local TEST':'Single-day browser local TEST'}'`} AND deleted_at IS NULL;`)||'null');
    assert.ok(target,'exact existing single-day TEST target required; no fixture creation fallback');
    if(chipSetupTour||chipTemplateTour||chipMetadataTour)assert.equal(sql(`SELECT (SELECT count(*) FROM public.tournament_entries WHERE tournament_id='${singleTour}')+
      (SELECT count(*) FROM public.tournament_registrations WHERE tournament_id='${singleTour}')+
      (SELECT count(*) FROM public.cashier_buyin_movements WHERE tournament_id='${singleTour}');`),'0','Chip Setup requires a zero-money isolated canary');
    fixture={...fixture,...target};
    console.log('LOCAL_EXISTING_SINGLE_TOUR_TARGET_VERIFIED',JSON.stringify(target));
    if(process.env.VINPOKER_SINGLE_TABLE_FIXTURE==='1') {
      // Additive, explicitly synthetic physical assets only. Not a product
      // declaration acceptance or legacy repair; never adopt old name-only rows.
      for(const number of [30,31]) {
        const name=`Single-day browser TEST ${number}`;
        const prior=JSON.parse(sql(`SELECT coalesce(jsonb_agg(to_jsonb(g)),'[]'::jsonb) FROM public.game_tables g
          WHERE club_id='${fixture.club}' AND table_number=${number};`));
        assert.ok(prior.length<=1,'single-day inventory number ambiguous');
        if(prior.length)assert.equal(prior[0].table_name,name,'never adopt another fixture asset');
        else sql(`INSERT INTO public.game_tables(club_id,table_name,table_number,table_type,game_type,status,operational_status)
          VALUES('${fixture.club}','${name}',${number},'tournament','NLH','inactive','available');`);
      }
      console.log('LOCAL_SINGLE_TOUR_SYNTHETIC_INVENTORY_ONLY_30_31_READY');
    }
  }
  const owner = sql(`SELECT owner_id FROM public.clubs WHERE id='${fixture.club}';`);
  if(bank270ReadOnly){
    assert.equal(fixture.club,'a8e7d1b7-fdaa-45ad-b0a1-f894b6315760');
    const fingerprint=()=>sql(`SELECT md5(jsonb_build_array(
      (SELECT jsonb_agg(to_jsonb(x) ORDER BY club_id,denomination_id) FROM public.chip_bank x),
      (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_bank_ledger x),
      (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_inventory_ledger x),
      (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
      (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x))::text);`);
    bank270Proof={fingerprint,before:fingerprint()};
  }
  const reentryPlayer=process.env.VINPOKER_SINGLE_REENTRY_PLAYER;
  if(reentryPlayer) {
    const configured=singleTour==='829e61fe-0ac8-4ced-950d-ab76cb8dadc5';
    assert.equal(singleTour,single666Reentry?'c367013a-3ed3-48af-ad48-3915acadc50e':configured?'829e61fe-0ac8-4ced-950d-ab76cb8dadc5':'b72cb86e-b2f7-4b32-9b1b-b5fff911ea2f');
    assert.equal(reentryPlayer,single666Reentry?'e5eded2a-1efc-406f-b794-316a39a20a51':configured?'a364de8e-06b1-4428-a20d-ac614ec406e5':'66408e9e-5145-4fd8-8e19-8faffba70ab7');
    const oldEntry=single666Reentry?'c08959a4-38f8-4df9-8fd4-033c1bdf8a9e':configured?'2ff34617-98c7-409c-91c9-dd2341c17d71':'3c8777af-3abf-43f7-b576-a63b14d2e970';
    assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM public.tournament_entries WHERE id='${oldEntry}'
      AND tournament_id='${singleTour}' AND player_id='${reentryPlayer}' AND status='busted');`),'t');
    const banks=JSON.parse(sql(`SELECT coalesce(jsonb_agg(jsonb_build_object('bank_name',bank_name,'account_number',account_number)),'[]'::jsonb)
      FROM public.platform_bank_accounts WHERE club_id='${fixture.club}';`));
    if(banks.length===0)sql(`INSERT INTO public.platform_bank_accounts(club_id,bank_name,account_number,account_holder,notes)
      VALUES('${fixture.club}','LOCAL_TEST_NO_BANK','LOCAL_TEST_NOT_PAYABLE','LOCAL TEST ONLY','Synthetic non-payable browser fixture. No BIN, QR, provider or real account.');`);
    else assert.deepEqual(banks,[{bank_name:'LOCAL_TEST_NO_BANK',account_number:single666Reentry?'CLEAN248_NOT_PAYABLE':'LOCAL_TEST_NOT_PAYABLE'}]);
  }
  let memberReceipt=null;
  const registrationReplay=process.env.VINPOKER_REGISTRATION_RECEIPT_REPLAY==='1';
  if(registrationReplay)assert.ok(activeMemberScope&&process.env.VINPOKER_MEMBER_RECEIPT_BROWSER==='1','only retained confirmed bank registration replay');
  if(process.env.VINPOKER_MEMBER_RECEIPT_BROWSER==='1'){
    if(!activeMemberScope)assert.equal(singleTour,'829e61fe-0ac8-4ced-950d-ab76cb8dadc5');assert.ok(!reentryPlayer&&!chipSetupTour&&!closedFixture);
    memberReceipt=JSON.parse(sql(`SELECT jsonb_build_object('registration',r.id,'player',r.player_id) FROM public.tournament_registrations r
      WHERE r.tournament_id='${singleTour}' ${activeMemberScope?`AND r.id='${activeMemberScope.registration}'`:''} AND r.status='confirmed' AND EXISTS(SELECT 1 FROM public.seat_draw_receipts s WHERE s.registration_id=r.id AND s.cancelled_at IS NULL)
      ORDER BY r.id LIMIT 1;`)||'null');assert.ok(memberReceipt);
    const fingerprint=()=>sql(`SELECT md5(jsonb_build_object('registrations',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.tournament_registrations r WHERE tournament_id='${singleTour}'),
      'movements',(SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM public.cashier_buyin_movements m WHERE tournament_id='${singleTour}'),
      'receipts',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.seat_draw_receipts s WHERE tournament_id='${singleTour}'))::text);`);
    memberReadProof={fingerprint,before:fingerprint()};
  }
  const stakingBuyer=process.env.VINPOKER_STAKING_PURCHASE_BUYER;
  if(stakingBuyer){
    assert.ok(linkedD2&&process.env.VINPOKER_STAKING_BROWSER==='1'&&process.env.VINPOKER_STAKING_PURCHASE_POSITIVE==='1');
    assert.equal(stakingBuyer,'1cc90e71-883d-40c0-8671-1f38929ecadc');
    assert.equal(sql(`SELECT count(*) FROM public.profiles WHERE user_id='${stakingBuyer}' AND display_name='LOCAL510 ${stakingBuyer}' AND bank_account_number='LOCAL_ONLY';`),'1');
    const fingerprint=()=>sql(`SELECT md5(jsonb_build_array(${['tournaments','tournament_events','tournament_entries','tournament_seats','tournament_hands','tournament_prize_payments','multi_day_package_release_v1','centerpoint_tournament_ops_release'].map(t=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.${t} x)`).join(',')})::text);`);
    stakingBuyerProof={fingerprint,before:fingerprint()};
  }
  const actor = stakingBuyer??clean244Player??freshRegistrationScope?.player??memberReceipt?.player??reentryPlayer??owner;
  if(notificationReadOnly){
    assert.equal(actor,'675fe35e-60a8-4452-bb90-e79486d54da6');
    const fingerprint=()=>sql(`SELECT md5(jsonb_build_object('notices',(SELECT coalesce(jsonb_agg(to_jsonb(n) ORDER BY id),'[]') FROM public.notifications n),
      'jobs',(SELECT coalesce(jsonb_agg(to_jsonb(j) ORDER BY id),'[]') FROM private.notification_push_outbox_v1 j))::text);`);
    notificationReadProof={fingerprint,before:fingerprint()};
  }
  if(inboxDmChat){
    inboxDmFixture=JSON.parse(sql(`SELECT jsonb_build_object('chat',c.id,'peer',CASE WHEN c.user_a='${actor}' THEN c.user_b ELSE c.user_a END,
      'ownRead',CASE WHEN c.user_a='${actor}' THEN 'user_a_last_read_at' ELSE 'user_b_last_read_at' END)
      FROM public.direct_chats c JOIN public.profiles p ON p.user_id=CASE WHEN c.user_a='${actor}' THEN c.user_b ELSE c.user_a END
      WHERE c.id='${inboxDmChat}' AND '${actor}' IN(c.user_a,c.user_b) AND p.display_name LIKE 'LOCAL DM peer TEST %'
       AND (SELECT count(*) FROM public.direct_messages m WHERE m.chat_id=c.id AND m.kind='text' AND m.content LIKE 'LOCAL DM browser % TEST %'
         AND m.content<>${dm277Send?"'LOCAL DM browser send277 TEST same-tab recovery'":"'LOCAL DM browser send275 TEST recovery'"})=${dm277Send?3:2};`)||'null');
    assert.ok(inboxDmFixture,'exact isolated canonical private DM fixture required');
    if(dm275Send)direct275Bridge=createDirect275Browser({sql,query:statement=>query(statement),actor,chat:inboxDmChat,ownRead:inboxDmFixture.ownRead,log:[],reload277:dm277Send});
    const fingerprint=()=>sql(`SELECT md5(jsonb_build_object('chat',(SELECT to_jsonb(c)-'${inboxDmFixture.ownRead}' FROM public.direct_chats c WHERE id='${inboxDmChat}'),
      'messages',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.direct_messages m WHERE chat_id='${inboxDmChat}'))::text);`);
    inboxDmFixture.fingerprint=direct275Bridge?.fingerprint??fingerprint;inboxDmFixture.before=inboxDmFixture.fingerprint();
  }
  let finalizationRecovery=null;
  if(process.env.VINPOKER_FINALIZATION_RECOVERY_BROWSER==='1'){
    assert.equal(d2Event,'b8ebfbc7-ff78-4515-8812-7d748b828d0b');assert.ok(!singleTour&&!baggingFlight&&!memberReceipt);
    finalizationRecovery=JSON.parse(sql(`SELECT jsonb_build_object('actorId',actor_id,'eventId',event_id,'args',jsonb_build_object(
      'p_event_id',event_id,'p_request_id',request_id,'p_expected_rules_version',rules_version,
      'p_expected_funding_revision',funding_revision,'p_expected_qualification_revision',qualification_revision,'p_expected_payout_input_hash',payout_input_hash))
      FROM public.multi_day_payout_finalizations_v1 WHERE event_id='${d2Event}' AND actor_id='${actor}';`)||'null');assert.ok(finalizationRecovery);
    const fingerprint=()=>sql(`SELECT jsonb_build_object('finalization',(SELECT to_jsonb(f) FROM public.multi_day_payout_finalizations_v1 f WHERE event_id='${d2Event}'),
      'payments',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]'::jsonb) FROM public.tournament_prize_payments p WHERE tournament_id='${fixture.tour}'));`);
    finalizationReadProof={fingerprint,before:fingerprint()};
  }
  let finalizationFault=!!finalizationRecovery;
  let qualificationRecovery=null;
  if(process.env.VINPOKER_QUALIFICATION_RECOVERY_BROWSER==='1'){
    assert.equal(d2Event,'b8ebfbc7-ff78-4515-8812-7d748b828d0b');assert.ok(!singleTour&&!baggingFlight&&!memberReceipt&&!finalizationRecovery);
    qualificationRecovery=JSON.parse(sql(`SELECT jsonb_build_object('actorId',l.actor_id,'eventId',l.event_id,'policy',r.policy,'args',jsonb_build_object(
      'p_event_id',l.event_id,'p_request_id',l.request_id,'p_expected_source_hash',l.source_hash,
      'p_bag_ids',(SELECT jsonb_agg(ids.bag ORDER BY ids.bag) FROM(SELECT DISTINCT b->>'bagId' bag FROM public.multi_day_final_participations_v1 p,
        LATERAL jsonb_array_elements(p.source_bags) b WHERE p.event_id=l.event_id) ids)))
      FROM public.multi_day_qualification_locks_v1 l JOIN public.multi_day_qualification_rules_v1 r ON r.event_id=l.event_id
      WHERE l.event_id='${d2Event}' AND l.actor_id='${actor}';`)||'null');assert.ok(qualificationRecovery);
    assert.equal(sql(`SELECT selection_hash=md5('${qualificationRecovery.args.p_bag_ids.join(',')}') FROM public.multi_day_qualification_locks_v1 WHERE event_id='${d2Event}';`),'t');
    const fingerprint=()=>sql(`SELECT jsonb_build_object('lock',(SELECT to_jsonb(l) FROM public.multi_day_qualification_locks_v1 l WHERE event_id='${d2Event}'),
      'participations',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.multi_day_final_participations_v1 p WHERE p.event_id='${d2Event}'),
      'finalization',(SELECT to_jsonb(f) FROM public.multi_day_payout_finalizations_v1 f WHERE event_id='${d2Event}'),
      'payments',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]'::jsonb) FROM public.tournament_prize_payments p WHERE tournament_id='${fixture.tour}'));`);
    qualificationReadProof={fingerprint,before:fingerprint()};
  }
  let qualificationFault=!!qualificationRecovery;
  let continueRecovery=null;
  if(process.env.VINPOKER_CONTINUE_RECOVERY_BROWSER==='1'){
    assert.equal(d2Event,'b8ebfbc7-ff78-4515-8812-7d748b828d0b');
    assert.ok(!singleTour&&!baggingFlight&&!memberReceipt&&!finalizationRecovery&&!qualificationRecovery);
    continueRecovery=JSON.parse(sql(`SELECT jsonb_build_object('actorId',r.actor_id,'tournamentId',b.tournament_id,
      'batchId',b.id,'revision',(r.request_fingerprint::jsonb->>'expected_redraw_revision')::bigint,'requestId',r.request_id)
      FROM public.table_operation_receipts r JOIN public.tournament_redraw_batches b ON b.id=(r.result->>'batch_id')::uuid
      WHERE r.operation_type='floor_continue_tournament_redraw_v1' AND b.tournament_id='${fixture.tour}' AND r.actor_id='${actor}'
      ORDER BY r.created_at DESC LIMIT 1;`)||'null');assert.ok(continueRecovery);
    const fingerprint=()=>sql(`SELECT md5(jsonb_build_object('tour',(SELECT to_jsonb(t) FROM public.tournaments t WHERE id='${fixture.tour}'),
      'sessions',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.table_sessions s WHERE tournament_id='${fixture.tour}'),
      'batches',(SELECT jsonb_agg(to_jsonb(b) ORDER BY b.id) FROM public.tournament_redraw_batches b WHERE tournament_id='${fixture.tour}'),
      'receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY actor_id,operation_type,request_id) FROM public.table_operation_receipts r))::text);`);
    continueReadProof={fingerprint,before:fingerprint()};
  }
  let continueFault=!!continueRecovery;
  let rulesRecovery=null;
  if(process.env.VINPOKER_RULES_RECOVERY_BROWSER==='1'){
    assert.equal(d2Event,'b8ebfbc7-ff78-4515-8812-7d748b828d0b');
    assert.ok(!singleTour&&!baggingFlight&&!memberReceipt&&!finalizationRecovery&&!qualificationRecovery&&!continueRecovery);
    rulesRecovery=JSON.parse(sql(`SELECT jsonb_build_object('actorId','${actor}','eventId',event_id,'itmPercent',itm_percent,'args',jsonb_build_object(
      'p_event_id',event_id,'p_policy',policy,'p_min_cash_x',min_cash_x,'p_day2_percent',day2_percent))
      FROM public.multi_day_qualification_rules_v1 WHERE event_id='${d2Event}';`)||'null');assert.ok(rulesRecovery);
    const fingerprint=()=>sql(`SELECT md5(jsonb_build_object('rules',(SELECT to_jsonb(r) FROM public.multi_day_qualification_rules_v1 r WHERE event_id='${d2Event}'),
      'lock',(SELECT to_jsonb(l) FROM public.multi_day_qualification_locks_v1 l WHERE event_id='${d2Event}'),
      'final',(SELECT to_jsonb(f) FROM public.multi_day_payout_finalizations_v1 f WHERE event_id='${d2Event}'),
      'payments',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.tournament_prize_payments p WHERE tournament_id='${fixture.tour}'))::text);`);
    rulesReadProof={fingerprint,before:fingerprint()};
  }
  let rulesFault=!!rulesRecovery;
  if(process.env.VINPOKER_CORRECTION_BROWSER==='1'){
    assert.ok(d2Event&&!singleTour&&!baggingFlight&&!memberReceipt&&!finalizationRecovery&&!qualificationRecovery&&!continueRecovery&&!rulesRecovery);
  }
  const memberReceiptHandler=(memberReceipt||freshRegistrationScope||clean244Member)?createNativeReceiptHandler(sql,()=>actor):null;
  let memberReceiptFault=memberReceipt&&process.env.VINPOKER_MEMBER_RECEIPT_FAIL_ONCE==='1';
  if(process.env.VINPOKER_RETRY_SINGLE_PAID==='1') {
    assert.ok(singleTour);retrySingleTourPaidNative({sql,fixture,actor});
  }
  const historyTable=single647Hand||single657Read?{id:'c2ce77c0-2b61-4a19-bd43-4752232cc55a',session:'b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5'}:(existingEventFlight||linkedD2)?JSON.parse(sql(`SELECT jsonb_build_object('id',tt.id,'session',s.id)
    FROM public.tournament_tables tt JOIN public.table_sessions s ON s.id=tt.table_session_id
    WHERE tt.tournament_id='${fixture.tour}'
      AND s.tournament_id=tt.tournament_id AND s.game_table_id=tt.game_table_id AND s.club_id='${fixture.club}'
      AND ((tt.status='active' AND s.closed_at IS NULL ${linkedD2?"AND s.control_mode='tracker'":''})
      ${linkedD2?`OR (tt.status<>'active' AND s.closed_at IS NOT NULL
        AND EXISTS(SELECT 1 FROM public.tournaments t WHERE t.id=tt.tournament_id AND t.club_id=s.club_id AND t.status='completed')
        AND EXISTS(SELECT 1 FROM public.tournament_hands h WHERE h.tournament_id=tt.tournament_id
          AND h.tournament_table_id=tt.id AND h.table_session_id=s.id AND h.status='completed'))`:''})
    ORDER BY CASE WHEN s.closed_at IS NULL THEN 0 ELSE 1 END,
      CASE WHEN s.closed_at IS NOT NULL THEN (SELECT max(h.created_at) FROM public.tournament_hands h
        WHERE h.tournament_id=tt.tournament_id AND h.tournament_table_id=tt.id AND h.table_session_id=s.id AND h.status='completed') END DESC,
      tt.table_number LIMIT 1;`)||'null'):handCorrectionScope?{id:handCorrectionScope.table}:sidepotScope?{id:sidepotScope.table,session:sidepotScope.session}:hand555Observer||hand589Observer?{id:'d294f4a4-082b-4efc-a6ca-1f96579ea344',session:'ee2b9393-0c96-42f9-8667-7f306edeb9bc'}:(d2Event||observerFixture)?JSON.parse(sql(`SELECT jsonb_build_object('id',tt.id,'session',tt.table_session_id)
    FROM public.tournament_tables tt WHERE tt.tournament_id='${fixture.tour}'
    AND EXISTS(SELECT 1 FROM public.tournament_hands h WHERE h.tournament_id=tt.tournament_id AND h.table_id=tt.id AND h.status='completed')
    ORDER BY tt.table_number LIMIT 1;`)||'null'):null;
  const claims = `SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;`;
  const authUsageBefore=sql("SELECT has_schema_privilege('authenticated','auth','USAGE');");
  assert.ok(['t','f'].includes(authUsageBefore));
  // Schema-only native bootstrap omits this hosted Auth schema permission.
  // Model it only inside the RPC transaction, restore before commit.
  const query = (statement) => linkedD2&&main167Bridge&&process.env.VINPOKER_PAYMENT461_BROWSER!=='1'?main167Bridge.runFinal(statement):JSON.parse(sql(`BEGIN;${authUsageBefore==='f'?'GRANT USAGE ON SCHEMA auth TO authenticated;':''}
    ${claims}${statement}RESET ROLE;${authUsageBefore==='f'?'REVOKE USAGE ON SCHEMA auth FROM authenticated;':''}COMMIT;`));
  if(bank272Browser)bank272Bridge=createBank272Browser(sql,query,fixture);
  const runId = randomUUID(), sessions = new Map(), signingKey = randomBytes(32);
  const email = 'native-owner@test.invalid', password = 'LOCAL_TEST_ONLY';
  const user = { id: actor, aud: 'authenticated', role: 'authenticated', email,
    email_confirmed_at: new Date().toISOString(), created_at: new Date().toISOString(),
    app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, identities: [] };
  const log = []; const droppedKeys = new Set(); const mainEventDroppedKeys=new Set(); let dropNext = false;
  if(sum807||d2847){
    const protectedTables=['public.cashier_buyin_movements','public.tournament_entries','public.tournament_seats','public.tournament_hands','public.chip_bag','public.day_close','public.multi_day_final_participations_v1','public.multi_day_qualification_locks_v1','private.multi_day_initial_draw_plans_v1','private.multi_day_initial_draw_applications_v1','public.multi_day_package_release_v1','public.centerpoint_tournament_ops_release','public.dealer_attendance','public.audit_logs',...(d2847?['public.tournaments','public.table_sessions','public.tournament_tables','public.multi_day_final_requests_v1','public.multi_day_final_stack_revisions_v1','public.multi_day_final_adjustments_v1','public.tournament_chip_counts','public.chip_inventory_ledger','public.chip_bank_ledger','private.d2_seed846_commit_fixture','private.d2_held849_install']:[])];
    const fingerprint=()=>sql(`SELECT md5(jsonb_build_array(${protectedTables.map(t=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM ${t} x)`).join(',')})::text);`);
    sum807Proof={fingerprint,before:fingerprint()};
  }
  const floor791Bridge=process.env.VINPOKER_FLOOR791_READ==='1'?createFloor791Read({query,fixture,actor,log,sum807,d2847}):null;
  if(single677Redraw)single677Bridge=createSingle677Redraw({sql,query,actor,club:fixture.club,tour:fixture.tour,log});
  if(single643Read)single643Reads=createSingle643Reads({sql,query,club:fixture.club,log});
  if(single706Read)single706Payroll=createSingle706PayrollRead({sql,query,actor,club:fixture.club,log});
  if(single644Write)single644Assign=createSingle644Assignment({sql,fixture,actor,dealers:clean244DealerIds,log});
  const single661Bridge=single661Swing||single662Plan?createSingle661ManualSwing({sql,query,actor,club:fixture.club,log}):null;
  if(single678Hand){
    const predicate=`tournament_id='${fixture.tour}' AND tournament_table_id='c2ce77c0-2b61-4a19-bd43-4752232cc55a' AND user_id='${actor}' AND capability='undo_open_hand'`;
    let before=JSON.parse(sql(`SELECT to_jsonb(s) FROM public.tracker_correction_uat_scopes s WHERE ${predicate};`)||'null');
    if(before===null){
      before=JSON.parse(sql(`INSERT INTO public.tracker_correction_uat_scopes(club_id,tournament_id,tournament_table_id,user_id,capability,enabled)
       VALUES('${fixture.club}','${fixture.tour}','c2ce77c0-2b61-4a19-bd43-4752232cc55a','${actor}','undo_open_hand',false) RETURNING to_jsonb(tracker_correction_uat_scopes);`));
    }
    single678UndoScope=before;
    console.log('LOCAL_SINGLE678_UNDO_SCOPE_PREIMAGE',JSON.stringify(before));
    sql(`UPDATE public.tracker_correction_uat_scopes SET enabled=true,expires_at=now()+interval '30 minutes' WHERE id='${before.id}' AND ${predicate};`);
  }
  const ops601=process.env.VINPOKER_OPS601_READONLY==='1'?createOps601Read({query,club:fixture.club,log}):null;
  if(ops601)assert.equal(process.env.VINPOKER_FINANCE583_READONLY,'1');
  let finance584Failures=process.env.VINPOKER_FINANCE584_FAULT==='1'?2:0;
  if(finance584Failures)assert.equal(process.env.VINPOKER_FINANCE583_READONLY,'1');
  if(process.env.VINPOKER_STREAM579_BROWSER==='1'){
    assert.ok(linkedD2&&!sidepotScope&&!main167Bridge&&!funding560Bridge&&!refund538Bridge);
    stream579Bridge=createStream579Browser({sql,query,fixture,actor,log});
  }
  if(fnbShift731)fnb731Bridge=createFnb731Shift({sql,query,log,fixture,actor});
  else if(fnbKitchen384)fnb384Bridge=createFnb384Kitchen({sql,query,log,fixture,actor});
  if(process.env.VINPOKER_SEPAY608_BROWSER==='1')sepay608Bridge=await createSePay608Browser({sql,actor,log});
  if(process.env.VINPOKER_COUPLING613_BROWSER==='1')coupling613Bridge=await createCoupling613Browser({sql,actor,log});
  if(process.env.VINPOKER_BAG630_BROWSER==='1')bag630Bridge=await createBag630Browser({sql,actor,log});
  if(process.env.VINPOKER_BAG616_READONLY==='1'){
    assert.equal(actor,'675fe35e-60a8-4452-bb90-e79486d54da6');
    const fingerprint=()=>sql(`SELECT md5(jsonb_build_array(
      (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_bag x),
      (SELECT jsonb_agg(to_jsonb(x) ORDER BY tournament_id,day_number) FROM public.day_close x),
      (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_inventory_ledger x),
      (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
      (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x),
      (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_entries x),
      (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x))::text);`);
    bag616Proof={fingerprint,before:fingerprint()};
  }
  const detail367ReadOnly=process.env.VINPOKER_DETAIL367_READ_ONLY==='1';
  let detail367CountFault=false;
  if(detail367ReadOnly){
    assert.ok(linkedD2&&d2Event==='dbb49f8d-7d47-4c2c-afd9-f57062c9971d');
    assert.equal(sql("SELECT count(*) FROM public.tournament_streams WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e';"),'0','no external stream provider in detail read canary');
  }
  if(sepayWrite303)sepay303Bridge=createSePay303Browser(sql,actor,fixture.club,log);
  if(sepayWrite306)sepay306Bridge=createSePay306Browser(sql,actor,fixture.club,log);
  if(clean244TvAssets)tv258Bridge=createTv258Assets({sql,query,actor,club:fixture.club,tour:fixture.tour,log});
  let finishReceiptHold=process.env.VINPOKER_FINISH_RECEIPT_HOLD==='1';
  if(finishReceiptHold&&!single656Finish)assert.equal(sidepotScope?.tour,'46cab483-91e7-4220-aacf-e17bdf05269c','Finish recovery fault requires exact retained local TEST scope');
  const activeCorrection101=process.env.VINPOKER_ACTIVE_CORRECTION_BROWSER==='1';
  let floorLocationFault101=false;
  if(activeCorrection101){assert.equal(sidepotScope?.tour,'46cab483-91e7-4220-aacf-e17bdf05269c');assert.ok(!process.env.VINPOKER_FLOOR_ALERT_BROWSER&&!handCorrectionScope&&!process.env.VINPOKER_HISTORY_DISPLAY_BROWSER);}
  if(process.env.VINPOKER_FEED_INVALIDATION288==='1'){
    assert.ok(handCorrectionScope&&!linkedD2&&!sidepotScope);
    feed288Bridge=await createFeedInvalidation288({sql,scope:handCorrectionScope,log});
  }else if(handCorrectionScope&&!feedRead291)handCorrectionBridge=await createCorrectionBrowser({sql,query,scope:handCorrectionScope,actor,log});
  if(process.env.VINPOKER_FLOOR_ALERT_BROWSER==='1'){
    assert.ok(sidepotScope&&!process.env.VINPOKER_HISTORY_DISPLAY_BROWSER,'exact independent alert TEST transaction required');
    floorAlertBridge=await createFloorAlertBrowser({sql,scope:sidepotScope,actor,log});
  }
  if(process.env.VINPOKER_HISTORY_DISPLAY_BROWSER==='1'){
    assert.ok(sidepotScope,'display verifier browser seam requires the exact isolated Tracker TEST scope');
    historicalDisplayBridge=createHistoricalDisplayBrowser({sql,query,fixture,actor,log});
  }
  let dealerPlanHang=!!dealerScope,dealerSwingLoss=!!dealerScope;
  const dealerReadOnly=process.env.VINPOKER_DEALER_READ_ONLY==='1';
  const dealerControlReadOnly=process.env.VINPOKER_DEALER_CONTROL_READONLY==='1';
  let opsCapabilityReadFault=process.env.VINPOKER_OPS_CAPABILITY_READ_FAULT==='1';
  if(opsCapabilityReadFault)assert.ok(sidepotScope&&dealerControlReadOnly,'capability503 probe requires exact readonly Dealer canary');
  const opsChipReadOnly=process.env.VINPOKER_CHIP_OPS_READONLY==='1';
  let opsChipHangOnce=opsChipReadOnly&&process.env.VINPOKER_CHIP_OPS_READ_HANG==='1';
  assert.ok(!(dealerControlReadOnly&&opsChipReadOnly));
  let dealerControlReadFault=dealerControlReadOnly&&process.env.VINPOKER_DEALER_CONTROL_READ_FAULT==='1';
  if(dealerControlReadOnly||opsChipReadOnly){
    assert.ok(sidepotScope&&!dealerReadOnly&&!dealerScope&&!floorAlertBridge&&!historicalDisplayBridge,'isolated retained readonly Dealer Control only');
    const fingerprint=()=>sql(`SELECT md5(jsonb_build_object(
      'tables',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.game_tables t WHERE club_id='${fixture.club}'),
      'sessions',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.table_sessions s WHERE club_id='${fixture.club}'),
      'assignments',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.dealer_assignments a WHERE club_id='${fixture.club}'),
      'dealers',(SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM public.dealers d WHERE club_id='${fixture.club}'),
      'attendance',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.dealer_attendance a WHERE dealer_id IN(SELECT id FROM public.dealers WHERE club_id='${fixture.club}'))
    )::text);`);
    dealerControlReadProof={fingerprint,before:fingerprint()};
    if(opsChipReadOnly){
      assert.equal(sql(`SELECT coalesce(phase,'')<>'flight' FROM public.tournaments WHERE id='${fixture.tour}';`),'t','readonly canary must not mount bagging actions');
      const chipFingerprint=()=>JSON.stringify(query(`SELECT jsonb_build_object(
        'inventory',public.get_issued_chip_inventory('${fixture.tour}'),
        'templates',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.stack_template s WHERE tournament_id='${fixture.tour}'),
        'issuance',(SELECT jsonb_agg(to_jsonb(i) ORDER BY stack_template_id) FROM public.stack_template_issuance i WHERE stack_template_id IN(SELECT id FROM public.stack_template WHERE tournament_id='${fixture.tour}'))
      );`));
      chipReadSnapshot=chipFingerprint;chipReadBefore=chipFingerprint();
    }
  }
  if(dealerReadOnly)assert.ok(sidepotScope,'dealer read probe uses exact retained TEST scope');
  let dealerReadFault=dealerReadOnly;
  if(dealerScope)dealerBridge=createDealerPlanBrowser({scope:dealerScope,sql,query,log});
  const hangingReads = new Set();
  if(payout379ReadOnly&&!payout700Recovery&&!payout704Manual)payout379Bridge=createPayout379Read({sql,query,fixture,actor,log,hangingReads});
  if(payout704Manual)payout704Bridge=createPayout704Manual({sql,query,actor,log});
  if(single699Payout||payout700Recovery)single699Bridge=createSingle699Payout({sql,query,fixture,actor,log,recovery700:payout700Recovery});
  let historyReadHangCount=Number(process.env.VINPOKER_HISTORY362_HANG_COUNT??'0');
  assert.ok(Number.isInteger(historyReadHangCount)&&historyReadHangCount>=0&&historyReadHangCount<=2);
  if(historyReadHangCount)assert.ok(linkedD2&&d2Event==='dbb49f8d-7d47-4c2c-afd9-f57062c9971d','history fault exact retained Main only');
  const hangingTrackerActions = new Set();
  const actionHangBeforeDb=process.env.VINPOKER_TRACKER_ACTION_HANG_BEFORE_DB==='1';
  if(actionHangBeforeDb){
    assert.ok(sidepotScope,'action transport fault requires exact retained sidepot scope');
    const fingerprint=()=>sql(`SELECT md5(jsonb_build_object(
      'hand',(SELECT to_jsonb(h)-'locked_at'-'locked_by_user_id' FROM public.tournament_hands h WHERE id='08730ce1-9a83-4439-96f9-ac005ae3d734' AND tournament_id='${fixture.tour}'),
      'actions',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.hand_actions a WHERE hand_id='08730ce1-9a83-4439-96f9-ac005ae3d734'),
      'players',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.hand_players p WHERE hand_id='08730ce1-9a83-4439-96f9-ac005ae3d734'),
      'entries',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tournament_entries e WHERE tournament_id='${fixture.tour}'),
      'seats',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.tournament_seats s WHERE tournament_id='${fixture.tour}')
    )::text);`);
    sidepotActionReadProof={fingerprint,before:fingerprint()};
  }
  if(process.env.VINPOKER_STAKING_BROWSER==='1') stakingBridge=createStakingBrowserEdge({sql,query,actor,club:fixture.club,log});
  if(process.env.VINPOKER_REFUND538_BROWSER==='1')refund538Bridge=await createRefund538Browser({actor,club:fixture.club,log});
  if(process.env.VINPOKER_FUNDING560_BROWSER==='1'){
    assert.ok(linkedD2&&!refund538Bridge&&!stakingBridge);
    funding560Bridge=await createFunding560Browser({actor,club:fixture.club,log});
  }
  if(process.env.VINPOKER_GROUP_INVITE_BROWSER==='1')inviteBridge=createGroupInviteBrowser({sql,query,actor,log});
  if(process.env.VINPOKER_PAYROLL_BROWSER==='1')payrollBridge=createPayrollBrowser({sql,query,actor,fixture,log});
  if(process.env.VINPOKER_PAYROLL_LINKED_MAIN227==='1'){
    assert.equal(d2Event,'dbb49f8d-7d47-4c2c-afd9-f57062c9971d');
    assert.ok(!payrollBridge&&process.env.VINPOKER_PAYROLL_READ_ONLY==='1');
    payrollBridge=createPayrollBrowser({sql,query,actor,fixture:{...fixture,payroll:{
      dealer:'24803da6-62f3-4f42-af5b-7e8884e74171',year:2026,month:10,start:'2026-10-01',end:'2026-10-31',linkedMain:true,
    }},log});
  }
  let failPublicResultOnce=process.env.VINPOKER_PUBLIC_RESULT_FAIL_ONCE==='1';
  let cashierWorklistHangOnce=process.env.VINPOKER_CASHIER_WORKLIST_HANG_ONCE==='1';
  let cashierIssues266HangOnce=process.env.VINPOKER_CASHIER_ISSUES_HANG_ONCE==='1';
  if(cashierIssues266HangOnce)assert.ok(bank265ReadOnly,'issues read hang requires exact retained readonly bank264');
  if(cashierWorklistHangOnce)assert.ok(sidepotScope,'Cashier read hang requires exact retained TEST scope');
  let cashierSummaryNullMoney=false;
  const chipNullReadOnly=process.env.VINPOKER_CHIP_NULL_READ_ONCE==='1';
  let corruptChipCount=chipNullReadOnly;
  if(chipNullReadOnly)assert.ok(sidepotScope,'malformed chip response only in exact retained paid TEST');
  let hangChipReadCount=Number(process.env.VINPOKER_CHIP_READ_HANG_COUNT??(process.env.VINPOKER_CHIP_READ_HANG_ONCE==='1'?'1':'0'));
  assert.ok(Number.isInteger(hangChipReadCount)&&hangChipReadCount>=0&&hangChipReadCount<=2,'local read fault count must be0..2');
  const hangChipReadRpc=process.env.VINPOKER_CHIP_READ_HANG_RPC??'get_tournament_participation_counts_v1';
  assert.ok(['get_tournament_participation_counts_v1','get_chip_bank','chip_bank_ledger'].includes(hangChipReadRpc));
  const holdChipRead=(name,response)=>{
    if(!hangChipReadCount||name!==hangChipReadRpc)return false;
    hangChipReadCount--;
    log.push({rpc:name,fault:'LOCAL_READ_HANG_AFTER_SQL',mutation:false});
    const held={response,shutdown:false};hangingReads.add(held);
    response.once('close',()=>{hangingReads.delete(held);log.push({rpc:name,fault:held.shutdown?'LOCAL_HUNG_READ_SERVER_SHUTDOWN':'LOCAL_HUNG_READ_CLIENT_CLOSED',mutation:false});});
    return true;
  };
  if(hangChipReadCount||chipSetupTour||chipTemplateTour||chipMetadataTour||chipNullReadOnly){
    assert.ok(singleTour,'chip read fault requires explicit retained single-day scope');
    chipReadSnapshot=()=>sql(`SELECT md5(jsonb_build_object(
      'tournament',(SELECT to_jsonb(t) FROM public.tournaments t WHERE id='${fixture.tour}'),
      'entries',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tournament_entries e WHERE tournament_id='${fixture.tour}'),
      'seats',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.tournament_seats s WHERE tournament_id='${fixture.tour}'),
      'chipLedger',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.chip_inventory_ledger l WHERE tournament_id='${fixture.tour}'),
      'bankLedger',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.chip_bank_ledger l WHERE club_id='${fixture.club}'),
      'payments',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.tournament_prize_payments p WHERE tournament_id='${fixture.tour}')
    )::text);`);
    chipReadBefore=chipReadSnapshot();
  }
  const editCanary=process.env.VINPOKER_EDIT_CANARY??null;
  if(editCanary){
    assert.ok(uuid(editCanary)&&sidepotScope,'edit probe requires retained scope');
    assert.equal(sql(`SELECT count(*) FROM public.tournaments WHERE id='${editCanary}' AND club_id='${fixture.club}' AND name='Tour edit132 browser local TEST' AND deleted_at IS NULL;`),'1');
    assert.equal(sql(`SELECT (SELECT count(*) FROM public.tournament_entries WHERE tournament_id='${editCanary}')+(SELECT count(*) FROM public.cashier_buyin_movements WHERE tournament_id='${editCanary}');`),'0');
  }
  let templatePayload=null;
  const metadataPayloads=new Map();let metadataAddedId=null;
  if(process.env.VINPOKER_CORRECTION_BROWSER==='1')correctionBridge=await createMultiDayCorrectionBrowser({sql,actor,event:d2Event,club:fixture.club,tour:fixture.tour,log});
  const session = () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const unsigned = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url') + '.'
      + Buffer.from(JSON.stringify({ sub: actor, aud: 'authenticated', role: 'authenticated', exp, iat: exp - 3600,
        iss: 'http://127.0.0.1:54329/auth/v1' })).toString('base64url');
    const access_token = `${unsigned}.${createHmac('sha256', signingKey).update(unsigned).digest('base64url')}`;
    const value = { access_token, refresh_token: randomUUID(), token_type: 'bearer', expires_in: 3600, expires_at: exp, user };
    sessions.set(access_token, value); return value;
  };
  if(process.env.VINPOKER_TV166_BROWSER==='1'){
    assert.ok(sidepotScope);tv166Bridge=createTvProjection166Browser({sql,log});
  }
  if(process.env.VINPOKER_TERMINAL_TV219_BROWSER==='1'){
    assert.ok(linkedD2&&!sidepotScope&&!tv166Bridge);
    tv166Bridge=createTvProjection166Browser({sql,log,terminal219:true,hangFirstFlightA851:process.env.VINPOKER_TV851_HANG_FIRST==='1'});
  }
  if(process.env.VINPOKER_MAIN167_DESIGN==='1'){
    assert.ok(sidepotScope&&!tv166Bridge);main167Bridge=createMainEvent167Design({sql,actor,club:fixture.club,log});
  }
  if(existingEventFlight)main167Bridge=createMainEvent167Design({sql,actor,club:fixture.club,log,lifecycleFlight:existingEventFlight,
    qualification:process.env.VINPOKER_LINKED_QUALIFICATION183==='1'});
  if(linkedD2&&!stakingBuyer)main167Bridge=createMainEvent167Design({sql,actor,club:fixture.club,log,lifecycleFlight:fixture.final,qualification:true,finalLifecycle:true});
  let payoutRead262Fault=process.env.VINPOKER_PAYOUT_READ_503_ONCE==='1';
  if(payoutRead262Fault)assert.ok(linkedD2&&fixture.tour==='4cd3af4d-7e1d-4042-855f-04fb6777e580','read fault requires exact retained Main167');
  if(process.env.VINPOKER_FNB341_BROWSER==='1'){assert.ok(linkedD2);fnb341Bridge=createFnb341Browser({sql,log,
    name:process.env.VINPOKER_FNB350_BROWSER==='1'?'TEST350':process.env.VINPOKER_FNB349_BROWSER==='1'?'TEST349':process.env.VINPOKER_FNB342_BROWSER==='1'?'TEST342':'TEST341',
    fault:process.env.VINPOKER_FNB350_BROWSER==='1'?'none':process.env.VINPOKER_FNB349_BROWSER==='1'?'before503':process.env.VINPOKER_FNB342_BROWSER==='1'?'503':'disconnect',readOnly:process.env.VINPOKER_FNB343_READONLY==='1'});}
  server = createServer(async (req, res) => {
    const localRequestStart=performance.now();
    const origin = req.headers.origin;
    if ((origin && origin !== 'http://127.0.0.1:5188') || req.headers.host !== '127.0.0.1:54329') {
      res.writeHead(403); res.end(); return;
    }
    res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:5188');
    res.setHeader('Access-Control-Allow-Headers', 'authorization,apikey,content-type,x-client-info,x-supabase-api-version,prefer,accept-profile,content-profile,x-upsert,cache-control');
    res.setHeader('Access-Control-Allow-Methods', payout379ReadOnly||single699Payout?'GET,HEAD,POST,OPTIONS':'GET,POST,PATCH,OPTIONS');
    if(notificationReadOnly||payout379ReadOnly||single699Payout)res.setHeader('Access-Control-Expose-Headers','Content-Range');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    const send = (status, value) => { res.writeHead(status); res.end(JSON.stringify(value)); };
    try {
      const url = new URL(req.url, 'http://127.0.0.1:54329');
      if(process.env.VINPOKER_LOCAL_RPC_TIMING==='1'&&req.method==='POST'){
        const timedRpc=url.pathname.match(/^\/rest\/v1\/rpc\/([a-z0-9_]+)$/)?.[1];
        if(timedRpc)res.once('finish',()=>log.push({localRpcTiming:true,rpc:timedRpc,
          elapsed_ms:Math.round((performance.now()-localRequestStart)*1000)/1000,status:res.statusCode}));
      }
      if(url.pathname==='/__local/fnb341-manifest'&&req.method==='GET'){assert.ok(fnb341Bridge);send(200,fnb341Bridge.manifest);return;}
      if(url.pathname==='/__local/tv166-manifest'&&req.method==='GET'){
        assert.ok(tv166Bridge);send(200,tv166Bridge.manifest);return;
      }
      if(url.pathname==='/__local/edit-manifest'&&req.method==='GET'){
        assert.ok(editCanary);send(200,{runId,tour:editCanary,club:fixture.club,actor,email,model:'LOCAL_AUTH_MODEL_REAL_PG_RPC_EDIT_CANARY'});return;
      }
      if (url.pathname === '/__local/manifest' && req.method === 'GET') {
        if(single706Payroll){send(200,{runId,tour:fixture.tour,club:fixture.club,actor,email,payroll:{dealer:'e6420000-0000-4000-8000-000000000001',year:2026,month:10},model:'LOCAL_AUTH_MODEL_ACTUAL_ORIGINAL_SINGLE244_READONLY_PAYROLL_NO_FINALIZATION'});return;}
        if(payout704Bridge){send(200,{runId,tour:payout704Bridge.tour,club:payout704Bridge.club,actor,email,payoutManual:true,model:'LOCAL_AUTH_MODEL_NATIVE_MANUAL_PAYOUT_SYNTHETIC_CANARY_NO_PAYMENTS'});return;}
        if(bag630Bridge){send(200,{runId,tour:fixture.tour,club:fixture.club,actor,email,bag616:{...bag630Bridge.manifest,rollbackOnly:true},model:'LOCAL_AUTH_MODEL_NATIVE_BAG_ROLLBACK'});return;}
        if(bag616Proof){send(200,{runId,tour:fixture.tour,club:fixture.club,actor,email,bag616:{tour:'46cab483-91e7-4220-aacf-e17bdf05269c',club:fixture.club},model:'LOCAL_AUTH_MODEL_NATIVE_BAG_READONLY'});return;}
        if(coupling613Bridge){send(200,{runId,tour:fixture.tour,club:fixture.club,actor,email,colorUp613:coupling613Bridge.manifest,model:'LOCAL_AUTH_MODEL_NATIVE_COUPLING_ROLLBACK'});return;}
        if(sepay608Bridge){send(200,{runId,tour:fixture.tour,club:fixture.club,actor,email,sepay608:sepay608Bridge.manifest,model:'LOCAL_AUTH_MODEL_NATIVE_SEPAY_ROLLBACK'});return;}
        if(funding560Bridge){send(200,{runId,tour:fixture.tour,club:fixture.club,actor,email,funding560:funding560Bridge.manifest,model:'LOCAL_AUTH_MODEL_NATIVE_FUNDING_ROLLBACK'});return;}
        if(refund538Bridge){send(200,{runId,tour:fixture.tour,club:fixture.club,actor,email,refund538:refund538Bridge.manifest,model:'LOCAL_AUTH_MODEL_NATIVE_REFUND_ROLLBACK'});return;}
        if(payout379Bridge){send(200,{runId,tour:fixture.tour,club:fixture.club,actor,email,singleTour:fixture.tour,payoutReadOnly:true,model:'LOCAL_AUTH_MODEL_REAL_AUTHENTICATED_PG_READ_ONLY'});return;}
        if(single699Bridge){send(200,{runId,tour:fixture.tour,club:fixture.club,actor,email,singleTour:fixture.tour,payoutJourney:true,payoutRecovery:payout700Recovery,model:'LOCAL_AUTH_MODEL_ACTUAL_EDGE_ENGINE_NATIVE_PAYOUT_APPLY_ONLY_NO_PAYMENTS'});return;}
        if(feed288Bridge){send(200,{runId,tour:fixture.tour,club:fixture.club,actor,email,historyTable:{id:handCorrectionScope.table},model:'ANON_REAL_PG_ROLLBACK_ONLY'});return;}
        if(clean244TvAssets){send(200,{runId,tour:fixture.tour,club:fixture.club,actor,email,singleTour:fixture.tour,tvAssets:true,model:'LOCAL_AUTH_MODEL_REAL_PG_STORAGE_RLS_AND_LAYOUT_BLOB_PROVIDER_MODEL'});return;}
        if(clean244Dealer){send(200,{runId,tour:fixture.tour,club:fixture.club,actor,email,singleTour:fixture.tour,dealerPhone:true,model:'LOCAL_AUTH_MODEL_REAL_PG_SAME_SINGLE_DAY_DEALER_CHECKIN'});return;}
        if(existingEventFlight){send(200,{runId,tour:fixture.tour,club:fixture.club,actor,email,singleTour:fixture.tour,linkedMainEvent:fixture.event,historyTable,model:'LOCAL_AUTH_MODEL_REAL_PG_LINKED_FLIGHT'});return;}
        if(linkedD2){send(200,{runId,tour:fixture.tour,club:fixture.club,actor,email,d2Event,historyTable,payroll:payrollBridge?.manifest??null,staking:stakingBridge?.manifest??null,model:'LOCAL_LINKED_D2_TRANSIENT_RELEASE_SCOPE_REAL_PG'});return;}
        if(main167Bridge){send(200,{runId,tour:fixture.tour,club:fixture.club,actor,email,mainEventDesign:main167Bridge.event,model:'LOCAL_TRANSIENT_RELEASE_SCOPE_REAL_PG'});return;}
        if(handCorrectionBridge){send(200,{runId,tour:fixture.tour,club:fixture.club,actor,email,correctionHand:handCorrectionScope.hand,
          historyTable:{id:handCorrectionScope.table},model:'LOCAL_AUTH_MODEL_REAL_PG_RPC'});return;}
        if(floorAlertBridge){send(200,{runId,tour:fixture.tour,club:fixture.club,actor,email,floorAlert:floorAlertBridge.manifest,model:'LOCAL_AUTH_MODEL_REAL_PG_RPC_ROLLBACK'});return;}
        if(tvEditorTour){send(200,{runId,tour:fixture.tour,club:fixture.club,actor,email,tvEditor:true,model:'LOCAL_AUTH_MODEL_REAL_PG_RPC'});return;}
        send(200, { runId, tour: fixture.tour, club: fixture.club, actor, email, registrationReplay, dealerPlan:dealerBridge?.manifest??null, finalizationRecovery, qualificationRecovery, continueRecovery, rulesRecovery, correctionBrowser:!!correctionBridge, correctionPayment:correctionBridge?.manifest??null, memberReceipt:memberReceipt?{registration:memberReceipt.registration}:null, payroll:payrollBridge?.manifest??null, groupInvite:inviteBridge?.manifest??null, staking:stakingBridge?.manifest??null, reentry:!!reentryPlayer, singleTour:singleTour??null, d2Event:singleTour?null:d2Event??null, baggingFlight:baggingFlight??null, historyTable, model: 'LOCAL_AUTH_MODEL_REAL_PG_RPC' }); return;
      }
      if (url.pathname === '/__local/evidence' && req.method === 'GET') {
        send(200, { runId, tour: fixture.tour, log, direct275:direct275Bridge?.evidence()??null, payroll:payrollBridge?.evidence()??null, groupInvite:inviteBridge?.evidence()??null, staking:stakingBridge?.evidence()??null, payments: JSON.parse(sql(`SELECT coalesce(jsonb_agg(jsonb_build_object('place',finished_place,'amount',prize_amount,'recipient',recipient_ref)), '[]'::jsonb) FROM public.tournament_prize_payments WHERE tournament_id='${fixture.tour}';`)) }); return;
      }
      if(refund538Bridge&&url.pathname==='/__local/refund538-release'&&req.method==='POST'){refund538Bridge.release();send(200,{released:true});return;}
      if(tv258Bridge&&req.method==='GET'&&url.pathname.startsWith('/storage/v1/object/public/backing-proofs/')){
        const path=decodeURIComponent(url.pathname.slice('/storage/v1/object/public/backing-proofs/'.length));
        const image=tv258Bridge.publicImage(path);
        if(!image){send(404,{message:'LOCAL_TV258_OBJECT_NOT_FOUND'});return;}
        res.writeHead(200,{'Content-Type':image.mimetype});res.end(image.bytes);return;
      }
      if(tv258Bridge&&req.method==='POST'&&url.pathname.startsWith('/storage/v1/object/backing-proofs/')){
        const bearer=String(req.headers.authorization??'').replace(/^Bearer /i,'');
        if(!sessions.has(bearer)){send(401,{message:'LOCAL_AUTH_REQUIRED'});return;}
        const path=decodeURIComponent(url.pathname.slice('/storage/v1/object/backing-proofs/'.length));
        send(200,await tv258Bridge.upload(req,path));return;
      }
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (raw.length > 16384) throw new Error('body_too_large'); }
      const body = raw ? JSON.parse(raw) : {};
      if(floor791Bridge&&!['/auth/v1/token','/auth/v1/logout'].includes(url.pathname)){
        const bearer=String(req.headers.authorization??'').replace(/^Bearer /i,'');
        if(!sessions.has(bearer)){send(401,{message:'LOCAL_AUTH_REQUIRED'});return;}
        const result=floor791Bridge.handle(url,req.method,body);
        if(result?.hold){
          const held={response:res,shutdown:false};hangingReads.add(held);
          res.once('close',()=>{hangingReads.delete(held);log.push({floor793:held.shutdown?'server_shutdown':'client_aborted_held_list',mutation:false});});return;
        }
        if(result){send(result.status,result.value);return;}
        if(!['GET','HEAD'].includes(req.method)){send(403,{message:'LOCAL_FLOOR791_READ_ONLY'});return;}
      }
      if(single679Read&&!['GET','HEAD'].includes(req.method)
        &&!['/auth/v1/token','/auth/v1/logout'].includes(url.pathname)
        &&!/^\/rest\/v1\/rpc\/(get_public_tournament_table_history_v2|get_public_tournament_table_hand_v2|get_public_tournament_table_live_or_last_hand_v2|get_public_tournament_hand_v2|get_public_tournament_hand_detail_v1|get_public_tournament_live_hand|get_public_tournament_settlement|get_public_tournament_clock_summary|get_public_tournament_results|get_tournament_clock|get_public_tournament_registration_summary_v1|get_public_tournament_hand_catalog_v2)$/.test(url.pathname)){
        const hasLocalSession=sessions.has(String(req.headers.authorization||'').replace(/^Bearer /i,''));
        send(hasLocalSession?403:401,{message:'LOCAL_SINGLE679_HISTORY_READ_ONLY'});return;
      }
      if(bag630Bridge){
        const bearer=String(req.headers.authorization??'').replace(/^Bearer /i,'');
        if(bag630Bridge.paths.includes(url.pathname)){
          if(!sessions.has(bearer)){send(401,{message:'LOCAL_AUTH_REQUIRED'});return;}
          const result=await bag630Bridge.route(url,req.method,body);send(result.status,result.value);return;
        }
        if(!['GET','HEAD'].includes(req.method)&&!['/auth/v1/token','/auth/v1/logout'].includes(url.pathname)){
          send(sessions.has(bearer)?403:401,{message:'LOCAL630_EXACT_BAG_ROLLBACK_ONLY'});return;
        }
      }
      if(bag616Proof){
        const bearer=String(req.headers.authorization??'').replace(/^Bearer /i,'');
        if(url.pathname==='/rest/v1/rpc/get_bag_tag_state'){
          if(!sessions.has(bearer)){send(401,{message:'LOCAL_AUTH_REQUIRED'});return;}
          assert.equal(req.method,'POST');assert.deepEqual(Object.keys(body).sort(),['p_tournament_id','p_day_number'].sort());
          assert.equal(body.p_tournament_id,'46cab483-91e7-4220-aacf-e17bdf05269c');assert.ok([1,2].includes(body.p_day_number));
          const result=query(`SELECT public.get_bag_tag_state('${body.p_tournament_id}',${body.p_day_number});`);
          log.push({bag616:'native_read',day:body.p_day_number,players:result.players?.length,locked:result.day?.status});
          if(bag616Fault){bag616Fault=false;send(503,{message:'LOCAL616_READ_UNAVAILABLE'});return;}
          send(200,result);return;
        }
        if(!['GET','HEAD'].includes(req.method)&&!['/auth/v1/token','/auth/v1/logout'].includes(url.pathname)){
          log.push({bag616:'denied_write',path:url.pathname});send(sessions.has(bearer)?403:401,{message:'LOCAL616_BAG_READONLY'});return;
        }
      }
      if(coupling613Bridge){
        const bearer=String(req.headers.authorization??'').replace(/^Bearer /i,'');
        if(coupling613Bridge.paths.includes(url.pathname)){
          if(!sessions.has(bearer)){send(401,{message:'LOCAL_AUTH_REQUIRED'});return;}
          const result=await coupling613Bridge.route(url,req.method,body);send(result.status,result.value);return;
        }
        if(!['GET','HEAD'].includes(req.method)&&!['/auth/v1/token','/auth/v1/logout'].includes(url.pathname)){
          send(sessions.has(bearer)?403:401,{message:'LOCAL613_EXACT_COUPLING_ROLLBACK_ONLY'});return;
        }
      }
      if(sepay608Bridge){
        const authPath=['/auth/v1/token','/auth/v1/logout'].includes(url.pathname);
        const bearer=String(req.headers.authorization??'').replace(/^Bearer /i,'');
        if(['/rest/v1/rpc/sepay_cashier_settlement_worklist','/rest/v1/rpc/cashier_sepay_intent_v1'].includes(url.pathname)){
          if(!sessions.has(bearer)){send(401,{message:'LOCAL_AUTH_REQUIRED'});return;}
          const result=await sepay608Bridge.route(url,req.method,body);send(result.status,result.value);return;
        }
        if(!['GET','HEAD'].includes(req.method)&&!authPath){send(sessions.has(bearer)?403:401,{message:'LOCAL608_EXACT_SEPAY_ROLLBACK_ONLY'});return;}
      }
      if(process.env.VINPOKER_FINANCE583_READONLY==='1'){
        assert.ok(linkedD2&&!sidepotScope&&!stream579Bridge);
        const bearer=String(req.headers.authorization??'').replace(/^Bearer /i,'');
        if(ops601?.accepts(url,req.method)){
          if(!sessions.has(bearer)){send(401,{message:'LOCAL_AUTH_REQUIRED'});return;}
          const result=ops601.handle(url,req.method,body);
          if(result){send(200,result.value);return;}
        }
        const financeScopeRpc=url.pathname.match(/^\/rest\/v1\/rpc\/(get_my_ops_capability_scope|get_my_ops_global_capability)$/)?.[1];
        if(financeScopeRpc&&req.method==='POST'){
          if(!sessions.has(bearer)){send(401,{message:'LOCAL_AUTH_REQUIRED'});return;}
          assert.deepEqual(body,{});
          const value=query(`SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM(SELECT * FROM public.${financeScopeRpc}()) t;`);
          log.push({finance588:'scope_read',rpc:financeScopeRpc});send(200,value);return;
        }
        if(url.pathname==='/rest/v1/clubs'&&req.method==='GET'&&url.searchParams.get('select')==='id,name'){
          if(!sessions.has(bearer)){send(401,{message:'LOCAL_AUTH_REQUIRED'});return;}
          assert.equal(url.searchParams.get('id'),`in.(${fixture.club})`);
          send(200,query(`SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM(SELECT id,name FROM public.clubs WHERE id='${fixture.club}') t;`));return;
        }
        if(url.pathname==='/rest/v1/rpc/get_club_finance_summary'&&req.method==='POST'){
          if(!sessions.has(bearer)){send(401,{message:'LOCAL_AUTH_REQUIRED'});return;}
          assert.deepEqual(Object.keys(body).sort(),['p_from','p_to','p_club_id'].sort());
          assert.equal(body.p_club_id,fixture.club);
          for(const value of [body.p_from,body.p_to])assert.match(value,/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
          assert.ok(Date.parse(body.p_from)<=Date.parse(body.p_to));
          const value=query(`SELECT public.get_club_finance_summary('${body.p_from}'::timestamptz,'${body.p_to}'::timestamptz,'${fixture.club}'::uuid);`);
          log.push({finance588:'native_asof_read',from:body.p_from,to:body.p_to,club:body.p_club_id,net:value.net});
          if(finance584Failures>0){finance584Failures-=1;log.push({finance584:'503_after_native_read',mutation:false});send(503,{message:'LOCAL584_FINANCE_READ_UNAVAILABLE'});return;}
          send(200,value);return;
        }
        if(url.pathname==='/rest/v1/rpc/get_club_finance_summary_v2'&&req.method==='POST'){
          if(!sessions.has(bearer)){send(401,{message:'LOCAL_AUTH_REQUIRED'});return;}
          assert.deepEqual(Object.keys(body).sort(),['p_from_date','p_to_date','p_club_id'].sort());
          assert.match(body.p_from_date,/^\d{4}-\d{2}-\d{2}$/);assert.match(body.p_to_date,/^\d{4}-\d{2}-\d{2}$/);
          assert.ok(body.p_club_id===null||body.p_club_id===fixture.club,'finance read is limited to retained Main club');
          const clubArgument=body.p_club_id===null?'NULL':`'${fixture.club}'::uuid`;
          const value=query(`SELECT public.get_club_finance_summary_v2('${body.p_from_date}'::date,'${body.p_to_date}'::date,${clubArgument});`);
          log.push({finance583:'native_read',from:body.p_from_date,to:body.p_to_date,club:body.p_club_id,net:value.net,zone:value.timeZone});
          if(finance584Failures>0){finance584Failures-=1;log.push({finance584:'503_after_native_read',mutation:false});send(503,{message:'LOCAL584_FINANCE_READ_UNAVAILABLE'});return;}
          send(200,value);return;
        }
        const authPath=['/auth/v1/token','/auth/v1/logout'].includes(url.pathname);
        const scopeRead=['/rest/v1/rpc/get_my_floor_operator_scope','/rest/v1/rpc/dealer_control_club_ids'].includes(url.pathname);
        if(!['GET','HEAD'].includes(req.method)&&!authPath&&!scopeRead){send(sessions.has(bearer)?403:401,{message:'LOCAL_FINANCE583_READ_ONLY'});return;}
      }
      if(stream579Bridge){
        const authPath=['/auth/v1/token','/auth/v1/logout'].includes(url.pathname);
        const bearer=String(req.headers.authorization??'').replace(/^Bearer /i,'');
        if(['/rest/v1/tournaments','/rest/v1/clubs','/rest/v1/tournament_streams'].includes(url.pathname)){
          if(!sessions.has(bearer)){send(401,{message:'LOCAL_AUTH_REQUIRED'});return;}
          const result=stream579Bridge.handle(url,req.method,body);send(result.status,result.value);return;
        }
        const scopeRead=['/rest/v1/rpc/get_my_floor_operator_scope','/rest/v1/rpc/dealer_control_club_ids'].includes(url.pathname);
        if(!['GET','HEAD'].includes(req.method)&&!authPath&&!scopeRead){send(sessions.has(bearer)?403:401,{message:'LOCAL579_STREAM_ONLY'});return;}
      }
      if(fnb731Bridge){
        const bearer=String(req.headers.authorization??'').replace(/^Bearer /i,'');
        if(fnb731Bridge.matches(url)){
          if(!sessions.has(bearer)){send(401,{message:'LOCAL_AUTH_REQUIRED'});return;}
          const result=fnb731Bridge.handle(url,req.method,body);send(result.status??200,result.value);return;
        }
        const authPath=['/auth/v1/token','/auth/v1/logout'].includes(url.pathname);
        const scopeRead=['/rest/v1/rpc/has_role','/rest/v1/rpc/get_user_club_roles','/rest/v1/rpc/get_my_floor_operator_scope','/rest/v1/rpc/dealer_control_club_ids'].includes(url.pathname);
        if(!['GET','HEAD'].includes(req.method)&&!authPath&&!scopeRead){send(sessions.has(bearer)?403:401,{message:'LOCAL_FNB731_EXACT_SCOPE_ONLY'});return;}
      }
      if(fnb384Bridge){
        const authPath=['/auth/v1/token','/auth/v1/logout'].includes(url.pathname);
        const bearer=String(req.headers.authorization??'').replace(/^Bearer /i,'');
        if(fnb384Bridge.paths.includes(url.pathname)){
          if(!sessions.has(bearer)){send(401,{message:'LOCAL_AUTH_REQUIRED'});return;}
          const result=fnb384Bridge.handle(url,req.method,body);send(result.status??200,result.value);return;
        }
        if(!['GET','HEAD'].includes(req.method)&&!authPath){send(sessions.has(bearer)?403:401,{message:'LOCAL_FNB384_EXACT_SHIPPING_ONLY'});return;}
      }
      if(payout704Bridge){
        const authPath=['/auth/v1/token','/auth/v1/logout'].includes(url.pathname);
        if(!authPath&&(payout704Bridge.paths.includes(url.pathname)||!['GET','HEAD'].includes(req.method))){
          const bearer=String(req.headers.authorization??'').replace(/^Bearer /i,'');
          if(!sessions.has(bearer)){send(401,{message:'LOCAL_AUTH_REQUIRED'});return;}
          if(payout704Bridge.paths.includes(url.pathname)){payout704Bridge.handle(url,req.method,body,res,send);return;}
          send(403,{message:'LOCAL704_MANUAL_ONLY_NO_PAYMENTS'});return;
        }
      }
      if(single699Bridge){
        const authPath=['/auth/v1/token','/auth/v1/logout'].includes(url.pathname);
        const payoutPath=['/rest/v1/rpc/prepare_payout_snapshot','/rest/v1/rpc/get_tournament_prizes','/rest/v1/rpc/get_tournament_payout_recipients','/functions/v1/compute-payouts',
          '/rest/v1/tournaments','/rest/v1/tournament_payout_runs','/rest/v1/tournament_entries'].includes(url.pathname);
        if(!authPath&&(payoutPath||!['GET','HEAD'].includes(req.method))){
          const bearer=String(req.headers.authorization??'').replace(/^Bearer /i,'');
          if(!sessions.has(bearer)){send(401,{message:'LOCAL_AUTH_REQUIRED'});return;}
          if(payoutPath&&await single699Bridge.handle(url,req.method,body,res,send))return;
          send(403,{message:'LOCAL_SINGLE699_PAYOUT_ONLY_NO_PAYMENTS'});return;
        }
      }
      if(payout379Bridge){
        const authPath=['/auth/v1/token','/auth/v1/logout'].includes(url.pathname);
        const operatorRead=process.env.VINPOKER_OPERATOR382_READ==='1'&&['/rest/v1/rpc/get_my_floor_operator_scope','/rest/v1/rpc/dealer_control_club_ids'].includes(url.pathname);
        const prizes=url.pathname==='/rest/v1/rpc/get_tournament_prizes';
        if(!['GET','HEAD'].includes(req.method)&&!authPath&&!prizes&&!operatorRead){
          const bearer=String(req.headers.authorization??'').replace(/^Bearer /i,'');
          send(sessions.has(bearer)?403:401,{message:'LOCAL_PAYOUT379_READ_ONLY'});return;
        }
        if(operatorRead||prizes||['/rest/v1/tournaments','/rest/v1/tournament_payout_runs','/rest/v1/tournament_entries','/rest/v1/payout_templates'].includes(url.pathname)){
          const bearer=String(req.headers.authorization??'').replace(/^Bearer /i,'');
          if(!sessions.has(bearer)){send(401,{message:'LOCAL_AUTH_REQUIRED'});return;}
          if(payout379Bridge.handle(url,req.method,body,res,send))return;
          send(403,{message:'LOCAL_PAYOUT379_UNSUPPORTED_READ'});return;
        }
      }
      if(detail367ReadOnly){
        const tour='c367013a-3ed3-48af-ad48-3915acadc50e';
        const anon=statement=>JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claim.role='anon';SET LOCAL request.jwt.claim.sub='';SET LOCAL request.jwt.claims='{"role":"anon"}';SET LOCAL ROLE anon;${statement}COMMIT;`));
        if(req.method==='POST'&&url.pathname==='/rest/v1/rpc/get_public_tournament_registration_summary_v1'){
          assert.deepEqual(body,{p_tournament_id:tour});
          if(detail367CountFault){log.push({test:'DETAIL367_COUNT_503',mutation:false});send(503,{message:'LOCAL_DETAIL367_COUNT_UNAVAILABLE'});return;}
          const value=anon(`SELECT public.get_public_tournament_registration_summary_v1('${tour}');`);
          log.push({test:'DETAIL367_PUBLIC_AGGREGATE',count:value.registration_count,mutation:false});send(200,value);return;
        }
        if(!['GET','HEAD'].includes(req.method)){send(401,{message:'LOCAL_DETAIL367_READ_ONLY'});return;}
        if(url.pathname==='/rest/v1/tournaments'){
          assert.equal(url.searchParams.get('id'),`eq.${tour}`);
          assert.equal(url.searchParams.get('select'),'*,club:clubs(id,name,region,address)');
          const value=anon(`SELECT coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('club',(SELECT jsonb_build_object('id',c.id,'name',c.name,'region',c.region,'address',c.address) FROM public.clubs c WHERE c.id=t.club_id))),'[]'::jsonb) FROM public.tournaments t WHERE t.id='${tour}' AND t.deleted_at IS NULL;`);
          log.push({test:'DETAIL367_PUBLIC_TOUR',rows:value.length,mutation:false});send(200,value);return;
        }
        if(url.pathname==='/rest/v1/tournament_streams'){
          assert.equal(url.searchParams.get('tournament_id'),`eq.${tour}`);
          send(200,anon(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'platform',platform,'stream_url',stream_url,'title',title,'is_live',is_live)),'[]'::jsonb) FROM public.tournament_streams WHERE tournament_id='${tour}';`));return;
        }
      }
      if(fnb341Bridge&&url.pathname.startsWith('/rest/v1/rpc/fnb_guest_')){
        const result=fnb341Bridge.handle({url,method:req.method,body});
        if(result.drop)res.destroy();else send(result.status??200,result.value);return;
      }
      if(memberStacks323&&!['GET','HEAD'].includes(req.method)&&!['/auth/v1/token','/auth/v1/logout'].includes(url.pathname)){
        send(401,{code:'LOCAL_MEMBER323_READ_ONLY'});return;
      }
      if((sepayWrite303||sepayWrite306)&&req.method==='POST'&&!['/auth/v1/token','/auth/v1/logout','/rest/v1/rpc/sepay_cashier_settlement_worklist','/rest/v1/rpc/cashier_sepay_intent_v1'].includes(url.pathname)){
        send(401,{code:'LOCAL_SEPAY303_ONLY'});return;
      }
      if((sepay303Bridge||sepay306Bridge)&&req.method==='POST'&&['/rest/v1/rpc/sepay_cashier_settlement_worklist','/rest/v1/rpc/cashier_sepay_intent_v1'].includes(url.pathname)){
        const bearer=String(req.headers.authorization??'').replace(/^Bearer /i,'');
        if(!sessions.has(bearer)){send(401,{code:'LOCAL_AUTH_REQUIRED'});return;}
        const result=(sepay303Bridge??sepay306Bridge).handle(url.pathname,body);send(result.status,result.value);return;
      }
      if(sepayRead292&&req.method==='POST'&&['/rest/v1/rpc/manual_confirm_bank_transaction','/rest/v1/rpc/ignore_bank_transaction','/rest/v1/rpc/cashier_sepay_intent_v1'].includes(url.pathname)){send(401,{code:'LOCAL_SEPAY292_READ_ONLY'});return;}
      if(sepayRead292&&req.method==='POST'&&url.pathname==='/rest/v1/rpc/sepay_cashier_settlement_worklist'){
        const bearer=String(req.headers.authorization??'').replace(/^Bearer /i,'');
        if(!sessions.has(bearer)){send(401,{code:'LOCAL_AUTH_REQUIRED'});return;}
        assert.deepEqual(Object.keys(body).sort(),['p_limit','p_scope']);assert.ok(['actionable','resolved'].includes(body.p_scope));assert.equal(body.p_limit,200);
        if(sepayReadFault292){sepayReadFault292=false;log.push({rpc:'sepay_cashier_settlement_worklist',fault:'LOCAL_SEPAY292_503',mutation:false});send(503,{message:'LOCAL_WORKLIST_UNAVAILABLE'});return;}
        const value=query(`SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) FROM public.sepay_cashier_settlement_worklist('${body.p_scope}',200) r;`);
        log.push({rpc:'sepay_cashier_settlement_worklist',rows:value.length,mutation:false});send(200,value);return;
      }
      if(feedRead291&&!(req.method==='POST'&&['/rest/v1/rpc/get_public_tournament_hand_catalog_v2','/rest/v1/rpc/get_public_tournament_hand_v2','/rest/v1/rpc/get_public_tournament_settlement'].includes(url.pathname))){send(401,{code:'LOCAL_FEED291_ANON_READ_ONLY'});return;}
      if(feed288Bridge){const result=await feed288Bridge.handle(url,req.method,body);send(result.status,result.value);return;}
      if(tv166Bridge&&req.method==='POST'){
        if(url.pathname==='/rest/v1/rpc/get_tv_display_state_v4'){
          const value=tv166Bridge.read(body);
          if(tv166Bridge.holdResponse851(body)){
            log.push({rpc:'get_tv_display_state_v4',fault:'LOCAL_TV851_RESPONSE_HELD_AFTER_NATIVE_READ'});
            const held={response:res,shutdown:false};hangingReads.add(held);
            res.once('close',()=>{hangingReads.delete(held);log.push({rpc:'get_tv_display_state_v4',fault851ClientClosed:!held.shutdown});});
            return;
          }
          send(200,value);return;
        }
        if(process.env.VINPOKER_TERMINAL_TV219_BROWSER==='1'&&['/rest/v1/rpc/get_public_tournament_results','/rest/v1/rpc/get_public_tournament_clock_summary'].includes(url.pathname)){
          assert.deepEqual(Object.keys(body),['p_tournament_id']);assert.equal(body.p_tournament_id,fixture.tour);
          const name=url.pathname.split('/').at(-1);
          const value=JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claims='{"role":"anon"}';SET LOCAL ROLE anon;
            SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM public.${name}('${fixture.tour}') t;COMMIT;`));
          log.push({rpc:name,role:'anon',rows:value.length});send(200,value);return;
        }
        send(401,{message:'LOCAL_TV166_READ_ONLY'});return;
      }
      if(dealerScope&&req.method!=='GET'&&!['/auth/v1/token','/auth/v1/logout',
        '/rest/v1/rpc/operator_plan_next_dealer_v1','/rest/v1/rpc/get_dealer_next_intent_receipt_v1',
        '/rest/v1/rpc/operator_perform_swing_v2','/rest/v1/rpc/get_dealer_manual_swing_receipt_v1','/rest/v1/rpc/cancel_dealer_manual_swing_v1',
        '/rest/v1/rpc/operator_close_club_table_v2'].includes(url.pathname)){send(401,{message:'LOCAL_DEALER_CANARY_ONLY'});return;}
      if(chipMetadataTour&&req.method!=='GET'&&!['/auth/v1/token','/auth/v1/logout','/__local/drop-next',
        '/rest/v1/rpc/get_current_chip_inventory','/rest/v1/rpc/get_issued_chip_inventory','/rest/v1/rpc/get_chip_bank',
        '/rest/v1/rpc/get_chip_issuance_state_v1','/rest/v1/rpc/get_tournament_participation_counts_v1',
        '/rest/v1/rpc/chip_ops_apply_setup_metadata_v1','/rest/v1/rpc/get_chip_setup_metadata_receipt_v1','/rest/v1/rpc/cancel_chip_setup_metadata_v1'].includes(url.pathname)){
        send(401,{message:'LOCAL_METADATA_RECOVERY_ONLY'});return;
      }
      if(chipTemplateTour&&req.method!=='GET'&&!['/auth/v1/token','/auth/v1/logout','/__local/drop-next',
        '/rest/v1/rpc/get_current_chip_inventory','/rest/v1/rpc/get_issued_chip_inventory','/rest/v1/rpc/get_chip_bank',
        '/rest/v1/rpc/get_chip_issuance_state_v1','/rest/v1/rpc/get_tournament_participation_counts_v1',
        '/rest/v1/rpc/chip_ops_save_stack_template_v2','/rest/v1/rpc/get_chip_template_save_receipt_v1','/rest/v1/rpc/cancel_chip_template_save_v1'].includes(url.pathname)){
        send(401,{message:'LOCAL_TEMPLATE_RECOVERY_ONLY'});return;
      }
      if(correctionBridge&&req.method!=='GET'&&!['/auth/v1/token','/auth/v1/logout',
        '/rest/v1/rpc/multi_day_floor_read_v1','/rest/v1/rpc/multi_day_qualification_preview_v1','/rest/v1/rpc/multi_day_payout_postfinal_state_v1',
        '/rest/v1/rpc/multi_day_request_payout_correction_v1','/rest/v1/rpc/multi_day_approve_payout_correction_v1',
        ...(process.env.VINPOKER_PAYMENT461_BROWSER==='1'?['/rest/v1/rpc/get_tournament_payout_recipients','/rest/v1/rpc/record_multi_day_prize_payment_v1','/rest/v1/rpc/get_tournament_prize_payment_receipt_v2']:[])].includes(url.pathname)){
        send(401,{message:'LOCAL_CORRECTION_TRANSACTION_ONLY'});return;
      }
      if(rulesRecovery&&req.method!=='GET'&&!['/auth/v1/token','/auth/v1/logout',
        '/rest/v1/rpc/multi_day_floor_read_v1','/rest/v1/rpc/multi_day_qualification_preview_v1',
        '/rest/v1/rpc/multi_day_payout_postfinal_state_v1','/rest/v1/rpc/multi_day_final_roster_v1',
        '/rest/v1/rpc/get_public_tournament_redraw_v1','/rest/v1/rpc/multi_day_set_qualification_rules_v2'].includes(url.pathname)){
        send(401,{message:'LOCAL_RULES_REPLAY_ONLY'});return;
      }
      if(continueRecovery&&req.method!=='GET'&&!['/auth/v1/token','/auth/v1/logout',
        '/rest/v1/rpc/get_public_tournament_redraw_v1','/rest/v1/rpc/floor_continue_tournament_redraw_v1'].includes(url.pathname)){
        send(401,{message:'LOCAL_CONTINUE_RECEIPT_REPLAY_ONLY'});return;
      }
      if((finalizationRecovery||qualificationRecovery)&&req.method!=='GET'&&![
        '/auth/v1/token','/auth/v1/logout','/rest/v1/rpc/multi_day_floor_read_v1','/rest/v1/rpc/multi_day_qualification_preview_v1',
        '/rest/v1/rpc/multi_day_payout_preview_v1','/rest/v1/rpc/multi_day_payout_postfinal_state_v1',
        '/rest/v1/rpc/multi_day_final_roster_v1',
        finalizationRecovery?'/rest/v1/rpc/multi_day_finalize_payout_v1':'/rest/v1/rpc/multi_day_lock_qualification_v1',
      ].includes(url.pathname)){send(401,{message:'LOCAL_FINALIZATION_RECEIPT_REPLAY_ONLY'});return;}
      if(historyReadOnly&&req.method!=='GET'&&!(inboxDmFixture&&req.method==='PATCH'&&url.pathname==='/rest/v1/direct_chats')&&!(dm275Send&&req.method==='POST'&&url.pathname==='/rest/v1/direct_messages')&&!(req.method==='POST'&&[
        ...(inboxBrowser?['/auth/v1/token','/auth/v1/logout']:[]),
        '/rest/v1/rpc/get_public_tournament_table_history_v2','/rest/v1/rpc/get_public_tournament_table_hand_v2',
        '/rest/v1/rpc/get_public_tournament_table_live_or_last_hand_v2','/rest/v1/rpc/get_public_tournament_hand_v2',
        '/rest/v1/rpc/get_public_tournament_settlement','/rest/v1/rpc/get_public_tournament_clock_summary',
        '/rest/v1/rpc/get_public_tournament_results','/rest/v1/rpc/get_tournament_clock',
        '/rest/v1/rpc/get_public_tournament_registration_summary_v1',
      ].includes(url.pathname))){send(401,{message:'LOCAL_HISTORY_READ_ONLY'});return;}
      const publicClockRead=url.pathname.match(/^\/rest\/v1\/rpc\/(get_public_tournament_clock_summary|get_public_tournament_results)$/)?.[1];
      if(url.pathname==='/rest/v1/rpc/get_public_tournament_registration_summary_v1'&&req.method==='POST'){
        assert.deepEqual(Object.keys(body),['p_tournament_id']);assert.equal(body.p_tournament_id,fixture.tour);
        const value=JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claim.role='anon';SET LOCAL request.jwt.claims='{"role":"anon"}';SET LOCAL ROLE anon;
          SELECT public.get_public_tournament_registration_summary_v1('${fixture.tour}');COMMIT;`));
        log.push({rpc:'get_public_tournament_registration_summary_v1',role:'anon',count:value.registration_count});send(200,value);return;
      }
      if(publicClockRead&&req.method==='POST') {
        assert.deepEqual(Object.keys(body),['p_tournament_id']);assert.equal(body.p_tournament_id,fixture.tour);
        if(publicClockRead==='get_public_tournament_results'&&failPublicResultOnce){
          failPublicResultOnce=false;log.push({rpc:publicClockRead,role:'anon',fault:'LOCAL_READ_503'});
          send(503,{message:'LOCAL_READ_503'});return;
        }
        const value=JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claim.role='anon';SET LOCAL request.jwt.claims='{"role":"anon"}';SET LOCAL ROLE anon;
          SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM public.${publicClockRead}('${fixture.tour}') t;COMMIT;`));
        log.push({rpc:publicClockRead,role:'anon',rows:value.length});send(200,value);return;
      }
      if((d2Event||observerFixture||sidepotScope||handCorrectionScope||existingEventFlight||single647Hand)&&req.method==='GET'&&['/rest/v1/tournaments','/rest/v1/tournament_table_appearance'].includes(url.pathname)) {
        const appearance=url.pathname.endsWith('/tournament_table_appearance');
        const columns=url.searchParams.get('select')?.replaceAll(' ','');
        if(appearance||columns==='players_remaining,average_stack') {
          assert.equal(columns,appearance?'felt_color,rail_color,logo_url':'players_remaining,average_stack');
          assert.equal(url.searchParams.get(appearance?'tournament_id':'id'),`eq.${fixture.tour}`);
          const table=appearance?'tournament_table_appearance':'tournaments';
          const value=JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claims='{"role":"anon"}';SET LOCAL ROLE anon;
            SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM(SELECT ${columns} FROM public.${table} WHERE ${appearance?'tournament_id':'id'}='${fixture.tour}') t;COMMIT;`));
          log.push({read:table,role:'anon',rows:value.length});
          send(200,String(req.headers.accept??'').includes('vnd.pgrst.object')?(value[0]??null):value);return;
        }
      }
      if((d2Event||observerFixture||sidepotScope||handCorrectionScope||existingEventFlight||single647Hand||single655Break||single657Read)&&url.pathname==='/rest/v1/rpc/get_tournament_clock'&&req.method==='POST') {
        assert.equal(body.p_tournament_id,fixture.tour);
        const value=JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claims='{"role":"anon"}';SET LOCAL ROLE anon;SELECT public.get_tournament_clock('${fixture.tour}');COMMIT;`));
        log.push({rpc:'get_tournament_clock',role:'anon'});send(200,value);return;
      }
      if(url.pathname==='/rest/v1/rpc/get_public_tournament_hand_catalog_v2'&&req.method==='POST'){
        assert.ok((linkedD2||feedRead291||single647Hand)&&historyTable,'feed reader requires exact retained canary');
        assert.deepEqual(Object.keys(body).sort(),['p_limit','p_tournament_id','p_tournament_table_id']);
        assert.equal(body.p_tournament_id,fixture.tour);assert.equal(body.p_tournament_table_id,historyTable.id);
        assert.ok(Number.isSafeInteger(body.p_limit)&&body.p_limit>=1&&body.p_limit<=101);
        if(feedCatalogHang326){
          const held={rpc:'get_public_tournament_hand_catalog_v2',fault:'LOCAL_FEED326_READ_HELD',clientClosed:false};
          log.push(held);res.once('close',()=>{held.clientClosed=true;});return;
        }
        if(feedCatalogFault313){log.push({rpc:'get_public_tournament_hand_catalog_v2',fault:'LOCAL_FEED313_READ_503'});send(503,{message:'LOCAL_FEED313_READ_503'});return;}
        const value=JSON.parse(sql(`BEGIN READ ONLY;SET LOCAL request.jwt.claim.role='anon';SET LOCAL request.jwt.claims='{"role":"anon"}';SET LOCAL ROLE anon;
          SELECT public.get_public_tournament_hand_catalog_v2('${fixture.tour}','${historyTable.id}',${body.p_limit});ROLLBACK;`));
        log.push({rpc:'get_public_tournament_hand_catalog_v2',role:'anon',rows:value.items?.length??null});send(200,value);return;
      }
      const publicReplayRpc=url.pathname.match(/^\/rest\/v1\/rpc\/(get_public_tournament_table_hand_v2|get_public_tournament_table_live_or_last_hand_v2|get_public_tournament_hand_v2|get_public_tournament_settlement)$/);
      if(publicReplayRpc&&req.method==='POST') {
        assert.ok((d2Event||observerFixture||sidepotScope||handCorrectionScope||existingEventFlight||single647Hand||single657Read)&&historyTable);
        const name=publicReplayRpc[1];let args;
        if(name==='get_public_tournament_settlement')args=`'${body.p_hand_id}'`;
        else {
          assert.equal(body.p_tournament_id,fixture.tour);
          args=`'${fixture.tour}'`;
          if(name.includes('_table_')){assert.equal(body.p_tournament_table_id,historyTable.id);args+=`,'${historyTable.id}'`;}
          if(name!=='get_public_tournament_table_live_or_last_hand_v2')args+=`,'${body.p_hand_id}'`;
        }
        if(name!=='get_public_tournament_table_live_or_last_hand_v2') {
          assert.ok(uuid(body.p_hand_id));
          assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM public.tournament_hands WHERE id='${body.p_hand_id}' AND tournament_id='${fixture.tour}' AND table_id='${historyTable.id}');`),'t');
        }
        const value=JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claim.role='anon';SET LOCAL request.jwt.claims='{"role":"anon"}';SET LOCAL ROLE anon;SELECT public.${name}(${args});COMMIT;`));
        log.push({rpc:name,role:'anon',hand:body.p_hand_id??null});send(200,value);return;
      }
      if(url.pathname==='/rest/v1/rpc/get_public_tournament_table_history_v2'&&req.method==='POST') {
        assert.ok((d2Event||observerFixture||sidepotScope||handCorrectionScope||existingEventFlight||single647Hand||single657Read)&&historyTable);assert.equal(body.p_tournament_id,fixture.tour);
        assert.equal(body.p_tournament_table_id,historyTable.id);assert.ok([20,50].includes(body.p_limit));
        assert.ok(body.p_before_id===null&&body.p_before_created_at===null,'initial history page only');
        const value=JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claim.role='anon';SET LOCAL request.jwt.claims='{"role":"anon"}';SET LOCAL ROLE anon;
          SELECT public.get_public_tournament_table_history_v2('${fixture.tour}','${historyTable.id}',${body.p_limit},NULL,NULL);COMMIT;`));
        log.push({rpc:'get_public_tournament_table_history_v2',role:'anon',hands:value.items?.map(item=>item.handId)??[]});
        if(historyReadHangCount){
          historyReadHangCount--;
          const held={response:res,shutdown:false};hangingReads.add(held);
          log.push({rpc:'get_public_tournament_table_history_v2',fault:'LOCAL_HISTORY362_READ_HELD_AFTER_SQL',mutation:false});
          res.once('close',()=>{hangingReads.delete(held);log.push({rpc:'get_public_tournament_table_history_v2',fault:held.shutdown?'LOCAL_HISTORY362_SERVER_SHUTDOWN':'LOCAL_HISTORY362_CLIENT_ABORT',mutation:false});});return;
        }
        send(200,value);return;
      }
      if(url.pathname==='/rest/v1/rpc/get_public_tournament_redraw_v1'&&req.method==='POST') {
        if(existingEventFlight&&process.env.VINPOKER_LINKED_QUALIFICATION183==='1'){
          const result=main167Bridge.handle('get_public_tournament_redraw_v1',body);
          assert.ok(result);send(result.status,result.value);return;
        }
        assert.ok(d2Event||single677Redraw);assert.ok([fixture.tour,...(d2Event?[fixture.final]:[])].includes(body.p_tournament_id));
        const value=JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claims='{"role":"anon"}';SET LOCAL ROLE anon;
          SELECT public.get_public_tournament_redraw_v1('${body.p_tournament_id}');COMMIT;`));
        log.push({rpc:'get_public_tournament_redraw_v1',role:'anon',batchId:value.batch_id??null});
        send(200,value);return;
      }
      if (url.pathname === '/auth/v1/token' && req.method === 'POST') {
        if (url.searchParams.get('grant_type') === 'password' && body.email === email && body.password === password) {
          send(200, session()); return;
        }
        if (url.searchParams.get('grant_type') === 'refresh_token' && [...sessions.values()].some((value) => value.refresh_token === body.refresh_token)) {
          send(200, session()); return;
        }
        send(400, { error: 'invalid_grant', error_description: 'LOCAL TEST account only' }); return;
      }
      const bearer = String(req.headers.authorization || '').replace(/^Bearer /i, '');
      if (!sessions.has(bearer)) { log.push({auth:'rejected',path:url.pathname});send(401, { code: 'LOCAL_AUTH_REQUIRED', message: 'LOCAL TEST session required' }); return; }
      if(single677Bridge){
        const result=single677Bridge.handle(req.method,url,body);
        if(result){
          if(result.dropEligible&&dropNext){dropNext=false;log.at(-1).responseDropped=true;send(503,{message:'LOCAL_SINGLE677_APPLY_RESPONSE_LOST_AFTER_COMMIT'});return;}
          send(200,result.value);return;
        }
        if(!['GET','HEAD'].includes(req.method)&&!['/auth/v1/logout','/__local/drop-next'].includes(url.pathname)
          &&!/^\/rest\/v1\/rpc\/(get_club_table_inventory|get_floor_tournament_table_inventory_v1|get_floor_tournament_table_roster_v6|get_floor_seatable_entries|get_floor_restorable_entries_v3|get_floor_pending_tracker_moves_v1|get_tournament_participation_counts_v1)$/.test(url.pathname)){
          send(403,{message:'LOCAL_SINGLE677_REDRAW_ONLY'});return;
        }
      }
      if(direct275Bridge){
        const result=direct275Bridge.handle(url,req.method,body);
        if(result){
          log.push({dm275:result.write?'browser_commit':'browser_receipt',value:result.value});
          if(result.write&&dm275Loss){dm275Loss=false;log.at(-1).responseDropped=true;send(503,{message:'LOCAL_DM275_RESPONSE_LOST_AFTER_COMMIT'});return;}
          send(result.status,result.value);return;
        }
      }
      if(bank272Bridge){
        if(req.method==='POST'&&['/rest/v1/rpc/get_chip_bank','/rest/v1/rpc/chip_ops_bank_adjust_v2','/rest/v1/rpc/get_chip_bank_adjust_receipt_v2'].includes(url.pathname)){
          const name=url.pathname.split('/').at(-1),result=bank272Bridge.rpc(name,body);
          log.push({rpc:name,request:body.p_idempotency_key??null,result:result.value});
          if(name==='get_chip_bank'&&holdChipRead(name,res))return;
          if(result.write&&dropNext){dropNext=false;log.at(-1).responseDropped=true;send(503,{message:'LOCAL_BANK_RESPONSE_LOST_AFTER_COMMIT'});return;}
          send(200,result.value);return;
        }
        if(req.method==='GET'&&url.pathname==='/rest/v1/chip_bank_ledger'){
          const value=bank272Bridge.ledger(url);log.push({table:'chip_bank_ledger',rows:value.length});
          if(holdChipRead('chip_bank_ledger',res))return;
          send(200,value);return;
        }
        if(!['GET','HEAD'].includes(req.method)&&!['/auth/v1/logout','/__local/drop-next'].includes(url.pathname)){
          send(403,{message:'LOCAL_BANK272_SINGLE_ADJUSTMENT_ONLY'});return;
        }
      }
      if(bank270ReadOnly){
        if(req.method==='POST'&&url.pathname==='/rest/v1/rpc/get_chip_bank'){
          assert.deepEqual(body,{p_club_id:fixture.club});
          const result=query(`SELECT public.get_chip_bank('${fixture.club}');`);
          log.push({rpc:'get_chip_bank',result,readOnly:true});send(200,result);return;
        }
        if(req.method==='GET'&&url.pathname==='/rest/v1/chip_bank_ledger'){
          assert.equal(url.searchParams.get('club_id'),`eq.${fixture.club}`);
          assert.equal(url.searchParams.get('select'),'id,denomination_id,direction,count,balance_after,reason,created_at');
          assert.equal(url.searchParams.get('order'),'created_at.desc');assert.equal(url.searchParams.get('limit'),'50');
          const result=query(`SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY created_at DESC),'[]'::jsonb) FROM
            (SELECT id,denomination_id,direction,count,balance_after,reason,created_at FROM public.chip_bank_ledger WHERE club_id='${fixture.club}' ORDER BY created_at DESC LIMIT 50) l;`);
          log.push({table:'chip_bank_ledger',rows:result.length,readOnly:true});send(200,result);return;
        }
        if(!['GET','HEAD'].includes(req.method)&&url.pathname!=='/auth/v1/logout'){
          send(403,{message:'LOCAL_BANK270_READONLY'});return;
        }
      }
      if(bank265ReadOnly&&!['GET','HEAD'].includes(req.method)&&!['/auth/v1/logout',
        '/rest/v1/rpc/get_my_ops_capability_scope','/rest/v1/rpc/get_my_ops_global_capability',
        '/rest/v1/rpc/cashier_tour_worklist_v1','/rest/v1/rpc/cashier_tour_issues_v1','/rest/v1/rpc/cashier_shift_summary_v1'].includes(url.pathname)){
        send(403,{message:'LOCAL_BANK264_CASHIER_READONLY'});return;
      }
      if(tv258Bridge&&!['GET','HEAD'].includes(req.method)&&!['/auth/v1/logout','/__local/drop-next',
        '/rest/v1/rpc/get_tv_tournament_branding_v1','/rest/v1/rpc/save_tv_tournament_layout_v1'].includes(url.pathname)){
        send(403,{message:'LOCAL_TV258_ASSETS_AND_LAYOUT_ONLY'});return;
      }
      if(tv258Bridge&&req.method==='POST'&&['/rest/v1/rpc/get_tv_tournament_branding_v1','/rest/v1/rpc/save_tv_tournament_layout_v1'].includes(url.pathname)){
        const result=tv258Bridge.rpc(url.pathname.split('/').at(-1),body);
        if(result.write&&dropNext){dropNext=false;log.at(-1).responseDropped=true;send(503,{message:'LOCAL_TV258_PUBLISH_RESPONSE_LOST_AFTER_COMMIT'});return;}
        send(200,result.value);return;
      }
      if(single644Assign&&req.method==='POST'&&url.pathname==='/functions/v1/assign-dealer'){
        const result=await single644Assign.invoke(body);
        if(body.mode==='assign'&&result.value.status==='success'&&dropNext){dropNext=false;log.at(-1).responseDropped=true;send(503,{message:'LOCAL_ASSIGNMENT_RESPONSE_LOST_AFTER_COMMIT'});return;}
        send(result.status,result.value);return;
      }
      if(single706Payroll){
        if(single706Payroll.paths.includes(url.pathname)){
          const bearer=String(req.headers.authorization??'').replace(/^Bearer /i,'');
          if(!sessions.has(bearer)){send(401,{message:'LOCAL_AUTH_REQUIRED'});return;}
          single706Payroll.handle(url,req.method,body,res,send);return;
        }
        if(!['GET','HEAD'].includes(req.method)&&!['/auth/v1/token','/auth/v1/logout'].includes(url.pathname)){
          send(403,{message:'LOCAL706_PAYROLL_READ_ONLY_NO_FINALIZATION_OR_PAYMENT'});return;
        }
      }
      if(single643Reads){
        const mutation=single661Bridge?.(req.method,url,body);
        if(mutation){
          if(mutation.write&&dropNext){dropNext=false;log.at(-1).responseDropped=true;send(503,{message:'LOCAL_SINGLE661_RESPONSE_LOST_AFTER_COMMIT'});return;}
          send(200,mutation.value);return;
        }
        const read=single643Reads(req.method,url,body);
        if(read.matched){
          const singular=req.headers.accept?.includes('vnd.pgrst.object');
          send(200,singular&&Array.isArray(read.value)?read.value[0]??null:read.value);return;
        }
      }
      if(clean244Dealer){
        if(!['GET','HEAD'].includes(req.method)&&!['/auth/v1/logout','/__local/drop-next','/rest/v1/rpc/operator_check_in_dealers'].includes(url.pathname)){
          send(403,{message:'LOCAL_CLEAN256_DEALER_CHECKIN_ONLY'});return;
        }
        if(req.method==='GET'&&url.pathname==='/rest/v1/dealers'&&url.searchParams.has('club_id')){
          assert.equal(url.searchParams.get('select'),'id,full_name,tier');
          assert.equal(url.searchParams.get('club_id'),`eq.${fixture.club}`);
          assert.equal(url.searchParams.get('status'),'eq.active');assert.equal(url.searchParams.get('deleted_at'),'is.null');
          assert.equal(url.searchParams.get('order'),'full_name.asc');
          const value=query(`SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY full_name),'[]') FROM(SELECT id,full_name,tier FROM public.dealers WHERE club_id='${fixture.club}' AND status='active' AND deleted_at IS NULL AND id IN(${clean244DealerIds.map(id=>`'${id}'::uuid`).join(',')}))d;`);
          log.push({read:'clean256_dealers',rows:value.length});send(200,value);return;
        }
        if(req.method==='GET'&&url.pathname==='/rest/v1/dealer_attendance'){
          assert.equal(url.searchParams.get('select'),'dealer_id');assert.equal(url.searchParams.get('status'),'eq.checked_in');
          const filter=url.searchParams.get('dealer_id');assert.ok(filter?.startsWith('in.(')&&filter.endsWith(')'));
          const ids=filter.slice(4,-1).split(',');assert.ok(ids.length>0&&ids.length<=4&&ids.every(id=>clean244DealerIds.includes(id)));
          const value=query(`SELECT coalesce(jsonb_agg(jsonb_build_object('dealer_id',dealer_id)),'[]') FROM public.dealer_attendance WHERE status='checked_in' AND dealer_id IN(${ids.map(id=>`'${id}'::uuid`).join(',')});`);
          log.push({read:'clean256_active_attendance',rows:value.length});send(200,value);return;
        }
        if(req.method==='POST'&&url.pathname==='/rest/v1/rpc/operator_check_in_dealers'){
          assert.deepEqual(Object.keys(body).sort(),['p_entries','p_expected_club_id','p_request_id']);
          assert.ok(uuid(body.p_request_id));assert.equal(body.p_expected_club_id,fixture.club);
          assert.ok(Array.isArray(body.p_entries)&&body.p_entries.length>0&&body.p_entries.length<=4);
          for(const e of body.p_entries){assert.ok(uuid(e.entry_id)&&clean244DealerIds.includes(e.dealer_id));assert.equal(e.mode,'unscheduled');assert.equal(e.input_method,'manual_list');assert.equal(e.user_id,null);assert.equal(e.shift_assignment_id,null);}
          const entries=JSON.stringify(body.p_entries).replaceAll("'","''");
          const value=query(`RESET ROLE;DO $$ BEGIN ASSERT NOT EXISTS(SELECT 1 FROM public.dealer_swing_phone_rollout);END $$;
            INSERT INTO public.dealer_swing_phone_rollout(id,enabled,all_clubs_enabled,allowed_club_ids) VALUES(true,true,false,ARRAY['${fixture.club}'::uuid]);
            SET LOCAL ROLE authenticated;SELECT public.operator_check_in_dealers('${body.p_request_id}','${fixture.club}','${entries}'::jsonb);
            RESET ROLE;DELETE FROM public.dealer_swing_phone_rollout WHERE id;`);
          log.push({rpc:'operator_check_in_dealers',request:body.p_request_id,dealers:body.p_entries.map(e=>e.dealer_id),result:value});
          if(dropNext){dropNext=false;log.at(-1).responseDropped=true;send(503,{message:'LOCAL_CHECKIN_RESPONSE_LOST_AFTER_COMMIT'});return;}
          send(200,value);return;
        }
      }
      if(clean244Member&&!['GET','HEAD'].includes(req.method)&&!['/auth/v1/logout','/__local/drop-next','/functions/v1/tournament-register','/functions/v1/get-buyin-receipt',...(single666Reentry?['/functions/v1/tournament-reentry']:[])].includes(url.pathname)){
        send(403,{message:'LOCAL_CLEAN248_MEMBER_REGISTRATION_ONLY'});return;
      }
      if(clean244CashierRead&&!['GET','HEAD'].includes(req.method)&&url.pathname!=='/auth/v1/logout'
       &&!(clean637Seat&&url.pathname==='/rest/v1/rpc/confirm_registration_and_assign_seat')
       &&!(clean244CashierPay&&['/__local/drop-next','/rest/v1/rpc/cashier_open_shift_v1','/rest/v1/rpc/resolve_cashier_cash_buyin_intent_v1'].includes(url.pathname))
       &&!/^\/rest\/v1\/rpc\/(get_my_ops_capability_scope|get_my_ops_global_capability|cashier_tour_worklist_v1|cashier_tour_issues_v1|cashier_shift_summary_v1)$/.test(url.pathname)){
        send(403,{message:'LOCAL_CLEAN249_CASHIER_READ_ONLY'});return;
      }
      if(clean244Floor&&!['GET','HEAD'].includes(req.method)&&url.pathname!=='/auth/v1/logout'
       &&!(single694Close&&/^\/rest\/v1\/rpc\/(floor_free_sit_player_v1|close_tournament_table_v4|get_tournament_close_readiness_v1|close_tournament)$/.test(url.pathname))
       &&!(single677Redraw&&url.pathname==='/__local/drop-next')
       &&!(single657Read&&/^\/rest\/v1\/rpc\/(get_tournament_clock|get_public_tournament_table_history_v2|get_public_tournament_live_hand|get_public_tournament_settlement|get_public_tournament_hand_detail_v1)$/.test(url.pathname))
       &&!(single655Break&&(/^\/rest\/v1\/rpc\/(floor_plan_break_table_v1|floor_get_table_control_mode_request_v1|floor_request_table_control_mode_v4|get_tracker_hand_input_tables_v4|get_tracker_table_locks|is_club_tracker|get_tracker_roster_snapshot_v2|get_next_hand_number|get_tournament_clock|heartbeat_lock)$/.test(url.pathname)||url.pathname==='/functions/v1/tournament-live-update'))
       &&!(single655Queue&&url.pathname==='/rest/v1/rpc/floor_break_table_v5')
       &&!(single656Finish&&url.pathname==='/__local/drop-next')
       &&!(single654Color&&(url.pathname==='/__local/drop-next'||/^\/rest\/v1\/rpc\/(get_current_chip_inventory|get_chip_bank|get_chip_issuance_state_v1|get_color_up_history|chip_ops_color_up|chip_ops_reverse_color_up|get_chip_color_up_receipt_v1|cancel_chip_color_up_request_v1)$/.test(url.pathname)))
       &&!((single647Hand||single649Restore)&&url.pathname==='/__local/drop-next')
       &&!(single678Hand&&/^\/rest\/v1\/rpc\/(get_tracker_undo_receipt_v1|cancel_tracker_undo_intent_v1)$/.test(url.pathname))
       &&!(single649Restore&&/^\/rest\/v1\/rpc\/(floor_get_table_control_mode_request_v1|floor_request_table_control_mode_v4|floor_bust_player_v3|floor_restore_busted_player_to_seat_v5|get_floor_restore_receipt_v1|cancel_floor_restore_request_v1)$/.test(url.pathname))
       &&!((single646Start||single647Hand)&&(/^\/rest\/v1\/rpc\/(get_tracker_hand_input_tables_v4|get_tracker_table_locks|is_club_tracker|get_tracker_roster_snapshot_v2|get_next_hand_number|get_tournament_clock|heartbeat_lock)$/.test(url.pathname)||url.pathname==='/functions/v1/tournament-live-update'||single646Start&&url.pathname==='/functions/v1/tournament-live-clock'))
       &&!(single645Mode&&/^\/rest\/v1\/rpc\/(floor_get_table_control_mode_request_v1|floor_request_table_control_mode_v4|floor_cancel_table_control_mode_request_v1)$/.test(url.pathname))
       &&!/^\/rest\/v1\/rpc\/(get_club_table_inventory|declare_club_physical_table_v1|floor_open_tournament_table_v3|get_floor_tournament_table_inventory_v1|get_floor_tournament_table_roster_v6|get_floor_seatable_entries|get_floor_restorable_entries_v3|get_floor_pending_tracker_moves_v1|get_tournament_participation_counts_v1)$/.test(url.pathname)){
        send(403,{message:'LOCAL_CLEAN250_FLOOR_DECLARE_OPEN_ONLY'});return;
      }
      if(single748ChipRead&&!['GET','HEAD'].includes(req.method)&&url.pathname!=='/auth/v1/logout'
       &&!/^\/rest\/v1\/rpc\/(get_current_chip_inventory|get_issued_chip_inventory|get_chip_bank|get_chip_issuance_state_v1|get_color_up_history|get_bag_tag_state|get_tournament_participation_counts_v1|get_floor_tournament_table_roster_v6)$/.test(url.pathname)){
        send(403,{message:'LOCAL_SINGLE748_CHIP_READ_ONLY'});return;
      }
      if(clean244Mode&&!single748ChipRead&&!clean244Member&&!clean244CashierRead&&!clean244Floor&&!clean244Dealer&&!clean244TvAssets&&!['GET','HEAD'].includes(req.method)&&!['/auth/v1/logout','/__local/drop-next'].includes(url.pathname)
       &&!/^\/rest\/v1\/rpc\/(chip_ops_create_and_bind_set_v1|get_chip_setup_create_bind_receipt_v1|cancel_chip_setup_create_bind_v1|chip_ops_apply_setup_metadata_v1|get_chip_setup_metadata_receipt_v1|cancel_chip_setup_metadata_v1|chip_ops_save_stack_template_v2|get_chip_template_save_receipt_v1|cancel_chip_template_save_v1|get_current_chip_inventory|get_chip_bank|get_chip_issuance_state_v1|chip_ops_set_issuance_v2|get_chip_issuance_receipt_v1|get_tournament_participation_counts_v1|get_floor_tournament_table_roster_v6)$/.test(url.pathname)){
        send(403,{message:'LOCAL_CLEAN244_SETUP_ONLY_NO_PAYMENTS_OR_SEATING'});return;
      }
      if(notificationReadOnly&&url.pathname==='/rest/v1/notifications'){
        assert.equal(url.searchParams.get('user_id'),`eq.${actor}`);
        if(!['GET','HEAD'].includes(req.method)){log.push({read:'notifications',writeRejected:true});send(403,{message:'LOCAL_NOTIFICATION_READ_ONLY'});return;}
        const count=req.method==='HEAD';
        assert.equal(url.searchParams.get('select'),count?'id':'*');
        assert.deepEqual([...url.searchParams.keys()].sort(),(count?['select','user_id','is_read']:['select','user_id','order','limit']).sort());
        if(count)assert.equal(url.searchParams.get('is_read'),'eq.false');
        else {assert.equal(url.searchParams.get('order'),'created_at.desc');assert.ok(['15','100'].includes(url.searchParams.get('limit')));}
        const statement=count?`SELECT count(*)::text FROM public.notifications WHERE user_id='${actor}' AND NOT is_read;`
          :`SELECT coalesce(jsonb_agg(n),'[]') FROM(SELECT * FROM public.notifications WHERE user_id='${actor}' ORDER BY created_at DESC LIMIT ${Number(url.searchParams.get('limit'))}) n;`;
        const raw=sql(`BEGIN;${authUsageBefore==='f'?'GRANT USAGE ON SCHEMA auth TO authenticated;':''}${claims}${statement}ROLLBACK;`);
        const result=JSON.parse(raw);
        if(notificationReadHang&&!count){
          log.push({read:'notifications',fault:'LOCAL_NOTIFICATION_LIST_HELD_AFTER_SQL',rows:result.length});
          const held={response:res,shutdown:false};hangingReads.add(held);
          res.once('close',()=>{hangingReads.delete(held);log.push({read:'notifications',clientClosed:!held.shutdown});});return;
        }
        if(count){assert.ok(Number.isSafeInteger(result)&&result>=0);res.setHeader('Content-Range',`0-0/${result}`);res.writeHead(200);res.end();}
        else {assert.ok(result.every(n=>n.user_id===actor));send(200,result);}
        log.push({read:'notifications',kind:count?'count':'list',rows:count?result:result.length,role:'authenticated'});return;
      }
      if(uuidTv220&&req.method==='POST'&&!['/auth/v1/logout','/rest/v1/rpc/get_tournament_clock',
        '/rest/v1/rpc/get_tournament_participation_counts_v1','/rest/v1/rpc/get_tv_tournament_branding_v1'].includes(url.pathname)){
        send(403,{message:'LOCAL_UUID_TV220_READ_ONLY'});return;
      }
      if(uuidTv220&&req.method==='POST'&&url.pathname==='/rest/v1/rpc/get_tv_tournament_branding_v1'){
        assert.deepEqual(body,{p_tournament_id:fixture.tour});
        send(200,query(`SELECT public.get_tv_tournament_branding_v1('${fixture.tour}');`));return;
      }
      if(uuidTv220&&req.method==='GET'&&url.pathname==='/rest/v1/tournaments'){
        const columns=url.searchParams.get('select')?.replaceAll(' ','');
        if(columns?.startsWith('name,status,players_remaining,average_stack,prize_pool,starting_stack,guarantee_amount,buy_in,rake_amount,main_event:')){
          assert.equal(columns,'name,status,players_remaining,average_stack,prize_pool,starting_stack,guarantee_amount,buy_in,rake_amount,main_event:tournament_events(guarantee_amount),club:clubs(name,cover_url,tv_logo_url,tv_brand_name,tv_bg_url)');
          assert.equal(url.searchParams.get('id'),`eq.${fixture.tour}`);
          const value=query(`SELECT jsonb_build_object('name',t.name,'status',t.status,'players_remaining',t.players_remaining,
           'average_stack',t.average_stack,'prize_pool',t.prize_pool,'starting_stack',t.starting_stack,
           'guarantee_amount',t.guarantee_amount,'buy_in',t.buy_in,'rake_amount',t.rake_amount,
           'main_event',CASE WHEN e.id IS NULL THEN NULL ELSE jsonb_build_object('guarantee_amount',e.guarantee_amount) END,
           'club',jsonb_build_object('name',c.name,'cover_url',c.cover_url,'tv_logo_url',c.tv_logo_url,'tv_brand_name',c.tv_brand_name,'tv_bg_url',c.tv_bg_url))
           FROM public.tournaments t JOIN public.clubs c ON c.id=t.club_id
           LEFT JOIN public.tournament_events e ON e.id=t.event_id AND e.club_id=t.club_id WHERE t.id='${fixture.tour}';`);
          log.push({read:'uuid_tv_tournament',tour:fixture.tour,rawPool:value.prize_pool});send(200,value);return;
        }
        if(columns==='satellite_payout'){
          assert.equal(url.searchParams.get('id'),`eq.${fixture.tour}`);
          if(sql("SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='tournaments' AND column_name='satellite_payout');")!=='t'){
            send(400,{code:'42703',message:'column tournaments.satellite_payout does not exist'});return;
          }
          send(200,query(`SELECT jsonb_build_object('satellite_payout',satellite_payout) FROM public.tournaments WHERE id='${fixture.tour}';`));return;
        }
      }
      if(uuidTv220&&req.method==='GET'&&['/rest/v1/tournament_prizes','/rest/v1/tournament_registrations'].includes(url.pathname)){
        const prizes=url.pathname.endsWith('tournament_prizes');const table=prizes?'tournament_prizes':'tournament_registrations';
        assert.equal(url.searchParams.get('tournament_id'),`eq.${fixture.tour}`);
        assert.equal(url.searchParams.get('select')?.replaceAll(' ',''),prizes?'position,amount':'buy_in');
        if(prizes)assert.equal(url.searchParams.get('order'),'position.asc');else assert.equal(url.searchParams.get('status'),'eq.confirmed');
        send(200,query(`SELECT coalesce(jsonb_agg(r),'[]'::jsonb) FROM(SELECT ${prizes?'position,amount':'buy_in'} FROM public.${table}
          WHERE tournament_id='${fixture.tour}' ${prizes?'ORDER BY position':"AND status='confirmed'"}) r;`));return;
      }
      if(payoutRead262Fault&&req.method==='POST'&&url.pathname==='/rest/v1/rpc/get_tournament_payout_recipients'){
        assert.deepEqual(body,{p_tournament_id:fixture.tour});
        const result=query(`SELECT public.get_tournament_payout_recipients('${fixture.tour}');`);
        payoutRead262Fault=false;log.push({rpc:'get_tournament_payout_recipients',fault:'LOCAL_PAYOUT_READ_503_AFTER_SQL',rows:result.places.length});
        send(503,{message:'LOCAL_PAYOUT_READ_UNAVAILABLE'});return;
      }
      if(main167Bridge&&req.method==='POST'&&url.pathname.startsWith('/rest/v1/rpc/')){
        const result=main167Bridge.handle(url.pathname.slice('/rest/v1/rpc/'.length),body);
        if(result){send(result.status,result.value);return;}
      }
      if(handCorrectionBridge){const result=await handCorrectionBridge.handle(url,req.method,body);
        if(result){send(result.status,result.value);return;}}
      if(opsChipReadOnly){
        const posts=['/auth/v1/logout','/rest/v1/rpc/get_my_ops_capability_scope','/rest/v1/rpc/get_my_ops_global_capability','/rest/v1/rpc/get_issued_chip_inventory'];
        const gets=['/auth/v1/user','/rest/v1/clubs','/rest/v1/tournaments','/rest/v1/stack_template','/rest/v1/stack_template_issuance'];
        if(!((req.method==='POST'&&posts.includes(url.pathname))||(req.method==='GET'&&gets.includes(url.pathname)))){
          send(403,{message:'LOCAL_CHIP_OPS_READONLY'});return;
        }
        if(req.method==='POST'&&url.pathname==='/rest/v1/rpc/get_issued_chip_inventory'){
          assert.deepEqual(body,{p_tournament_id:fixture.tour});
          const value=query(`SELECT public.get_issued_chip_inventory('${fixture.tour}');`);
          if(opsChipHangOnce){opsChipHangOnce=false;log.push({read:'ops_chip_inventory',fault:'LATE_12S_ONCE'});await new Promise(resolve=>setTimeout(resolve,12000));}
          log.push({read:'ops_chip_inventory',tournament:value.tournament_id,totalValue:value.total_value});send(200,value);return;
        }
        const table=url.pathname.match(/^\/rest\/v1\/(tournaments|stack_template|stack_template_issuance)$/)?.[1];
        if(req.method==='GET'&&table){
          const selects={tournaments:'id,name,status,start_time,phase',stack_template:'id,name,stack_value',stack_template_issuance:'stack_template_id,issued_count'};
          assert.equal(url.searchParams.get('select'),selects[table]);
          if(table==='tournaments')assert.equal(url.searchParams.get('club_id'),`eq.${fixture.club}`);
          if(table==='stack_template')assert.equal(url.searchParams.get('tournament_id'),`eq.${fixture.tour}`);
          const where=table==='tournaments'?`club_id='${fixture.club}' AND deleted_at IS NULL`:table==='stack_template'?`tournament_id='${fixture.tour}'`
            :`stack_template_id IN(SELECT id FROM public.stack_template WHERE tournament_id='${fixture.tour}')`;
          const order=table==='tournaments'?' ORDER BY start_time DESC LIMIT 200':table==='stack_template'?' ORDER BY stack_value':'';
          const value=query(`SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) FROM(SELECT ${selects[table]} FROM public.${table} WHERE ${where}${order})q;`);
          log.push({read:`ops_chip_${table}`,count:value.length});send(200,value);return;
        }
      }
      if(dealerControlReadOnly){
        const allowedPosts=['/auth/v1/logout','/rest/v1/rpc/get_my_ops_capability_scope','/rest/v1/rpc/get_my_ops_global_capability','/rest/v1/rpc/get_club_table_inventory'];
        const allowedGets=['/auth/v1/user','/rest/v1/clubs','/rest/v1/game_tables','/rest/v1/dealers','/rest/v1/dealer_assignments','/rest/v1/dealer_attendance'];
        if(!((req.method==='POST'&&allowedPosts.includes(url.pathname))||(req.method==='GET'&&allowedGets.includes(url.pathname)))){
          send(403,{message:'LOCAL_DEALER_CONTROL_READONLY'});return;
        }
        if(req.method==='POST'&&url.pathname==='/rest/v1/rpc/get_club_table_inventory'){
          assert.deepEqual(body,{p_club_id:fixture.club});
          if(dealerControlReadFault){dealerControlReadFault=false;log.push({read:'dealer_inventory',fault:'503_ONCE'});send(503,{message:'LOCAL_DEALER_INVENTORY_UNAVAILABLE'});return;}
          const value=query(`SELECT coalesce(jsonb_agg(to_jsonb(i)),'[]'::jsonb) FROM public.get_club_table_inventory('${fixture.club}') i;`);
          log.push({read:'dealer_inventory',count:value.length,inUse:value.filter(t=>t.availability_status==='in_use').length});send(200,value);return;
        }
        const table=url.pathname.match(/^\/rest\/v1\/(game_tables|dealers|dealer_assignments|dealer_attendance)$/)?.[1];
        if(req.method==='GET'&&table){
          const selects={game_tables:'id, table_name, table_type, status',dealers:'id, full_name, tier',
            dealer_assignments:'id, table_id, table_session_id, dealer_id, swing_due_at, status, needs_replacement, assigned_at',
            dealer_attendance:'dealer_id, current_state, check_in_time'};
          assert.equal(url.searchParams.get('select'),selects[table].replaceAll(' ',''));
          if(table!=='dealer_attendance')assert.equal(url.searchParams.get('club_id'),`eq.${fixture.club}`);
          const where=table==='dealer_attendance'?`status='checked_in' AND dealer_id IN(SELECT id FROM public.dealers WHERE club_id='${fixture.club}' AND deleted_at IS NULL)`
            :`club_id='${fixture.club}'${table==='dealers'?' AND deleted_at IS NULL':table==='dealer_assignments'?" AND status='assigned'":''}`;
          const order=table==='game_tables'?'table_name':table==='dealers'?'full_name':table==='dealer_assignments'?'assigned_at DESC':'check_in_time DESC';
          const limit=table==='game_tables'?' LIMIT 200':table==='dealers'?' LIMIT 500':'';
          const value=query(`SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) FROM(SELECT ${selects[table]} FROM public.${table} WHERE ${where} ORDER BY ${order}${limit})q;`);
          log.push({read:table,count:value.length});send(200,value);return;
        }
      }
      if(opsSharedReadOnly&&req.method!=='GET'&&!['/auth/v1/logout',
        '/rest/v1/rpc/multi_day_floor_read_v1','/rest/v1/rpc/multi_day_qualification_preview_v1',
        '/rest/v1/rpc/multi_day_payout_preview_v1','/rest/v1/rpc/multi_day_payout_postfinal_state_v1',
        '/rest/v1/rpc/multi_day_final_roster_v1'].includes(url.pathname)){
        send(403,{message:'LOCAL_OPS_SHARED_READONLY'});return;
      }
      if(floorAlertBridge){
        if(process.env.VINPOKER_FLOOR_ALERT_REVIEW280==='1'&&req.method!=='GET'&&!['/rest/v1/rpc/list_tracker_tables_v2','/rest/v1/rpc/list_tracker_history_tables_v1',
          '/rest/v1/rpc/get_tracker_historical_display_queue_status','/rest/v1/rpc/list_tracker_floor_alerts'].includes(url.pathname)){
          log.push({review280WriteRejected:url.pathname});send(403,{code:'LOCAL_REVIEW280_READ_ONLY'});return;
        }
        const result=await floorAlertBridge.handle(url,req.method,body);
        if(result){send(result.status,result.value);return;}
        if(req.method!=='GET'&&!['/auth/v1/logout','/rest/v1/rpc/has_role','/rest/v1/rpc/get_user_club_roles'].includes(url.pathname)){
          send(403,{message:'LOCAL_ALERT_ROLLBACK_ONLY'});return;
        }
      }
      if(activeCorrection101&&req.method==='POST'&&['list_tracker_floor_alerts','report_tracker_wrong_hand_v1','transition_tracker_floor_alert'].some(name=>url.pathname===`/rest/v1/rpc/${name}`)){
        const name=url.pathname.split('/').at(-1);let statement;
        if(name==='list_tracker_floor_alerts'){
          assert.deepEqual(body,{p_tournament_id:fixture.tour,p_status:null});
          statement=`SELECT public.list_tracker_floor_alerts('${fixture.tour}',NULL);`;
        }else if(name==='report_tracker_wrong_hand_v1'){
          assert.deepEqual(Object.keys(body).sort(),['p_tournament_id','p_tournament_table_id','p_hand_id','p_expected_source_revision','p_request_id'].sort());
          assert.equal(body.p_tournament_id,fixture.tour);assert.equal(body.p_tournament_table_id,sidepotScope.table);
          assert.ok(uuid(body.p_hand_id)&&uuid(body.p_request_id)&&Number.isSafeInteger(body.p_expected_source_revision)&&body.p_expected_source_revision>0);
          assert.equal(query(`SELECT to_jsonb(EXISTS(SELECT 1 FROM public.tournament_hands WHERE id='${body.p_hand_id}' AND tournament_id='${fixture.tour}' AND hand_number=28 AND status='in_progress'));`),true);
          statement=`SELECT public.report_tracker_wrong_hand_v1('${fixture.tour}','${sidepotScope.table}','${body.p_hand_id}',${body.p_expected_source_revision},'${body.p_request_id}');`;
        }else{
          assert.deepEqual(Object.keys(body).sort(),['p_alert_id','p_expected_version','p_transition','p_note','p_idempotency_key'].sort());
          assert.ok(uuid(body.p_alert_id)&&Number.isSafeInteger(body.p_expected_version)&&body.p_expected_version>0);
          assert.ok(['acknowledge','start','resolve'].includes(body.p_transition));assert.equal(body.p_note,null);
          assert.match(body.p_idempotency_key,/^floor-alert:[a-f0-9-]{36}$/i);
          assert.equal(query(`SELECT to_jsonb(EXISTS(SELECT 1 FROM public.tracker_floor_alerts a JOIN public.tournament_hands h ON h.id=a.hand_id WHERE a.id='${body.p_alert_id}' AND a.tournament_id='${fixture.tour}' AND h.hand_number=28));`),true);
          statement=`SELECT public.transition_tracker_floor_alert('${body.p_alert_id}',${body.p_expected_version},'${body.p_transition}',NULL,'${body.p_idempotency_key}');`;
        }
        const result=query(statement);log.push({rpc:name,requestId:body.p_request_id??body.p_idempotency_key??null,transition:body.p_transition??null,result});send(200,result);return;
      }
      if(activeCorrection101&&req.method==='GET'&&url.pathname==='/rest/v1/game_tables'&&url.searchParams.get('select')==='id,table_number'){
        assert.equal(url.searchParams.get('id'),`in.(${sidepotScope?sql(`SELECT game_table_id FROM public.tournament_tables WHERE id='${sidepotScope.table}';`):''})`);
        if(floorLocationFault101){log.push({read:'floor_location101',fault:503});send(503,{message:'LOCAL_LOCATION_UNAVAILABLE'});return;}
        send(200,query(`SELECT jsonb_agg(jsonb_build_object('id',g.id,'table_number',g.table_number)) FROM public.game_tables g JOIN public.tournament_tables t ON t.game_table_id=g.id WHERE t.id='${sidepotScope.table}';`));return;
      }
      if(activeCorrection101&&req.method==='GET'&&url.pathname==='/rest/v1/tournament_hands'&&url.searchParams.get('select')==='id,hand_number,status,is_voided'){
        const filter=url.searchParams.get('id');assert.match(filter??'',/^in\.\([a-f0-9-]{36}\)$/i);
        const id=filter.slice(4,-1);assert.ok(uuid(id));
        assert.equal(query(`SELECT to_jsonb(EXISTS(SELECT 1 FROM public.tournament_hands WHERE id='${id}' AND tournament_id='${fixture.tour}' AND hand_number=28));`),true);
        if(floorLocationFault101){log.push({read:'floor_location101',fault:503});send(503,{message:'LOCAL_LOCATION_UNAVAILABLE'});return;}
        send(200,query(`SELECT jsonb_agg(jsonb_build_object('id',id,'hand_number',hand_number,'status',status,'is_voided',is_voided)) FROM public.tournament_hands WHERE id='${id}' AND tournament_id='${fixture.tour}';`));return;
      }
      if(activeCorrection101&&req.method==='POST'&&['list_tracker_tables_v2','list_tracker_history_tables_v1','get_tracker_historical_display_queue_status'].some(name=>url.pathname===`/rest/v1/rpc/${name}`)){
        assert.deepEqual(body,{p_tournament_id:fixture.tour});const name=url.pathname.split('/').at(-1);
        const result=query(name!=='get_tracker_historical_display_queue_status'?`SELECT public.${name}('${fixture.tour}');`
          :`SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM public.${name}('${fixture.tour}')r;`);
        log.push({rpc:name,readOnly:true});send(200,result);return;
      }
      if(activeCorrection101&&req.method==='GET'&&url.pathname==='/rest/v1/tournament_hands'
        &&url.searchParams.get('select')?.replaceAll(' ','')==='id,hand_number,hand_time,community_cards,pot_size,status,is_voided,created_at,table_id,button_seat'){
        const columns=url.searchParams.get('select').replaceAll(' ','');
        const physical=sql(`SELECT game_table_id FROM public.tournament_tables WHERE id='${sidepotScope.table}';`);
        assert.equal(url.searchParams.get('tournament_id'),`eq.${fixture.tour}`);
        assert.ok([`eq.${sidepotScope.table}`,`in.(${sidepotScope.table},${physical})`,`in.(${physical},${sidepotScope.table})`].includes(url.searchParams.get('table_id')));
        assert.equal(url.searchParams.get('order'),'created_at.desc,id.desc');
        assert.ok(!url.searchParams.has('offset')||url.searchParams.get('offset')==='0');assert.ok(!url.searchParams.has('or'));
        const result=query(`SELECT coalesce(jsonb_agg(to_jsonb(h)),'[]') FROM(SELECT ${columns} FROM public.tournament_hands
          WHERE tournament_id='${fixture.tour}' AND table_id IN('${sidepotScope.table}','${physical}') ORDER BY created_at DESC,id DESC LIMIT 80)h;`);
        log.push({read:'active_correction_history',rows:result.length});send(200,result);return;
      }
      if(activeCorrection101&&req.method==='GET'&&['/rest/v1/hand_players','/rest/v1/hand_actions'].includes(url.pathname)
        &&url.searchParams.get('hand_id')?.startsWith('in.(')){
        const name=url.pathname.split('/').at(-1),columns=url.searchParams.get('select')?.replaceAll(' ','');
        const players='id,hand_id,player_id,entry_number,seat_number,starting_stack,ending_stack,is_eliminated,hole_cards';
        assert.ok(name==='hand_players'?[players,players+',player_name'].includes(columns):columns==='id,hand_id,player_id,entry_number,street,action_type,action_amount,action_order');
        const filter=url.searchParams.get('hand_id');assert.ok(filter.endsWith(')'));
        const ids=filter.slice(4,-1).split(',');assert.ok(ids.length>0&&ids.length<=80&&ids.every(uuid));
        const list=ids.map(id=>`'${id}'::uuid`).join(',');
        assert.equal(query(`SELECT count(*)::int FROM public.tournament_hands WHERE id=ANY(ARRAY[${list}]) AND tournament_id='${fixture.tour}' AND tournament_table_id='${sidepotScope.table}';`),ids.length);
        const order=name==='hand_players'?'hand_id,player_id,entry_number,id':'hand_id,action_order,id';
        const result=query(`SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM(SELECT ${columns} FROM public.${name} WHERE hand_id=ANY(ARRAY[${list}]) ORDER BY ${order})r;`);
        log.push({read:`active_correction_${name}`,rows:result.length});send(200,result);return;
      }
      if(dealerReadOnly&&req.method!=='GET'&&!['/auth/v1/logout','/rest/v1/rpc/get_dealer_scores_v1'].includes(url.pathname)){
        send(403,{message:'LOCAL_DEALER_READ_ONLY'});return;
      }
      if(dealerReadOnly&&req.method==='GET'&&url.pathname==='/rest/v1/dealers'&&url.searchParams.has('club_id')){
        assert.equal(url.searchParams.get('club_id'),`in.(${fixture.club})`);
        assert.equal(url.searchParams.get('deleted_at'),'is.null');
        assert.equal(url.searchParams.get('order'),'full_name.asc');
        if(dealerReadFault){dealerReadFault=false;log.push({read:'dealers',fault:'LOCAL_503_ONCE'});send(503,{message:'LOCAL_503_DEALER_READ'});return;}
        const value=query(`SELECT coalesce(jsonb_agg(t ORDER BY t.full_name),'[]'::jsonb) FROM(SELECT id,club_id,full_name,tier,status,employment_type,hourly_rate_vnd,base_rate_vnd,monthly_salary_vnd,standard_hours_per_shift,ot_multiplier,joined_date,notes,phone,telegram_user_id,telegram_username,shift_preference FROM public.dealers WHERE club_id='${fixture.club}' AND deleted_at IS NULL) t;`);
        log.push({read:'dealers',count:value.length});send(200,value);return;
      }
      if(dealerReadOnly&&req.method==='POST'&&url.pathname==='/rest/v1/rpc/get_dealer_scores_v1'){
        assert.deepEqual(body,{p_club_id:fixture.club});
        const value=query(`SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM public.get_dealer_scores_v1('${fixture.club}') t;`);
        log.push({read:'get_dealer_scores_v1',count:value.length});send(200,value);return;
      }
      if(freshRegistrationScope&&req.method!=='GET'&&!['/auth/v1/logout','/__local/drop-next','/functions/v1/tournament-register','/functions/v1/get-buyin-receipt'].includes(url.pathname)
        &&!url.pathname.startsWith('/rest/v1/rpc/get_')){send(403,{message:'LOCAL_REGISTRATION_ONLY'});return;}
      if(chipNullReadOnly&&req.method!=='GET'&&url.pathname!=='/auth/v1/logout'
        &&!url.pathname.startsWith('/rest/v1/rpc/get_')){
        send(403,{message:'LOCAL_CHIP_READ_ONLY'});return;
      }
      if(tvEditorTour&&req.method!=='GET'&&!['/auth/v1/logout','/__local/drop-next',
        '/rest/v1/rpc/get_tv_tournament_branding_v1','/rest/v1/rpc/save_tv_tournament_layout_v1'].includes(url.pathname)){
        send(403,{code:'LOCAL_TV_EDITOR_ONLY'});return;
      }
      if(tvEditorTour&&req.method==='POST'&&url.pathname.startsWith('/rest/v1/rpc/')){
        const name=url.pathname.slice('/rest/v1/rpc/'.length);
        if(!['get_tv_tournament_branding_v1','save_tv_tournament_layout_v1'].includes(name)){send(403,{code:'LOCAL_TV_EDITOR_ONLY'});return;}
        const write=name==='save_tv_tournament_layout_v1';
        assert.equal(body.p_tournament_id,fixture.tour);
        assert.deepEqual(Object.keys(body).sort(),(write?['p_tournament_id','p_expected_revision','p_brand_name','p_logo_url','p_bg_url','p_layout']:['p_tournament_id']).sort());
        let args=`'${fixture.tour}'::uuid`;
        if(write){
          assert.ok(Number.isSafeInteger(body.p_expected_revision)&&body.p_expected_revision>=5);
          assert.ok(typeof body.p_brand_name==='string'&&body.p_brand_name.length<=128);
          assert.equal(body.p_logo_url,'');assert.equal(body.p_bg_url,'');
          assert.ok(body.p_layout&&typeof body.p_layout==='object'&&!Array.isArray(body.p_layout));
          args+=`,${body.p_expected_revision},'${body.p_brand_name.replaceAll("'","''")}','','','${JSON.stringify(body.p_layout).replaceAll("'","''")}'::jsonb`;
        }
        const result=query(`SELECT public.${name}(${args});`);
        log.push({rpc:name,expectedRevision:body.p_expected_revision??null,revision:result.revision,brand:result.brand_name});
        if(write&&dropNext){dropNext=false;log.at(-1).responseDropped=true;send(503,{message:'LOCAL_TV_RESPONSE_LOST_AFTER_COMMIT'});return;}
        send(200,result);return;
      }
      if(inboxBrowser&&req.method==='GET'&&url.pathname==='/rest/v1/booking_chats'){
        const columns=url.searchParams.get('select');
        assert.ok(columns==='*'||columns==='id,tournament_id,club_id,player_id,status,payment_confirmed,updated_at,archived_at');
        if(columns==='*'&&unreadFault){log.push({read:'booking_unread',fault:'LOCAL_READ_503'});send(503,{message:'LOCAL_READ_503'});return;}
        const result=query(`SELECT coalesce(jsonb_agg(to_jsonb(c)),'[]') FROM public.booking_chats c WHERE c.club_id='${fixture.club}'${columns==='*'?' AND c.archived_at IS NULL':''};`);
        assert.deepEqual(result,[],'this independent canary must have no real messages');
        log.push({read:columns==='*'?'booking_unread':'booking_inbox',role:'authenticated',rows:0});send(200,result);return;
      }
      if(inboxBrowser&&req.method==='GET'&&url.pathname==='/rest/v1/direct_chats'){
        if(dmHang&&(!dmPairHang||url.searchParams.get('select')==='id')){
          log.push({read:'direct_inbox',fault:'LOCAL_DM_READ_HELD'});
          const held={response:res,shutdown:false};hangingReads.add(held);
          res.once('close',()=>{hangingReads.delete(held);log.push({read:'direct_inbox',clientClosed:!held.shutdown});});return;
        }
        if(dmFault){log.push({read:'direct_inbox',fault:'LOCAL_DM_READ_503'});send(503,{message:'LOCAL_DM_READ_503'});return;}
        if(inboxDmFixture&&url.searchParams.get('select')==='id'){
          const [a,b]=[actor,inboxDmFixture.peer].sort();assert.equal(url.searchParams.get('user_a'),`eq.${a}`);assert.equal(url.searchParams.get('user_b'),`eq.${b}`);
          const rows=query(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id)),'[]') FROM public.direct_chats c WHERE c.id='${inboxDmChat}' AND c.user_a='${a}' AND c.user_b='${b}';`);
          assert.equal(rows.length,1);log.push({read:'direct_pair',role:'authenticated',rows:rows.length});send(200,rows[0]);return;
        }
        assert.equal(url.searchParams.get('select'),'id,user_a,user_b,last_message_at,user_a_last_read_at,user_b_last_read_at');
        assert.equal(url.searchParams.get('or'),`(user_a.eq.${actor},user_b.eq.${actor})`);
        const result=query(`SELECT coalesce(jsonb_agg(to_jsonb(c)),'[]') FROM public.direct_chats c WHERE c.user_a='${actor}' OR c.user_b='${actor}';`);
        if(inboxDmFixture)assert.deepEqual(result.map(c=>c.id),[inboxDmChat]);else assert.deepEqual(result,[],'independent canary has no direct chat history');
        log.push({read:'direct_inbox',role:'authenticated',rows:result.length});send(200,result);return;
      }
      if(inboxDmFixture&&req.method==='GET'&&url.pathname==='/rest/v1/profiles'&&['user_id,display_name,avatar_url','display_name,avatar_url'].includes(url.searchParams.get('select'))){
        const single=url.searchParams.get('user_id')===`eq.${inboxDmFixture.peer}`;
        if(!single)assert.equal(url.searchParams.get('user_id'),`in.(${inboxDmFixture.peer})`);
        const rows=query(`SELECT coalesce(jsonb_agg(jsonb_build_object('user_id',user_id,'display_name',display_name,'avatar_url',avatar_url)),'[]') FROM public.profiles WHERE user_id='${inboxDmFixture.peer}';`);
        assert.equal(rows.length,1);log.push({read:'direct_peer_profile',role:'authenticated',rows:rows.length});send(200,single?rows[0]:rows);return;
      }
      if(inboxDmFixture&&req.method==='GET'&&url.pathname==='/rest/v1/direct_messages'){
        const single=url.searchParams.get('chat_id')===`eq.${inboxDmChat}`;
        if(!single)assert.equal(url.searchParams.get('chat_id'),`in.(${inboxDmChat})`);
        assert.equal(url.searchParams.get('select'),single?'*':'chat_id,content,kind,created_at,sender_id');
        assert.equal(url.searchParams.get('order'),single?'created_at.asc':'created_at.desc');assert.equal(url.searchParams.get('limit'),'500');
        const rows=query(`SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY created_at ${single?'ASC':'DESC'}),'[]') FROM public.direct_messages m WHERE chat_id='${inboxDmChat}';`);
        assert.equal(rows.length,(dm277Send?3:2)+(direct275Bridge?.messageId?1:0));log.push({read:single?'direct_thread_messages':'direct_last_messages',role:'authenticated',rows:rows.length});send(200,rows);return;
      }
      if(inboxDmFixture&&req.method==='PATCH'&&url.pathname==='/rest/v1/direct_chats'){
        assert.equal(url.searchParams.get('id'),`eq.${inboxDmChat}`);assert.deepEqual(Object.keys(body),[inboxDmFixture.ownRead]);
        const time=body[inboxDmFixture.ownRead];assert.match(time,/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
        const rows=query(`WITH changed AS(UPDATE public.direct_chats SET ${inboxDmFixture.ownRead}='${time}'::timestamptz WHERE id='${inboxDmChat}' RETURNING id) SELECT coalesce(jsonb_agg(id),'[]') FROM changed;`);
        assert.deepEqual(rows,[inboxDmChat]);log.push({write:'direct_own_read_marker',role:'authenticated',chat:inboxDmChat});send(200,null);return;
      }
      if(dealerBridge){const result=dealerBridge.route(url,req.method,body);if(result){
        if(result.kind==='plan'&&dealerPlanHang){dealerPlanHang=false;log.at(-1).responseHeld=true;const held={response:res,shutdown:false};hangingReads.add(held);
          res.once('close',()=>hangingReads.delete(held));return;}
        if(result.kind==='swing'&&dealerSwingLoss){dealerSwingLoss=false;log.at(-1).responseDropped=true;send(503,{message:'LOCAL_SWING_RESPONSE_LOST_AFTER_COMMIT'});return;}
        send(200,result.value);return;
      }}
      if(correctionBridge){const result=await correctionBridge.handle(url.pathname,req.method,body);
        if(result){send(result.status,result.value);return;}}
      if((freshRegistrationScope||clean244Member)&&url.pathname==='/functions/v1/get-buyin-receipt'&&req.method==='POST'){
        assert.deepEqual(Object.keys(body),['registration_id']);assert.ok(uuid(body.registration_id));
        assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM public.tournament_registrations WHERE id='${body.registration_id}' AND tournament_id='${fixture.tour}' AND player_id='${actor}');`),'t');
        const response=await memberReceiptHandler(new Request('http://local.invalid/receipt',{method:'POST',headers:{Authorization:'Bearer LOCAL_TEST'},body:JSON.stringify(body)}));
        log.push({rpc:'get-buyin-receipt',status:response.status});send(response.status,await response.json());return;
      }
      if(memberReceipt){
        if(registrationReplay&&url.pathname==='/functions/v1/tournament-register'&&req.method==='POST'){
          assert.deepEqual(body,{tournament_id:fixture.tour});
          assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM public.tournament_registrations WHERE id='${memberReceipt.registration}'
            AND tournament_id='${fixture.tour}' AND player_id='${actor}' AND status='confirmed');`),'t');
          const response=await runRegisterBrowserEdge({body,fixture,user,sql,log});const result=await response.json();
          if(response.status===200){assert.equal(result.already_registered,true);assert.equal(result.registration_id,memberReceipt.registration);}
          log.push({rpc:'tournament-register',status:response.status,alreadyRegistered:result.already_registered??null});
          send(response.status,result);return;
        }
        if(url.pathname==='/functions/v1/get-buyin-receipt'&&req.method==='POST'){
          if(body.registration_id)assert.equal(body.registration_id,memberReceipt.registration);
          else assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM public.seat_draw_receipts WHERE receipt_code='${String(body.receipt_code).replaceAll("'","''")}' AND registration_id='${memberReceipt.registration}');`),'t');
          if(memberReceiptFault){memberReceiptFault=false;log.push({rpc:'get-buyin-receipt',fault:'LOCAL_READ_503'});send(503,{error:'LOCAL_READ_503'});return;}
          const response=await memberReceiptHandler(new Request('http://local.invalid/receipt',{method:'POST',headers:{Authorization:'Bearer LOCAL_TEST'},body:JSON.stringify(body)}));
          log.push({rpc:'get-buyin-receipt',status:response.status,registration:memberReceipt.registration});send(response.status,await response.json());return;
        }
        if(req.method!=='GET'&&url.pathname!=='/auth/v1/logout'){send(403,{error:'LOCAL_MEMBER_READ_ONLY'});return;}
        if(req.method==='GET'&&url.pathname==='/rest/v1/tournament_registrations'){
          assert.equal(url.searchParams.get('select'),'id,status,tournament_id');assert.equal(url.searchParams.get('player_id'),`eq.${actor}`);
          send(200,query(`SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM(SELECT id,status,tournament_id FROM public.tournament_registrations WHERE tournament_id='${fixture.tour}' AND player_id='${actor}' AND status IN('pending','confirmed') ORDER BY created_at DESC LIMIT 8)t;`));return;
        }
        if(req.method==='GET'&&url.pathname==='/rest/v1/tournaments'){
          assert.equal(url.searchParams.get('select'),'id,name,status');assert.equal(url.searchParams.get('id'),`in.(${fixture.tour})`);
          send(200,query(`SELECT jsonb_agg(t) FROM(SELECT id,name,status FROM public.tournaments WHERE id='${fixture.tour}')t;`));return;
        }
      }
      if(payrollBridge){const result=payrollBridge.route(url,req.method,body);if(result){send(result.status,result.value);return;}}
      if(stakingBridge){const result=await stakingBridge.route(url,req.method,body);if(result){send(result.status,result.value);return;}}
      if(refund538Bridge){const result=await refund538Bridge.route(url,req.method,body);if(result){send(result.status,result.value);return;}}
      if(funding560Bridge){const result=await funding560Bridge.route(url,req.method,body);if(result){send(result.status,result.value);return;}}
      if(inviteBridge){const result=inviteBridge.route(url,req.method,body);if(result){send(result.status,result.value);return;}}
      const metadataRpc=url.pathname.match(/^\/rest\/v1\/rpc\/(chip_ops_apply_setup_metadata_v1|get_chip_setup_metadata_receipt_v1|cancel_chip_setup_metadata_v1)$/)?.[1];
      if((clean244Mode||chipMetadataTour||sidepotScope||existingEventFlight)&&metadataRpc&&req.method==='POST'){
        assert.deepEqual(Object.keys(body).sort(),['p_tournament_id','p_payload','p_request_id','p_expected_actor'].sort());
        assert.equal(body.p_tournament_id,fixture.tour);assert.equal(body.p_expected_actor,actor);assert.ok(uuid(body.p_request_id));
        const payload=body.p_payload;assert.ok(['bind','add','delete'].includes(payload.operation)&&uuid(payload.chip_set_id));
        if(clean244Mode){
          assert.equal(payload.operation,'add');assert.ok([100,500].includes(payload.value));
          assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM public.chip_set s JOIN public.tournament_chip_set b ON b.chip_set_id=s.id
           WHERE b.tournament_id='${fixture.tour}' AND s.id='${payload.chip_set_id}' AND s.club_id='${fixture.club}' AND s.name='Clean single244 chipset TEST');`),'t');
          assert.deepEqual(payload,{operation:'add',chip_set_id:payload.chip_set_id,value:payload.value,color:'#1e88e5',label:null,display_order:payload.display_order});
          assert.ok(Number.isSafeInteger(payload.display_order)&&payload.display_order>=0&&payload.display_order<=1);
        }else if(existingEventFlight){
          assert.deepEqual(payload,{operation:'bind',chip_set_id:payload.chip_set_id,expected_chip_set_id:null});
          assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM public.chip_set WHERE id='${payload.chip_set_id}'
            AND club_id='${fixture.club}' AND name='Single-day browser TEST chips');`),'t');
        }else if(sidepotScope){
          assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM public.tournament_chip_set b JOIN public.chip_set s ON s.id=b.chip_set_id
            WHERE b.tournament_id='${fixture.tour}' AND b.club_id='${fixture.club}' AND s.club_id=b.club_id
              AND s.id='${payload.chip_set_id}' AND s.name='Single-day browser TEST chips');`),'t');
          assert.equal(payload.operation,'add');
          assert.ok([100,500].includes(payload.value));
          assert.deepEqual(payload,{operation:'add',chip_set_id:payload.chip_set_id,value:payload.value,color:'#1e88e5',label:null,display_order:payload.display_order});
          assert.ok(Number.isSafeInteger(payload.display_order)&&payload.display_order>=0&&payload.display_order<=1);
        }else{
        assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM public.chip_set s JOIN public.tournaments t ON t.club_id=s.club_id
          WHERE t.id='${fixture.tour}' AND s.id='${payload.chip_set_id}' AND s.name LIKE 'Metadata overlap TEST %');`),'t');
        if(payload.operation==='bind'){
          assert.deepEqual(Object.keys(payload).sort(),['operation','chip_set_id','expected_chip_set_id'].sort());
          assert.equal(payload.expected_chip_set_id,null);
        }else if(payload.operation==='add'){
          assert.deepEqual(payload,{operation:'add',chip_set_id:payload.chip_set_id,value:500,color:'#1e88e5',label:null,display_order:0});
        }else{
          assert.deepEqual(payload,{operation:'delete',chip_set_id:payload.chip_set_id,denomination_id:metadataAddedId});assert.ok(uuid(metadataAddedId));
        }
        }
        const metadataIdentity=clean244Mode||sidepotScope||existingEventFlight?body.p_request_id:payload.operation;
        if(metadataPayloads.has(metadataIdentity))assert.deepEqual(body,metadataPayloads.get(metadataIdentity),'retain exact operation nonce/payload');
        else metadataPayloads.set(metadataIdentity,structuredClone(body));
        const result=query(`SELECT COALESCE(public.${metadataRpc}('${fixture.tour}','${JSON.stringify(payload).replaceAll("'","''")}'::jsonb,'${body.p_request_id}','${actor}'),'null'::jsonb);`);
        if(payload.operation==='add'&&result?.outcome==='applied')metadataAddedId=result.result.denomination_id;
        log.push({rpc:metadataRpc,operation:payload.operation,requestId:body.p_request_id,result});
        if(metadataRpc==='chip_ops_apply_setup_metadata_v1'){
          if(dropNext){dropNext=false;droppedKeys.add(body.p_request_id);}
          if(droppedKeys.has(body.p_request_id)){log.at(-1).responseDropped=true;send(503,{message:'LOCAL_METADATA_RESPONSE_LOST_AFTER_COMMIT'});return;}
        }
        send(200,result);return;
      }
      const templateRpc=url.pathname.match(/^\/rest\/v1\/rpc\/(chip_ops_save_stack_template_v2|get_chip_template_save_receipt_v1|cancel_chip_template_save_v1)$/)?.[1];
      if((clean244Mode||chipTemplateTour||sidepotScope||existingEventFlight)&&templateRpc&&req.method==='POST'){
        assert.deepEqual(Object.keys(body).sort(),['p_tournament_id','p_chip_set_id','p_name','p_stack_value','p_lines','p_request_id','p_expected_actor'].sort());
        assert.equal(body.p_tournament_id,fixture.tour);assert.equal(body.p_expected_actor,actor);
        assert.ok(uuid(body.p_chip_set_id)&&uuid(body.p_request_id));assert.equal(body.p_name,clean244Mode?'Clean single244 20K TEST':existingEventFlight?'Linked Main Event 20K TEST':'Template browser recovery TEST');assert.equal(body.p_stack_value,20000);
        if(clean244Mode||existingEventFlight){
          assert.equal(body.p_lines.length,2);
          for(const line of body.p_lines){
            assert.deepEqual(Object.keys(line).sort(),['count','denomination_id']);assert.ok(uuid(line.denomination_id));
            const value=Number(sql(`SELECT d.value FROM public.tournament_chip_set b JOIN public.chip_set_denomination d ON d.chip_set_id=b.chip_set_id
              WHERE b.tournament_id='${fixture.tour}' AND b.chip_set_id='${body.p_chip_set_id}' AND d.id='${line.denomination_id}';`));
            assert.ok([100,500].includes(value));assert.equal(line.count,value===100?20:36);
          }
          assert.equal(new Set(body.p_lines.map(line=>line.denomination_id)).size,2);
        }else{
        assert.equal(body.p_lines.length,1);assert.deepEqual(Object.keys(body.p_lines[0]).sort(),['count','denomination_id']);
        assert.ok(uuid(body.p_lines[0].denomination_id));assert.equal(body.p_lines[0].count,200);
        assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM public.tournament_chip_set b JOIN public.chip_set_denomination d ON d.chip_set_id=b.chip_set_id
          WHERE b.tournament_id='${fixture.tour}' AND b.chip_set_id='${body.p_chip_set_id}' AND d.id='${body.p_lines[0].denomination_id}' AND d.value=100);`),'t');
        }
        if(templatePayload)assert.deepEqual(body,templatePayload,'canary must retain one exact nonce/payload');else templatePayload=structuredClone(body);
        const args=`'${fixture.tour}','${body.p_chip_set_id}','${body.p_name}',20000,'${JSON.stringify(body.p_lines)}'::jsonb,'${body.p_request_id}','${actor}'`;
        const result=query(`SELECT COALESCE(public.${templateRpc}(${args}),'null'::jsonb);`);
        log.push({rpc:templateRpc,requestId:body.p_request_id,result});
        if(templateRpc==='chip_ops_save_stack_template_v2'){
          if(dropNext){dropNext=false;droppedKeys.add(body.p_request_id);}
          if(droppedKeys.has(body.p_request_id)){log.at(-1).responseDropped=true;send(503,{message:'LOCAL_TEMPLATE_RESPONSE_LOST_AFTER_COMMIT'});return;}
        }
        send(200,result);return;
      }
      const chipCreateRpc=url.pathname.match(/^\/rest\/v1\/rpc\/(chip_ops_create_and_bind_set_v1|get_chip_setup_create_bind_receipt_v1|cancel_chip_setup_create_bind_v1)$/)?.[1];
      if((clean244Mode||chipSetupTour||sidepotScope)&&chipCreateRpc&&req.method==='POST'){
        assert.deepEqual(Object.keys(body).sort(),['p_tournament_id','p_name','p_request_id','p_expected_actor'].sort());
        assert.equal(body.p_tournament_id,fixture.tour);assert.equal(body.p_expected_actor,actor);assert.ok(uuid(body.p_request_id));
        assert.ok(typeof body.p_name==='string'&&body.p_name.trim()&&body.p_name.length<=128);
        if(clean244Mode)assert.equal(body.p_name,'Clean single244 chipset TEST');
        const name=body.p_name.replaceAll("'","''");
        const result=query(`SELECT public.${chipCreateRpc}('${fixture.tour}','${name}','${body.p_request_id}','${actor}');`);
        log.push({rpc:chipCreateRpc,requestId:body.p_request_id,result});
        if(chipCreateRpc!=='get_chip_setup_create_bind_receipt_v1'){
          if(dropNext){dropNext=false;droppedKeys.add(body.p_request_id);}
          if(droppedKeys.has(body.p_request_id)){log.at(-1).responseDropped=true;res.destroy();return;}
        }
        send(200,result);return;
      }
      if(process.env.VINPOKER_FNB_BROWSER==='1'){
        const result=runFnbBrowserEdge({url,method:req.method,body,fixture,actor,query,log});
        if(result){send(result.status,result.value);return;}
      }
      if((singleTour||d2Event)&&url.pathname==='/rest/v1/rpc/get_tournament_close_readiness_v1'&&req.method==='POST') {
        assert.deepEqual(body,{p_tournament_id:fixture.tour});
        const result=query(`SELECT public.get_tournament_close_readiness_v1('${fixture.tour}');`);
        log.push({rpc:'get_tournament_close_readiness_v1',result});send(200,result);return;
      }
      if(clean637Seat&&url.pathname==='/rest/v1/rpc/confirm_registration_and_assign_seat'&&req.method==='POST'){
        assert.deepEqual(Object.keys(body).sort(),['p_registration_id','p_actor_user_id','p_draw_mode'].sort());
        assert.ok(uuid(body.p_registration_id));assert.equal(body.p_actor_user_id,actor);assert.equal(body.p_draw_mode,'random_balanced');
        assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM public.tournament_registrations WHERE id='${body.p_registration_id}' AND tournament_id='${fixture.tour}' AND player_id IN(${clean637AllowedPlayers.map(id=>`'${id}'::uuid`).join(',')}));`),'t');
        assert.equal(sql(`SELECT count(*) FROM public.cashier_buyin_movements WHERE registration_id='${body.p_registration_id}' AND tournament_id='${fixture.tour}';`),'1','one original collection required');
        const protectedBefore=clean244Proof.fingerprint();
        const result=query(`SELECT public.confirm_registration_and_assign_seat('${body.p_registration_id}','${actor}','random_balanced');`);
        assert.equal(clean244Proof.fingerprint(),protectedBefore,'seating changed financial/chip/attendance facts');
        log.push({single637:'confirm',registration:body.p_registration_id,result});send(200,result);return;
      }
      if(clean637Seat&&req.method==='GET'&&['/rest/v1/tournament_tables','/rest/v1/tournament_seats'].includes(url.pathname)){
        const tables=url.pathname.endsWith('tournament_tables'),columns=url.searchParams.get('select')?.replaceAll(' ','');
        if(columns===(tables?'id,table_name,table_number,max_seats,status,table_id,game_table_id,table_session_id':'table_id,is_active,tournament_table_id,table_session_id')){
          assert.equal(url.searchParams.get('tournament_id'),`eq.${fixture.tour}`);
          if(!tables)assert.equal(url.searchParams.get('is_active'),'eq.true');
          const result=query(`SELECT coalesce(jsonb_agg(x),'[]'::jsonb) FROM(SELECT ${columns} FROM public.${tables?'tournament_tables':'tournament_seats'} WHERE tournament_id='${fixture.tour}'${tables?'':' AND is_active'})x;`);
          log.push({single637:tables?'capacity_tables':'capacity_seats',rows:result.length});send(200,result);return;
        }
      }
      if(clean244CashierRead&&req.method==='GET'){
        const selects={tournament_registrations:'id,reference_code,status,total_pay,committed_at,confirmed_at,confirmed_by,player_id',
          tournament_entries:'id,registration_id,player_id,status,current_stack',
          seat_draw_receipts:'entry_id,registration_id,receipt_code,status,table_number,seat_number,display_name,issued_at'};
        const queueTable=url.pathname.match(/^\/rest\/v1\/(tournament_registrations|tournament_entries|seat_draw_receipts)$/)?.[1];
        const columns=url.searchParams.get('select')?.replaceAll(' ','');
        if(queueTable&&columns===selects[queueTable]){
          assert.equal(url.searchParams.get('tournament_id'),`eq.${fixture.tour}`);
          const filter=queueTable==='tournament_registrations'?" AND status IN('pending','confirmed')":queueTable==='seat_draw_receipts'?" AND status IN('issued','printed')":'';
          if(queueTable==='tournament_registrations'){
            assert.equal(url.searchParams.get('status'),'in.(pending,confirmed)');assert.equal(url.searchParams.get('limit'),'300');
          }
          if(queueTable==='seat_draw_receipts')assert.equal(url.searchParams.get('status'),'in.(issued,printed)');
          const order=queueTable==='tournament_registrations'?' ORDER BY committed_at,id LIMIT 300':queueTable==='seat_draw_receipts'?' ORDER BY issued_at DESC,entry_id':'';
          const value=query(`SELECT coalesce(jsonb_agg(x),'[]'::jsonb) FROM(SELECT ${columns} FROM public.${queueTable} WHERE tournament_id='${fixture.tour}'${filter}${order})x;`);
          log.push({queue442:queueTable,rows:value.length});send(200,value);return;
        }
        if(url.pathname==='/rest/v1/profiles'&&columns==='user_id,display_name,phone'){
          const filter=url.searchParams.get('user_id');assert.ok(filter?.startsWith('in.(')&&filter.endsWith(')'));
          const ids=filter.slice(4,-1).split(',');assert.ok(ids.length>0&&ids.length<=600&&ids.every(uuid));
          const allowed=query(`SELECT coalesce(jsonb_agg(DISTINCT id),'[]'::jsonb) FROM(SELECT player_id id FROM public.tournament_registrations WHERE tournament_id='${fixture.tour}' UNION SELECT confirmed_by FROM public.tournament_registrations WHERE tournament_id='${fixture.tour}')x WHERE id IS NOT NULL;`);
          assert.ok(ids.every(id=>allowed.includes(id)));
          const value=query(`SELECT coalesce(jsonb_agg(x),'[]'::jsonb) FROM(SELECT user_id,display_name,phone FROM public.profiles WHERE user_id IN(${ids.map(id=>`'${id}'::uuid`).join(',')}))x;`);
          log.push({queue442:'profiles',rows:value.length});send(200,value);return;
        }
      }
      if((singleTour||d2Event)&&req.method==='GET'&&['/rest/v1/tournament_registrations','/rest/v1/tournament_eliminations'].includes(url.pathname)) {
        const registration=url.pathname.endsWith('tournament_registrations');
        const columns=url.searchParams.get('select')?.replaceAll(' ','');
        if(columns===(registration?'buy_in,total_pay,reference_code,status':'position,prize')) {
          assert.equal(url.searchParams.get('tournament_id'),`eq.${fixture.tour}`);
          if(registration)assert.equal(url.searchParams.get('status'),'eq.confirmed');
          const table=registration?'tournament_registrations':'tournament_eliminations';
          const result=query(`SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM(SELECT ${columns} FROM public.${table}
            WHERE tournament_id='${fixture.tour}'${registration?" AND status='confirmed'":''}) t;`);
          log.push({read:table,closeReport:true,rows:result.length});send(200,result);return;
        }
      }
      if(single748ChipRead&&url.pathname==='/rest/v1/rpc/get_bag_tag_state'&&req.method==='POST'){
        assert.deepEqual(Object.keys(body).sort(),['p_day_number','p_tournament_id']);assert.equal(body.p_tournament_id,fixture.tour);
        assert.ok(Number.isSafeInteger(body.p_day_number)&&body.p_day_number>=1&&body.p_day_number<=365);
        const result=query(`SELECT public.get_bag_tag_state('${fixture.tour}',${body.p_day_number});`);
        log.push({rpc:'get_bag_tag_state',day:body.p_day_number,players:result.players?.length,bags:result.bags?.length,readOnly:true});
        send(200,result);return;
      }
      if((singleTour||d2Event)&&url.pathname==='/rest/v1/rpc/get_tournament_participation_counts_v1'&&req.method==='POST') {
        assert.deepEqual(body,{p_tournament_id:fixture.tour});
        const result=query(`SELECT public.get_tournament_participation_counts_v1('${fixture.tour}');`);
        if(holdChipRead('get_tournament_participation_counts_v1',res))return;
        log.push({rpc:'get_tournament_participation_counts_v1',result});send(200,result);return;
      }
      if((singleTour||d2Event)&&url.pathname==='/rest/v1/tournament_seats'&&req.method==='GET') {
        assert.equal(url.searchParams.get('select'),'player_name,chip_count');
        assert.equal(url.searchParams.get('tournament_id'),`eq.${fixture.tour}`);assert.equal(url.searchParams.get('is_active'),'eq.true');
        const result=query(`SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM(SELECT player_name,chip_count FROM public.tournament_seats WHERE tournament_id='${fixture.tour}' AND is_active ORDER BY chip_count DESC)t;`);
        log.push({read:'tournament_seats',rows:result.length});send(200,result);return;
      }
      const floorRead=url.pathname.match(/^\/rest\/v1\/rpc\/(get_floor_tournament_table_inventory_v1|get_floor_tournament_table_roster_v3|get_floor_tournament_table_roster_v6|get_floor_seatable_entries|get_floor_restorable_entries_v3|get_floor_pending_tracker_moves_v1)$/)?.[1];
      if((singleTour||d2Event)&&floorRead&&req.method==='POST') {
        assert.equal(body.p_tournament_id,fixture.tour);
        const result=query(`SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM(SELECT * FROM public.${floorRead}('${fixture.tour}')) t;`);
        log.push({rpc:floorRead,tour:fixture.tour,rows:result.length});send(200,result);return;
      }
      if(clean244Floor&&url.pathname==='/rest/v1/rpc/get_club_table_inventory'&&req.method==='POST'){
        assert.deepEqual(body,{p_club_id:fixture.club});
        const result=query(`SELECT coalesce(jsonb_agg(to_jsonb(i)),'[]'::jsonb) FROM public.get_club_table_inventory('${fixture.club}') i;`);
        log.push({rpc:'get_club_table_inventory',rows:result.length});send(200,result);return;
      }
      if(singleTour&&url.pathname==='/rest/v1/rpc/declare_club_physical_table_v1'&&req.method==='POST') {
        assert.equal(body.p_club_id,fixture.club);assert.equal(body.p_expected_actor_id,actor);
        assert.ok([30,31].includes(body.p_table_number)&&uuid(body.p_request_id));
        const result=query(`SELECT public.declare_club_physical_table_v1('${fixture.club}',${body.p_table_number},'${body.p_request_id}','${actor}');`);
        log.push({rpc:'declare_club_physical_table_v1',requestId:body.p_request_id,result});send(200,result);return;
      }
      if((singleTour||linkedD2)&&url.pathname==='/rest/v1/rpc/floor_open_tournament_table_v3'&&req.method==='POST') {
        assert.equal(body.p_tournament_id,fixture.tour);assert.ok(uuid(body.p_game_table_id)&&uuid(body.p_request_id));
        assert.ok(['manual','tracker'].includes(body.p_control_mode));
        // Retained paid journey has canonical table2; 30/31 are the separate
        // declaration canary. Never accept legacy-name-only inventory rows.
        const allowedNumbers=linkedD2?'7,8,9':existingEventFlight?'1':sidepotScope?'2,30,31':'30,31';
        assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM public.game_tables WHERE id='${body.p_game_table_id}' AND club_id='${fixture.club}' AND table_number IN(${allowedNumbers}));`),'t');
        const result=query(`SELECT public.floor_open_tournament_table_v3('${fixture.tour}','${body.p_game_table_id}','${body.p_control_mode}','${body.p_request_id}');`);
        log.push({rpc:'floor_open_tournament_table_v3',requestId:body.p_request_id,result});send(200,result);return;
      }
      if((singleTour||d2Event)&&url.pathname==='/rest/v1/rpc/close_tournament'&&req.method==='POST') {
        assert.deepEqual(Object.keys(body).sort(),['p_tournament_id','p_reason'].sort());
        assert.equal(body.p_tournament_id,fixture.tour);assert.equal(body.p_reason,'close_report');
        if(single694Close){
          assert.equal(sql(`SELECT count(*) FROM public.tournament_seats WHERE tournament_id='${fixture.tour}' AND is_active;`),'0');
          assert.equal(sql("SELECT count(*) FROM public.table_sessions WHERE id='b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5' AND closed_at IS NOT NULL AND revision=22;"),'1');
        }
        const result=query(`SELECT public.close_tournament('${fixture.tour}','close_report');`);
        log.push({rpc:'close_tournament',tour:fixture.tour,result});send(200,result);return;
      }
      if((singleTour||d2Event)&&url.pathname==='/rest/v1/rpc/close_tournament_table_v4'&&req.method==='POST') {
        assert.deepEqual(Object.keys(body).sort(),['p_tournament_table_id','p_expected_revision','p_request_id'].sort());
        assert.ok(uuid(body.p_tournament_table_id)&&uuid(body.p_request_id));
        assert.ok(Number.isSafeInteger(body.p_expected_revision)&&body.p_expected_revision>=0);
        if(single694Close){assert.equal(body.p_tournament_table_id,'c2ce77c0-2b61-4a19-bd43-4752232cc55a');assert.equal(body.p_expected_revision,21);}
        assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM public.tournament_tables WHERE id='${body.p_tournament_table_id}' AND tournament_id='${fixture.tour}');`),'t');
        const result=query(`SELECT public.close_tournament_table_v4('${body.p_tournament_table_id}',${body.p_expected_revision},'${body.p_request_id}');`);
        log.push({rpc:'close_tournament_table_v4',requestId:body.p_request_id,result});send(200,result);return;
      }
      const breakRpc=url.pathname.match(/^\/rest\/v1\/rpc\/(floor_plan_break_table_v1|floor_break_table_v5)$/)?.[1];
      if((singleTour||linkedD2)&&breakRpc&&req.method==='POST') {
        if(single655Break){assert.ok(breakRpc==='floor_plan_break_table_v1'||single655Queue);assert.equal(body.p_tournament_table_id,'174d8c97-ed28-4170-9053-813ccb50ec89');if(breakRpc==='floor_break_table_v5'){assert.equal(body.p_plan_hash,'6a2b0ef42bba0c08ebfd1887c7f40cc4');assert.equal(body.p_expected_revision,5);}}
        assert.deepEqual(Object.keys(body).sort(),['p_tournament_table_id','p_expected_revision','p_draw_mode',
          ...(breakRpc==='floor_break_table_v5'?['p_request_id','p_plan_hash']:[])].sort());
        assert.ok(uuid(body.p_tournament_table_id));
        assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM public.tournament_tables WHERE id='${body.p_tournament_table_id}' AND tournament_id='${fixture.tour}');`),'t');
        assert.ok(Number.isSafeInteger(body.p_expected_revision)&&body.p_expected_revision>=0);
        assert.ok(['fill_lowest_table','redraw_balanced'].includes(body.p_draw_mode));
        let args=`p_tournament_table_id=>'${body.p_tournament_table_id}'::uuid,p_expected_revision=>${body.p_expected_revision}::bigint,p_draw_mode=>'${body.p_draw_mode}'::text`;
        if(breakRpc==='floor_break_table_v5') {
          assert.ok(uuid(body.p_request_id));assert.match(body.p_plan_hash??'',/^[a-f0-9]{32,64}$/);
          args+=`,p_request_id=>'${body.p_request_id}'::uuid,p_plan_hash=>'${body.p_plan_hash}'::text`;
        }
        const result=query(`SELECT public.${breakRpc}(${args});`);
        log.push({rpc:breakRpc,requestId:body.p_request_id??null,result});send(200,result);return;
      }
      const playerMutation=url.pathname.match(/^\/rest\/v1\/rpc\/(floor_bust_player_v3|floor_free_sit_player_v1|floor_restore_busted_player_to_seat_v5|get_floor_restore_receipt_v1|cancel_floor_restore_request_v1)$/)?.[1];
      if((singleTour||d2Event)&&playerMutation&&req.method==='POST') {
        if(single694Close){
          assert.equal(playerMutation,'floor_free_sit_player_v1');assert.equal(body.p_entry_id,'129884e6-d2e4-4795-ade1-5bb1905e784f');
          assert.equal(body.p_expected_revision,20);assert.equal(body.p_expected_control_epoch,5);assert.equal(body.p_expected_chip_count,180000);
          assert.equal(body.p_reason,'floor_v3_operator_free_sit');
        }
        if(single649Restore){
          assert.equal(body.p_entry_id,'c08959a4-38f8-4df9-8fd4-033c1bdf8a9e');
          assert.notEqual(playerMutation,'floor_free_sit_player_v1');
          if(playerMutation==='floor_bust_player_v3')assert.equal(body.p_expected_chip_count,19900);
          else {
            assert.equal(body.p_expected_table_session_id,'b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5');
            assert.equal(body.p_to_tournament_table_id,'c2ce77c0-2b61-4a19-bd43-4752232cc55a');
            assert.equal(body.p_to_seat_number,7);
          }
        }
        assert.ok(uuid(body.p_entry_id)&&uuid(body.p_request_id));
        assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM public.tournament_entries WHERE id='${body.p_entry_id}' AND tournament_id='${fixture.tour}');`),'t');
        const schema=['floor_bust_player_v3','floor_free_sit_player_v1'].includes(playerMutation)
          ?{p_entry_id:'uuid',p_expected_revision:'bigint',p_expected_control_epoch:'bigint',p_expected_chip_count:'integer',p_request_id:'uuid',p_reason:'text'}
          :{p_entry_id:'uuid',p_expected_table_session_id:'uuid',p_to_tournament_table_id:'uuid',p_to_seat_number:'integer',p_expected_revision:'bigint',p_expected_control_epoch:'bigint',p_request_id:'uuid'};
        assert.deepEqual(Object.keys(body).sort(),Object.keys(schema).sort());
        const args=Object.entries(schema).map(([key,type])=>{
          const value=body[key];
          if(type==='uuid')assert.ok(uuid(value));
          else if(type==='text')assert.ok(typeof value==='string'&&value.length<=256);
          else assert.ok(Number.isSafeInteger(value)&&value>=0);
          return `${key}=>'${String(value).replaceAll("'","''")}'::${type}`;
        }).join(',');
        if(body.p_to_tournament_table_id)assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM public.tournament_tables WHERE id='${body.p_to_tournament_table_id}' AND tournament_id='${fixture.tour}' AND table_session_id='${body.p_expected_table_session_id}');`),'t');
        const result=query(`SELECT public.${playerMutation}(${args});`);
        log.push({rpc:playerMutation,entry:body.p_entry_id,requestId:body.p_request_id,result});
        if(single649Restore&&playerMutation==='floor_restore_busted_player_to_seat_v5'&&result.ok===true){
          if(dropNext){dropNext=false;droppedKeys.add(body.p_request_id);}
          if(droppedKeys.has(body.p_request_id)){log.at(-1).responseDropped=true;send(503,{message:'LOCAL_RESTORE_RESPONSE_LOST_AFTER_COMMIT'});return;}
        }
        send(200,result);return;
      }
      const singleMode=url.pathname.match(/^\/rest\/v1\/rpc\/(floor_get_table_control_mode_request_v1|floor_request_table_control_mode_v4|floor_cancel_table_control_mode_request_v1)$/)?.[1];
      if((singleTour||d2Event)&&singleMode&&req.method==='POST') {
        if(single645Mode||single649Restore){
          const fields=['p_tournament_table_id','p_table_session_id',...(singleMode==='floor_request_table_control_mode_v4'?['p_control_mode','p_expected_revision','p_expected_epoch','p_request_id']:singleMode==='floor_cancel_table_control_mode_request_v1'?['p_mode_request_id']:[])];
          assert.deepEqual(Object.keys(body).sort(),fields.sort());
        }
        assert.ok(uuid(body.p_tournament_table_id)&&uuid(body.p_table_session_id));
        if(single655Break){assert.equal(body.p_tournament_table_id,'c2ce77c0-2b61-4a19-bd43-4752232cc55a');assert.equal(body.p_table_session_id,'b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5');if(singleMode==='floor_request_table_control_mode_v4')assert.equal(body.p_control_mode,'tracker');}
        if(single649Restore){
          assert.equal(body.p_tournament_table_id,'c2ce77c0-2b61-4a19-bd43-4752232cc55a');
          assert.equal(body.p_table_session_id,'b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5');
          if(singleMode==='floor_request_table_control_mode_v4')assert.equal(body.p_control_mode,'manual');
        }
        assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM public.tournament_tables t JOIN public.table_sessions s ON s.id=t.table_session_id
          WHERE t.id='${body.p_tournament_table_id}' AND s.id='${body.p_table_session_id}'
           AND t.tournament_id='${fixture.tour}' AND s.tournament_id=t.tournament_id AND s.club_id='${fixture.club}');`),'t');
        let args=`'${body.p_tournament_table_id}','${body.p_table_session_id}'`;
        if(singleMode==='floor_request_table_control_mode_v4') {
          assert.ok(['manual','tracker'].includes(body.p_control_mode)&&uuid(body.p_request_id));
          assert.ok(Number.isSafeInteger(body.p_expected_revision)&&body.p_expected_revision>=0);
          assert.ok(Number.isSafeInteger(body.p_expected_epoch)&&body.p_expected_epoch>=0);
          args+=`,'${body.p_control_mode}',${body.p_expected_revision},${body.p_expected_epoch},'${body.p_request_id}'`;
        } else if(singleMode==='floor_cancel_table_control_mode_request_v1') {
          assert.ok(uuid(body.p_mode_request_id));args+=`,'${body.p_mode_request_id}'`;
        }
        const result=query(`SELECT public.${singleMode}(${args});`);
        log.push({rpc:singleMode,requestId:body.p_request_id??null,result});send(200,result);return;
      }
      if((singleTour||d2Event)&&url.pathname==='/functions/v1/tournament-live-clock'&&req.method==='POST') {
        if(single646Start)assert.equal(body.action,'start','only activate the existing first blind level in this stage');
        const response=await runClockBrowserEdge({body,fixture,user,query,log});
        send(response.status,await response.json());return;
      }
      if(singleTour&&['/functions/v1/tournament-register','/functions/v1/tournament-reentry'].includes(url.pathname)&&req.method==='POST') {
        const reentry=url.pathname.endsWith('tournament-reentry');
        assert.equal(reentry,!!reentryPlayer,'use the explicit local player re-entry fixture only');
        assert.equal(body.tournament_id,fixture.tour);
        const response=await runRegisterBrowserEdge({body,fixture,user,sql,log,reentry});
        const result=await response.json();
        if((freshRegistrationScope||clean244Member)&&dropNext&&response.status===200){dropNext=false;log.push({rpc:'tournament-register',fault:'LOCAL_REGISTRATION_RESPONSE_LOSS_AFTER_COMMIT',alreadyRegistered:result.already_registered});res.destroy();return;}
        if(freshRegistrationScope&&registrationMalformed&&response.status===200){
          assert.equal(result.already_registered,true,'malformed observation must only use an existing registration');
          registrationMalformed=false;log.push({rpc:'tournament-register',fault:'LOCAL_EXISTING_REGISTRATION_MALFORMED_OBSERVATION',registration:result.registration_id});
          send(200,null);return;
        }
        send(response.status,result);return;
      }
      if(singleTour&&url.pathname==='/rest/v1/rpc/resolve_cashier_cash_buyin_intent_v1'&&req.method==='POST') {
        const i=body.p_intent;assert.ok(i&&typeof i==='object');
        if(single667Pay){assert.equal(i.registration_id,'7ac99c8b-d9a9-45ef-bc92-6b59f84ae806');assert.equal(i.amount,100000);}
        assert.deepEqual(Object.keys(i).sort(),['actor_id','club_id','tournament_id','registration_id','amount','request_id'].sort());
        assert.equal(i.actor_id,actor);assert.equal(i.club_id,fixture.club);assert.equal(i.tournament_id,fixture.tour);
        assert.ok(uuid(i.registration_id)&&uuid(i.request_id));
        const localCashLimit=existingEventFlight
          ?Number(sql(`SELECT total_pay FROM public.tournament_registrations WHERE id='${i.registration_id}' AND tournament_id='${fixture.tour}' AND club_id='${fixture.club}';`))
          :100000;
        if(existingEventFlight)assert.equal(localCashLimit,115000,'exact linked flight frozen registration price required');
        assert.ok(Number.isSafeInteger(i.amount)&&i.amount>0&&i.amount<=localCashLimit);
        assert.ok(['record','read','cancel'].includes(body.p_action));
        assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM public.tournament_registrations WHERE id='${i.registration_id}' AND tournament_id='${fixture.tour}' AND club_id='${fixture.club}');`),'t');
        const result=query(`SELECT public.resolve_cashier_cash_buyin_intent_v1('${JSON.stringify(i)}'::jsonb,'${body.p_action}');`);
        log.push({rpc:'resolve_cashier_cash_buyin_intent_v1',action:body.p_action,requestId:i.request_id,result});
        if(body.p_action==='record') {
          if(dropNext){droppedKeys.add(i.request_id);dropNext=false;}
          if(droppedKeys.has(i.request_id)){log.at(-1).responseDropped=true;res.destroy();return;}
        }
        send(200,result);return;
      }
      if(singleTour&&url.pathname==='/rest/v1/cashier_refund_requests'&&req.method==='GET') {
        assert.equal(url.searchParams.get('select'),'id,amount,status,reason');
        const id=url.searchParams.get('registration_id')?.slice(3);assert.ok(uuid(id));
        assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM public.tournament_registrations WHERE id='${id}' AND tournament_id='${fixture.tour}');`),'t');
        const rows=query(`SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM(SELECT id,amount,status,reason FROM public.cashier_refund_requests WHERE registration_id='${id}') t;`);
        assert.ok(rows.length<=1);send(200,rows[0]??null);return;
      }
      const capabilityRpc=url.pathname.match(/^\/rest\/v1\/rpc\/(get_my_ops_capability_scope|get_my_ops_global_capability)$/)?.[1];
      if(singleTour&&capabilityRpc&&req.method==='POST') {
        assert.deepEqual(body,{});
        if(capabilityRpc==='get_my_ops_capability_scope'&&opsCapabilityReadFault){
          opsCapabilityReadFault=false;log.push({rpc:capabilityRpc,fault:'503_ONCE'});
          send(503,{code:'LOCAL_OPS_SCOPE_READ_UNAVAILABLE',message:'Local capability read temporarily unavailable'});return;
        }
        const result=query(`SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM(SELECT * FROM public.${capabilityRpc}()) t;`);
        log.push({rpc:capabilityRpc,result});send(200,result);return;
      }
      if(singleTour&&url.pathname==='/rest/v1/clubs'&&req.method==='GET'&&url.searchParams.get('select')==='id,name') {
        assert.equal(url.searchParams.get('id'),`in.(${fixture.club})`);
        send(200,query(`SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM(SELECT id,name FROM public.clubs WHERE id='${fixture.club}') t;`));return;
      }
      if(singleTour&&url.pathname==='/rest/v1/cashier_till_shifts'&&req.method==='GET') {
        assert.equal(url.searchParams.get('club_id'),`eq.${fixture.club}`);
        const columns=url.searchParams.get('select'),closed=url.searchParams.get('closed_at');
        assert.ok(closed==='is.null'||closed==='not.is.null');
        assert.equal(columns,closed==='is.null'?'id,opening_cash,opened_at':'id,opening_cash,opened_at,closed_at,counted_cash,expected_cash,variance_cash');
        const rows=query(`SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM(SELECT ${columns} FROM public.cashier_till_shifts
          WHERE club_id='${fixture.club}' AND closed_at IS ${closed==='is.null'?'':'NOT '}NULL ORDER BY opened_at DESC LIMIT 20) t;`);
        send(200,String(req.headers.accept??'').includes('vnd.pgrst.object')?(rows[0]??null):rows);return;
      }
      if(clean244CashierPay&&url.pathname==='/rest/v1/rpc/cashier_open_shift_v1'&&req.method==='POST'){
        assert.deepEqual(body,{p_club_id:fixture.club,p_opening_cash:0});
        const result=query(`SELECT public.cashier_open_shift_v1('${fixture.club}',0);`);
        log.push({rpc:'cashier_open_shift_v1',result});send(200,result);return;
      }
      const cashierRead=url.pathname.match(/^\/rest\/v1\/rpc\/(cashier_tour_worklist_v1|cashier_tour_issues_v1|cashier_shift_summary_v1)$/)?.[1];
      if(singleTour&&cashierRead&&req.method==='POST') {
        let args;
        if(cashierRead==='cashier_shift_summary_v1') {
          assert.ok(uuid(body.p_shift_id));
          assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM public.cashier_till_shifts WHERE id='${body.p_shift_id}' AND club_id='${fixture.club}');`),'t');
          args=`'${body.p_shift_id}'`;
        }else {
          assert.equal(body.p_club_id,fixture.club);assert.ok(body.p_tournament_id===null||body.p_tournament_id===fixture.tour);
          args=`'${fixture.club}',${body.p_tournament_id===null?'NULL':`'${fixture.tour}'`}`;
          if(cashierRead==='cashier_tour_worklist_v1') {
            assert.ok(typeof body.p_query==='string'&&body.p_query.length<=128);
            assert.ok(['counter','completed','waiting_seat','needs_review','all'].includes(body.p_bucket));
            assert.ok(Number.isSafeInteger(body.p_page)&&body.p_page>=0&&body.p_page<=20);assert.equal(body.p_limit,50);
            args+=`,'${body.p_query.replaceAll("'","''")}','${body.p_bucket}',${body.p_page},50`;
          }
        }
        const result=query(`SELECT public.${cashierRead}(${args});`);log.push({rpc:cashierRead,result});
        if(cashierRead==='cashier_tour_issues_v1'&&cashierIssues266HangOnce&&body.p_tournament_id===fixture.tour){
          cashierIssues266HangOnce=false;log.push({rpc:cashierRead,fault:'LOCAL_ISSUES266_HELD_AFTER_SQL',rows:result.rows.length});
          const held={response:res,shutdown:false};hangingReads.add(held);
          res.once('close',()=>{hangingReads.delete(held);log.push({rpc:cashierRead,fault:held.shutdown?'LOCAL_ISSUES266_SERVER_SHUTDOWN':'LOCAL_ISSUES266_CLIENT_ABORTED'});});return;
        }
        if(cashierRead==='cashier_shift_summary_v1'&&cashierSummaryNullMoney){
          assert.equal(result.ok,true);assert.equal(result.club_id,fixture.club);
          log.push({rpc:cashierRead,fault:'LOCAL_SUMMARY_NULL_MONEY_AFTER_SQL',mutation:false});
          send(200,{...result,totals:{...result.totals,cash_in:null}});return;
        }
        if(cashierRead==='cashier_tour_worklist_v1'&&cashierWorklistHangOnce){
          cashierWorklistHangOnce=false;
          log.push({rpc:cashierRead,fault:'LOCAL_CASHIER_READ_HANG_AFTER_SQL',mutation:false});
          const held={response:res,shutdown:false};hangingReads.add(held);
          res.once('close',()=>{hangingReads.delete(held);log.push({rpc:cashierRead,
            fault:held.shutdown?'LOCAL_CASHIER_HANG_SERVER_SHUTDOWN':'LOCAL_CASHIER_HANG_CLIENT_ABORT',mutation:false});});
          return;
        }
        send(200,result);return;
      }
      // Exact single-day Chip Master consumer. Transport is modeled, authorization
      // and writes below execute as the real authenticated SQL actor.
      const issuanceRpc=url.pathname.match(/^\/rest\/v1\/rpc\/(chip_ops_set_issuance_v2|get_chip_issuance_receipt_v1)$/)?.[1];
      if(singleTour&&issuanceRpc&&req.method==='POST') {
        if(clean244Mode){
          assert.deepEqual(Object.keys(body).sort(),['p_expected_actor','p_expected_revision','p_issued_count','p_request_id','p_stack_template_id'].sort());
          assert.equal(body.p_stack_template_id,'ae128140-48dc-4773-8c96-87a6e0d90219');
          assert.equal(body.p_issued_count,single668Issue?9:8);assert.equal(body.p_expected_revision,single668Issue?1:0);
          assert.equal(query(`SELECT to_jsonb(public.chip_ops_coupling_on('${fixture.club}'));`),false,'clean244 issuance is coupling-OFF only; bank unchanged');
        }
        assert.equal(body.p_expected_actor,actor);assert.ok(uuid(body.p_stack_template_id)&&uuid(body.p_request_id));
        assert.ok(Number.isSafeInteger(body.p_issued_count)&&body.p_issued_count>=0&&body.p_issued_count<=100);
        assert.ok(Number.isSafeInteger(body.p_expected_revision)&&body.p_expected_revision>=0);
        assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM public.stack_template WHERE id='${body.p_stack_template_id}' AND tournament_id='${fixture.tour}');`),'t');
        const args=`'${body.p_stack_template_id}',${body.p_issued_count},${body.p_expected_revision},'${body.p_request_id}','${actor}'`;
        const result=query(`SELECT public.${issuanceRpc}(${args});`);
        log.push({rpc:issuanceRpc,tour:fixture.tour,requestId:body.p_request_id,result});
        if(issuanceRpc==='chip_ops_set_issuance_v2') {
          if(dropNext){droppedKeys.add(body.p_request_id);dropNext=false;}
          if(droppedKeys.has(body.p_request_id)){log.at(-1).responseDropped=true;res.destroy();return;}
        }
        send(200,result);return;
      }
      const chipTable=url.pathname.match(/^\/rest\/v1\/(tournament_chip_set|chip_set|chip_set_denomination|stack_template|stack_template_line|stack_template_issuance)$/)?.[1];
      if(singleTour&&chipTable&&req.method==='GET') {
        const specs={
          tournament_chip_set:['chip_set_id',`tournament_id='${fixture.tour}'`],
          chip_set:['id,name',`club_id='${fixture.club}'`],
          chip_set_denomination:['id,value,color,label,display_order',null],
          stack_template:['id,name,stack_value',`tournament_id='${fixture.tour}'`],
          stack_template_line:['stack_template_id,denomination_id,count',null],
          stack_template_issuance:['stack_template_id,issued_count',null],
        };
        const [columns,base]=specs[chipTable];assert.equal(url.searchParams.get('select'),columns);
        let where=base;
        if(['tournament_chip_set','stack_template'].includes(chipTable))assert.equal(url.searchParams.get('tournament_id'),`eq.${fixture.tour}`);
        else if(chipTable==='chip_set')assert.equal(url.searchParams.get('club_id'),`eq.${fixture.club}`);
        else if(chipTable==='chip_set_denomination') {
          const id=url.searchParams.get('chip_set_id')?.slice(3);assert.ok(uuid(id));
          assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM public.chip_set WHERE id='${id}' AND club_id='${fixture.club}');`),'t');
          where=`chip_set_id='${id}'`;
        } else {
          const filter=url.searchParams.get('stack_template_id');assert.match(filter??'',/^in\.\([a-f0-9,-]+\)$/i);
          const ids=filter.slice(4,-1).split(',');assert.ok(ids.length<=20&&ids.every(uuid));
          const list=ids.map(id=>`'${id}'::uuid`).join(',');
          assert.equal(Number(sql(`SELECT count(*) FROM public.stack_template WHERE tournament_id='${fixture.tour}' AND id=ANY(ARRAY[${list}]);`)),ids.length);
          where=`stack_template_id=ANY(ARRAY[${list}])`;
        }
        const rows=query(`SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM(SELECT ${columns} FROM public.${chipTable} WHERE ${where}) t;`);
        send(200,String(req.headers.accept??'').includes('vnd.pgrst.object')?(rows[0]??null):rows);return;
      }
      const colorRpc=url.pathname.match(/^\/rest\/v1\/rpc\/(get_color_up_history|chip_ops_color_up|chip_ops_reverse_color_up|get_chip_color_up_receipt_v1|cancel_chip_color_up_request_v1)$/)?.[1];
      if(singleTour&&colorRpc&&req.method==='POST') {
        if(single654Color){
          assert.equal(sql(`SELECT public.chip_ops_coupling_on('${fixture.club}');`),'f');
          if(colorRpc==='chip_ops_color_up'){
            assert.equal(body.p_target_added,32);
            assert.equal(sql(`SELECT count(*) FROM public.chip_set_denomination r JOIN public.chip_set_denomination t ON t.chip_set_id=r.chip_set_id
             JOIN public.tournament_chip_set b ON b.chip_set_id=r.chip_set_id WHERE b.tournament_id='${fixture.tour}'
             AND r.id='${body.p_denom_removed}' AND r.value=100 AND t.id='${body.p_denom_target}' AND t.value=500;`),'1');
          }
        }
        const schemas={get_color_up_history:{p_tournament_id:'uuid'},
          chip_ops_color_up:{p_tournament_id:'uuid',p_denom_removed:'uuid',p_denom_target:'uuid',p_target_added:'bigint',p_level_number:'integer',p_idempotency_key:'text'},
          chip_ops_reverse_color_up:{p_operation_id:'uuid',p_idempotency_key:'text'},
          get_chip_color_up_receipt_v1:{p_tournament_id:'uuid',p_operation:'text',p_request_key:'text',p_payload:'jsonb'},
          cancel_chip_color_up_request_v1:{p_tournament_id:'uuid',p_operation:'text',p_request_key:'text',p_payload:'jsonb'}};
        const schema=schemas[colorRpc];assert.deepEqual(Object.keys(body).sort(),Object.keys(schema).sort());
        if(body.p_tournament_id)assert.equal(body.p_tournament_id,fixture.tour);
        if(body.p_operation_id){assert.ok(uuid(body.p_operation_id));assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM public.color_up_operation WHERE id='${body.p_operation_id}' AND tournament_id='${fixture.tour}');`),'t');}
        const args=Object.entries(schema).map(([key,type])=>{
          const value=body[key];
          if(value===null){assert.equal(key,'p_level_number');return `${key}=>NULL::integer`;}
          if(type==='uuid')assert.ok(uuid(value));
          else if(type==='text')assert.ok(typeof value==='string'&&value.length>0&&value.length<=128);
          else if(type==='jsonb')assert.ok(value&&typeof value==='object'&&!Array.isArray(value));
          else assert.ok(Number.isSafeInteger(value)&&value>=0);
          return `${key}=>'${(type==='jsonb'?JSON.stringify(value):String(value)).replaceAll("'","''")}'::${type}`;
        }).join(',');
        const result=query(`SELECT public.${colorRpc}(${args});`);
        const requestId=body.p_idempotency_key??body.p_request_key??null;
        log.push({rpc:colorRpc,requestId,result});
        if(['chip_ops_color_up','chip_ops_reverse_color_up'].includes(colorRpc)){
          if(dropNext){droppedKeys.add(requestId);dropNext=false;}
          if(droppedKeys.has(requestId)){log.at(-1).responseDropped=true;res.destroy();return;}
        }
        send(200,result);return;
      }
      const chipRpc=url.pathname.match(/^\/rest\/v1\/rpc\/(get_chip_issuance_state_v1|get_current_chip_inventory|get_chip_bank|chip_ops_create_chip_set|chip_ops_bind_tournament_chip_set|chip_ops_add_denomination|chip_ops_save_stack_template)$/)?.[1];
      if(singleTour&&chipRpc&&req.method==='POST') {
        const text=(value)=>{assert.ok(typeof value==='string'&&value.length<=128);return `'${value.replaceAll("'","''")}'`;};
        let args;
        if(chipRpc==='get_chip_issuance_state_v1') {
          assert.equal(body.p_expected_actor,actor);assert.ok(uuid(body.p_stack_template_id));
          assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM public.stack_template WHERE id='${body.p_stack_template_id}' AND tournament_id='${fixture.tour}');`),'t');
          args=`'${body.p_stack_template_id}','${actor}'`;
        }
        else if(chipRpc==='get_chip_bank'){assert.equal(body.p_club_id,fixture.club);args=`'${fixture.club}'`;}
        else if(chipRpc==='chip_ops_create_chip_set') {
          assert.equal(body.p_club_id,fixture.club);assert.equal(body.p_name,'Single-day browser TEST chips');
          args=`'${fixture.club}',${text(body.p_name)}`;
        } else if(chipRpc==='chip_ops_add_denomination') {
          assert.ok(uuid(body.p_chip_set_id));
          assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM public.tournament_chip_set WHERE tournament_id='${fixture.tour}' AND chip_set_id='${body.p_chip_set_id}');`),'t');
          assert.ok(Number.isSafeInteger(body.p_value)&&body.p_value>0&&Number.isSafeInteger(body.p_display_order));
          args=`'${body.p_chip_set_id}',${body.p_value},${text(body.p_color)},NULL,${body.p_display_order}`;
        } else {
          assert.equal(body.p_tournament_id,fixture.tour);args=`'${fixture.tour}'`;
          if(chipRpc==='chip_ops_bind_tournament_chip_set') {
            assert.ok(uuid(body.p_chip_set_id));
            assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM public.chip_set WHERE id='${body.p_chip_set_id}' AND club_id='${fixture.club}' AND name='Single-day browser TEST chips');`),'t');
            args+=`,'${body.p_chip_set_id}'`;
          } else if(chipRpc==='chip_ops_save_stack_template') {
            assert.equal(body.p_name,'Single-day 20k TEST');assert.equal(body.p_stack_value,20000);
            assert.ok(Array.isArray(body.p_lines)&&body.p_lines.length>0&&body.p_lines.length<=10);
            for(const row of body.p_lines)assert.ok(uuid(row.denomination_id)&&Number.isSafeInteger(row.count)&&row.count>0);
            args+=`,${text(body.p_name)},20000,'${JSON.stringify(body.p_lines)}'::jsonb`;
          }
        }
        const result=query(`SELECT public.${chipRpc}(${args});`);
        if(chipRpc==='get_current_chip_inventory'&&corruptChipCount){
          assert.equal(result.tournament_id,fixture.tour);assert.ok(result.denominations.length>0);
          corruptChipCount=false;
          const malformed=structuredClone(result);malformed.denominations[0].current_count=null;
          log.push({rpc:chipRpc,fault:'LOCAL_NULL_COUNT_AFTER_SQL',mutation:false});send(200,malformed);return;
        }
        if(chipRpc==='get_chip_bank'&&holdChipRead(chipRpc,res))return;
        log.push({rpc:chipRpc,tour:fixture.tour,result});send(200,result);return;
      }
      if(rulesRecovery&&url.pathname==='/rest/v1/rpc/multi_day_set_qualification_rules_v2'&&req.method==='POST'){
        assert.deepEqual(body,rulesRecovery.args);
        const a=rulesRecovery.args;
        const result=query(`SELECT public.multi_day_set_qualification_rules_v2('${d2Event}','${a.p_policy}',${a.p_min_cash_x},${a.p_day2_percent});`);
        assert.equal(result.ok,true);assert.equal(result.idempotent,true);
        log.push({rpc:'multi_day_set_qualification_rules_v2',args:body,result});
        if(rulesFault){rulesFault=false;log.push({rpc:'multi_day_set_qualification_rules_v2',fault:'LOCAL_EXISTING_RULES_RESPONSE_LOSS'});
          send(503,{message:'LOCAL_EXISTING_RULES_RESPONSE_LOSS'});return;}
        send(200,result);return;
      }
      if(url.pathname==='/rest/v1/rpc/multi_day_lock_qualification_v1'&&req.method==='POST') {
        if(qualificationRecovery)assert.deepEqual(body,qualificationRecovery.args,'only the exact committed qualification may replay');
        assert.ok(d2Event);assert.equal(body.p_event_id,d2Event);assert.ok(uuid(body.p_request_id));
        assert.match(body.p_expected_source_hash,/^[a-f0-9]{32}$/);
        assert.ok(Array.isArray(body.p_bag_ids)&&body.p_bag_ids.length>0&&body.p_bag_ids.length<=100&&body.p_bag_ids.every(uuid));
        const ids=body.p_bag_ids.map(id=>`'${id}'::uuid`).join(',');
        const result=query(`SELECT public.multi_day_lock_qualification_v1('${d2Event}',ARRAY[${ids}],'${body.p_expected_source_hash}','${body.p_request_id}');`);
        log.push({rpc:'multi_day_lock_qualification_v1',requestId:body.p_request_id,bags:body.p_bag_ids,result});
        if(qualificationRecovery){assert.equal(result.idempotent,true);assert.equal(result.policy,qualificationRecovery.policy);
          if(qualificationFault){qualificationFault=false;log.push({rpc:'multi_day_lock_qualification_v1',fault:'LOCAL_EXISTING_QUALIFICATION_RESPONSE_LOSS'});send(503,{message:'LOCAL_EXISTING_QUALIFICATION_RESPONSE_LOSS'});return;}}
        send(200,result);return;
      }
      const eventRead=url.pathname.match(/^\/rest\/v1\/rpc\/(multi_day_floor_read_v1|multi_day_qualification_preview_v1|multi_day_payout_preview_v1|multi_day_payout_postfinal_state_v1)$/);
      if(url.pathname==='/rest/v1/rpc/multi_day_finalize_payout_v1'&&req.method==='POST') {
        if(finalizationRecovery)assert.deepEqual(body,finalizationRecovery.args,'only the exact committed TEST receipt may replay');
        assert.ok(d2Event);assert.equal(body.p_event_id,d2Event);assert.ok(uuid(body.p_request_id));
        const hashes=['p_expected_rules_version','p_expected_funding_revision','p_expected_qualification_revision','p_expected_payout_input_hash'];
        assert.deepEqual(Object.keys(body).sort(),['p_event_id','p_request_id',...hashes].sort());
        for(const key of hashes)assert.match(body[key]??'',/^[a-f0-9]{32}$/);
        const result=query(`SELECT public.multi_day_finalize_payout_v1('${d2Event}',${hashes.map(key=>`'${body[key]}'`).join(',')},'${body.p_request_id}');`);
        log.push({rpc:'multi_day_finalize_payout_v1',eventId:d2Event,requestId:body.p_request_id,result});
        if(finalizationRecovery){assert.equal(result.idempotent,true);assert.equal(result.paymentExecution,'NOT_PERFORMED');
          if(finalizationFault){finalizationFault=false;log.push({rpc:'multi_day_finalize_payout_v1',fault:'LOCAL_EXISTING_RECEIPT_RESPONSE_LOSS'});send(503,{message:'LOCAL_EXISTING_RECEIPT_RESPONSE_LOSS'});return;}}
        send(200,result);return;
      }
      if(eventRead&&req.method==='POST') {
        assert.ok(d2Event);assert.equal(body.p_event_id,d2Event);
        const result=query(`SELECT public.${eventRead[1]}('${d2Event}');`);
        log.push({rpc:eventRead[1],eventId:d2Event,result});send(200,result);return;
      }
      const bagRpc=url.pathname.match(/^\/rest\/v1\/rpc\/(multi_day_bagging_state_v1|multi_day_record_bag_v1|multi_day_seal_bag_v1|multi_day_close_bagging_v1|multi_day_get_bagging_receipt_v2)$/);
      if(bagRpc&&req.method==='POST') {
        const targetFlight=baggingFlight??existingEventFlight;
        assert.ok(targetFlight);assert.equal(body.p_flight_tournament_id,targetFlight);
        const name=bagRpc[1];let args=`'${targetFlight}'`;
        if(name!=='multi_day_bagging_state_v1') {
          assert.ok(uuid(body.p_request_id));
          if(name==='multi_day_get_bagging_receipt_v2') {
            assert.equal(body.p_expected_payload?.p_flight_tournament_id,targetFlight);
            args+=`,'${body.p_request_id}','${JSON.stringify(body.p_expected_payload).replaceAll("'","''")}'::jsonb`;
          }else if(name==='multi_day_close_bagging_v1') {
            assert.ok(Number.isSafeInteger(body.p_expected_day_version)&&body.p_expected_day_version>=0);
            args+=`,${body.p_expected_day_version},'${body.p_request_id}'`;
          }else {
            assert.ok(uuid(body.p_player_id)&&Number.isSafeInteger(body.p_expected_revision)&&body.p_expected_revision>=0);
            args+=`,'${body.p_player_id}'`;
            if(name==='multi_day_record_bag_v1') {
              assert.ok(typeof body.p_bag_code==='string'&&body.p_bag_code.length<=128&&Number.isSafeInteger(body.p_total_value)&&body.p_total_value>=0);
              args+=`,'${body.p_bag_code.replaceAll("'","''")}',${body.p_total_value}`;
            }
            args+=`,${body.p_expected_revision},'${body.p_request_id}'`;
          }
        }
        const statement=`SELECT public.${name}(${args});`;
        const result=existingEventFlight?main167Bridge.runBagging(statement):query(statement);
        log.push({rpc:name,requestId:body.p_request_id??null,result});
        if(['multi_day_record_bag_v1','multi_day_seal_bag_v1','multi_day_close_bagging_v1'].includes(name)) {
          if(dropNext){droppedKeys.add(body.p_request_id);dropNext=false;}
          if(droppedKeys.has(body.p_request_id)){log.at(-1).responseDropped=true;res.destroy();return;}
        }
        send(200,result);return;
      }
      if(url.pathname==='/rest/v1/rpc/get_dealer_swing_health'&&req.method==='POST') {
        assert.ok(Array.isArray(body.p_club_ids)&&body.p_club_ids.length<=2);
        assert.ok(body.p_club_ids.every(id=>id===fixture.club||id==='00000000-0000-4000-8000-000000000099'));
        const ids=body.p_club_ids.map(id=>`'${id}'::uuid`).join(',');
        const value=query(`SELECT public.get_dealer_swing_health(ARRAY[${ids}]::uuid[]);`);
        log.push({rpc:'get_dealer_swing_health',requested:body.p_club_ids,returned:value.map(row=>row.club_id)});
        send(200,value);return;
      }
      if (url.pathname === '/auth/v1/user') { log.push({auth:'user_read'});send(200, user); return; }
      const editRpc=url.pathname.match(/^\/rest\/v1\/rpc\/(get_tournament_edit_context_v1|edit_tournament_with_levels_v1|get_tournament_edit_receipt_v1)$/)?.[1];
      if(editRpc&&req.method==='POST'){
        assert.ok(editCanary);assert.equal(body.p_tournament_id,editCanary);assert.equal(body.p_expected_actor_id,actor);
        let args=`'${editCanary}','${actor}'`;
        if(editRpc!=='get_tournament_edit_context_v1'){
          assert.equal(body.p_club_id,fixture.club);assert.ok(uuid(body.p_request_id));
          assert.deepEqual(Object.keys(body).sort(),['p_tournament_id','p_club_id','p_expected_actor_id','p_request_id','p_expected_state','p_config','p_levels'].sort());
          const json=value=>`'${JSON.stringify(value).replaceAll("'","''")}'::jsonb`;
          args=`'${editCanary}','${fixture.club}',${json(body.p_expected_state)},${json(body.p_config)},${body.p_levels===null?'NULL':json(body.p_levels)},'${body.p_request_id}','${actor}'`;
        }else assert.deepEqual(Object.keys(body).sort(),['p_tournament_id','p_expected_actor_id'].sort());
        const value=query(`SELECT public.${editRpc}(${args});`);
        log.push({rpc:editRpc,tour:editCanary,requestId:body.p_request_id??null,method:req.method,sdkRetryCount:req.headers['x-retry-count']??null,clientInfo:req.headers['x-client-info']??null,receivedAt:Date.now(),outcome:value.error??value.ok,result:value});
        if(editRpc==='edit_tournament_with_levels_v1'&&value.ok===true){
          if(dropNext){droppedKeys.add(body.p_request_id);dropNext=false;}
          if(droppedKeys.has(body.p_request_id)){
            log.at(-1).responseDropped=true;
            if(process.env.VINPOKER_EDIT_LOSS_AFTER_HEADERS==='1'){
              log.at(-1).faultStage='body_after_headers';
              res.writeHead(200,{'Content-Type':'application/json','Content-Length':Buffer.byteLength(JSON.stringify(value)),'Access-Control-Allow-Origin':'*'});
              res.flushHeaders();res.write('{');setTimeout(()=>res.destroy(),25);return;
            }
            log.at(-1).faultStage='before_headers';res.destroy();return;
          }
        }
        send(200,value);return;
      }
      if(url.pathname==='/__local/main-event-response-recovery'&&req.method==='POST'){
        assert.ok(sidepotScope);mainEventDroppedKeys.clear();log.push({fault:'LOCAL_MAIN_EVENT_RESPONSE_RESTORED'});send(200,{restored:true});return;
      }
      const eventCreateRpc=url.pathname.match(/^\/rest\/v1\/rpc\/(create_tournament_event_with_flights_v2|get_tournament_event_create_receipt_v1)$/)?.[1];
      if(eventCreateRpc&&req.method==='POST'){
        assert.ok(sidepotScope&&!d2Event);assert.equal(body.p_expected_actor_id,actor);assert.equal(body.p_club_id,fixture.club);assert.ok(uuid(body.p_request_id));
        assert.ok(['Main Event browser local TEST 163','Main Event browser local TEST 164'].includes(body.p_config?.name));assert.equal(body.p_config.flight_count,2);
        assert.ok(Array.isArray(body.p_levels)&&body.p_levels.length<=100);
        const config=JSON.stringify(body.p_config).replaceAll("'","''"),levels=JSON.stringify(body.p_levels).replaceAll("'","''");
        const value=query(`SELECT public.${eventCreateRpc}('${fixture.club}','${config}'::jsonb,'${levels}'::jsonb,'${body.p_request_id}','${actor}');`);
        log.push({rpc:eventCreateRpc,requestId:body.p_request_id,event:value.event_id,final:value.final_tournament_id,flights:value.flight_count,levels:value.level_count,outcome:value.error??value.ok});
        if(eventCreateRpc==='create_tournament_event_with_flights_v2'&&value.ok===true&&dropNext){mainEventDroppedKeys.add(body.p_request_id);dropNext=false;}
        if(mainEventDroppedKeys.has(body.p_request_id)){log.at(-1).responseDropped=true;send(503,{message:'LOCAL_MAIN_EVENT_RESPONSE_LOST_AFTER_COMMIT'});return;}
        send(200,value);return;
      }
      const createRpc=url.pathname.match(/^\/rest\/v1\/rpc\/(create_tournament_with_levels_v1|get_tournament_create_receipt_v1)$/)?.[1];
      if(createRpc&&req.method==='POST') {
        assert.ok(d2Event);assert.equal(body.p_expected_actor_id,actor);assert.equal(body.p_club_id,fixture.club);assert.ok(uuid(body.p_request_id));
        assert.equal(body.p_config?.name,'Single-day browser local TEST');assert.ok(Array.isArray(body.p_levels)&&body.p_levels.length<=100);
        const config=JSON.stringify(body.p_config).replaceAll("'","''"),levels=JSON.stringify(body.p_levels).replaceAll("'","''");
        const value=query(`SELECT public.${createRpc}('${fixture.club}','${config}'::jsonb,'${levels}'::jsonb,'${body.p_request_id}','${actor}');`);
        log.push({rpc:createRpc,requestId:body.p_request_id,tour:value.tournament_id,levels:value.level_count,outcome:value.error??value.ok});
        if(createRpc==='create_tournament_with_levels_v1'&&value.ok===true&&dropNext){droppedKeys.add(body.p_request_id);dropNext=false;}
        if(droppedKeys.has(body.p_request_id)){log.at(-1).responseDropped=true;res.destroy();return;}
        send(200,value);return;
      }
      if(url.pathname==='/functions/v1/parse-tournament-schedule'&&req.method==='POST') {
        assert.ok(d2Event);assert.ok(['image/png','image/jpeg','image/webp'].includes(body.image_mime));
        assert.ok(typeof body.image_base64==='string'&&body.image_base64.length>=100);
        log.push({externalModel:'OCR_FIXED_TEST_ROWS_NO_PROVIDER_CALL'});
        send(200,{tournaments:[1,2].map(i=>({name:`Schedule browser ${runId} TEST ${i}`,start_time:'2026-10-19T10:00:00+07:00',buy_in:100000,starting_stack:20000,game_type:'nlh',venue:null}))});return;
      }
      const scheduleRpc=url.pathname.match(/^\/rest\/v1\/rpc\/(create_tournament_schedule_batch_v1|get_tournament_schedule_batch_receipt_v1|cancel_tournament_schedule_batch_v1)$/)?.[1];
      if(scheduleRpc&&req.method==='POST') {
        assert.ok(d2Event);assert.equal(body.p_expected_actor_id,actor);assert.ok(uuid(body.p_request_id));
        assert.ok(Array.isArray(body.p_rows)&&body.p_rows.length===2);
        for(const row of body.p_rows) {
          assert.equal(row.club_id,fixture.club);assert.match(row.name,/^Schedule browser [a-f0-9-]{36} TEST [12]$/);
          assert.deepEqual(Object.keys(row).sort(),['club_id','name','start_time','buy_in','starting_stack','game_type','location'].sort());
          assert.equal(row.buy_in,100000);assert.equal(row.starting_stack,20000);assert.equal(row.game_type,'nlh');
        }
        const encoded=JSON.stringify(body.p_rows).replaceAll("'","''");
        const result=query(`SELECT public.${scheduleRpc}('${encoded}'::jsonb,'${body.p_request_id}','${actor}');`);
        log.push({rpc:scheduleRpc,requestId:body.p_request_id,outcome:result.outcome??result.error??'created',tours:result.tournaments?.map(t=>t.tournament_id)});
        if(scheduleRpc==='create_tournament_schedule_batch_v1'&&result.ok===true&&dropNext){droppedKeys.add(body.p_request_id);dropNext=false;}
        if(droppedKeys.has(body.p_request_id)){log.at(-1).responseDropped=true;res.destroy();return;}
        send(200,result);return;
      }
      if(historicalDisplayBridge&&url.pathname==='/functions/v1/tournament-historical-settlement'&&req.method==='POST'){
        const result=await historicalDisplayBridge.invoke(body);
        send(result.status,result.body);return;
      }
      if(url.pathname==='/functions/v1/tournament-live-update'&&req.method==='POST') {
        assert.ok(d2Event||sidepotScope||existingEventFlight||single646Start||single647Hand||single655Break,'exact original Tracker canary opt-in required');
        if(single655Break&&!single656Finish){assert.equal(body.action,'start_hand');assert.equal(body.tournament_id,'c367013a-3ed3-48af-ad48-3915acadc50e');assert.equal(body.tournament_table_id,'c2ce77c0-2b61-4a19-bd43-4752232cc55a');assert.equal(body.table_session_id,'b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5');assert.equal(body.control_epoch,4);}
        if(single656Finish){assert.ok(['record_action','update_community_cards','show_manual_cards_v1','get_manual_card_receipt_v1','record_manual_hand_v1','get_manual_finish_receipt_v1','cancel_manual_finish_v1'].includes(body.action));assert.equal(body.tournament_id,fixture.tour);assert.equal(body.hand_id??body.finish_intent?.hand_id,'2ee4ebe0-f8bd-49a5-b3ed-dd0a2ea4e4a8');}
        if(single647Hand){
          assert.ok([...((single664Hand||single678Hand||single682Hand||single684Hand||singleFinalHand)?['start_hand']:[]),...(single678Hand?['undo_last_action_v1']:[]),'record_action','update_community_cards','show_manual_cards_v1','get_manual_card_receipt_v1','record_manual_hand_v1','get_manual_finish_receipt_v1','cancel_manual_finish_v1'].includes(body.action));
          assert.equal(body.tournament_id,'c367013a-3ed3-48af-ad48-3915acadc50e');
          if(single664Hand||single678Hand||single682Hand||single684Hand||singleFinalHand){
            if(body.action==='start_hand'){
              assert.equal(body.tournament_table_id,'c2ce77c0-2b61-4a19-bd43-4752232cc55a');assert.equal(body.table_session_id,'b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5');assert.equal(body.control_epoch,single678Hand||single682Hand||single684Hand||singleFinalHand?5:4);assert.equal(body.hand_number,singleFinalHand|| (single684Hand?6:single682Hand?5:single678Hand?4:3));
            }else{
              const hand=body.hand_id??body.finish_intent?.hand_id;assert.ok(uuid(hand));
              assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM public.tournament_hands WHERE id='${hand}' AND tournament_id='${fixture.tour}' AND table_id='c2ce77c0-2b61-4a19-bd43-4752232cc55a' AND table_session_id='b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5' AND hand_number=${singleFinalHand|| (single684Hand?6:single682Hand?5:single678Hand?4:3)});`),'t');
            }
          }else assert.equal(body.hand_id??body.finish_intent?.hand_id,'4f120026-cf38-4db3-bb05-ae6feaabf59a');
        }
        if(single646Start){
          assert.equal(body.action,'start_hand','this stage may only start the original first hand');
          assert.equal(body.tournament_id,'c367013a-3ed3-48af-ad48-3915acadc50e');
          assert.equal(body.tournament_table_id,'c2ce77c0-2b61-4a19-bd43-4752232cc55a');
          assert.equal(body.table_session_id,'b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5');
          assert.equal(body.control_epoch,2);
        }
        if(actionHangBeforeDb&&body.action==='record_action'){
          assert.equal(body.hand_id,'08730ce1-9a83-4439-96f9-ac005ae3d734');
          assert.equal(body.tournament_id,fixture.tour);
          log.push({trackerActionFault:'LOCAL_ACTION_HELD_BEFORE_DB',actionOrder:body.action_order,dbDispatched:false});
          const held={response:res,shutdown:false};hangingReads.add(held);hangingTrackerActions.add(held);
          res.once('close',()=>{hangingReads.delete(held);hangingTrackerActions.delete(held);});return;
        }
        if(finishReceiptHold&&body.action==='get_manual_finish_receipt_v1'){
          assert.equal(body.tournament_id,fixture.tour);assert.equal(body.finish_intent?.tournament_id,fixture.tour);
          assert.ok(uuid(body.finish_intent?.hand_id)&&uuid(body.finish_intent?.request_id));
          log.push({trackerReceiptFault:'LOCAL_FINISH_RECEIPT_503_BEFORE_DB',handId:body.finish_intent.hand_id,requestId:body.finish_intent.request_id});
          send(503,{error:'LOCAL_FINISH_RECEIPT_READ_UNAVAILABLE'});return;
        }
        const response=await runTrackerBrowserEdge({body,fixture,user,query,log});
        // Fault the write response and same-key write retries, not an independent
        // receipt lookup used to recover that unknown outcome after reload.
        if(['record_manual_hand_v1','undo_last_action_v1'].includes(body.action)) {
          const key=body.action==='record_manual_hand_v1'?body.finish_intent.request_id:body.idempotency_key;
          assert.ok(uuid(key));
          if(response.ok&&dropNext){droppedKeys.add(key);dropNext=false;}
          if(droppedKeys.has(key)) {
            log.push({edgeResponseDropped:body.action,requestId:key});res.destroy();return;
          }
        }
        send(response.status,await response.json());return;
      }
      if(url.pathname==='/rest/v1/tracker_floor_alerts'&&req.method==='GET') {
        assert.ok(d2Event||sidepotScope||single646Start||single647Hand||single655Break,'explicit Tracker TEST scope required');
        const rows=readTrackerAlertCounts({url,fixture,query});
        log.push({read:'tracker_floor_alerts',role:'authenticated',count:rows.length});
        send(200,rows);return;
      }
      const trackerTable=url.pathname.match(/^\/rest\/v1\/(tournament_tables|tournament_hands|hand_actions|hand_players)$/)?.[1];
      if(trackerTable&&req.method==='GET') {
        const columns=url.searchParams.get('select')?.replaceAll(' ','');
        const permitted={tournament_tables:['max_seats,table_session_id'],
          tournament_hands:['id,button_seat,status,is_voided','id,hand_number','id,hand_number,table_id,button_seat,community_cards','id,hand_number,table_id,button_seat,community_cards,tracker_sb_position,tracker_bb_position','button_seat,status,is_voided,tracker_sb_position,tracker_bb_position',
            'tracker_level_number,tracker_small_blind,tracker_big_blind,tracker_bba',
            'id,tournament_id,table_id,tournament_table_id,table_session_id,source_revision,status,is_voided','source_revision','id,source_revision'],
          hand_actions:['player_id,entry_number,action_type','player_id,action_type,action_amount,action_order,street','id'],hand_players:['player_id,entry_number,seat_number','player_id,entry_number,hole_cards']};
        assert.ok(permitted[trackerTable].includes(columns));
        let where;
        const exact=url.searchParams.get(trackerTable==='hand_actions'||trackerTable==='hand_players'?'hand_id':'id');
        if(exact) {
          assert.ok(exact.startsWith('eq.')&&uuid(exact.slice(3)));
          const id=exact.slice(3);
          where=trackerTable==='tournament_tables'?`id='${id}' AND tournament_id='${fixture.tour}'`
            :trackerTable==='tournament_hands'?`id='${id}' AND tournament_id='${fixture.tour}'`
            :`hand_id='${id}' AND EXISTS(SELECT 1 FROM public.tournament_hands h WHERE h.id='${id}' AND h.tournament_id='${fixture.tour}')`;
          if(trackerTable==='tournament_hands')for(const key of ['table_id','table_session_id']){
            const filter=url.searchParams.get(key);if(filter){assert.ok(filter.startsWith('eq.')&&uuid(filter.slice(3)));where+=` AND ${key}='${filter.slice(3)}'`;}
          }
          if(trackerTable==='tournament_hands'&&url.searchParams.has('tournament_table_id')){
            const scopedTable=single647Hand||single655Break?'c2ce77c0-2b61-4a19-bd43-4752232cc55a':sidepotScope?.table;
            assert.ok(uuid(scopedTable));assert.equal(url.searchParams.get('tournament_table_id'),`eq.${scopedTable}`);where+=` AND tournament_table_id='${scopedTable}'`;
          }
          if(trackerTable==='tournament_hands'&&url.searchParams.has('status')){assert.equal(url.searchParams.get('status'),'eq.in_progress');where+=" AND status='in_progress'";}
        } else {
          assert.equal(trackerTable,'tournament_hands');assert.equal(url.searchParams.get('tournament_id'),`eq.${fixture.tour}`);
          const table=url.searchParams.get('table_id'),session=url.searchParams.get('table_session_id');
          assert.ok(table?.startsWith('eq.')&&uuid(table.slice(3))&&session?.startsWith('eq.')&&uuid(session.slice(3)));
          where=`tournament_id='${fixture.tour}' AND table_id='${table.slice(3)}' AND table_session_id='${session.slice(3)}'`;
          if(url.searchParams.has('status')){assert.equal(url.searchParams.get('status'),'eq.in_progress');where+=" AND status='in_progress'";}
        }
        let suffix=trackerTable==='tournament_hands'&&!exact?' ORDER BY hand_number DESC LIMIT 1':trackerTable==='hand_actions'&&columns.includes('action_order')?' ORDER BY action_order ASC':'';
        if(trackerTable==='hand_actions'&&columns==='id'){
          assert.equal(url.searchParams.get('order'),'action_order.desc,created_at.desc,id.desc');
          assert.equal(url.searchParams.get('limit'),'1');suffix=' ORDER BY action_order DESC,created_at DESC,id DESC LIMIT 1';
        }
        const rows=query(`SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM(SELECT ${columns} FROM public.${trackerTable} WHERE ${where}${suffix}) t;`);
        log.push({read:trackerTable,count:rows.length});send(200,req.headers.accept?.includes('vnd.pgrst.object')?(rows[0]??null):rows);return;
      }
      if(url.pathname==='/rest/v1/profiles'&&req.method==='GET'&&url.searchParams.get('select')==='user_id, avatar_url') {
        const filter=url.searchParams.get('user_id');assert.ok(filter?.startsWith('in.(')&&filter.endsWith(')'));
        const ids=filter.slice(4,-1).split(',');assert.ok(ids.length<=9&&ids.every(uuid));
        const list=ids.map(id=>`'${id}'::uuid`).join(',');
        assert.equal(Number(sql(`SELECT count(DISTINCT player_id) FROM public.tournament_seats WHERE tournament_id='${fixture.tour}' AND player_id=ANY(ARRAY[${list}]);`)),ids.length);
        send(200,query(`SELECT coalesce(jsonb_agg(p),'[]'::jsonb) FROM(SELECT user_id,avatar_url FROM public.profiles WHERE user_id=ANY(ARRAY[${list}])) p;`));return;
      }
      if(url.pathname==='/rest/v1/tournaments'&&req.method==='GET') {
        if((singleTour||d2Event)&&url.searchParams.get('select')==='*') {
          assert.equal(url.searchParams.get('id'),`eq.${fixture.tour}`);
          const rows=query(`SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM public.tournaments t WHERE id='${fixture.tour}';`);
          send(200,rows[0]??null);return;
        }
        if(singleTour&&url.searchParams.get('select')==='id,name,start_time,status,registration_closed_at') {
          assert.equal(url.searchParams.get('club_id'),`eq.${fixture.club}`);assert.equal(url.searchParams.get('deleted_at'),'is.null');
          send(200,query(`SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM(SELECT id,name,start_time,status,registration_closed_at FROM public.tournaments WHERE id='${fixture.tour}' AND deleted_at IS NULL) t;`));return;
        }
        if(singleTour&&url.searchParams.get('select')==='id,name,club_id,start_time') {
          assert.equal(url.searchParams.get('deleted_at'),'is.null');
          send(200,query(`SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM(SELECT id,name,club_id,start_time FROM public.tournaments WHERE id='${fixture.tour}' AND deleted_at IS NULL) t;`));return;
        }
        assert.equal(url.searchParams.get('id'),`eq.${fixture.tour}`);
        const columns=url.searchParams.get('select')?.replaceAll(' ','');assert.ok(['id','club_id','current_level','current_level,club_id','status,players_remaining,average_stack,current_level,current_blinds,starting_stack'].includes(columns));
        const rows=query(`SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM(SELECT ${columns} FROM public.tournaments WHERE id='${fixture.tour}') t;`);
        log.push({read:'tournaments',columns,count:rows.length});
        send(200,req.headers.accept?.includes('vnd.pgrst.object')?(rows[0]??null):rows);return;
      }
      if(url.pathname==='/rest/v1/tournament_levels'&&req.method==='GET') {
        assert.ok(d2Event||sidepotScope||single654Color||single668Issue||single748ChipRead);assert.equal(url.searchParams.get('tournament_id'),`eq.${fixture.tour}`);
        if((singleTour||d2Event)&&['big_blind','small_blind,big_blind,ante,is_break'].includes(url.searchParams.get('select'))) {
          const columns=url.searchParams.get('select');
          const level=url.searchParams.get('level_number');assert.match(level??'',/^eq\.\d+$/);
          const rows=query(`SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM(SELECT ${columns} FROM public.tournament_levels WHERE tournament_id='${fixture.tour}' AND level_number=${Number(level.slice(3))})t;`);
          assert.ok(rows.length<=1);send(200,rows[0]??null);return;
        }
        assert.equal(url.searchParams.get('select')?.replaceAll(' ',''),'level_number,small_blind,big_blind,ante,duration_minutes,is_break');
        send(200,query(`SELECT coalesce(jsonb_agg(t ORDER BY level_number),'[]'::jsonb) FROM(SELECT level_number,small_blind,big_blind,ante,duration_minutes,is_break FROM public.tournament_levels WHERE tournament_id='${fixture.tour}') t;`));return;
      }
      if(url.pathname==='/rest/v1/blind_structure_templates'&&req.method==='GET') {
        assert.ok(d2Event);assert.equal(url.searchParams.get('club_id'),`eq.${fixture.club}`);
        assert.equal(url.searchParams.get('select')?.replaceAll(' ',''),'id,club_id,name,levels');
        send(200,query(`SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM(SELECT id,club_id,name,levels FROM public.blind_structure_templates WHERE club_id='${fixture.club}' ORDER BY name) t;`));return;
      }
      if(url.pathname==='/rest/v1/rpc/update_blind_structure'&&req.method==='POST') {
        assert.ok(d2Event);assert.equal(body.p_tournament_id,fixture.tour);
        assert.ok(Array.isArray(body.p_levels)&&body.p_levels.length>0&&body.p_levels.length<=100);
        for(const [i,l] of body.p_levels.entries()) {
          assert.deepEqual(Object.keys(l).sort(),['level_number','small_blind','big_blind','ante','duration_minutes','is_break'].sort());
          assert.equal(l.level_number,i+1);assert.equal(typeof l.is_break,'boolean');
          assert.ok(['small_blind','big_blind','ante','duration_minutes'].every(k=>Number.isSafeInteger(l[k])&&l[k]>=0));
        }
        const encoded=JSON.stringify(body.p_levels).replaceAll("'","''");
        const value=query(`SELECT public.update_blind_structure('${fixture.tour}','${encoded}'::jsonb);`);
        log.push({rpc:'update_blind_structure',outcome:value.status,count:value.levels_saved});send(200,value);return;
      }
      const trackerRead=url.pathname.match(/^\/rest\/v1\/rpc\/(get_tracker_hand_input_tables_v4|get_tracker_table_locks|is_club_tracker|get_tracker_roster_snapshot_v2|get_next_hand_number|get_tournament_clock|heartbeat_lock|get_tracker_undo_receipt_v1|cancel_tracker_undo_intent_v1)$/)?.[1];
      if(trackerRead&&req.method==='POST') {
        let statement;
        if(trackerRead==='get_tracker_undo_receipt_v1'||trackerRead==='cancel_tracker_undo_intent_v1') {
          assert.ok(sidepotScope||single678Hand,'exact retained TEST required for Undo receipt read');
          assert.deepEqual(Object.keys(body).sort(),['p_tournament_id','p_tournament_table_id','p_hand_id','p_expected_action_id','p_expected_source_revision','p_idempotency_key'].sort());
          assert.equal(body.p_tournament_id,fixture.tour);assert.equal(body.p_tournament_table_id,single678Hand?'c2ce77c0-2b61-4a19-bd43-4752232cc55a':sidepotScope.table);
          for(const key of ['p_hand_id','p_expected_action_id','p_idempotency_key'])assert.ok(uuid(body[key]));
          if(single678Hand)assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM public.tournament_hands WHERE id='${body.p_hand_id}' AND tournament_id='${fixture.tour}' AND table_session_id='b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5' AND hand_number=4);`),'t');
          assert.ok(Number.isSafeInteger(body.p_expected_source_revision)&&body.p_expected_source_revision>0);
          statement=`SELECT public.${trackerRead}('${fixture.tour}','${body.p_tournament_table_id}','${body.p_hand_id}','${body.p_expected_action_id}',${body.p_expected_source_revision},'${body.p_idempotency_key}');`;
        } else if(trackerRead==='is_club_tracker') {
          assert.equal(body._user_id,actor);assert.equal(body._club_id,fixture.club);
          statement=`SELECT to_jsonb(public.is_club_tracker('${actor}','${fixture.club}'));`;
        } else if(trackerRead==='heartbeat_lock') {
          assert.ok(uuid(body.p_hand_id));assert.equal(body.p_user_id,actor);
          assert.equal(query(`SELECT to_jsonb(EXISTS(SELECT 1 FROM public.tournament_hands WHERE id='${body.p_hand_id}' AND tournament_id='${fixture.tour}'));`),true);
          statement=`SELECT public.heartbeat_lock('${body.p_hand_id}','${actor}');`;
        } else if(trackerRead==='get_tracker_roster_snapshot_v2') {
          assert.equal(body.p_tournament_id,fixture.tour);assert.ok(uuid(body.p_tournament_table_id)&&uuid(body.p_table_session_id)&&Number.isSafeInteger(body.p_expected_epoch));
          statement=`SELECT public.get_tracker_roster_snapshot_v2('${fixture.tour}','${body.p_tournament_table_id}','${body.p_table_session_id}',${body.p_expected_epoch});`;
        } else if(trackerRead==='get_next_hand_number') {
          assert.equal(body.p_tournament_id,fixture.tour);assert.ok(uuid(body.p_table_id));
          assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM public.tournament_tables WHERE id='${body.p_table_id}' AND tournament_id='${fixture.tour}');`),'t');
          statement=`SELECT public.get_next_hand_number('${fixture.tour}','${body.p_table_id}');`;
        } else if(trackerRead==='get_tournament_clock') {
          assert.equal(body.p_tournament_id,fixture.tour);statement=`SELECT public.get_tournament_clock('${fixture.tour}');`;
        } else {
          assert.equal(body.p_tournament_id,fixture.tour);
          if(trackerRead==='get_tracker_table_locks') {
            assert.equal(body.p_actor_user_id,actor);
            statement=`SELECT public.get_tracker_table_locks('${fixture.tour}','${actor}');`;
          } else statement=`SELECT public.get_tracker_hand_input_tables_v4('${fixture.tour}');`;
        }
        const result=query(statement);log.push({rpc:trackerRead,outcome:typeof result==='boolean'?result:result?.error??'read'});send(200,result);return;
      }
      if (url.pathname === '/auth/v1/logout') { sessions.delete(bearer); send(204, null); return; }
      if (url.pathname === '/__local/drop-next' && req.method === 'POST') { dropNext = true; log.push({fault:'LOCAL_RESPONSE_LOSS_ARMED'}); send(200, { armed: true }); return; }
      const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/(get_tournament_payout_recipients|record_multi_day_prize_payment_v1|record_tournament_prize_payment_v2|get_tournament_prize_payment_receipt_v2|get_club_payout_liability_v2|multi_day_final_roster_v1|multi_day_plan_initial_draw_v1|multi_day_get_initial_draw_plan_v1|multi_day_apply_initial_draw_v1|multi_day_cancel_initial_draw_v1|multi_day_get_initial_draw_resolution_v1|floor_continue_tournament_redraw_v1)$/);
      if (rpc && req.method === 'POST') {
        const name = rpc[1]; let statement;
        if(name==='floor_continue_tournament_redraw_v1') {
          if(continueRecovery)assert.deepEqual(body,{p_batch_id:continueRecovery.batchId,
            p_expected_redraw_revision:continueRecovery.revision,p_request_id:continueRecovery.requestId});
          assert.ok(d2Event&&uuid(body.p_batch_id)&&uuid(body.p_request_id));
          assert.ok(Number.isSafeInteger(body.p_expected_redraw_revision)&&body.p_expected_redraw_revision>0);
          assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM private.multi_day_initial_draw_plans_v1 WHERE id='${body.p_batch_id}' AND event_id='${d2Event}' AND actor_id='${actor}');`),'t');
          statement=`SELECT public.floor_continue_tournament_redraw_v1('${body.p_batch_id}',${body.p_expected_redraw_revision},'${body.p_request_id}');`;
        } else if(name.startsWith('multi_day_')) {
          assert.ok(d2Event,'explicit D2 fixture opt-in required');
          if(name==='multi_day_final_roster_v1') {
            assert.equal(body.p_event_id,d2Event);statement=`SELECT public.multi_day_final_roster_v1('${d2Event}');`;
          } else if(name==='multi_day_plan_initial_draw_v1') {
            assert.equal(body.p_event_id,d2Event);assert.ok(uuid(body.p_request_id));assert.match(body.p_expected_source_hash,/^[a-f0-9]{32}$/);
            assert.ok(Array.isArray(body.p_tournament_table_ids)&&body.p_tournament_table_ids.length>0&&body.p_tournament_table_ids.length<=50&&body.p_tournament_table_ids.every(uuid));
            const ids=body.p_tournament_table_ids.map(id=>`'${id}'::uuid`).join(',');
            assert.equal(Number(sql(`SELECT count(*) FROM public.tournament_tables WHERE tournament_id='${fixture.final??fixture.tour}' AND id=ANY(ARRAY[${ids}]);`)),body.p_tournament_table_ids.length);
            statement=`SELECT public.multi_day_plan_initial_draw_v1('${d2Event}',ARRAY[${ids}],'${body.p_expected_source_hash}','${body.p_request_id}');`;
          } else if(name==='multi_day_get_initial_draw_plan_v1') {
            assert.equal(body.p_event_id,d2Event);assert.ok(uuid(body.p_request_id));
            statement=`SELECT public.multi_day_get_initial_draw_plan_v1('${d2Event}','${body.p_request_id}');`;
          } else {
            assert.ok(uuid(body.p_plan_id));
            assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM private.multi_day_initial_draw_plans_v1 WHERE id='${body.p_plan_id}' AND event_id='${d2Event}' AND actor_id='${actor}');`),'t');
            if(name==='multi_day_get_initial_draw_resolution_v1') {
              assert.equal(body.p_event_id,d2Event);statement=`SELECT public.multi_day_get_initial_draw_resolution_v1('${d2Event}','${body.p_plan_id}');`;
            } else {
              assert.ok(uuid(body.p_request_id));statement=`SELECT public.${name}('${body.p_plan_id}','${body.p_request_id}');`;
            }
          }
        } else if (name === 'get_club_payout_liability_v2') {
          assert.match(body.p_from_date, /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/);
          assert.match(body.p_to_date, /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/);
          assert.ok(body.p_club_id === null || body.p_club_id === fixture.club);
          statement = `SELECT public.get_club_payout_liability_v2('${body.p_from_date}','${body.p_to_date}',${body.p_club_id === null ? 'NULL' : `'${fixture.club}'`});`;
        } else if (name === 'get_tournament_payout_recipients') {
          assert.equal(body.p_tournament_id, fixture.tour);
          statement = `SELECT public.get_tournament_payout_recipients('${fixture.tour}');`;
        } else if(name==='record_multi_day_prize_payment_v1'){
          assert.ok(d2Event&&body.p_event_id===d2Event&&uuid(body.p_participation_id)&&uuid(body.p_request_id));
          assert.ok(['cash','bank','app','other'].includes(body.p_method));assert.match(body.p_expected_token,/^[a-f0-9]{32}$/);
          statement=`SELECT public.record_multi_day_prize_payment_v1('${d2Event}','${body.p_participation_id}','${body.p_method}','${body.p_expected_token}','${body.p_request_id}');`;
        } else if (name === 'get_tournament_prize_payment_receipt_v2') {
          assert.ok(uuid(body.p_request_id));
          statement = `SELECT public.get_tournament_prize_payment_receipt_v2('${body.p_request_id}');`;
        } else {
          assert.equal(body.p_tournament_id, fixture.tour); assert.ok(uuid(body.p_request_id));
          assert.ok(Number.isSafeInteger(body.p_finished_place) && body.p_finished_place > 0 && body.p_finished_place <= 100);
          assert.ok(['cash', 'bank', 'app', 'other'].includes(body.p_method));
          assert.match(body.p_expected_token, /^[a-f0-9]{32}$/);
          statement = `SELECT public.record_tournament_prize_payment_v2('${fixture.tour}',${body.p_finished_place},'${body.p_method}','${body.p_expected_token}','${body.p_request_id}');`;
        }
        const result = query(statement);
        if(continueRecovery&&name==='floor_continue_tournament_redraw_v1'){
          assert.equal(result.ok,true);assert.equal(result.batch_id,continueRecovery.batchId);
          assert.equal(result.redraw_revision,continueRecovery.revision+1);
          log.push({rpc:name,requestId:body.p_request_id,result});
          if(continueFault){continueFault=false;log.push({rpc:name,fault:'LOCAL_EXISTING_CONTINUE_RESPONSE_LOSS'});
            send(503,{message:'LOCAL_EXISTING_CONTINUE_RESPONSE_LOSS'});return;}
          send(200,result);return;
        }
        log.push({ rpc: name, requestId: body.p_request_id ?? null, place: body.p_finished_place ?? null,
          outcome: result.outcome ?? result.state ?? result.error ?? (result.found === undefined ? 'read' : result.found ? 'recovered' : 'not_found') });
        if (['record_multi_day_prize_payment_v1','record_tournament_prize_payment_v2','multi_day_plan_initial_draw_v1','multi_day_apply_initial_draw_v1','multi_day_cancel_initial_draw_v1','floor_continue_tournament_redraw_v1'].includes(name)) {
          if (dropNext) { droppedKeys.add(body.p_request_id); dropNext = false; }
          if (droppedKeys.has(body.p_request_id)) { log.at(-1).responseDropped = true; res.destroy(); return; }
        }
        send(200, result); return;
      }
      if(memberStacks323&&req.method==='GET'&&['/rest/v1/stack_registrations','/rest/v1/tournament_registrations'].includes(url.pathname)){
        const canonical=url.pathname.endsWith('/tournament_registrations');
        assert.equal(url.searchParams.get(canonical?'player_id':'user_id'),`eq.${actor}`);
        assert.equal(url.searchParams.get('order'),'created_at.desc');
        const columns=url.searchParams.get('select');
        assert.equal(columns?.replaceAll(' ',''),canonical?'id,status,total_pay,reference_code,tournament:tournaments(id,name,start_time,buy_in,club:clubs(name))':'*,tournament:tournaments(id,name,start_time,buy_in,club:clubs(name))');
        const value=query(`SELECT coalesce(jsonb_agg(x ORDER BY x.created_at DESC),'[]'::jsonb) FROM(
          SELECT r.id,r.status,r.created_at,${canonical?'r.total_pay,r.reference_code,':''}
          (SELECT jsonb_build_object('id',t.id,'name',t.name,'start_time',t.start_time,'buy_in',t.buy_in,
            'club',(SELECT jsonb_build_object('name',c.name) FROM public.clubs c WHERE c.id=t.club_id))
           FROM public.tournaments t WHERE t.id=r.tournament_id) tournament
          FROM public.${canonical?'tournament_registrations':'stack_registrations'} r WHERE r.${canonical?'player_id':'user_id'}='${actor}') x;`);
        log.push({member323:canonical?'current':'legacy',rows:value.length});send(200,value);return;
      }
      const table = url.pathname.match(/^\/rest\/v1\/(user_roles|clubs|dealers|club_chip_masters|club_marketers|club_fnb_staff|club_accountants|profiles)$/)?.[1];
      if (table && req.method === 'GET') {
        const column = table === 'clubs' ? 'owner_id' : 'user_id';
        assert.equal(url.searchParams.get(column), `eq.${actor}`);
        const columns = table === 'user_roles' ? 'role' : table.startsWith('club_') ? 'club_id' : 'id';
        const rows=query(`SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM (SELECT ${columns} FROM public.${table} WHERE ${column}='${actor}' LIMIT 20) t;`);
        if(table==='user_roles'&&authRoleDelayOnce){
          authRoleDelayOnce=false;log.push({authRoleReadFault:'DELAY_12S_ONCE',actor,rows:rows.length});
          await new Promise(resolve=>setTimeout(resolve,12000));
          log.push({authRoleReadFault:'DELAY_COMPLETED',clientDisconnected:res.destroyed});
          if(res.destroyed)return;
        }
        send(200, rows); return;
      }
      if (table === 'profiles' && req.method === 'PATCH') {
        assert.equal(url.searchParams.get('user_id'), `eq.${actor}`);
        assert.deepEqual(body, { onesignal_external_user_id: actor });
        query(`WITH changed AS (UPDATE public.profiles SET onesignal_external_user_id='${actor}' WHERE user_id='${actor}' RETURNING user_id) SELECT coalesce(jsonb_agg(changed),'[]'::jsonb) FROM changed;`);
        send(204, null); return;
      }
      log.push({ rejected: url.pathname, method: req.method });
      send(404, { code: 'LOCAL_ENDPOINT_NOT_ALLOWED', message: 'Endpoint not included in local acceptance' });
    } catch (error) {
      if(memberStacks323)log.push({member323Rejected:req.url?.split('?')[0],message:error.message});
      if(inboxDmFixture)log.push({inboxAdapterRejected:req.url,message:error.message});
      if(payrollBridge)log.push({payrollAdapterRejected:req.url,message:error.message});
      send(400, { code: 'LOCAL_REQUEST_REJECTED', message: error.message });
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(54329, '127.0.0.1', resolve); });
  const paymentFingerprint = () => sql(`SELECT md5(coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]'::jsonb)::text) FROM public.tournament_prize_payments p WHERE tournament_id='${fixture.tour}';`);
  const beforeDenied = paymentFingerprint();
  const denied = await fetch('http://127.0.0.1:54329/rest/v1/rpc/record_tournament_prize_payment_v2', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ p_tournament_id: fixture.tour,
      p_finished_place: 1, p_method: 'cash', p_expected_token: '0'.repeat(32), p_request_id: randomUUID() }),
  });
  assert.equal(denied.status, 401); await denied.text();
  assert.equal(paymentFingerprint(), beforeDenied, 'unauthenticated HTTP payment cannot mutate ledger');
  console.log('LOCAL_HTTP_UNAUTHENTICATED_PAYMENT_401_NO_DB_DELTA_PASS');
  if(single699Bridge){
    const proofSession=session();
    for(const [method,path,body] of [
      ['POST','/rest/v1/rpc/record_tournament_prize_payment_v2',{}],
      ['POST','/rest/v1/rpc/prepare_payout_snapshot',{p_tournament_id:'4cd3af4d-7e1d-4042-855f-04fb6777e580',p_regenerate:false}],
      ['POST','/functions/v1/compute-payouts',{mode:'preview'}],
      ['PATCH','/rest/v1/tournaments',{}],['POST','/__local/drop-next',{}],
    ]){
      const response=await fetch(`http://127.0.0.1:54329${path}`,{method,headers:{authorization:`Bearer ${proofSession.access_token}`,'content-type':'application/json'},body:JSON.stringify(body)});
      assert.equal(response.status,403);await response.text();
    }
    sessions.delete(proofSession.access_token);single699Bridge.verify();
    console.log('SINGLE699_AUTHENTICATED_PAYMENT_OTHER_TOUR_PREVIEW_PATCH_FAULT_ARM_DENIED_NO_DELTA_PASS');
  }
  if(payout379Bridge){
    const proofSession=session();
    for(const [method,path] of [['POST','/rest/v1/rpc/prepare_payout_snapshot'],['POST','/functions/v1/compute-payouts'],['PATCH','/rest/v1/tournaments'],['DELETE','/rest/v1/payout_templates'],['POST','/__local/drop-next']]){
      const response=await fetch(`http://127.0.0.1:54329${path}`,{method,headers:{authorization:`Bearer ${proofSession.access_token}`,'content-type':'application/json'},body:'{}'});
      assert.equal(response.status,403);await response.text();
    }
    sessions.delete(proofSession.access_token);payout379Bridge.verify();
    console.log('PAYOUT379_AUTHENTICATED_PREPARE_EDGE_PATCH_DELETE_FAULT_ARM_403_PASS');
  }
  if(d2Event) {
    const snapshot=()=>sql(`SELECT jsonb_build_object('entries',(SELECT count(*) FROM public.tournament_entries WHERE tournament_id='${fixture.tour}'),
      'seats',(SELECT count(*) FROM public.tournament_seats WHERE tournament_id='${fixture.tour}'),
      'applications',(SELECT count(*) FROM private.multi_day_initial_draw_applications_v1 a JOIN private.multi_day_initial_draw_plans_v1 p ON p.id=a.plan_id WHERE p.event_id='${d2Event}'))::text;`);
    const before=snapshot();
    const deniedD2=await fetch('http://127.0.0.1:54329/rest/v1/rpc/multi_day_apply_initial_draw_v1',{
      method:'POST',headers:{'content-type':'application/json'},body:'{}'});
    assert.equal(deniedD2.status,401);await deniedD2.text();assert.equal(snapshot(),before);
    console.log('LOCAL_HTTP_D2_UNAUTHENTICATED_401_NO_DB_DELTA_PASS');
  }
  if(floor791Bridge){
    const proofSession=session();
    for(const path of ['/rest/v1/rpc/multi_day_apply_initial_draw_v1','/rest/v1/rpc/close_tournament','/__local/drop-next']){
      const denied=await fetch(`http://127.0.0.1:54329${path}`,{method:'POST',headers:{authorization:`Bearer ${proofSession.access_token}`,'content-type':'application/json'},body:'{}'});
      assert.equal(denied.status,403);await denied.text();
    }
    const deniedActor=await fetch('http://127.0.0.1:54329/rest/v1/rpc/dealer_control_club_ids',{
      method:'POST',headers:{authorization:`Bearer ${proofSession.access_token}`,'content-type':'application/json'},body:JSON.stringify({_user_id:'febf2b51-fdb7-42ff-886c-b3bb1fffdc3e'})});
    assert.equal(deniedActor.status,400);await deniedActor.text();
    sessions.delete(proofSession.access_token);
    console.log('FLOOR791_AUTHENTICATED_APPLY_CLOSE_FAULT_ARM_403_FOREIGN_ACTOR_400_PASS');
  }
  console.log('LOCAL_PAYOUT_BROWSER_READY', JSON.stringify({ runId, tour: fixture.tour, actor,
    browser: 'http://127.0.0.1:5188/__dev/payout-native', model: 'LOCAL_AUTH_MODEL_REAL_PG_RPC' }));
  if (process.argv.includes('--smoke')) await new Promise((resolve) => server.close(resolve));
  else await new Promise((resolve) => {
    let correcting=false,correctionAttempted=false;
    const onInput = (value) => {
      const command=value.toString().trim();
      if(floor791Bridge?.command(command)){console.log('LOCAL793_FLOOR_LIST_FAULT_ARMED');return;}
      if(coupling613Bridge&&['coupling-bank-use','coupling-bank-restore'].includes(command)){
        void coupling613Bridge.bankUse(command==='coupling-bank-restore').then(()=>console.log('LOCAL614_BANK_STEP_PASS',command))
          .catch(error=>console.error('LOCAL614_BANK_STEP_FAILED',error.message));return;
      }
      if(fnb384Bridge&&process.env.VINPOKER_FNB607_SESSION_READ==='1'&&['fnb-queue-fault','fnb-queue-ready'].includes(command)){
        fnb384Bridge.setQueueFault(command==='fnb-queue-fault');console.log('LOCAL607_QUEUE_MODE',command);return;
      }
      if(detail367ReadOnly&&['detail-count-fault','detail-count-ready'].includes(command)){
        detail367CountFault=command==='detail-count-fault';console.log('LOCAL_DETAIL367_COUNT_MODE',detail367CountFault?'fault':'ready');return;
      }
      if(fnb341Bridge&&['fnb-menu-fault','fnb-menu-ready'].includes(command)){
        fnb341Bridge.setMenuFault(command==='fnb-menu-fault');console.log('LOCAL344_MENU_MODE',command);return;
      }
      if(fnb731Bridge?.command(command)){console.log('LOCAL731_FAULT_CONTROL',command);return;}
      if(fnb341Bridge&&['fnb-status-fault','fnb-status-ready'].includes(command)){
        fnb341Bridge.setStatusFault(command==='fnb-status-fault');console.log('LOCAL343_STATUS_MODE',command);return;
      }
      if(feedRead291&&['feed-read-hang','feed-read-unhang'].includes(command)){
        feedCatalogHang326=command==='feed-read-hang';console.log('LOCAL_FEED326_HANG',feedCatalogHang326);return;
      }
      if((feedRead291||linkedD2)&&['feed-read-fault','feed-read-ready'].includes(command)){
        feedCatalogFault313=command==='feed-read-fault';console.log('LOCAL_FEED313_READ_MODE',feedCatalogFault313?'fault':'ready');return;
      }
      if(command==='feed-invalidate'&&feed288Bridge){void feed288Bridge.invalidate().then(result=>console.log('LOCAL_FEED288_PENDING',JSON.stringify(result))).catch(error=>console.error('LOCAL_FEED288_FAILED',error.message));return;}
      if(command==='notifications-ready'&&notificationReadOnly){notificationReadHang=false;console.log('LOCAL_NOTIFICATION_READ_RECOVERED');return;}
      if(activeCorrection101&&['floor-location-fault','floor-location-ready','evidence'].includes(command)){
        if(command==='evidence')console.log('LOCAL_ACTIVE_CORRECTION101_EVIDENCE',JSON.stringify(log.filter(row=>row.rpc||row.edgeRpc||row.edgeResponseDropped||row.fault)));
        else{floorLocationFault101=command==='floor-location-fault';console.log('LOCAL_FLOOR_LOCATION101_MODE',floorLocationFault101?'fault':'ready');}
        return;
      }
      if(sidepotScope&&['cashier-summary-null','cashier-summary-ready'].includes(command)){
        cashierSummaryNullMoney=command==='cashier-summary-null';
        console.log('LOCAL_CASHIER_SUMMARY_READ_MODE',cashierSummaryNullMoney?'null-money':'ready');return;
      }
      if(command==='cashier-hang-next'&&sidepotScope){
        cashierWorklistHangOnce=true;
        console.log('LOCAL_CASHIER_NEXT_READ_HANG_ARMED');return;
      }
      if(command==='tracker-action-release'&&actionHangBeforeDb){
        for(const held of hangingTrackerActions){
          held.response.writeHead(503,{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
          held.response.end(JSON.stringify({message:'LOCAL_ACTION_NOT_DISPATCHED_TO_DB'}));
        }
        log.push({trackerActionFault:'LOCAL_ACTION_RELEASED_WITHOUT_DB',dbDispatched:false});
        console.log('LOCAL_ACTION_RELEASED_WITHOUT_DB');return;
      }
      if(payrollBridge&&process.env.VINPOKER_PAYROLL_READ_ONLY==='1'&&['payroll-saved-ready','payroll-saved-null','payroll-saved-empty'].includes(command)){
        payrollBridge.setSavedReadFault(command==='payroll-saved-ready'?'none':command==='payroll-saved-null'?'null_money':'empty');
        console.log('LOCAL_PAYROLL_SAVED_READ_MODE',command);return;
      }
      if(command==='unread-ready'&&inboxBrowser){unreadFault=false;log.push({test:'LOCAL_UNREAD_FAULT_CLEARED'});console.log('LOCAL_UNREAD_FAULT_CLEARED');return;}
      if(command==='dm-ready'&&inboxBrowser){dmFault=false;dmHang=false;log.push({test:'LOCAL_DM_FAULT_CLEARED'});console.log('LOCAL_DM_FAULT_CLEARED');return;}
      if(command==='finish-receipts-ready'&&(sidepotScope||single656Finish)&&process.env.VINPOKER_FINISH_RECEIPT_HOLD==='1'){
        finishReceiptHold=false;log.push({test:'LOCAL_FINISH_RECEIPT_READ_RECOVERED'});console.log('LOCAL_FINISH_RECEIPT_READ_RECOVERED');return;
      }
      if(command==='stop'){if(correcting){console.log('LOCAL_OBSERVER_CORRECTION_IN_PROGRESS_WAIT');return;}finish();}
      else if(command==='correct-history'&&liveObserverCorrection&&!correctionAttempted){
        correctionAttempted=true;correcting=true;
        void (async()=>{
          const {correctRetainedObserverHand}=await import('../trackerSettlement/paidCorrectionEdge.native.mjs');
          const result=await correctRetainedObserverHand({sql,fixture:{...fixture,actor},hand:historyObserver});
          historyObserverProof.before=historyObserverProof.fingerprint();historyObserverProof.corrections=1;
          log.push({test:result.recovered?'LOCAL_CANONICAL_CORRECTION_RECEIPT_RECOVERED':'LOCAL_CANONICAL_CORRECTION_COMMITTED',...result});
          console.log(result.recovered?'LOCAL_CANONICAL_OBSERVER_CORRECTION_RECEIPT_RECOVERED':'LOCAL_CANONICAL_OBSERVER_CORRECTION_COMMITTED',JSON.stringify(result));
        })().catch(error=>{console.error('LOCAL_OBSERVER_CORRECTION_FAILED_NO_AUTO_RETRY',error);})
          .finally(()=>{correcting=false;});
      }
    };
    const finish = () => {
      process.stdin.removeListener('data', onInput);
      process.stdin.pause();
      for(const held of hangingReads){held.shutdown=true;held.response.destroy();}
      server.close(resolve);
    };
    process.once('SIGINT', finish); process.once('SIGTERM', finish);
    process.stdin.on('data', onInput);
  });
} finally {
  try {
   if (server?.listening) server.close();
   direct275Bridge?.verify();
   stream579Bridge?.verify();
   payout379Bridge?.verify();
   single699Bridge?.verify();
   payout704Bridge?.verify();
   single706Payroll?.verify();
   fnb384Bridge?.verify();
   fnb731Bridge?.verify();
   if(feed291Proof){assert.equal(feed291Proof.fingerprint(),feed291Proof.before);console.log('LOCAL_FEED291_HAND_PLAYER_ACTION_SEAT_CASH_PRIZE_UNCHANGED_PASS');}
   bank272Bridge?.verify();
   sepay303Bridge?.verify();
   sepay306Bridge?.verify();
   if(bank270Proof){assert.equal(bank270Proof.fingerprint(),bank270Proof.before);console.log('LOCAL_BANK270_ALL_BANK_CHIP_CASH_PRIZES_UNCHANGED_PASS');}
   if(clean244Proof){assert.equal(clean244Proof.fingerprint(),clean244Proof.before);console.log(clean244Proof.label);}
   if(notificationReadProof){assert.equal(notificationReadProof.fingerprint(),notificationReadProof.before);console.log('LOCAL_NOTIFICATION_READ_NO_NOTICE_OR_OUTBOX_DELTA_PASS');}
   if(dealerControlReadProof){assert.equal(dealerControlReadProof.fingerprint(),dealerControlReadProof.before);console.log('LOCAL_DEALER_CONTROL_TABLES_SESSIONS_ASSIGNMENTS_DEALERS_ATTENDANCE_UNCHANGED_PASS');}
   if(tvEditorProof){
     const expected=tvEditorProof.gate;
     sql(`UPDATE public.centerpoint_tournament_ops_release SET (enabled,allowed_club_ids,updated_at)=
       (SELECT r.enabled,r.allowed_club_ids,r.updated_at FROM jsonb_populate_record(NULL::public.centerpoint_tournament_ops_release,'${JSON.stringify(expected).replaceAll("'","''")}'::jsonb) r) WHERE id;`);
     assert.deepEqual(JSON.parse(sql('SELECT to_jsonb(r) FROM public.centerpoint_tournament_ops_release r WHERE id;')),expected);
     assert.equal(tvEditorProof.fingerprint(),tvEditorProof.before);
     console.log('LOCAL_TV_EDITOR_NO_OPERATIONAL_FINANCIAL_ASSET_DELTA_GATE_RESTORED_PASS');
   }
   let correctionCleanupError=null;
   if(opsSharedReadProof){assert.equal(opsSharedReadProof.fingerprint(),opsSharedReadProof.before);console.log('LOCAL_OPS_SHARED_EVENT_TOURS_ENTRIES_SEATS_HANDS_CASH_PAYMENTS_QUALIFICATION_FINALIZATION_UNCHANGED_PASS');}
   if(historyObserverProof){assert.equal(historyObserverProof.fingerprint(),historyObserverProof.before);console.log(historyObserverProof.kind==='single679'?'LOCAL_SINGLE679_HISTORY_13_TABLES_UNCHANGED_PASS':historyObserverProof.kind==='multiple113'?'LOCAL_MULTIPLE113_OBSERVER_NO_HAND_PROOF_QUEUE_DELTA_PASS':historyObserverProof.corrections?'LOCAL_CORRECTED_HISTORY_BROWSER_NO_UNEXPECTED_HAND_PROOF_QUEUE_DELTA_PASS':'LOCAL_CORRECTED_HISTORY_BROWSER_NO_HAND_PROOF_QUEUE_DELTA_PASS');}
   if(inboxDmFixture){assert.equal(inboxDmFixture.fingerprint(),inboxDmFixture.before);console.log('LOCAL_DM_BROWSER_IDENTITY_MESSAGES_OTHER_READ_MARKER_UNCHANGED_PASS');}
   tv166Bridge?.verify();
   main167Bridge?.verify();
   fnb341Bridge?.verify();
   if(bank265Proof){assert.equal(bank265Proof.fingerprint(),bank265Proof.before);console.log('LOCAL_BANK265_ALL_BANK_MONEY_ENTRY_SEAT_NOTICE_CHIP_PRIZES_UNCHANGED_PASS');}
   if(sidepotFinancialProof){assert.equal(sidepotFinancialProof.fingerprint(),sidepotFinancialProof.before);console.log('LOCAL_SIDEPOT_BROWSER_NO_REGISTRATION_CASH_PAYOUT_DELTA_PASS');}
   if(freshRegistrationProof){
    assert.equal(freshRegistrationProof.fingerprint(),freshRegistrationProof.before);
    const f=freshRegistrationProof;
    assert.equal(sql(`SELECT count(*) FROM public.tournament_registrations WHERE tournament_id='${f.tour}' AND player_id='${f.player}';`),'1');
    assert.equal(sql(`SELECT count(*) FROM public.notifications WHERE user_id='${f.player}' AND type='registration_confirmed';`),'1');
    console.log('LOCAL_FRESH_REGISTRATION_ONE_ROW_ONE_NOTICE_NO_MONEY_QUOTA_SEAT_DELTA_PASS');
   }
   if(sidepotActionReadProof){assert.equal(sidepotActionReadProof.fingerprint(),sidepotActionReadProof.before);console.log('LOCAL_TRACKER_ACTION_TIMEOUT_NO_HAND_ACTION_PLAYER_SEAT_ENTRY_DELTA_PASS');}
   if(correctionBridge){try{await correctionBridge.cleanup();}catch(error){correctionCleanupError=error;}}
   if(memberReadProof){assert.equal(memberReadProof.fingerprint(),memberReadProof.before);console.log('LOCAL_MEMBER_RECEIPT_BROWSER_NO_REGISTRATION_MOVEMENT_RECEIPT_DELTA_PASS');}
   if(finalizationReadProof){assert.equal(finalizationReadProof.fingerprint(),finalizationReadProof.before);console.log('LOCAL_FINALIZATION_RECEIPT_REPLAY_NO_FINALIZATION_PAYMENT_DELTA_PASS');}
   if(sum807Proof){assert.equal(sum807Proof.fingerprint(),sum807Proof.before);console.log(d2847?'LOCAL_D2_847_READONLY_COMMITTED_SEED_HELD_DRAW_CLOCK_GATES_PROOF_UNCHANGED_PASS':'LOCAL_SUM807_READONLY_BUSINESS_DRAW_GATES_AUDIT_UNCHANGED_PASS');}
   if(qualificationReadProof){assert.equal(qualificationReadProof.fingerprint(),qualificationReadProof.before);console.log('LOCAL_QUALIFICATION_REPLAY_NO_LOCK_PARTICIPATION_FINANCIAL_DELTA_PASS');}
   if(continueReadProof){assert.equal(continueReadProof.fingerprint(),continueReadProof.before);console.log('LOCAL_CONTINUE_REPLAY_NO_TOUR_SESSION_BATCH_RECEIPT_DELTA_PASS');}
   if(rulesReadProof){assert.equal(rulesReadProof.fingerprint(),rulesReadProof.before);console.log('LOCAL_RULES_REPLAY_NO_RULES_QUALIFICATION_FINANCIAL_DELTA_PASS');}
   if(bag616Proof){assert.equal(bag616Proof.fingerprint(),bag616Proof.before);console.log('BAG616_ALL_BAGS_DAYS_INVENTORY_CASH_PRIZES_ENTRIES_SEATS_UNCHANGED_PASS');}
   if(chipReadSnapshot){assert.equal(chipReadSnapshot(),chipReadBefore,'read-only chip fault/recovery changed financial or tournament state');console.log('LOCAL_CHIP_READ_FAULT_RECOVERY_NO_FINANCIAL_DELTA_PASS');}
   if(stakingBridge)stakingBridge.cleanup();
   if(stakingBuyerProof){assert.equal(stakingBuyerProof.fingerprint(),stakingBuyerProof.before);console.log('STAKING_BUYER_MAIN_TABLES_GATES_UNCHANGED_PASS');}
   if(payrollBridge)payrollBridge.cleanup();
   if(dealerBridge)dealerBridge.cleanup();
   if(tv258Bridge)tv258Bridge.cleanup();
   if(d2GateBefore!==null) {
    if(d2OpsBefore!==null){const g=d2OpsBefore[0];sql(`UPDATE public.centerpoint_tournament_ops_release SET enabled=${g.enabled},allowed_club_ids=ARRAY[${g.allowed_club_ids.map(id=>`'${id}'::uuid`).join(',')}]::uuid[] WHERE id;`);
      assert.deepEqual(JSON.parse(sql("SELECT jsonb_build_object('enabled',enabled,'clubs',allowed_club_ids) FROM public.centerpoint_tournament_ops_release WHERE id;")),{enabled:g.enabled,clubs:g.allowed_club_ids});}
    assert.ok(d2GateBefore.length<=1);
    if(d2GateBefore.length){const g=d2GateBefore[0];sql(`UPDATE public.multi_day_package_release_v1 SET enabled=${g.enabled},allowed_club_ids=ARRAY[${g.allowed_club_ids.map(id=>`'${id}'::uuid`).join(',')}]::uuid[];`);}
    else sql(`DELETE FROM public.multi_day_package_release_v1 WHERE id AND allowed_club_ids=ARRAY['${d2Club}'::uuid];`);
    const restored=JSON.parse(sql("SELECT coalesce(jsonb_agg(jsonb_build_object('enabled',enabled,'clubs',allowed_club_ids)),'[]'::jsonb) FROM public.multi_day_package_release_v1;"));
    assert.deepEqual(restored,d2GateBefore.map(g=>({enabled:g.enabled,clubs:g.allowed_club_ids})));
    console.log('LOCAL_D2_RELEASE_SCOPE_RESTORED_PASS');
   }
   if(correctionCleanupError)throw correctionCleanupError;
  } finally {
   try{
    if(single678UndoScope){
      const before=single678UndoScope;
      sql(`UPDATE public.tracker_correction_uat_scopes SET (enabled,expires_at,updated_at)=(SELECT s.enabled,s.expires_at,s.updated_at FROM jsonb_populate_record(NULL::public.tracker_correction_uat_scopes,'${JSON.stringify(before).replaceAll("'","''")}'::jsonb) s) WHERE id='${before.id}';`);
      assert.deepEqual(JSON.parse(sql(`SELECT to_jsonb(s) FROM public.tracker_correction_uat_scopes s WHERE id='${before.id}';`)),before);
      console.log('LOCAL_SINGLE678_UNDO_SCOPE_RESTORED_PASS');
    }
    single677Bridge?.cleanup();if(single644Assign)single644Assign.cleanup();if(bag630Bridge)await bag630Bridge.cleanup();if(coupling613Bridge)await coupling613Bridge.cleanup();if(sepay608Bridge)await sepay608Bridge.cleanup();if(funding560Bridge)await funding560Bridge.cleanup();if(refund538Bridge)await refund538Bridge.cleanup();if(feed288Bridge)await feed288Bridge.cleanup();if(floorAlertBridge)await floorAlertBridge.cleanup();historicalDisplayBridge?.dispose();handCorrectionBridge?.dispose();
   }finally{stop();}
  }
}
