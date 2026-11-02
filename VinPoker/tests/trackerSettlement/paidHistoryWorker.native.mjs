import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {runPaidCorrectionEdge} from './paidCorrectionEdge.native.mjs';
import {createPaidCompletedHandFixture} from '../cashier/paidJourney.fixture.mjs';
import {singleDayBrowserHands} from '../cashier/singleDayBrowserHands.fixture.mjs';
import {configuredSequentialHands,configuredFinalHand} from '../cashier/configuredSingleSequential.fixture.mjs';
import {HistoricalDisplayVerificationError,verifyHistoricalDisplaySettlement} from '../../supabase/functions/_shared/trackerSettlement/historicalDisplayVerification.ts';
import {canonicalJsonV1} from '../../supabase/functions/_shared/trackerSettlement/outcomeV1.ts';
import {isUuid} from '../../supabase/functions/_shared/internal-trigger-auth.ts';
import {authorizeHistoryWorker,HISTORY_CANARY_SECRET_ENV} from '../../supabase/functions/_shared/trackerSettlement/historyWorkerAuth.ts';
import {historicalWorkerFailureStatus,TRACKER_HISTORY_WORKER_MAX_BATCH,parseHistoryWorkerHandIds,requireHistoryCanaryScope,HISTORY_CANARY_SCOPE_ENV} from '../../supabase/functions/_shared/trackerSettlement/historyWorkerPolicy.ts';
import {computeAuthoritativeSettlement,normalizeSettlementSourceRpcResult} from '../../supabase/functions/_shared/trackerSettlement/compute.ts';
// Actual worker/verifier/SQL, modeled HTTP/PostgREST/CORS. NO hosted credentials,
// provider, cron or outbound network. Dedicated dark canary hand scope only.
const database='vinpoker_ops_cash115_qualified_c';
const lostCommitResponse=process.argv.includes('--lost-commit-response');
const expiredLease=process.argv.includes('--expired-lease');
const correctionDuringCommit=process.argv.includes('--correct-during-commit');
const correctionEdge=process.argv.includes('--correction-edge');
const canonicalObserver=process.argv.includes('--canonical-observer');
const verified=process.argv.includes('--verified')||lostCommitResponse||expiredLease||correctionDuringCommit||correctionEdge;
let expiredOnce=false;
let correctionRevision;
for(const [key,value] of Object.entries({PGHOST:'127.0.0.1',PGPORT:'55441',PGUSER:'postgres',PGDATABASE:database}))assert.equal(process.env[key],value);
for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[key]);
const prefix=process.platform==='win32'?['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',`PGDATABASE=${database}`,'psql']:[];
const binary=prefix.length?'wsl':'psql',flags=['-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync(binary,[...prefix,...flags],{input:q,encoding:'utf8',timeout:30000,stdio:['pipe','pipe','pipe']}).trim();
const parentHand=process.env.VINPOKER_HISTORY_PARENT_HAND;
const pending472=process.env.VINPOKER_HISTORY_PENDING472==='1';
const pending477=process.env.VINPOKER_HISTORY_PENDING477==='1';
const pending554=process.env.VINPOKER_HISTORY_PENDING554==='1';
const pending575=process.env.VINPOKER_HISTORY_PENDING575==='1';
const pending594=process.env.VINPOKER_HISTORY_PENDING594==='1';
const pending647=process.env.VINPOKER_HISTORY_PENDING647==='1';
const pending665=process.env.VINPOKER_HISTORY_PENDING665==='1';
const pending679=process.env.VINPOKER_HISTORY_PENDING679==='1';
const pending683=process.env.VINPOKER_HISTORY_PENDING683==='1';
const pending685=process.env.VINPOKER_HISTORY_PENDING685==='1';
const pending693=process.env.VINPOKER_HISTORY_PENDING693==='1';
const pending691=process.env.VINPOKER_HISTORY_PENDING691==='1';
const pending689=process.env.VINPOKER_HISTORY_PENDING689==='1';
assert.ok([pending693,pending691,pending689,process.env.VINPOKER_HISTORY_PENDING687==='1'].filter(Boolean).length<=1,'one exact frozen history checkpoint only');
const pending687=process.env.VINPOKER_HISTORY_PENDING687==='1'||pending689||pending691||pending693;
// Already-recorded UI hands; immutable expected facts, not a caller-supplied
// hand selector or values inferred from the worker result being checked.
const finalHistoryCase=pending693?{checkpoint:693,hand:'ba4eede3-8cf4-4866-bc1b-ff916aad161f',number:10,revision:15,pot:40000,refund:0,net:20000,sb:8,bb:2,request:'e59ba871-6116-4d71-997b-e5086925ba63',
 stacks:[[2,160000,180000],[8,20000,0]],actions:[['post_sb',100],['post_bb',200],['all_in',19900],['call',19800]],nets:[-20000,20000]}
 :pending691?{checkpoint:691,hand:'a3228a49-cd3a-485c-a334-a001c4f457d6',number:9,revision:17,pot:40000,refund:120000,net:20000,sb:6,bb:7,request:'ce7df86f-cd78-42fa-81b8-548c0605f3ab',
 stacks:[[2,140000,160000],[7,20000,0],[8,20000,20000]],actions:[['post_bb',200],['fold',0],['all_in',140000],['call',19800]],nets:[-20000,0,20000]}
 :pending689?{checkpoint:689,hand:'73224217-8ba7-4aa8-9eec-edd738a4302d',number:8,revision:20,pot:40000,refund:100000,net:20000,sb:5,bb:6,request:'daef4dcf-150d-4b90-8b5a-3013e63e22e6',
 stacks:[[2,120000,140000],[6,20000,0],[7,20000,20000],[8,20000,20000]],actions:[['post_bb',200],['fold',0],['fold',0],['all_in',120000],['call',19800]],nets:[-20000,0,0,20000]}
 :pending687?{checkpoint:687,hand:'c722177e-6cdf-4346-aecb-ce377895bec8',number:7,revision:23,pot:39600,refund:80400,net:19800,sb:4,bb:5,request:'12b70369-d40d-4dba-9364-bf02dff78180',
 stacks:[[2,100200,120000],[5,19800,0],[6,20000,20000],[7,20000,20000],[8,20000,20000]],actions:[['post_bb',200],['fold',0],['fold',0],['fold',0],['all_in',100200],['call',19600]],nets:[-19800,0,0,0,19800]}:null;
const pending657=process.env.VINPOKER_HISTORY_PENDING657==='1'||pending665||pending679||pending683||pending685||pending687;
if(pending647||pending657){
 assert.ok(!(pending647&&pending657));
 assert.ok(!(pending679&&pending665));
 assert.ok(!pending683||!pending679&&!pending665&&process.env.VINPOKER_HISTORY_PENDING657!=='1');
 assert.ok(!pending685||!pending683&&!pending679&&!pending665&&process.env.VINPOKER_HISTORY_PENDING657!=='1');
 assert.ok(!pending687||!pending685&&!pending683&&!pending679&&!pending665&&process.env.VINPOKER_HISTORY_PENDING657!=='1');
 assert.equal(parentHand,pending687?finalHistoryCase.hand:pending685?'b0175f85-6740-4d6b-b93f-81a621acf569':pending683?'42999d26-6dd8-413f-bbfd-71b0e33dfe54':pending679?'6eb869b7-49da-4b84-bdee-80a5b5feea25':pending665?'a9e63051-3333-45d3-8f76-15ab01bc08aa':pending657?'2ee4ebe0-f8bd-49a5-b3ed-dd0a2ea4e4a8':'4f120026-cf38-4db3-bb05-ae6feaabf59a');
 assert.equal(process.env.VINPOKER_NATIVE_PAID_TOUR,'1');
 assert.ok(verified&&process.env.VINPOKER_HISTORY_PARENT_BASELINE&&!pending472&&!pending477&&!pending554&&!pending575&&!pending594
  &&!canonicalObserver&&!lostCommitResponse&&!expiredLease&&!correctionDuringCommit&&!correctionEdge);
}
if(pending594){
 assert.equal(parentHand,'7080b766-b07b-41c5-b4f5-d3350cc505d5');
 assert.equal(process.env.VINPOKER_NATIVE_PAID_TOUR,'1');
 assert.ok(verified&&process.env.VINPOKER_HISTORY_PARENT_BASELINE&&!pending472&&!pending477&&!pending554&&!pending575
  &&!canonicalObserver&&!lostCommitResponse&&!expiredLease&&!correctionDuringCommit&&!correctionEdge);
}
if(pending575){
 assert.equal(parentHand,'985238ea-a213-4f59-a0ab-295f25b4ab5b');
 assert.equal(process.env.VINPOKER_NATIVE_PAID_TOUR,'1');
 assert.ok(verified&&process.env.VINPOKER_HISTORY_PARENT_BASELINE&&!pending472&&!pending477&&!pending554&&!canonicalObserver&&!lostCommitResponse&&!expiredLease&&!correctionDuringCommit&&!correctionEdge);
}
if(pending554){
 assert.equal(parentHand,'3787718f-ef28-485d-aef6-342241c6fe40');
 assert.equal(process.env.VINPOKER_NATIVE_PAID_TOUR,'1');
 assert.ok(verified&&process.env.VINPOKER_HISTORY_PARENT_BASELINE&&!pending472&&!pending477&&!pending575&&!canonicalObserver&&!lostCommitResponse&&!expiredLease&&!correctionDuringCommit&&!correctionEdge);
}
if(pending477){
 assert.equal(parentHand,'b3414623-e129-4c0a-99ce-37a5915bb511');
 assert.equal(process.env.VINPOKER_NATIVE_PAID_TOUR,'1');
 assert.ok(verified&&process.env.VINPOKER_HISTORY_PARENT_BASELINE&&!pending472&&!canonicalObserver&&!lostCommitResponse&&!expiredLease&&!correctionDuringCommit&&!correctionEdge);
}
if(pending472){
 assert.equal(parentHand,'65e9cd23-c25e-4491-9c46-9b01c79676cf');
 assert.equal(process.env.VINPOKER_NATIVE_PAID_TOUR,'1');
 assert.ok(verified&&process.env.VINPOKER_HISTORY_PARENT_BASELINE&&!canonicalObserver&&!lostCommitResponse&&!expiredLease&&!correctionDuringCommit&&!correctionEdge);
}
const correction290=process.env.VINPOKER_HISTORY_CORRECTION290==='1';
const correction648=process.env.VINPOKER_HISTORY_CORRECTION648==='1';
const correction648Scope={tour:'c367013a-3ed3-48af-ad48-3915acadc50e',club:'d4427834-5f5f-48ef-bde5-e2dc388ed00b',actor:'febf2b51-fdb7-42ff-886c-b3bb1fffdc3e',hand:'4f120026-cf38-4db3-bb05-ae6feaabf59a',table:'c2ce77c0-2b61-4a19-bd43-4752232cc55a',sourceRevision:19};
if(correction648)assert.ok(!correction290&&!process.env.VINPOKER_HISTORY_BROWSER_CORRECTION_MANIFEST&&!process.env.VINPOKER_HISTORY_PARENT_BASELINE&&!pending647);
const correction291Replay=process.env.VINPOKER_HISTORY_CORRECTION291_REPLAY==='1';
if(correction291Replay)assert.ok(correction290,'replay only the exact processed correction290');
if(correction290)assert.ok(!process.env.VINPOKER_HISTORY_BROWSER_CORRECTION_MANIFEST);
const correction290Scope={tour:'46cab483-91e7-4220-aacf-e17bdf05269c',club:'a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',actor:'675fe35e-60a8-4452-bb90-e79486d54da6',hand:'4aa376ee-4a27-4963-9c69-dd0a2cd17abf',table:'d294f4a4-082b-4efc-a6ca-1f96579ea344',sourceRevision:25};
const browserCorrectionManifest=correction648?correction648Scope:correction290?correction290Scope:process.env.VINPOKER_HISTORY_BROWSER_CORRECTION_MANIFEST
 ?JSON.parse(process.env.VINPOKER_HISTORY_BROWSER_CORRECTION_MANIFEST):null;
if(browserCorrectionManifest){
 assert.equal(process.env.VINPOKER_NATIVE_BROWSER,'1');
 assert.deepEqual(browserCorrectionManifest,correction648?correction648Scope:correction290?correction290Scope:{tour:'de9f2288-efa8-4b70-8bf1-eb34f7e70f10',club:'6129d24d-8aab-41fd-b22b-99f135843a20',
  actor:'8212d904-4bcf-45f5-8192-613dd1559696',hand:'4ef98dd4-cb2b-4158-8a98-fe327ce71c0d',
  table:'0199beb9-a459-4aa1-994e-6a263ba183f5',sourceRevision:11});
 assert.equal(parentHand,browserCorrectionManifest.hand);
 assert.ok(verified&&!canonicalObserver&&!lostCommitResponse&&!expiredLease&&!correctionDuringCommit&&!correctionEdge);
}
const retainedShortChop=process.env.VINPOKER_HISTORY_RETAINED_BOARD_PLAY==='hand10';
const retainedBoardPlay=process.env.VINPOKER_HISTORY_RETAINED_BOARD_PLAY==='1'||retainedShortChop;
const boardPlayProof=retainedShortChop?{hand:'fdb2996a-bb7d-4356-87aa-9d9a1bf281fb',number:10,revision:16,pot:1200,award:600,request:'96b1c534-163b-47a0-819c-54ed22124632'}
 :{hand:'4ce3c57e-4521-48eb-813c-993d75d6a7e9',number:4,revision:31,pot:400,award:200,request:'0805090e-9b9f-4270-979d-118c80cca2d3'};
if(retainedBoardPlay){
 assert.equal(parentHand,boardPlayProof.hand);
 assert.equal(process.env.VINPOKER_NATIVE_PAID_TOUR,'1');
 assert.ok(verified&&!canonicalObserver&&!lostCommitResponse&&!expiredLease&&!correctionDuringCommit&&!correctionEdge);
}
const retainedShortStack=process.env.VINPOKER_HISTORY_RETAINED_SIDEPOT==='hand3';
const retainedSidepot=process.env.VINPOKER_HISTORY_RETAINED_SIDEPOT==='1'||retainedShortStack;
const winner103=process.env.VINPOKER_HISTORY_WINNER103==='1';
const winner104=process.env.VINPOKER_HISTORY_WINNER104==='1';
const multiple113=process.env.VINPOKER_HISTORY_MULTIPLE113==='1';
const mixed230=process.env.VINPOKER_HISTORY_MIXED230==='1';
if(mixed230){
 assert.equal(parentHand,'c14ee05a-86bb-4f10-9dcd-819c3fc521f0');
 assert.equal(process.env.VINPOKER_NATIVE_PAYOUT,'1');assert.equal(process.env.VINPOKER_NATIVE_PAID_TOUR,'1');
 assert.ok(verified&&!multiple113&&!retainedSidepot&&!retainedBoardPlay&&!winner103&&!winner104&&!browserCorrectionManifest
  &&!canonicalObserver&&!lostCommitResponse&&!expiredLease&&!correctionDuringCommit&&!correctionEdge);
 assert.ok(process.env.VINPOKER_HISTORY_PARENT_BASELINE);
}
const finish136=process.env.VINPOKER_HISTORY_FINISH136==='1';
const finish137=process.env.VINPOKER_HISTORY_FINISH137==='1';
const linked173=process.env.VINPOKER_HISTORY_LINKED173==='1';
const linked181=process.env.VINPOKER_HISTORY_LINKED181==='1';
const linkedD2Hand2=process.env.VINPOKER_HISTORY_LINKED185==='hand2';
// Exact browser-created canaries, not an arbitrary tour backfill selector.
const linkedD2Table7Cases={
 'table7-hand1':{hand:'4e8c75c3-2a10-4ff4-b172-b8e022aaf398',number:1,revision:27,players:8,actions:9,request:'5fa5e719-f1ef-4876-910e-44c3c6676954',winner:'40c2b9bd-9419-4826-8ae2-8059121a7625',pot:200,refund:100,board:[],starting:{1:20000,2:19900,3:20000,4:20000,5:20000,6:20000,7:40000,8:40000},nets:[-100,0,0,0,0,0,0,100]},
 'table7-hand2':{hand:'b578cda5-ab02-44cc-ae00-8394a5f7c842',number:2,revision:33,players:8,actions:10,request:'2dac8b8f-7019-45bd-94a1-6f3c0952995c',winner:'ac0fab65-253b-4c7a-b80f-65c5c1be3b7a',pot:40300,refund:20000,starting:{1:20000,2:19800,3:20100,4:20000,5:20000,6:20000,7:40000,8:40000},nets:[-20000,-200,-100,0,0,0,0,20300]},
 'table7-hand3':{hand:'914ea2d8-54fb-4f0c-8922-0fb4924e71cd',number:3,revision:30,players:7,actions:9,request:'3625dfe7-01b3-4ded-a654-2ccd03bce6e0',winner:'ac0fab65-253b-4c7a-b80f-65c5c1be3b7a',pot:39900,refund:40500,starting:{2:19800,3:20000,4:19800,5:20000,6:20000,7:60300,8:40000},nets:[-19800,-200,-100,0,0,0,20100]},
 'table7-hand4':{hand:'3bbb0ab3-f86c-4967-a96a-5500159c171e',number:4,revision:27,players:6,actions:8,request:'d5511003-409f-488d-b467-649900fc7152',winner:'ac0fab65-253b-4c7a-b80f-65c5c1be3b7a',pot:40300,refund:60400,starting:{3:20000,4:19700,5:19800,6:20000,7:80400,8:40000},nets:[-20000,-200,-100,0,0,20300]},
 'table7-hand5':{hand:'a65c290c-5562-4c75-be8d-4bc8fff255ce',number:5,revision:24,players:5,actions:7,request:'11136b88-90c7-4ebe-92ad-f1b259e30377',winner:'ac0fab65-253b-4c7a-b80f-65c5c1be3b7a',pot:39500,refund:0,starting:{4:19700,5:19700,6:19800,7:100700,8:40000},nets:[-19700,-100,0,0,19800]},
 'table7-hand6':{hand:'6e011bcc-6455-4f61-bf69-3d18a0f89bb3',number:6,revision:36,players:9,actions:11,request:'787215de-ca39-4a94-af82-d61139797e93',winner:'ac0fab65-253b-4c7a-b80f-65c5c1be3b7a',pot:40300,refund:0,starting:{1:20000,2:20100,3:20000,4:20000,5:19700,6:19700,7:120500,8:40000,9:20000},nets:[-20000,-300,0,0,0,0,0,0,20300]},
 'table7-hand7':{hand:'d5fb83f7-ffbf-48fc-96de-bf94ad760a8b',number:7,revision:33,players:8,actions:10,request:'8ff02dc3-4967-4998-a6e3-0ab39b24d4d3',winner:'ac0fab65-253b-4c7a-b80f-65c5c1be3b7a',pot:40700,refund:0,starting:{2:20100,3:20000,4:20000,5:19700,6:19700,7:140800,8:39700,9:20000},nets:[-20100,-300,-200,0,0,0,0,20600]},
 'table7-hand8':{hand:'1854e8a6-89d1-41da-951d-c1e4de14ea45',number:8,revision:30,players:7,actions:9,request:'5159317a-2ea8-43a0-bc84-ee326eb176a0',winner:'ac0fab65-253b-4c7a-b80f-65c5c1be3b7a',pot:40200,refund:141400,starting:{3:20000,4:20000,5:19700,6:19700,7:161400,8:39500,9:19700},nets:[-20000,-200,0,0,0,0,20200]},
 'table7-hand9':{hand:'2f5d27d6-4fac-4141-bdd1-b2a8e3a445bd',number:9,revision:26,players:6,actions:7,request:'e511acac-134d-49d8-81f2-99a534e22e44',winner:'ac0fab65-253b-4c7a-b80f-65c5c1be3b7a',pot:40000,refund:161600,starting:{4:20000,5:19700,6:19700,7:181600,8:39500,9:19500},nets:[-20000,0,0,0,0,20000]},
 'table7-hand10':{hand:'cdd466e2-bf11-4a6d-b742-bc7656fa2bd5',number:10,revision:23,players:5,actions:6,request:'e645bdd0-1de3-492c-a793-92eddbaed1ff',winner:'ac0fab65-253b-4c7a-b80f-65c5c1be3b7a',pot:39400,refund:181900,starting:{5:19700,6:19700,7:201600,8:39500,9:19500},nets:[-19700,0,0,0,19700]},
 'table7-hand11':{hand:'001ac942-f6bd-491e-8969-feb43fd0561b',number:11,revision:20,players:4,actions:5,request:'744188b7-64f7-4b6c-ae5d-fef8fe08883f',winner:'ac0fab65-253b-4c7a-b80f-65c5c1be3b7a',pot:39400,refund:201600,starting:{6:19700,7:221300,8:39500,9:19500},nets:[-19700,0,0,19700]},
 'table7-hand12':{hand:'db6c40ad-3eca-4d11-9b77-c257eeac8d17',number:12,revision:17,players:3,actions:4,request:'46bb6c66-7196-415a-a4d4-babf9a0592ca',winner:'ac0fab65-253b-4c7a-b80f-65c5c1be3b7a',pot:39000,refund:0,starting:{7:241000,8:39500,9:19500},nets:[-19500,0,19500]},
 'table7-hand13':{hand:'31c2e710-590f-4e82-b8ff-c8e887c5b314',number:13,revision:15,players:2,actions:4,request:'6ce81676-3bf3-4e61-a54c-37daf40113a7',winner:'ac0fab65-253b-4c7a-b80f-65c5c1be3b7a',pot:79000,refund:221000,starting:{7:260500,8:39500},nets:[-39500,39500]},
};
const linkedD2Case=process.env.VINPOKER_HISTORY_LINKED185;
assert.ok(!linkedD2Case||['1','hand2',...Object.keys(linkedD2Table7Cases)].includes(linkedD2Case));
const linkedD2Table7Proof=Object.hasOwn(linkedD2Table7Cases,linkedD2Case)?linkedD2Table7Cases[linkedD2Case]:null;
const linkedD2Table7=!!linkedD2Table7Proof;
const linked185=process.env.VINPOKER_HISTORY_LINKED185==='1'||linkedD2Hand2||linkedD2Table7;
const linkedD2Table=linkedD2Table7?'8508d715-cd7c-4f1f-bb0d-223d967e355c':'e16d00d3-8537-45e1-893c-fc1f574ea17c';
const linkedD2Session=linkedD2Table7?'9e586a50-61a8-440f-81df-27839c7ba81a':'ca3c62fa-b4c5-4739-b571-5560dce53036';
const linkedD2Pot=linkedD2Table7Proof?.pot??40000;
const linkedD2Board=linkedD2Table7Proof?.board??['2c','3d','7h','9s','Tc'];
const linkedD2Proof=linkedD2Table7Proof??(linkedD2Hand2
 ?{hand:'967d40a1-057b-4bf0-b915-7ac840af1b46',number:2,revision:20,players:4,actions:5,request:'2d8814b4-9852-47c9-94c9-4a9a8895ba50',winner:'3add8ca8-34ff-4f52-8b40-a48c192d3aa5'}
 :{hand:'5ab58f9c-b8db-4a6a-8bb9-23c61fa90e98',number:1,revision:24,players:5,actions:7,request:'af18f40a-a369-482d-9efe-c3a35e64fc71',winner:'ac0fab65-253b-4c7a-b80f-65c5c1be3b7a'});
if(linked185){
 assert.equal(parentHand,linkedD2Proof.hand);
 assert.equal(process.env.VINPOKER_NATIVE_PAID_TOUR,'1');
 assert.ok(verified&&!linked181&&!linked173&&!finish137&&!finish136&&!winner103&&!winner104&&!multiple113&&!retainedSidepot&&!retainedBoardPlay
  &&!browserCorrectionManifest&&!canonicalObserver&&!lostCommitResponse&&!expiredLease&&!correctionDuringCommit&&!correctionEdge
  &&!process.env.VINPOKER_HISTORY_PARENT_BASELINE&&!process.env.VINPOKER_HISTORY_PARENT_D2&&!process.env.VINPOKER_HISTORY_PARENT_SINGLE_DAY);
}
if(linked181){
 assert.equal(parentHand,'47d106b2-97d0-4747-8daf-f11a55476bd9');
 assert.equal(process.env.VINPOKER_NATIVE_PAID_TOUR,'1');
 assert.ok(verified&&!linked173&&!finish137&&!finish136&&!winner103&&!winner104&&!multiple113&&!retainedSidepot&&!retainedBoardPlay
  &&!browserCorrectionManifest&&!canonicalObserver&&!lostCommitResponse&&!expiredLease&&!correctionDuringCommit&&!correctionEdge
  &&!process.env.VINPOKER_HISTORY_PARENT_BASELINE&&!process.env.VINPOKER_HISTORY_PARENT_D2&&!process.env.VINPOKER_HISTORY_PARENT_SINGLE_DAY);
}
if(linked173){
 assert.equal(parentHand,'63242da8-8d27-460d-b680-f7204a1e63ef');
 assert.equal(process.env.VINPOKER_NATIVE_PAID_TOUR,'1');
 assert.ok(verified&&!finish137&&!finish136&&!winner103&&!winner104&&!multiple113&&!retainedSidepot&&!retainedBoardPlay
  &&!browserCorrectionManifest&&!canonicalObserver&&!lostCommitResponse&&!expiredLease&&!correctionDuringCommit&&!correctionEdge
  &&!process.env.VINPOKER_HISTORY_PARENT_BASELINE&&!process.env.VINPOKER_HISTORY_PARENT_D2&&!process.env.VINPOKER_HISTORY_PARENT_SINGLE_DAY);
}
if(finish137){
 assert.equal(parentHand,'4aa376ee-4a27-4963-9c69-dd0a2cd17abf');
 assert.equal(process.env.VINPOKER_NATIVE_PAYOUT,'1');assert.equal(process.env.VINPOKER_NATIVE_PAID_TOUR,'1');
 assert.ok(verified&&!finish136&&!winner103&&!winner104&&!multiple113&&!retainedSidepot&&!retainedBoardPlay&&!browserCorrectionManifest&&!canonicalObserver&&!lostCommitResponse&&!expiredLease&&!correctionDuringCommit&&!correctionEdge&&!process.env.VINPOKER_HISTORY_PARENT_BASELINE);
}
if(finish136){
 assert.equal(parentHand,'4aa376ee-4a27-4963-9c69-dd0a2cd17abf');
 assert.equal(process.env.VINPOKER_NATIVE_PAYOUT,'1');assert.equal(process.env.VINPOKER_NATIVE_PAID_TOUR,'1');
 assert.ok(verified&&!winner103&&!winner104&&!multiple113&&!retainedSidepot&&!retainedBoardPlay&&!browserCorrectionManifest&&!canonicalObserver&&!lostCommitResponse&&!expiredLease&&!correctionDuringCommit&&!correctionEdge);
}
if(multiple113){
 assert.equal(parentHand,'6bcc874f-828e-4e87-beb0-3ecbe9deda19');
 assert.equal(process.env.VINPOKER_NATIVE_PAYOUT,'1');assert.equal(process.env.VINPOKER_NATIVE_PAID_TOUR,'1');
 assert.ok(verified&&!winner103&&!winner104&&!retainedSidepot&&!retainedBoardPlay&&!browserCorrectionManifest&&!canonicalObserver&&!lostCommitResponse&&!expiredLease&&!correctionDuringCommit&&!correctionEdge);
}
if(winner104){
 assert.equal(process.env.VINPOKER_NATIVE_BROWSER,'1');assert.equal(parentHand,'3b17d706-6efa-4264-80b0-ec296397f6cf');
 assert.ok(verified&&!canonicalObserver&&!lostCommitResponse&&!expiredLease&&!correctionDuringCommit&&!correctionEdge);
 assert.ok(!winner103&&!retainedSidepot&&!retainedBoardPlay&&!browserCorrectionManifest&&!process.env.VINPOKER_HISTORY_PARENT_BASELINE);
}
if(winner103){
 assert.equal(process.env.VINPOKER_NATIVE_PAYOUT,'1');assert.equal(process.env.VINPOKER_NATIVE_PAID_TOUR,'1');
 assert.equal(parentHand,'3b17d706-6efa-4264-80b0-ec296397f6cf');
 assert.ok(verified&&!canonicalObserver&&!lostCommitResponse&&!expiredLease&&!correctionDuringCommit&&!correctionEdge);
 assert.ok(!retainedSidepot&&!retainedBoardPlay&&!browserCorrectionManifest);
}
if(retainedSidepot){
 assert.equal(process.env.VINPOKER_NATIVE_PAYOUT,'1');
 assert.equal(process.env.VINPOKER_NATIVE_PAID_TOUR,'1');
 assert.equal(parentHand,retainedShortStack?'ba840f18-085a-430a-918a-6fca24d8c9ca':'08730ce1-9a83-4439-96f9-ac005ae3d734');
 assert.ok(verified&&!canonicalObserver&&!lostCommitResponse&&!expiredLease&&!correctionDuringCommit&&!correctionEdge);
}
if(canonicalObserver){assert.equal(parentHand,undefined,'observer must own a fresh fixture, not a finalized journey');assert.equal(verified,true);}
const baselineParent=process.env.VINPOKER_HISTORY_PARENT_BASELINE;
const d2Parent=process.env.VINPOKER_HISTORY_PARENT_D2;
const singleDayParent=process.env.VINPOKER_HISTORY_PARENT_SINGLE_DAY==='1';
const singleDayShowdown=process.env.VINPOKER_HISTORY_SINGLE_DAY_HAND2==='1';
const replayNumber=process.env.VINPOKER_HISTORY_SINGLE_DAY_REPLAY;
const singleDayReplay=replayNumber?singleDayBrowserHands.find(item=>String(item.number)===replayNumber):null;
assert.ok(!replayNumber||(singleDayReplay&&singleDayParent&&!singleDayShowdown),'owned_browser_replay_manifest_required');
assert.ok(!singleDayShowdown||singleDayParent,'hand2_requires_owned_single_day_parent');
if(singleDayParent)assert.ok(parentHand&&!baselineParent&&!d2Parent&&process.env.VINPOKER_NATIVE_CROSS_FLOW==='1');
assert.ok(!d2Parent || (parentHand && !baselineParent && !process.env.VINPOKER_HISTORY_PARENT_SHOWDOWN
 && process.env.VINPOKER_NATIVE_CROSS_FLOW==='1'),'owned_d2_parent_gate_required');
const parentShowdown=process.env.VINPOKER_HISTORY_PARENT_SHOWDOWN==='1';
const configuredShowdown=process.env.VINPOKER_HISTORY_CONFIGURED_SINGLE_SHOWDOWN==='1';
const configuredBrowserHand3=process.env.VINPOKER_HISTORY_CONFIGURED_BROWSER_HAND3==='1';
const configuredSequentialNumber=process.env.VINPOKER_HISTORY_CONFIGURED_SEQUENTIAL;
const configuredSequential=configuredSequentialNumber?[...configuredSequentialHands,configuredFinalHand].find(h=>String(h.number)===configuredSequentialNumber):null;
if(configuredSequentialNumber){assert.ok(configuredSequential);assert.equal(parentShowdown,true);assert.equal(configuredShowdown,false);assert.equal(configuredBrowserHand3,false);assert.equal(parentHand,configuredSequential.id);assert.equal(JSON.parse(baselineParent).tour,'829e61fe-0ac8-4ced-950d-ab76cb8dadc5');}
if(configuredBrowserHand3){assert.equal(parentShowdown,true);assert.equal(configuredShowdown,false);assert.equal(parentHand,'637c2e84-d785-4f68-901e-d001e84a6bc3');assert.equal(JSON.parse(baselineParent).tour,'829e61fe-0ac8-4ced-950d-ab76cb8dadc5');}
if(configuredShowdown){assert.equal(parentShowdown,true);assert.equal(parentHand,'a6624773-e132-410f-9460-c73ff2c88088');assert.equal(JSON.parse(baselineParent).tour,'829e61fe-0ac8-4ced-950d-ab76cb8dadc5');}
assert.ok(!baselineParent||parentHand,'parent_hand_required');
assert.ok(process.env.VINPOKER_HISTORY_PARENT_SHOWDOWN===undefined||parentShowdown);
if(parentShowdown)assert.ok(parentHand&&baselineParent&&process.env.VINPOKER_NATIVE_PAID_TOUR==='1','owned_paid_showdown_parent_required');
let fixture,hand,singleDayAlreadyVerified=false;
if(parentHand){
 assert.ok(singleDayParent||d2Parent||process.env.VINPOKER_NATIVE_CORRECTION_UI==='1'||process.env.VINPOKER_NATIVE_PAID_TOUR==='1','owned_parent_gate_required');assert.ok(isUuid(parentHand));
 assert.equal(verified,true);assert.ok(!lostCommitResponse&&!expiredLease&&!correctionDuringCommit&&!correctionEdge&&!process.argv.includes('--identity-revision'));
 assert.equal(sql('SELECT current_database();'),database);
 assert.equal(sql("SELECT host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('server_version_num')::int/10000;"),'127.0.0.1|55441|17');
 const dir=sql('SHOW data_directory');assert.ok(dir==='/tmp/vinpoker-sol-local-20261016-0e79a729/data'||process.env.GITHUB_ACTIONS==='true'&&dir==='/var/lib/postgresql/data');
 assert.equal(sql("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net');"),'f');
 let raw;
 if(singleDayParent) {
  assert.equal(parentHand,singleDayReplay?.id??(singleDayShowdown?'f883abef-7fed-4aef-b2fc-22842d8eb106':'0ba64dcd-f572-4cd5-9ba0-d7a52f3a931e'));
  if(singleDayReplay){
   const expected=singleDayReplay;
   raw=sql(`SELECT jsonb_build_object('tour',t.id,'actor',c.owner_id,'club',c.id)
    FROM public.tournament_hands h JOIN public.tournaments t ON t.id=h.tournament_id JOIN public.clubs c ON c.id=t.club_id
    WHERE h.id='${expected.id}' AND t.id='b72cb86e-b2f7-4b32-9b1b-b5fff911ea2f' AND t.name='Single-day browser local TEST'
     AND c.id='9ef80c7a-cb97-4acc-b81c-5bf34d49317f' AND c.owner_id='065801a0-565e-4bd6-9c2d-ee252b7e6494'
     AND t.event_id IS NULL AND h.created_by=c.owner_id AND h.status='completed' AND NOT h.is_voided
     AND h.hand_number=${expected.number} AND h.source_revision=${expected.revision} AND h.pot_size=${expected.pot}
     AND h.community_cards='["2c","3d","4h","7s","9c"]'::jsonb
     AND (SELECT count(*) FROM public.hand_players WHERE hand_id=h.id)=${expected.starting.length}
     AND EXISTS(SELECT 1 FROM floor_private.floor_table_v3_existing_receipt(c.owner_id,'record_tracker_manual_hand_v1','${expected.request}') r WHERE r.result->>'hand_id'=h.id::text)
     AND NOT EXISTS(SELECT 1 FROM public.hand_players hp WHERE hp.hand_id=h.id AND NOT EXISTS(
      SELECT 1 FROM public.tournament_entries e JOIN public.seat_draw_receipts r ON r.entry_id=e.id
       JOIN public.cashier_buyin_movements m ON m.registration_id=e.registration_id AND m.tournament_id=e.tournament_id
      WHERE e.tournament_id=t.id AND e.player_id=hp.player_id AND e.entry_no=hp.entry_number
       AND r.status IN ('issued','superseded') AND r.issued_at<=h.created_at
       AND m.direction='in' AND m.method='cash' AND m.applied_amount=100000));`);
   assert.ok(raw,'owned_exact_browser_finish_paid_generation_lineage_required');
   assert.deepEqual(JSON.parse(sql(`SELECT jsonb_agg(starting_stack ORDER BY starting_stack) FROM public.hand_players WHERE hand_id='${parentHand}';`)),expected.starting);
  }else if(singleDayShowdown){
   raw=sql(`SELECT jsonb_build_object('tour',t.id,'actor',c.owner_id,'club',c.id)
    FROM public.tournament_hands h JOIN public.tournaments t ON t.id=h.tournament_id JOIN public.clubs c ON c.id=t.club_id
    WHERE h.id='${parentHand}' AND t.id='b72cb86e-b2f7-4b32-9b1b-b5fff911ea2f' AND t.name='Single-day browser local TEST'
     AND c.id='9ef80c7a-cb97-4acc-b81c-5bf34d49317f' AND c.owner_id='065801a0-565e-4bd6-9c2d-ee252b7e6494'
     AND t.event_id IS NULL AND h.created_by=c.owner_id AND h.status='completed' AND NOT h.is_voided
     AND h.hand_number=2 AND h.source_revision=43 AND h.pot_size=39900
     AND h.community_cards='["2c","3d","4h","7s","9c"]'::jsonb
     AND (SELECT count(*) FROM public.hand_players WHERE hand_id=h.id)=8
     AND EXISTS(SELECT 1 FROM floor_private.floor_table_v3_existing_receipt(c.owner_id,'record_tracker_manual_hand_v1','c39563de-08c4-4f67-b1f1-2e2547eab4b5') r WHERE r.result->>'hand_id'=h.id::text)
     AND NOT EXISTS(SELECT 1 FROM public.hand_players hp WHERE hp.hand_id=h.id AND NOT EXISTS(
      SELECT 1 FROM public.tournament_entries e JOIN public.seat_draw_receipts r ON r.entry_id=e.id
       JOIN public.cashier_buyin_movements m ON m.registration_id=e.registration_id AND m.tournament_id=e.tournament_id
      WHERE e.tournament_id=t.id AND e.player_id=hp.player_id AND e.entry_no=hp.entry_number
       AND r.draw_type='initial' AND r.status IN ('issued','superseded') AND r.issued_at<=h.created_at
       AND m.direction='in' AND m.method='cash' AND m.applied_amount=100000));`);
   assert.ok(raw,'owned_single_day_hand2_browser_finish_and_paid_lineage_required');
   assert.deepEqual(JSON.parse(sql(`SELECT jsonb_agg(starting_stack ORDER BY starting_stack) FROM public.hand_players WHERE hand_id='${parentHand}';`)),[19900,20000,20000,20000,20000,20000,20000,20100]);
  }else{
  raw=sql(`SELECT jsonb_build_object('tour',t.id,'actor',c.owner_id,'club',c.id)
   FROM public.tournament_hands h JOIN public.tournaments t ON t.id=h.tournament_id
   JOIN public.clubs c ON c.id=t.club_id WHERE h.id='${parentHand}'
    AND t.id='b72cb86e-b2f7-4b32-9b1b-b5fff911ea2f' AND t.name='Single-day browser local TEST'
    AND c.id='9ef80c7a-cb97-4acc-b81c-5bf34d49317f' AND c.owner_id='065801a0-565e-4bd6-9c2d-ee252b7e6494'
    AND t.event_id IS NULL AND h.created_by=c.owner_id AND h.status='completed' AND NOT h.is_voided
    AND h.hand_number=1 AND (SELECT count(*) FROM public.hand_players WHERE hand_id=h.id)=4
    AND NOT EXISTS(SELECT 1 FROM public.hand_players hp WHERE hp.hand_id=h.id AND NOT EXISTS(
     SELECT 1 FROM public.tournament_entries e JOIN public.seat_draw_receipts r ON r.entry_id=e.id
      JOIN public.cashier_buyin_movements m ON m.registration_id=e.registration_id AND m.tournament_id=e.tournament_id
     WHERE e.tournament_id=t.id AND e.player_id=hp.player_id AND e.entry_no=hp.entry_number
      AND hp.starting_stack=20000 AND r.draw_type='initial' AND r.status='issued'
      AND m.direction='in' AND m.method='cash' AND m.applied_amount=100000));`);
  }
  assert.ok(raw,'owned_single_day_browser_paid_parent_required');
  const existing=Number(sql(`SELECT count(*) FROM public.tournament_settlement_outcomes WHERE hand_id='${parentHand}';`));
  assert.ok(existing===0||existing===1);
  if(existing) {
   assert.equal(sql(`SELECT count(*) FROM public.tournament_settlement_outcomes o JOIN public.tournament_hands h ON h.id=o.hand_id
    WHERE h.id='${parentHand}' AND o.source_revision=h.source_revision AND o.status='verified' AND o.verification_scope='historical_display';`),'1');
   singleDayAlreadyVerified=true;
  }
 } else if(d2Parent) {
  const f=JSON.parse(d2Parent);
  assert.ok(f&&['actor','tour','club','event','plan'].every(key=>isUuid(f[key])),'owned_d2_fixture_required');
  raw=sql(`SELECT jsonb_build_object('tour',t.id,'actor',c.owner_id,'club',c.id)
   FROM public.tournament_hands h JOIN public.tournaments t ON t.id=h.tournament_id
   JOIN public.clubs c ON c.id=t.club_id JOIN public.tournament_events ev ON ev.id=t.event_id
   JOIN private.multi_day_initial_draw_plans_v1 p ON p.id='${f.plan}' AND p.event_id=ev.id AND p.final_tournament_id=t.id
   JOIN private.multi_day_initial_draw_applications_v1 a ON a.plan_id=p.id AND a.actor_id=c.owner_id
   WHERE h.id='${parentHand}' AND t.id='${f.tour}' AND ev.id='${f.event}' AND ev.final_tournament_id=t.id
    AND c.id='${f.club}' AND c.owner_id='${f.actor}' AND p.actor_id=c.owner_id AND h.created_by=c.owner_id
    AND t.name='Multi-day Final local TEST' AND t.phase='final' AND c.name='Cash identity local TEST'
    AND h.status='completed' AND NOT h.is_voided
    AND (SELECT count(*) FROM public.hand_players WHERE hand_id=h.id)=3
    AND NOT EXISTS(SELECT 1 FROM public.cashier_buyin_movements WHERE tournament_id=t.id)
    AND NOT EXISTS(SELECT 1 FROM public.tournament_settlement_outcomes WHERE hand_id=h.id)
    AND NOT EXISTS(
     SELECT 1 FROM public.hand_players hp WHERE hp.hand_id=h.id AND NOT EXISTS(
      SELECT 1 FROM public.multi_day_final_seatings_v1 s
      JOIN public.multi_day_final_participations_v1 part ON part.id=s.participation_id AND part.event_id=ev.id
      JOIN public.tournament_entries e ON e.id=s.entry_id AND e.tournament_id=t.id AND e.player_id=hp.player_id AND e.entry_no=hp.entry_number
      WHERE s.final_tournament_id=t.id AND s.player_id=hp.player_id
       AND hp.starting_stack=coalesce((SELECT prior_player.ending_stack FROM public.hand_players prior_player
        JOIN public.tournament_hands prior_hand ON prior_hand.id=prior_player.hand_id
        WHERE prior_hand.tournament_id=t.id AND prior_hand.status='completed' AND NOT prior_hand.is_voided
         AND prior_hand.hand_number<h.hand_number AND prior_player.player_id=hp.player_id
         AND prior_player.entry_number=hp.entry_number ORDER BY prior_hand.hand_number DESC LIMIT 1),s.seed_stack)
       AND jsonb_array_length(s.source_bags)>0 AND s.source_bags=part.source_bags
       AND EXISTS(SELECT 1 FROM jsonb_array_elements(p.receipt->'assignments') x WHERE x->>'playerId'=hp.player_id::text AND x->>'participationId'=part.id::text)
       AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(s.source_bags) x
        LEFT JOIN public.chip_bag b ON b.id=(x->>'bagId')::uuid
        LEFT JOIN public.multi_day_flight_roster_v1 r ON r.flight_tournament_id=(x->>'flightId')::uuid AND r.player_id=hp.player_id
        LEFT JOIN public.tournament_entries src ON src.id=r.entry_id
        WHERE b.id IS NULL OR NOT b.sealed OR b.tournament_id IS DISTINCT FROM (x->>'flightId')::uuid
         OR b.multi_day_sealed_version IS DISTINCT FROM (x->>'bagVersion')::integer
         OR b.total_value IS DISTINCT FROM (x->>'stack')::bigint OR r.entry_id IS DISTINCT FROM (x->>'sourceEntryId')::uuid
         OR NOT EXISTS(SELECT 1 FROM public.cashier_buyin_movements m WHERE m.tournament_id=b.tournament_id AND m.registration_id=src.registration_id AND m.amount>0))));`);
  assert.ok(raw,'owned_qualified_bag_d2_parent_required');
 } else if(baselineParent){
  const f=JSON.parse(baselineParent);assert.ok(f&&['actor','tour','club','player','entry','registration'].every(key=>isUuid(f[key])),'owned_paid_fixture_required');
  if(configuredSequential||retainedSidepot||retainedBoardPlay||winner103||multiple113||mixed230||finish136){
   const count=Number(sql(`SELECT count(*) FROM public.tournament_settlement_outcomes WHERE hand_id='${parentHand}';`));assert.ok(count===0||count===1);
   if(count===1){assert.equal(sql(`SELECT count(*) FROM public.tournament_settlement_outcomes o JOIN public.tournament_hands h ON h.id=o.hand_id AND h.source_revision=o.source_revision
    WHERE h.id='${parentHand}' AND o.status='verified' AND o.verification_scope='historical_display';`),'1');singleDayAlreadyVerified=true;}
  }
  raw=sql(`SELECT jsonb_build_object('tour',h.tournament_id,'actor',c.owner_id,'club',t.club_id) FROM public.tournament_hands h
   JOIN public.tournaments t ON t.id=h.tournament_id JOIN public.clubs c ON c.id=t.club_id
   JOIN public.tournament_entries e ON e.id='${f.entry}' AND e.tournament_id=t.id AND e.player_id='${f.player}' AND e.registration_id='${f.registration}'
   JOIN public.hand_players hp ON hp.hand_id=h.id AND hp.player_id=e.player_id AND hp.entry_number=e.entry_no
   WHERE h.id='${parentHand}' AND h.tournament_id='${f.tour}' AND c.id='${f.club}' AND c.owner_id='${f.actor}' AND h.created_by=c.owner_id
    AND h.status='completed' AND NOT h.is_voided AND c.name='Cash identity local TEST'
    AND (t.name='Cash identity local TEST' OR (t.name='Single-day browser local TEST'
      AND t.id='829e61fe-0ac8-4ced-950d-ab76cb8dadc5' AND c.id='349ecf35-50ba-4c71-a581-15dc45f1cd01'))
    AND EXISTS(SELECT 1 FROM public.cashier_buyin_movements m WHERE m.registration_id=e.registration_id AND m.tournament_id=t.id AND m.amount>0)
    ${singleDayAlreadyVerified?'':'AND NOT EXISTS(SELECT 1 FROM public.tournament_settlement_outcomes o WHERE o.hand_id=h.id)'};`);
  assert.ok(raw,'owned_paid_parent_baseline_required');
  if(pending647||pending657){
   assert.deepEqual(f,{tour:'c367013a-3ed3-48af-ad48-3915acadc50e',club:'d4427834-5f5f-48ef-bde5-e2dc388ed00b',actor:'febf2b51-fdb7-42ff-886c-b3bb1fffdc3e',...(pending687?{player:'a11b1317-4885-4835-8d2e-fb435f7b24e2',entry:'129884e6-d2e4-4795-ade1-5bb1905e784f',registration:'df79ea5e-ef9f-4ef6-a27c-ed53d5486a67'}:{player:'5c2bfc67-c546-4ddb-8209-e5c5693d82f5',entry:'c530aeb0-175c-44f4-8643-2c30d5dce30b',registration:'144e19ef-caa3-4c82-a6f2-11c190415ecb'})});
   if(pending687){
    assert.equal(sql(`SELECT count(*) FROM public.tournament_hands h WHERE h.id='${parentHand}' AND h.hand_number=${finalHistoryCase.number} AND h.source_revision=${finalHistoryCase.revision} AND h.pot_size=${finalHistoryCase.pot}
     AND h.tournament_table_id='c2ce77c0-2b61-4a19-bd43-4752232cc55a' AND h.table_session_id='b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5'
     AND h.community_cards='["2c","3d","7h","9s","Tc"]'::jsonb AND h.tracker_small_blind=100 AND h.tracker_big_blind=200 AND h.tracker_bba=0 AND h.tracker_sb_position=${finalHistoryCase.sb} AND h.tracker_bb_position=${finalHistoryCase.bb}
     AND EXISTS(SELECT 1 FROM floor_private.floor_table_v3_existing_receipt('${f.actor}','record_tracker_manual_hand_v1','${finalHistoryCase.request}') r WHERE r.result->>'hand_id'=h.id::text);`),'1');
    assert.deepEqual(JSON.parse(sql(`SELECT jsonb_agg(jsonb_build_array(seat_number,starting_stack,ending_stack) ORDER BY seat_number) FROM public.hand_players WHERE hand_id='${parentHand}';`)),finalHistoryCase.stacks);
    assert.deepEqual(JSON.parse(sql(`SELECT jsonb_agg(jsonb_build_array(action_type,action_amount) ORDER BY action_order) FROM public.hand_actions WHERE hand_id='${parentHand}';`)),finalHistoryCase.actions);
    assert.equal(sql(`SELECT count(*)||'|'||sum(applied_amount) FROM public.cashier_buyin_movements WHERE tournament_id='${f.tour}';`),'9|900000');
    assert.equal(sql(`SELECT count(*) FROM public.hand_players hp WHERE hp.hand_id='${parentHand}' AND NOT EXISTS(
     SELECT 1 FROM public.tournament_entries e JOIN public.cashier_buyin_movements m ON m.registration_id=e.registration_id AND m.tournament_id=e.tournament_id
     JOIN public.seat_draw_receipts r ON r.entry_id=e.id WHERE e.tournament_id='${f.tour}' AND e.player_id=hp.player_id AND e.entry_no=hp.entry_number
      AND m.direction='in' AND m.method='cash' AND m.applied_amount=100000 AND r.status IN('issued','superseded') AND r.issued_at<=(SELECT created_at FROM public.tournament_hands WHERE id=hp.hand_id));`),'0');
   }else if(pending685){
    assert.equal(sql(`SELECT count(*) FROM public.tournament_hands h WHERE h.id='${parentHand}' AND h.hand_number=6 AND h.source_revision=26 AND h.pot_size=80400
     AND h.tournament_table_id='c2ce77c0-2b61-4a19-bd43-4752232cc55a' AND h.table_session_id='b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5'
     AND h.community_cards='["2c","3d","7h","9s","Tc"]'::jsonb AND h.tracker_small_blind=100 AND h.tracker_big_blind=200 AND h.tracker_bba=0 AND h.tracker_sb_position=3 AND h.tracker_bb_position=4
     AND EXISTS(SELECT 1 FROM floor_private.floor_table_v3_existing_receipt('${f.actor}','record_tracker_manual_hand_v1','3322763a-5856-49b1-ae9a-128be3b46331') r WHERE r.result->>'hand_id'=h.id::text);`),'1');
    assert.deepEqual(JSON.parse(sql(`SELECT jsonb_agg(jsonb_build_array(seat_number,starting_stack,ending_stack) ORDER BY seat_number) FROM public.hand_players WHERE hand_id='${parentHand}';`)),[[2,60000,100200],[4,40200,0],[5,19800,19800],[6,20000,20000],[7,20000,20000],[8,20000,20000]]);
    assert.deepEqual(JSON.parse(sql(`SELECT jsonb_agg(jsonb_build_array(action_type,action_amount) ORDER BY action_order) FROM public.hand_actions WHERE hand_id='${parentHand}';`)),[['post_bb',200],['fold',0],['fold',0],['fold',0],['fold',0],['all_in',60000],['call',40000]]);
    assert.equal(sql(`SELECT count(*)||'|'||sum(applied_amount) FROM public.cashier_buyin_movements WHERE tournament_id='${f.tour}';`),'9|900000');
    assert.equal(sql(`SELECT count(*) FROM public.hand_players hp WHERE hp.hand_id='${parentHand}' AND NOT EXISTS(
     SELECT 1 FROM public.tournament_entries e JOIN public.cashier_buyin_movements m ON m.registration_id=e.registration_id AND m.tournament_id=e.tournament_id
     JOIN public.seat_draw_receipts r ON r.entry_id=e.id WHERE e.tournament_id='${f.tour}' AND e.player_id=hp.player_id AND e.entry_no=hp.entry_number
      AND m.direction='in' AND m.method='cash' AND m.applied_amount=100000 AND r.status IN('issued','superseded') AND r.issued_at<=(SELECT created_at FROM public.tournament_hands WHERE id=hp.hand_id));`),'0');
   }else if(pending683){
    assert.equal(sql(`SELECT count(*) FROM public.tournament_hands h WHERE h.id='${parentHand}' AND h.hand_number=5 AND h.source_revision=30 AND h.pot_size=40000
     AND h.tournament_table_id='c2ce77c0-2b61-4a19-bd43-4752232cc55a' AND h.table_session_id='b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5'
     AND h.community_cards='["2c","3d","7h","9s","Tc"]'::jsonb AND h.tracker_small_blind=100 AND h.tracker_big_blind=200 AND h.tracker_bba=0
     AND EXISTS(SELECT 1 FROM floor_private.floor_table_v3_existing_receipt('${f.actor}','record_tracker_manual_hand_v1','a30a7ec6-b878-4489-b279-4bcc2cb74c28') r WHERE r.result->>'hand_id'=h.id::text);`),'1');
    assert.deepEqual(JSON.parse(sql(`SELECT jsonb_agg(jsonb_build_array(seat_number,starting_stack,ending_stack) ORDER BY seat_number) FROM public.hand_players WHERE hand_id='${parentHand}';`)),[[2,40000,60000],[3,20000,0],[4,40200,40200],[5,19800,19800],[6,20000,20000],[7,20000,20000],[8,20000,20000]]);
    assert.deepEqual(JSON.parse(sql(`SELECT jsonb_agg(jsonb_build_array(action_type,action_amount) ORDER BY action_order) FROM public.hand_actions WHERE hand_id='${parentHand}';`)),[['post_sb',100],['post_bb',200],['fold',0],['fold',0],['fold',0],['fold',0],['fold',0],['all_in',39900],['call',19800]]);
    assert.equal(sql(`SELECT count(*)||'|'||sum(applied_amount) FROM public.cashier_buyin_movements WHERE tournament_id='${f.tour}';`),'9|900000');
    assert.equal(sql(`SELECT count(*) FROM public.hand_players hp WHERE hp.hand_id='${parentHand}' AND NOT EXISTS(
     SELECT 1 FROM public.tournament_entries e JOIN public.cashier_buyin_movements m ON m.registration_id=e.registration_id AND m.tournament_id=e.tournament_id
     JOIN public.seat_draw_receipts r ON r.entry_id=e.id WHERE e.tournament_id='${f.tour}' AND e.player_id=hp.player_id AND e.entry_no=hp.entry_number
      AND m.direction='in' AND m.method='cash' AND m.applied_amount=100000 AND r.status IN('issued','superseded') AND r.issued_at<=(SELECT created_at FROM public.tournament_hands WHERE id=hp.hand_id));`),'0');
    assert.equal(sql(`SELECT count(*) FROM public.hand_players WHERE hand_id='${parentHand}' AND player_id='e5eded2a-1efc-406f-b794-316a39a20a51' AND entry_number=2 AND seat_number=3;`),'1');
   }else{
   assert.equal(sql(`SELECT count(*) FROM public.tournament_hands h WHERE id='${parentHand}' AND source_revision=${pending665||pending679?33:15} AND hand_number=${pending679?4:pending665?3:pending657?2:1} AND pot_size=${pending665||pending679?40000:200}
    AND tournament_table_id='c2ce77c0-2b61-4a19-bd43-4752232cc55a' AND table_session_id='b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5'
    AND community_cards='${pending679?'["2s","3h","7d","9c","Th"]':pending665?'["2c","3d","7h","9s","Tc"]':'[]'}'::jsonb AND tracker_small_blind=100 AND tracker_big_blind=200 AND tracker_bba=0
    AND EXISTS(SELECT 1 FROM floor_private.floor_table_v3_existing_receipt('${f.actor}','record_tracker_manual_hand_v1','${pending679?'77fbf2c6-dfd8-405c-9b00-ff927d11c81b':pending665?'5f9816ff-896f-4693-bdd9-de17d2b06fa1':pending657?'1e986bba-e3c6-43be-84f4-01c938826ab0':'62671214-a5a8-492b-af17-64219d0e8061'}') r WHERE r.result->>'hand_id'=h.id::text);`),'1');
   assert.deepEqual(JSON.parse(sql(`SELECT jsonb_agg(jsonb_build_array(seat_number,starting_stack,ending_stack) ORDER BY seat_number) FROM public.hand_players WHERE hand_id='${parentHand}';`)),pending679?[[1,20000,0],[2,20000,40000],[3,20000,20000],[4,40200,40200],[5,19800,19800],[6,20000,20000],[7,20000,20000],[8,20000,20000]]:pending665?[[1,20000,19800],[2,20000,20000],[3,20000,20000],[4,20000,20000],[6,20000,20000],[7,19900,0],[8,20000,20000],[9,20100,40200]]:pending657?[[6,20000,20000],[7,19900,19900],[8,20100,20000],[9,20000,20100]]:[[6,20000,20000],[7,20000,19900],[8,20000,20100],[9,20000,20000]]);
   assert.deepEqual(JSON.parse(sql(`SELECT jsonb_agg(jsonb_build_array(action_type,action_amount) ORDER BY action_order) FROM public.hand_actions WHERE hand_id='${parentHand}';`)),pending679?[['post_sb',100],['post_bb',200],['fold',0],['fold',0],['fold',0],['fold',0],['fold',0],['fold',0],['all_in',19900],['call',19800]]:pending665?[['post_sb',100],['post_bb',200],['fold',0],['fold',0],['fold',0],['fold',0],['all_in',19900],['fold',0],['call',19800],['fold',0]]:[['post_sb',100],['post_bb',200],['fold',0],['fold',0],['fold',0]]);
   assert.equal(sql(`SELECT count(*)||'|'||sum(applied_amount) FROM public.cashier_buyin_movements WHERE tournament_id='${f.tour}';`),pending679?'9|900000':'8|800000');
   if(pending679){
    assert.equal(sql(`SELECT count(*) FROM public.hand_players hp WHERE hp.hand_id='${parentHand}' AND NOT EXISTS(
     SELECT 1 FROM public.tournament_entries e JOIN public.cashier_buyin_movements m ON m.registration_id=e.registration_id AND m.tournament_id=e.tournament_id
     JOIN public.seat_draw_receipts r ON r.entry_id=e.id WHERE e.tournament_id='${f.tour}' AND e.player_id=hp.player_id AND e.entry_no=hp.entry_number
      AND m.direction='in' AND m.method='cash' AND m.applied_amount=100000 AND r.status IN('issued','superseded') AND r.issued_at<=(SELECT created_at FROM public.tournament_hands WHERE id=hp.hand_id));`),'0');
    assert.equal(sql(`SELECT count(*) FROM public.hand_players WHERE hand_id='${parentHand}' AND player_id='e5eded2a-1efc-406f-b794-316a39a20a51' AND entry_number=2 AND seat_number=3;`),'1');
   }
   }
  }
  if(pending472||pending477||pending554||pending575||pending594){
   assert.equal(f.tour,'46cab483-91e7-4220-aacf-e17bdf05269c');
   assert.equal(f.club,'a8e7d1b7-fdaa-45ad-b0a1-f894b6315760');
   assert.equal(f.actor,'675fe35e-60a8-4452-bb90-e79486d54da6');
   assert.equal(sql(`SELECT count(*) FROM public.tournament_hands h WHERE id='${parentHand}' AND hand_number=${pending594?38:pending575?36:pending554?35:pending477?34:33} AND source_revision=${pending575?23:pending554?15:pending477?19:9} AND pot_size=${pending575?1600:pending554?2200:pending477?400:200}
    AND tournament_table_id='d294f4a4-082b-4efc-a6ca-1f96579ea344' AND table_session_id='ee2b9393-0c96-42f9-8667-7f306edeb9bc'
    AND EXISTS(SELECT 1 FROM floor_private.floor_table_v3_existing_receipt('${f.actor}','record_tracker_manual_hand_v1','${pending594?'c912c011-76ef-4244-bbc3-e3243d4a091f':pending575?'8dd75121-3cef-47a4-b5b9-7de60166a2c9':pending554?'65a6a27a-3673-4d49-b753-2f4a43611c50':pending477?'71ab16b8-c996-47a8-88ad-b128eae92084':'be1cd666-bbb5-4d2a-91c3-cbcfe5623a53'}') r WHERE r.result->>'hand_id'=h.id::text);`),'1');
   assert.deepEqual(JSON.parse(sql(`SELECT jsonb_agg(jsonb_build_array(seat_number,starting_stack,ending_stack) ORDER BY seat_number) FROM public.hand_players WHERE hand_id='${parentHand}';`)),pending594?[[1,58800,58900],[2,1200,1100]]:pending554||pending575?[[1,58900,58900],[2,1100,1100]]:pending477?[[1,58700,58900],[2,1300,1100]]:[[1,58800,58700],[2,1200,1300]]);
   if(pending594){
    assert.deepEqual(JSON.parse(sql(`SELECT community_cards FROM public.tournament_hands WHERE id='${parentHand}';`)),[]);
    assert.deepEqual(JSON.parse(sql(`SELECT jsonb_agg(jsonb_build_array(action_type,action_amount) ORDER BY action_order) FROM public.hand_actions WHERE hand_id='${parentHand}';`)),[['post_sb',100],['post_bb',200],['fold',0]]);
    assert.equal(sql("SELECT count(*) FROM private.tracker_undo_intent_cancellations_v1 WHERE idempotency_key='d69b3aed-ab90-42db-93fd-633e7903427e' AND hand_id='7080b766-b07b-41c5-b4f5-d3350cc505d5';"),'1');
   }
   if(pending575){
    assert.deepEqual(JSON.parse(sql(`SELECT community_cards FROM public.tournament_hands WHERE id='${parentHand}';`)),['9c','Th','Jd','Qs','Kc']);
    assert.deepEqual(JSON.parse(sql(`SELECT jsonb_agg(jsonb_build_array(action_type,action_amount) ORDER BY action_order) FROM public.hand_actions WHERE hand_id='${parentHand}';`)),[['post_sb',100],['post_bb',200],['raise',300],['call',200],['check',0],['bet',200],['raise',400],['call',200],['check',0],['check',0],['check',0],['check',0]]);
    assert.deepEqual(JSON.parse(sql(`SELECT jsonb_agg(hole_cards ORDER BY seat_number) FROM public.hand_players WHERE hand_id='${parentHand}';`)),[['3c','8s'],['2h','7d']]);
   }
   if(pending554){
    assert.deepEqual(JSON.parse(sql(`SELECT community_cards FROM public.tournament_hands WHERE id='${parentHand}';`)),['2c','3d','4h','5s','6c']);
    assert.deepEqual(JSON.parse(sql(`SELECT jsonb_agg(jsonb_build_array(action_type,action_amount) ORDER BY action_order) FROM public.hand_actions WHERE hand_id='${parentHand}';`)),[['post_sb',100],['post_bb',200],['all_in',58800],['call',900]]);
    assert.deepEqual(JSON.parse(sql(`SELECT jsonb_agg(hole_cards ORDER BY seat_number) FROM public.hand_players WHERE hand_id='${parentHand}';`)),[['Ah','Ad'],['Kh','Kd']]);
   }
   if(pending477){
    assert.deepEqual(JSON.parse(sql(`SELECT community_cards FROM public.tournament_hands WHERE id='${parentHand}';`)),['As','Kh','Qd','7c','2d']);
    assert.equal(sql(`SELECT count(*) FROM public.hand_actions WHERE hand_id='${parentHand}';`),'10');
   }
  }
  if(mixed230){
   assert.deepEqual(f,{club:'aa892f65-ee9d-4248-a24c-8dfabd8b05a8',tour:'371c106a-97ad-40e8-a63d-7fc2b15a8ecc',actor:'34a88927-047d-401a-a4de-af49c391849b',entry:'d33db9c6-708b-42ff-af7b-3f2ee7547ae1',player:'8bafad4d-51f0-4f30-b651-5518eeba8a40',registration:'dc352bea-5a83-4f53-8b2f-d10c0c7ef80a'});
   assert.equal(sql(`SELECT count(*) FROM public.tournament_hands h WHERE id='${parentHand}' AND source_revision=20 AND hand_number=2 AND pot_size=59900
    AND tournament_table_id='c239e871-47c2-4ba8-829f-87d339f88112' AND table_session_id='253708f1-064b-47ef-8685-e08a0ff0898f'
    AND community_cards='["2c","3d","7h","9s","Tc"]'::jsonb
    AND EXISTS(SELECT 1 FROM floor_private.floor_table_v3_existing_receipt('${f.actor}','record_tracker_manual_hand_v1','2152f973-f737-4458-a48e-e3db724c1147') r WHERE r.result->>'hand_id'=h.id::text);`),'1');
   assert.deepEqual(JSON.parse(sql(`SELECT jsonb_agg(jsonb_build_array(starting_stack,ending_stack,hole_cards) ORDER BY seat_number) FROM public.hand_players WHERE hand_id='${parentHand}';`)),[[19900,59700,['As','Ad']],[20100,300,['Ks','Kd']],[20000,0,['Qs','Qd']]]);
   assert.equal(sql(`SELECT count(*)||'|'||sum(applied_amount) FROM public.cashier_buyin_movements WHERE tournament_id='${f.tour}';`),'3|300000');
   assert.equal(sql(`SELECT count(*) FROM public.hand_actions WHERE hand_id='${parentHand}';`),'7');
   assert.equal(sql(`SELECT auto_swing_enabled FROM public.club_settings WHERE club_id='${f.club}';`),'f');
  }
  if(finish136){
   assert.deepEqual(f,{tour:'46cab483-91e7-4220-aacf-e17bdf05269c',club:'a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',actor:'675fe35e-60a8-4452-bb90-e79486d54da6',entry:'96ae5f01-7e6e-4344-895a-2b5cdbf124cd',player:'5f4dd4c4-a9d0-43a9-b523-ab5ec5d3c103',registration:'b0b7ac28-0d84-4d66-af43-028ed172390f'});
   assert.equal(sql(`SELECT count(*) FROM public.tournament_hands h WHERE h.id='${parentHand}' AND h.hand_number=32 AND h.source_revision=21 AND h.pot_size=400 AND h.tournament_table_id='d294f4a4-082b-4efc-a6ca-1f96579ea344' AND h.table_session_id='ee2b9393-0c96-42f9-8667-7f306edeb9bc' AND h.community_cards='["2c","3d","7s","9c","Jd"]'::jsonb
    AND EXISTS(SELECT 1 FROM floor_private.floor_table_v3_existing_receipt('${f.actor}','record_tracker_manual_hand_v1','b04fc2c9-56cf-46f0-a256-bda72e88fcd1') r WHERE r.result->>'hand_id'=h.id::text AND (r.result->>'committed_source_revision')::bigint=21);`),'1');
   assert.deepEqual(JSON.parse(sql(`SELECT jsonb_agg(jsonb_build_array(seat_number,starting_stack,ending_stack,hole_cards) ORDER BY seat_number) FROM public.hand_players WHERE hand_id='${parentHand}';`)),[[1,58600,58400,['Ks','Kh']],[2,1400,1600,['As','Ah']]]);
   assert.equal(sql(`SELECT count(*) FROM public.hand_actions WHERE hand_id='${parentHand}';`),'10');
   assert.equal(sql(`SELECT sum(amount) FROM public.cashier_buyin_movements WHERE tournament_id='${f.tour}';`),'300000');
  }
  if(multiple113){
   assert.deepEqual(f,{club:'8e5239a5-36f2-4a0b-a0a3-cb7a236f51b2',tour:'d24e3aed-f125-4bc5-ab11-49836c435e30',actor:'f793a5b3-6025-4766-bc1b-49f16aa1b44a',entry:'84bf4113-c9cb-4ce0-bbbd-f808685b157d',player:'a6b9e3c6-ce29-4ce9-851b-b3e7a8698dec',registration:'0b14549a-b6d7-4e00-9487-125cdfb575b1'});
   assert.equal(sql(`SELECT count(*) FROM public.tournament_hands WHERE id='${parentHand}' AND hand_number=3 AND source_revision=21 AND pot_size=79799 AND tournament_table_id='22d4d681-6379-41fa-82c3-db2960fcd3b5' AND table_session_id='53e06f2b-44df-4a70-bb2e-ca42a33b984f' AND community_cards='["2c","3d","7h","9s","Tc"]'::jsonb;`),'1');
   assert.deepEqual(JSON.parse(sql(`SELECT jsonb_agg(jsonb_build_array(seat_number,starting_stack,ending_stack,hole_cards) ORDER BY seat_number) FROM public.hand_players WHERE hand_id='${parentHand}';`)),[[3,19599,78396,['As','Ad']],[5,20301,201,['Qs','Qd']],[6,20100,802,['Kh','Kc']],[7,20000,601,['Ks','Kd']]]);
   assert.equal(sql(`SELECT count(*)||'|'||sum(applied_amount) FROM public.cashier_buyin_movements WHERE tournament_id='${f.tour}';`),'4|400000');
   assert.equal(sql(`SELECT count(*) FROM floor_private.floor_table_v3_existing_receipt('${f.actor}','record_tracker_manual_hand_v1','a6285573-db24-4955-bb6d-e424a027ac06') r WHERE r.result->>'hand_id'='${parentHand}';`),'1');
  }
  if(winner103){
   assert.equal(f.tour,'46cab483-91e7-4220-aacf-e17bdf05269c');assert.equal(f.club,'a8e7d1b7-fdaa-45ad-b0a1-f894b6315760');
   assert.equal(f.actor,'675fe35e-60a8-4452-bb90-e79486d54da6');
   assert.equal(sql(`SELECT count(*) FROM public.tournament_hands h WHERE h.id='${parentHand}' AND h.source_revision=16
    AND h.hand_number=29 AND h.pot_size=2800 AND h.table_session_id='ee2b9393-0c96-42f9-8667-7f306edeb9bc'
    AND h.community_cards='["2c","3d","7s","9c","Jd"]'::jsonb
    AND EXISTS(SELECT 1 FROM floor_private.floor_table_v3_existing_receipt('${f.actor}','record_tracker_manual_hand_v1','3fb7f5d7-41f3-4daa-acd4-8f325e5b1a9a') r WHERE r.result->>'hand_id'=h.id::text);`),'1');
   assert.deepEqual(JSON.parse(sql(`SELECT jsonb_agg(jsonb_build_array(seat_number,starting_stack,ending_stack,hole_cards) ORDER BY seat_number) FROM public.hand_players WHERE hand_id='${parentHand}';`)),[[1,58600,57200,['Ks','Kh']],[2,1400,2800,['As','Ah']]]);
  }
  if(retainedBoardPlay){
   assert.equal(f.tour,'46cab483-91e7-4220-aacf-e17bdf05269c');
   assert.equal(f.club,'a8e7d1b7-fdaa-45ad-b0a1-f894b6315760');
   assert.equal(f.actor,'675fe35e-60a8-4452-bb90-e79486d54da6');
   assert.equal(sql(`SELECT count(*) FROM public.tournament_hands h WHERE h.id='${parentHand}' AND h.source_revision=${boardPlayProof.revision}
    AND h.hand_number=${boardPlayProof.number} AND h.pot_size=${boardPlayProof.pot} AND h.table_session_id='ee2b9393-0c96-42f9-8667-7f306edeb9bc'
    AND h.community_cards='["As","Ks","Qs","Js","Ts"]'::jsonb
    AND EXISTS(SELECT 1 FROM floor_private.floor_table_v3_existing_receipt('${f.actor}','record_tracker_manual_hand_v1','${boardPlayProof.request}') r
     WHERE r.result->>'hand_id'=h.id::text);`),'1');
   assert.deepEqual(JSON.parse(sql(`SELECT jsonb_agg(jsonb_build_array(seat_number,starting_stack,ending_stack,hole_cards) ORDER BY seat_number)
    FROM public.hand_players WHERE hand_id='${parentHand}';`)),[[1,59400,59400,['4c','5d']],[2,600,600,['2c','3d']]]);
  }
  if(retainedSidepot){
   assert.equal(f.tour,'46cab483-91e7-4220-aacf-e17bdf05269c');
   assert.equal(f.club,'a8e7d1b7-fdaa-45ad-b0a1-f894b6315760');
   assert.equal(f.actor,'675fe35e-60a8-4452-bb90-e79486d54da6');
   assert.equal(sql(`SELECT count(*) FROM public.tournament_hands h WHERE h.id='${parentHand}' AND h.source_revision=${retainedShortStack?19:24}
    AND h.pot_size=${retainedShortStack?600:59900} AND h.community_cards='["2c","3d","7h","9s","Tc"]'::jsonb
    AND EXISTS(SELECT 1 FROM floor_private.floor_table_v3_existing_receipt('${f.actor}','record_tracker_manual_hand_v1','${retainedShortStack?'d93ea701-428d-4691-a209-aedafd0ef6e6':'f1f9b9be-4104-48bf-843d-7237beaebd3b'}') r
     WHERE r.result->>'hand_id'=h.id::text);`),'1');
   assert.deepEqual(JSON.parse(sql(`SELECT jsonb_agg(jsonb_build_array(seat_number,starting_stack,ending_stack,hole_cards) ORDER BY seat_number)
    FROM public.hand_players WHERE hand_id='${parentHand}';`)),retainedShortStack?[[2,59700,59400,['Ks','Kd']],[3,300,600,['As','Ad']]]
      :[[2,19900,59700,['As','Ad']],[3,20100,300,['Ks','Kd']],[7,20000,0,['Qs','Qd']]]);
  }
 }else if(linked185){
  raw=sql(`SELECT jsonb_build_object('tour',h.tournament_id,'actor',c.owner_id,'club',t.club_id)
   FROM public.tournament_hands h JOIN public.tournaments t ON t.id=h.tournament_id JOIN public.clubs c ON c.id=t.club_id
   WHERE h.id='${parentHand}' AND h.hand_number=${linkedD2Proof.number} AND h.source_revision=${linkedD2Proof.revision} AND h.status='completed' AND NOT h.is_voided
    AND t.id='4cd3af4d-7e1d-4042-855f-04fb6777e580' AND t.event_id='dbb49f8d-7d47-4c2c-afd9-f57062c9971d'
    AND t.name='Main Event browser local TEST 164 · Final Day' AND c.id='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760'
    AND c.owner_id='675fe35e-60a8-4452-bb90-e79486d54da6' AND h.created_by=c.owner_id
    AND h.tournament_table_id='${linkedD2Table}' AND h.table_session_id='${linkedD2Session}'
    AND h.pot_size=${linkedD2Pot} AND h.community_cards='${JSON.stringify(linkedD2Board)}'::jsonb
    AND (SELECT count(*) FROM public.hand_players WHERE hand_id=h.id)=${linkedD2Proof.players}
    AND (SELECT count(*) FROM public.hand_actions WHERE hand_id=h.id)=${linkedD2Proof.actions}
    AND EXISTS(SELECT 1 FROM floor_private.floor_table_v3_existing_receipt(c.owner_id,'record_tracker_manual_hand_v1','${linkedD2Proof.request}') r
      WHERE r.result->>'hand_id'=h.id::text AND (r.result->>'committed_source_revision')::bigint=${linkedD2Proof.revision})
    AND NOT EXISTS(SELECT 1 FROM public.hand_players hp WHERE hp.hand_id=h.id AND NOT EXISTS(
      SELECT 1 FROM public.tournament_entries e JOIN public.multi_day_final_seatings_v1 fs ON fs.entry_id=e.id
      JOIN public.multi_day_final_participations_v1 p ON p.id=fs.participation_id
      WHERE e.tournament_id=t.id AND e.player_id=hp.player_id AND e.entry_no=hp.entry_number
       AND p.event_id=t.event_id AND hp.starting_stack=${linkedD2Table7?`('${JSON.stringify(linkedD2Table7Proof.starting)}'::jsonb->>hp.seat_number::text)::bigint`:linkedD2Hand2?'CASE WHEN hp.seat_number=2 THEN 40000 ELSE 20000 END':'20000'}
       AND fs.seed_stack=CASE WHEN hp.player_id='675fe35e-60a8-4452-bb90-e79486d54da6' THEN 20100
         WHEN hp.player_id='4c482b0f-cbb7-4676-8d56-2e9f9c7d2953' THEN 19900 ELSE 20000 END
       AND jsonb_array_length(p.source_bags)>0));`);
 }else if(linked181){
  raw=sql(`SELECT jsonb_build_object('tour',h.tournament_id,'actor',c.owner_id,'club',t.club_id)
   FROM public.tournament_hands h JOIN public.tournaments t ON t.id=h.tournament_id JOIN public.clubs c ON c.id=t.club_id
   WHERE h.id='${parentHand}' AND h.hand_number=1 AND h.source_revision=33 AND h.status='completed' AND NOT h.is_voided
    AND t.id='782a5196-5ea1-44ed-8a27-1b872d5f88d9' AND t.event_id='dbb49f8d-7d47-4c2c-afd9-f57062c9971d'
    AND t.name='Main Event browser local TEST 164 · Flight A' AND c.id='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760'
    AND c.owner_id='675fe35e-60a8-4452-bb90-e79486d54da6' AND h.created_by=c.owner_id
    AND h.tournament_table_id='04305b3a-217f-4d31-8654-e14df5e606c5' AND h.table_session_id='0f8ed188-785b-4105-a8c2-6a93f6192f01'
    AND h.pot_size=40000 AND h.community_cards='["Ah","Kh","Qh","Jh","Th"]'::jsonb
    AND (SELECT count(*) FROM public.hand_players WHERE hand_id=h.id)=8
    AND (SELECT count(*) FROM public.hand_actions WHERE hand_id=h.id)=10
    AND EXISTS(SELECT 1 FROM floor_private.floor_table_v3_existing_receipt(c.owner_id,'record_tracker_manual_hand_v1','736df023-5c47-4532-969b-436b567859d1') r
      WHERE r.result->>'hand_id'=h.id::text AND (r.result->>'committed_source_revision')::bigint=33)
    AND NOT EXISTS(SELECT 1 FROM public.hand_players hp WHERE hp.hand_id=h.id AND NOT EXISTS(
      SELECT 1 FROM public.tournament_entries e JOIN public.cashier_buyin_movements m ON m.registration_id=e.registration_id
      JOIN public.seat_draw_receipts sr ON sr.entry_id=e.id
      WHERE e.tournament_id=t.id AND e.player_id=hp.player_id AND e.entry_no=hp.entry_number AND hp.starting_stack=20000
       AND hp.ending_stack=20000 AND m.tournament_id=t.id AND m.applied_amount=115000 AND sr.status='issued' AND sr.issued_at<=h.created_at));`);
 }else if(linked173){
  raw=sql(`SELECT jsonb_build_object('tour',h.tournament_id,'actor',c.owner_id,'club',t.club_id)
   FROM public.tournament_hands h JOIN public.tournaments t ON t.id=h.tournament_id JOIN public.clubs c ON c.id=t.club_id
   WHERE h.id='${parentHand}' AND h.hand_number=1 AND h.source_revision=27 AND h.status='completed' AND NOT h.is_voided
    AND t.id='fdf91018-09f3-4cdc-b76a-f688eb216cee' AND t.event_id='dbb49f8d-7d47-4c2c-afd9-f57062c9971d'
    AND t.name='Main Event browser local TEST 164 · Flight B' AND c.id='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760'
    AND c.owner_id='675fe35e-60a8-4452-bb90-e79486d54da6' AND h.created_by=c.owner_id
    AND h.tournament_table_id='8ce69933-b2d0-4dfe-962e-86709c6222ac' AND h.table_session_id='c3f4dcfe-6dd1-4ef4-8cec-e0a9cf613e55'
    AND h.pot_size=200 AND (SELECT count(*) FROM public.hand_players WHERE hand_id=h.id)=8
    AND (SELECT count(*) FROM public.hand_actions WHERE hand_id=h.id)=9
    AND EXISTS(SELECT 1 FROM floor_private.floor_table_v3_existing_receipt(c.owner_id,'record_tracker_manual_hand_v1','7d4af38a-26b8-4511-af20-27b5ffaea11b') r
      WHERE r.result->>'hand_id'=h.id::text AND (r.result->>'committed_source_revision')::bigint=27)
    AND NOT EXISTS(SELECT 1 FROM public.hand_players hp WHERE hp.hand_id=h.id AND NOT EXISTS(
      SELECT 1 FROM public.tournament_entries e JOIN public.cashier_buyin_movements m ON m.registration_id=e.registration_id
      JOIN public.seat_draw_receipts sr ON sr.entry_id=e.id
      WHERE e.tournament_id=t.id AND e.player_id=hp.player_id AND e.entry_no=hp.entry_number AND hp.starting_stack=20000
       AND m.tournament_id=t.id AND m.applied_amount=115000 AND sr.status='issued' AND sr.issued_at<=h.created_at));`);
  assert.deepEqual(JSON.parse(sql(`SELECT jsonb_agg(ending_stack ORDER BY ending_stack) FROM public.hand_players WHERE hand_id='${parentHand}';`)),[19900,20000,20000,20000,20000,20000,20000,20100]);
 }else if(finish137){
  raw=sql(`SELECT jsonb_build_object('tour',h.tournament_id,'actor',c.owner_id,'club',t.club_id)
   FROM public.tournament_hands h JOIN public.tournaments t ON t.id=h.tournament_id JOIN public.clubs c ON c.id=t.club_id
   JOIN public.tournament_settlement_outcomes o ON o.hand_id=h.id CROSS JOIN LATERAL public.get_tournament_settlement_source_hash(h.id) s
   WHERE h.id='${parentHand}' AND h.hand_number=32 AND h.source_revision=24 AND h.status='completed' AND NOT h.is_voided
    AND t.id='46cab483-91e7-4220-aacf-e17bdf05269c' AND c.id='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760' AND c.owner_id='675fe35e-60a8-4452-bb90-e79486d54da6' AND h.created_by=c.owner_id
    AND h.tournament_table_id='d294f4a4-082b-4efc-a6ca-1f96579ea344' AND h.table_session_id='ee2b9393-0c96-42f9-8667-7f306edeb9bc' AND h.pot_size=400 AND h.community_cards='["2c","3d","7s","9c","Kc"]'::jsonb
    AND o.source_revision=s.source_revision AND o.source_chain_hash=s.source_chain_hash AND o.status='verified' AND o.verification_scope='chain' AND o.actor_user_id=c.owner_id
    AND o.idempotency_key='8cf502ce-c75e-4547-9ab7-24f21d762ca6' AND o.correction_reason='TEST browser137 river Kc correction hand32';`);
  assert.deepEqual(JSON.parse(sql(`SELECT jsonb_agg(jsonb_build_array(seat_number,starting_stack,ending_stack,hole_cards) ORDER BY seat_number) FROM public.hand_players WHERE hand_id='${parentHand}';`)),[[1,58600,58800,['Ks','Kh']],[2,1400,1200,['As','Ah']]]);
 }else if(winner104){
  raw=sql(`SELECT jsonb_build_object('tour',h.tournament_id,'actor',c.owner_id,'club',t.club_id)
   FROM public.tournament_hands h JOIN public.tournaments t ON t.id=h.tournament_id JOIN public.clubs c ON c.id=t.club_id
   JOIN public.tournament_settlement_outcomes o ON o.hand_id=h.id CROSS JOIN LATERAL public.get_tournament_settlement_source_hash(h.id) s
   WHERE h.id='${parentHand}' AND t.id='46cab483-91e7-4220-aacf-e17bdf05269c' AND c.id='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760'
    AND c.owner_id='675fe35e-60a8-4452-bb90-e79486d54da6' AND h.created_by=c.owner_id
    AND h.tournament_table_id='d294f4a4-082b-4efc-a6ca-1f96579ea344' AND h.source_revision=19 AND h.hand_number=29
    AND h.status='completed' AND NOT h.is_voided AND h.pot_size=2800 AND h.community_cards='["2c","3d","4h","5s","6c"]'::jsonb
    AND o.actor_user_id=c.owner_id AND o.source_revision=s.source_revision AND o.source_chain_hash=s.source_chain_hash
    AND o.status='verified' AND o.verification_scope='chain' AND o.idempotency_key='825c183b-d141-4005-9bf2-6c414613cc5a'
    AND o.correction_reason='TEST browser board plays correction hand29';`);
 }else if(browserCorrectionManifest){
  const f=browserCorrectionManifest;
  if(correction648){
   assert.deepEqual(JSON.parse(sql(`SELECT jsonb_agg(jsonb_build_array(seat_number,starting_stack,ending_stack,hole_cards) ORDER BY seat_number) FROM public.hand_players WHERE hand_id='${parentHand}';`)),[[6,20000,20000,[]],[7,20000,19900,[]],[8,20000,20100,['As','Ad']],[9,20000,20000,[]]]);
   assert.equal(sql(`SELECT count(*) FROM public.tournament_settlement_outcomes WHERE hand_id='${parentHand}' AND source_revision=15 AND status='stale' AND verification_scope='historical_display';`),'1');
   assert.equal(sql(`SELECT count(*) FROM public.tournament_settlement_outcomes WHERE hand_id='${parentHand}' AND source_revision=19 AND status='verified' AND verification_scope='chain' AND idempotency_key='32cd5536-9f25-47f3-84bf-c5198e89555d';`),'1');
  }
  raw=sql(`SELECT jsonb_build_object('tour',h.tournament_id,'actor',o.actor_user_id,'club',t.club_id)
   FROM public.tournament_hands h JOIN public.tournaments t ON t.id=h.tournament_id
   JOIN public.clubs c ON c.id=t.club_id JOIN public.tournament_settlement_outcomes o ON o.hand_id=h.id
   CROSS JOIN LATERAL public.get_tournament_settlement_source_hash(h.id) s
   WHERE h.id='${f.hand}' AND t.id='${f.tour}' AND c.id='${f.club}' AND c.owner_id='${f.actor}'
    AND h.created_by=c.owner_id AND h.tournament_table_id='${f.table}' AND h.source_revision=${f.sourceRevision}
    AND t.name='Cash identity local TEST' AND c.name='Cash identity local TEST'
    AND h.status='completed' AND NOT h.is_voided AND h.community_cards='${correction648?'[]':correction290?'["2c","3d","7s","9c","Kd"]':'["2c","3d","4h","5s","6c"]'}'::jsonb
    AND o.actor_user_id=c.owner_id AND o.source_revision=s.source_revision AND o.source_chain_hash=s.source_chain_hash
    AND o.status='verified' AND o.verification_scope='chain' AND o.correction_reason='${correction648?'LOCAL Single648 TEST bổ sung bài lật người thắng; không đổi chip':correction290?'LOCAL correction290 TEST đổi chất K, giữ nguyên stack':'TEST browser correction receipt recovery'}'
    ${correction290?"AND o.idempotency_key='5498a0ed-eef4-48be-86c2-4ada113741ba'":''};`);
 }else raw=sql(`SELECT jsonb_build_object('tour',h.tournament_id,'actor',o.actor_user_id,'club',t.club_id) FROM public.tournament_hands h
  JOIN public.tournaments t ON t.id=h.tournament_id JOIN public.tournament_settlement_outcomes o ON o.hand_id=h.id AND o.source_revision=h.source_revision
  WHERE h.id='${parentHand}' AND h.status='completed' AND NOT h.is_voided AND o.status='verified' AND o.verification_scope='chain'
   AND o.correction_reason='TEST parent correction recovery';`);
 assert.ok(raw,'owned_parent_correction_required');const row=JSON.parse(raw);
 if(correction291Replay){
  assert.equal(sql(`SELECT count(*) FROM public.tracker_historical_display_queue WHERE hand_id='${parentHand}' AND source_revision=25 AND status='completed';`),'1');
  assert.equal(sql(`SELECT count(*) FROM public.tournament_settlement_outcomes o CROSS JOIN LATERAL public.get_tournament_historical_display_source_hash(o.hand_id) s WHERE o.hand_id='${parentHand}' AND o.source_revision=25 AND o.source_revision=s.source_revision AND o.source_chain_hash=s.source_chain_hash AND o.verification_scope='historical_display' AND o.status='verified';`),'1');
  singleDayAlreadyVerified=true;
 }
 assert.ok(row&&isUuid(row.tour)&&isUuid(row.actor)&&isUuid(row.club));fixture=row;hand=parentHand;
 assert.equal(sql(`SELECT count(*) FROM public.tracker_historical_display_queue q JOIN public.tournament_hands h ON h.id=q.hand_id AND h.source_revision=q.source_revision WHERE h.id='${hand}' AND q.status='pending';`),singleDayAlreadyVerified?'0':'1');
}else({fixture,hand}=createPaidCompletedHandFixture(sql,{verified}));
if(canonicalObserver||process.argv.includes('--history-correction-locks')){
 assert.equal(parentHand,undefined,'lock observer must not change settings of retained parent journeys');
 sql(`INSERT INTO public.club_settings(club_id,auto_swing_enabled) VALUES('${fixture.club}',false)
  ON CONFLICT(club_id) DO UPDATE SET auto_swing_enabled=false;`);
 assert.equal(sql(`SELECT auto_swing_enabled FROM public.club_settings WHERE club_id='${fixture.club}';`),'f');
}
const business=()=>sql(`SELECT jsonb_build_object('hand',(SELECT to_jsonb(h) FROM public.tournament_hands h WHERE id='${hand}'),
 'seats',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.tournament_seats s WHERE tournament_id='${fixture.tour}'),
 'money',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m WHERE tournament_id='${fixture.tour}'));`);
const before=business(),calls=[],errors=[];
const expectedNets=parentHand?JSON.parse(sql(`SELECT jsonb_agg(delta ORDER BY delta) FROM (SELECT ending_stack-starting_stack delta FROM public.hand_players WHERE hand_id='${hand}') x;`)):[-100,100];
if(singleDayShowdown)assert.deepEqual(expectedNets,[-19900,-100,0,0,0,0,0,20000]);
if(singleDayReplay)assert.deepEqual(expectedNets,singleDayReplay.nets);
assert.ok(Array.isArray(expectedNets)&&expectedNets.length>=2);assert.equal(expectedNets.reduce((sum,value)=>sum+value,0),0);
const nonHandBusiness=()=>{const state=JSON.parse(business());delete state.hand;return JSON.stringify(state);};
const beforeNonHand=nonHandBusiness();
// Schema-only bootstrap omits hosted service_role BYPASSRLS. Match the existing
// native worker fixture pattern without changing application roles/policies.
const serviceTestRole='history_worker_'+crypto.randomUUID().replaceAll('-','');
sql(`CREATE ROLE ${serviceTestRole} NOLOGIN INHERIT BYPASSRLS;GRANT service_role TO ${serviceTestRole};`);
process.on('exit',()=>sql(`DROP ROLE ${serviceTestRole};`));
const service=`SET request.jwt.claim.role='service_role';SET request.jwt.claims='{"role":"service_role"}';SET ROLE ${serviceTestRole};`;
if(correctionEdge){await runPaidCorrectionEdge({sql,service,fixture,hand});process.exit(0);}
const types={claim_tracker_historical_display_jobs_scoped_v1:{p_limit:'integer',p_hand_ids:'uuid[]'},
 get_tracker_historical_display_snapshot:{p_hand_id:'uuid',p_tournament_id:'uuid'},
 finish_tracker_historical_display_job:{p_hand_id:'uuid',p_source_revision:'bigint',p_lease_token:'uuid',p_status:'text',p_error_code:'text'},
 commit_tracker_historical_display_outcome_v2:{p_hand_id:'uuid',p_actor_user_id:'uuid',p_actor_kind:'text',p_expected_source_revision:'bigint',
  p_expected_source_chain_hash:'text',p_outcome_hash:'text',p_request_hash:'text',p_idempotency_key:'text',p_public_outcome:'jsonb',p_lease_token:'uuid'}};
const quote=v=>v===null?'NULL':`'${(typeof v==='object'?JSON.stringify(v):String(v)).replaceAll("'","''")}'`;
const client={rpc:async(name,args)=>{try{
 const schema=types[name];assert.ok(schema,'unexpected worker RPC '+name);assert.deepEqual(Object.keys(args).sort(),Object.keys(schema).sort());
 calls.push({name,args});const params=Object.entries(args).map(([k,v])=>`${k}=>${Array.isArray(v)?`ARRAY[${v.map(quote).join(',')}]`:quote(v)}::${schema[k]}`).join(',');
 const query=name==='claim_tracker_historical_display_jobs_scoped_v1'?`SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM public.${name}(${params}) r;`:`SELECT to_jsonb(public.${name}(${params}));`;
 if(expiredLease&&!expiredOnce&&name==='commit_tracker_historical_display_outcome_v2'){
  // Local fault fixture: expire only this exact worker lease, not business time.
  sql(`UPDATE public.tracker_historical_display_queue SET lease_until=now()-interval '1 second' WHERE hand_id='${hand}' AND lease_token=${quote(args.p_lease_token)}::uuid AND status='processing';`);
  expiredOnce=true;
 }
 if(correctionDuringCommit&&!correctionRevision&&name==='commit_tracker_historical_display_outcome_v2'){
  const readJson=(label,query)=>{const raw=sql(service+query);assert.ok(raw,label+' returned SQL NULL/no rows; privileged chip rows='+sql(`SELECT count(*) FROM public.tournament_chip_counts WHERE tournament_id='${fixture.tour}';`));return JSON.parse(raw);};
  const snapshot=readJson('correction snapshot',`SELECT public.get_tracker_historical_display_snapshot('${hand}',NULL);`);
  const liveStacks=readJson('correction live stacks',`SELECT jsonb_agg(jsonb_build_object('player_id',player_id,'entry_number',entry_number,'chip_count',chip_count)) FROM public.tournament_chip_counts WHERE tournament_id='${fixture.tour}';`);
  const source=normalizeSettlementSourceRpcResult(readJson('chain source hash',`SELECT to_jsonb(s) FROM public.get_tournament_settlement_source_hash('${hand}') s;`));
  const corrected=await computeAuthoritativeSettlement({tournamentId:fixture.tour,targetHandId:hand,hands:[snapshot.hand],players:snapshot.players,actions:snapshot.actions,liveStacks,
   edit:{communityCards:['2c','3d','4h']},actor:{userId:fixture.actor,role:'club_owner_or_admin'},sourceRevisionOverride:source.sourceRevision,sourceChainHashOverride:source.sourceChainHash,settlementRevisionOverride:1});
  const receiptText=sql(service+`SELECT public.commit_tracker_hand_correction_outcome('${hand}','${fixture.actor}',${source.sourceRevision},${quote(source.sourceChainHash)},1,
   ${quote(corrected.privateOutcome.outcomeHash)},repeat('c',64),'native-worker-correction-${hand}',${quote(corrected.publicOutcome)}::jsonb,${quote(corrected.persistedEdit)}::jsonb,
   ${quote(corrected.handChanges)}::jsonb,${quote(corrected.finalStacks)}::jsonb,'TEST persisted board correction');`);
  assert.ok(receiptText,'canonical correction returned no receipt');
  const receipt=JSON.parse(receiptText);
  assert.equal(receipt.ok,true);
  correctionRevision=Number(sql(`SELECT source_revision FROM public.tournament_hands WHERE id='${hand}';`));
  assert.ok(correctionRevision>args.p_expected_source_revision);
 }
 const data=JSON.parse(sql(service+query));
 // Inject transport loss only AFTER the real atomic SQL commit returned.
 // Do not roll back/requeue the committed outcome to make recovery pass.
 if(lostCommitResponse&&name==='commit_tracker_historical_display_outcome_v2'){
  assert.equal(data.ok,true);return {data:null,error:{message:'TEST_response_lost_after_commit'}};
 }
 return {data,error:null};
 }catch(error){errors.push(String(error));return {data:null,error:{message:String(error)}};}},
 from(table){assert.equal(table,'tournament_settlement_outcomes');let id;const query={select:columns=>{assert.equal(columns,'settlement_revision');return query;},
  eq:(key,value)=>{assert.equal(key,'hand_id');assert.equal(value,hand);id=value;return query;},order:(key)=>{assert.equal(key,'settlement_revision');return query;},
  limit:async n=>{assert.equal(n,1);try{return {data:JSON.parse(sql(service+`SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM (SELECT settlement_revision FROM public.tournament_settlement_outcomes WHERE hand_id='${id}' ORDER BY settlement_revision DESC LIMIT 1) x;`)),error:null};}
   catch(error){errors.push(String(error));return {data:null,error:{message:String(error)}};}}};return query;}};
const file=readFileSync(new URL('../../supabase/functions/tournament-historical-settlement-worker/index.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('index.ts',file,ts.ScriptTarget.ES2022,true);
const stripped=ts.factory.updateSourceFile(ast,ast.statements.filter(n=>!ts.isImportDeclaration(n)));
const code=ts.transpileModule(ts.createPrinter().printFile(stripped),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
let handler;const env={SUPABASE_URL:'https://test.invalid',SUPABASE_SERVICE_ROLE_KEY:'TEST_HISTORY_SERVICE',
 TRACKER_HISTORY_COMPLETION_WORKER_ENABLED:'false',[HISTORY_CANARY_SECRET_ENV]:'TEST_HISTORY_CANARY',[HISTORY_CANARY_SCOPE_ENV]:JSON.stringify([hand])};
runInNewContext(code,{Request,Response,TextEncoder,Error,crypto:globalThis.crypto,console,
 handleOptions:()=>null,jsonResp:(_req,value,status=200)=>new Response(JSON.stringify(value),{status}),createClient:()=>client,
 HistoricalDisplayVerificationError,verifyHistoricalDisplaySettlement,canonicalJsonV1,isUuid,authorizeHistoryWorker,HISTORY_CANARY_SECRET_ENV,
 historicalWorkerFailureStatus,TRACKER_HISTORY_WORKER_MAX_BATCH,parseHistoryWorkerHandIds,requireHistoryCanaryScope,HISTORY_CANARY_SCOPE_ENV,normalizeSettlementSourceRpcResult,
 Deno:{serve:fn=>handler=fn,env:{get:key=>env[key]}}});
const response=await handler(new Request('https://test.invalid/history-worker',{method:'POST',headers:{Authorization:'Bearer TEST_HISTORY_CANARY','Content-Type':'application/json'},body:JSON.stringify({hand_ids:[hand],limit:1})}));
const result=await response.json();
if(correctionDuringCommit){
 assert.equal(response.status,503,JSON.stringify({result,errors}));
 assert.deepEqual(result,{ok:false,claimed:1,completed:0,retried:0,needs_attention:0,unresolved:1});
 assert.equal(errors.length,1);assert.match(errors[0],/stale_source_revision|queue_lease_lost/);
 assert.ok(correctionRevision);
 assert.equal(sql(`SELECT count(*) FROM public.tournament_settlement_outcomes WHERE hand_id='${hand}' AND verification_scope='historical_display';`),'0');
 assert.equal(sql(`SELECT count(*) FROM public.tracker_historical_display_queue WHERE hand_id='${hand}' AND source_revision=${correctionRevision} AND status='pending';`),'1');
 assert.equal(nonHandBusiness(),beforeNonHand,'board-only correction must preserve seats and cash');
 errors.length=0;
 const recovered=await handler(new Request('https://test.invalid/history-worker',{method:'POST',headers:{Authorization:'Bearer TEST_HISTORY_CANARY','Content-Type':'application/json'},body:JSON.stringify({hand_ids:[hand],limit:1})}));
 assert.equal(recovered.status,200);assert.deepEqual(await recovered.json(),{ok:true,claimed:1,completed:1,retried:0,needs_attention:0,unresolved:0});
 assert.deepEqual(errors,[]);assert.equal(nonHandBusiness(),beforeNonHand);
 assert.equal(sql(`SELECT count(*) FROM public.tournament_settlement_outcomes WHERE hand_id='${hand}' AND verification_scope='historical_display' AND source_revision=${correctionRevision} AND status='verified';`),'1');
 const logical=sql(`SELECT tournament_table_id FROM public.tournament_hands WHERE id='${hand}';`);
 const history=JSON.parse(sql(`SET request.jwt.claims='{"role":"anon"}';SET ROLE anon;SELECT public.get_public_tournament_table_history_v2('${fixture.tour}','${logical}',20,NULL,NULL);`));
 assert.equal(history.items[0].result.status,'verified');
 console.log('ACTUAL_HISTORY_WORKER_CANONICAL_CORRECTION_REJECTS_OLD_REVISION_PASS');
}else if(expiredLease){
 assert.equal(response.status,503,JSON.stringify({result,errors}));
 assert.deepEqual(result,{ok:false,claimed:1,completed:0,retried:0,needs_attention:0,unresolved:1});
 assert.equal(errors.length,1);assert.match(errors[0],/queue_lease_lost/);
 assert.equal(sql(`SELECT count(*) FROM public.tournament_settlement_outcomes WHERE hand_id='${hand}';`),'0');
 assert.equal(sql(`SELECT status FROM public.tracker_historical_display_queue WHERE hand_id='${hand}' ORDER BY source_revision DESC LIMIT 1;`),'processing');
 assert.equal(business(),before);
 errors.length=0;
 const recovered=await handler(new Request('https://test.invalid/history-worker',{method:'POST',headers:{Authorization:'Bearer TEST_HISTORY_CANARY','Content-Type':'application/json'},body:JSON.stringify({hand_ids:[hand],limit:1})}));
 assert.equal(recovered.status,200);assert.deepEqual(await recovered.json(),{ok:true,claimed:1,completed:1,retried:0,needs_attention:0,unresolved:0});
 const commits=calls.filter(c=>c.name==='commit_tracker_historical_display_outcome_v2');
 assert.equal(commits.length,2);assert.notEqual(commits[0].args.p_lease_token,commits[1].args.p_lease_token);
 assert.deepEqual(errors,[]);assert.equal(business(),before);
 assert.equal(sql(`SELECT count(*) FROM public.tournament_settlement_outcomes WHERE hand_id='${hand}' AND status='verified';`),'1');
 assert.equal(sql(`SELECT status FROM public.tracker_historical_display_queue WHERE hand_id='${hand}' ORDER BY source_revision DESC LIMIT 1;`),'completed');
 console.log('ACTUAL_HISTORY_WORKER_EXPIRED_LEASE_REJECT_THEN_RECLAIM_PASS');
}else{
assert.equal(response.status,lostCommitResponse?503:200,JSON.stringify({result,errors}));assert.deepEqual(errors,[]);
assert.deepEqual(result,{ok:!lostCommitResponse,claimed:singleDayAlreadyVerified?0:1,completed:verified&&!lostCommitResponse&&!singleDayAlreadyVerified?1:0,retried:0,needs_attention:verified?0:1,unresolved:lostCommitResponse?1:0});
assert.deepEqual(calls.map(c=>c.name),singleDayAlreadyVerified?['claim_tracker_historical_display_jobs_scoped_v1']:['claim_tracker_historical_display_jobs_scoped_v1','get_tracker_historical_display_snapshot',verified?'commit_tracker_historical_display_outcome_v2':'finish_tracker_historical_display_job',...(lostCommitResponse?['finish_tracker_historical_display_job']:[])]);
if(!verified)assert.equal(calls.at(-1).args.p_error_code,'historical_empty_or_invalid_pot');
assert.equal(sql(`SELECT status FROM public.tracker_historical_display_queue WHERE hand_id='${hand}' AND source_revision=(SELECT source_revision FROM public.tournament_hands WHERE id='${hand}');`),verified?'completed':'needs_attention');
assert.equal(sql(`SELECT count(*) FROM public.tournament_settlement_outcomes WHERE hand_id='${hand}' AND verification_scope='historical_display' AND status='verified';`),verified?'1':'0');
if(verified){const outcome=JSON.parse(sql(`SELECT public_outcome FROM public.tournament_settlement_outcomes WHERE hand_id='${hand}' AND verification_scope='historical_display' AND status='verified';`));
 if(pending687){
  assert.equal(outcome.players.length,finalHistoryCase.stacks.length);assert.deepEqual(outcome.pots.map(p=>p.amount),[finalHistoryCase.pot]);
  assert.deepEqual(outcome.pots[0].allocations.map(a=>[a.winnerId,a.amount]),[['a11b1317-4885-4835-8d2e-fb435f7b24e2',finalHistoryCase.pot]]);
  assert.deepEqual(outcome.refunds.map(r=>[r.playerId,r.amount]),finalHistoryCase.refund===0?[]:[['a11b1317-4885-4835-8d2e-fb435f7b24e2',finalHistoryCase.refund]]);
  assert.deepEqual(outcome.players.map(p=>p.netDelta).sort((a,b)=>a-b),finalHistoryCase.nets);
  assert.equal(outcome.players.reduce((sum,p)=>sum+p.endingStack,0),180000);
 }else if(pending685){
  assert.equal(outcome.players.length,6);assert.deepEqual(outcome.pots.map(p=>p.amount),[80400]);
  assert.deepEqual(outcome.pots[0].allocations.map(a=>[a.winnerId,a.amount]),[['a11b1317-4885-4835-8d2e-fb435f7b24e2',80400]]);
  assert.deepEqual(outcome.refunds.map(r=>[r.playerId,r.amount]),[['a11b1317-4885-4835-8d2e-fb435f7b24e2',19800]]);
  assert.deepEqual(outcome.players.map(p=>p.netDelta).sort((a,b)=>a-b),[-40200,0,0,0,0,40200]);
  assert.equal(outcome.players.reduce((sum,p)=>sum+p.endingStack,0),180000);
 }else if(pending683){
  assert.equal(outcome.players.length,7);assert.deepEqual(outcome.pots.map(p=>p.amount),[40000]);
  assert.deepEqual(outcome.pots[0].allocations.map(a=>[a.winnerId,a.amount]),[['a11b1317-4885-4835-8d2e-fb435f7b24e2',40000]]);
  assert.deepEqual(outcome.refunds.map(r=>[r.playerId,r.amount]),[['a11b1317-4885-4835-8d2e-fb435f7b24e2',20000]]);
  assert.deepEqual(outcome.players.map(p=>p.netDelta).sort((a,b)=>a-b),[-20000,0,0,0,0,0,20000]);
  assert.equal(outcome.players.reduce((sum,p)=>sum+p.endingStack,0),180000);
 }else if(pending679){
  assert.equal(outcome.players.length,8);assert.deepEqual(outcome.pots.map(p=>p.amount),[40000]);
  assert.deepEqual(outcome.pots[0].allocations.map(a=>[a.winnerId,a.amount]),[['a11b1317-4885-4835-8d2e-fb435f7b24e2',40000]]);
  assert.deepEqual(outcome.refunds,[]);assert.deepEqual(outcome.players.map(p=>p.netDelta).sort((a,b)=>a-b),[-20000,0,0,0,0,0,0,20000]);
  assert.equal(outcome.players.reduce((sum,p)=>sum+p.endingStack,0),180000);
 }else if(pending665){
  assert.equal(outcome.players.length,8);assert.deepEqual(outcome.pots.map(p=>p.amount),[40000]);
  assert.deepEqual(outcome.pots[0].allocations.map(a=>[a.winnerId,a.amount]),[['5c2bfc67-c546-4ddb-8209-e5c5693d82f5',40000]]);
  assert.deepEqual(outcome.refunds,[]);assert.deepEqual(outcome.players.map(p=>p.netDelta).sort((a,b)=>a-b),[-19900,-200,0,0,0,0,0,20100]);
  assert.equal(outcome.players.reduce((sum,p)=>sum+p.endingStack,0),160000);
 }else if(pending657){
  assert.equal(outcome.players.length,4);assert.deepEqual(outcome.pots.map(p=>p.amount),[200]);
  assert.deepEqual(outcome.pots[0].allocations.map(a=>[a.winnerId,a.amount]),[['5c2bfc67-c546-4ddb-8209-e5c5693d82f5',200]]);
  assert.deepEqual(outcome.refunds.map(r=>[r.playerId,r.amount]),[['5c2bfc67-c546-4ddb-8209-e5c5693d82f5',100]]);
  assert.deepEqual(outcome.players.map(p=>p.netDelta).sort((a,b)=>a-b),[-100,0,0,100]);
  assert.equal(outcome.players.reduce((sum,p)=>sum+p.endingStack,0),80000);
 }else if(pending575){
  assert.deepEqual(outcome.pots.map(p=>p.amount),[1600]);
  assert.deepEqual(outcome.pots[0].allocations.map(a=>[a.winnerId,a.amount]).sort(),[['5f4dd4c4-a9d0-43a9-b523-ab5ec5d3c103',800],['533feda3-28c5-4194-bdf3-53a07c41305b',800]].sort());
  assert.deepEqual(outcome.refunds,[]);
  assert.deepEqual(outcome.players.map(p=>p.netDelta),[0,0]);
  assert.deepEqual(outcome.players.map(p=>p.endingStack).sort((a,b)=>a-b),[1100,58900]);
 }else if(pending554){
  assert.deepEqual(outcome.pots.map(p=>p.amount),[2200]);
  assert.deepEqual(outcome.pots[0].allocations.map(a=>[a.winnerId,a.amount]).sort(),[['5f4dd4c4-a9d0-43a9-b523-ab5ec5d3c103',1100],['533feda3-28c5-4194-bdf3-53a07c41305b',1100]].sort());
  assert.deepEqual(outcome.refunds.map(r=>[r.playerId,r.amount]),[['5f4dd4c4-a9d0-43a9-b523-ab5ec5d3c103',57800]]);
  assert.deepEqual(outcome.players.map(p=>p.netDelta),[0,0]);
  assert.deepEqual(outcome.players.map(p=>p.endingStack).sort((a,b)=>a-b),[1100,58900]);
 }else if(pending477){
  assert.deepEqual(outcome.pots.map(p=>p.amount),[400]);
  assert.deepEqual(outcome.pots[0].allocations.map(a=>[a.winnerId,a.amount]),[['5f4dd4c4-a9d0-43a9-b523-ab5ec5d3c103',400]]);
  assert.deepEqual(outcome.refunds.map(r=>[r.playerId,r.amount]),[['5f4dd4c4-a9d0-43a9-b523-ab5ec5d3c103',200]]);
  assert.deepEqual(outcome.players.map(p=>p.netDelta).sort((a,b)=>a-b),[-200,200]);
  assert.deepEqual(outcome.players.map(p=>p.endingStack).sort((a,b)=>a-b),[1100,58900]);
  assert.deepEqual(outcome.handRanks,[]);
 }else if(correction290){
  assert.deepEqual(outcome.pots.map(p=>p.amount),[400]);assert.deepEqual(outcome.refunds,[]);
  assert.deepEqual(outcome.pots[0].allocations.map(a=>[a.winnerId,a.amount]),[['5f4dd4c4-a9d0-43a9-b523-ab5ec5d3c103',400]]);
  assert.deepEqual(outcome.players.map(p=>p.netDelta).sort((a,b)=>a-b),[-200,200]);
  assert.deepEqual(outcome.players.map(p=>p.endingStack).sort((a,b)=>a-b),[1200,58800]);
 }else if(mixed230){
  const aa='cb52d798-1362-4212-881f-c9227a4a72dc',kk='305165a1-0209-4baa-b4ff-fea4fb4ba0f1';
  assert.deepEqual(outcome.pots.map(p=>p.amount),[59700,200]);
  assert.deepEqual(outcome.pots.map(p=>p.allocations.map(a=>[a.winnerId,a.amount])),[[[aa,59700]],[[kk,200]]]);
  // KK started20100 and contributed20000: its remaining100 was never wagered.
  assert.deepEqual(outcome.refunds,[]);
  assert.deepEqual(outcome.players.map(p=>p.netDelta).sort((a,b)=>a-b),[-20000,-19800,39800]);
  assert.deepEqual(outcome.players.map(p=>p.endingStack).sort((a,b)=>a-b),[0,300,59700]);
 }else if(linked185){
  assert.equal(outcome.players.length,linkedD2Proof.players);
  assert.deepEqual(outcome.players.map(p=>p.netDelta).sort((a,b)=>a-b),linkedD2Table7Proof?.nets??(linkedD2Hand2?[-20000,0,0,20000]:[-20000,0,0,0,20000]));
  assert.deepEqual(outcome.pots.map(p=>p.amount),[linkedD2Pot]);
  assert.deepEqual(outcome.pots[0].allocations.map(a=>[a.winnerId,a.amount]),[[linkedD2Proof.winner,linkedD2Pot]]);
  assert.deepEqual(outcome.refunds.map(r=>[r.playerId,r.amount]),linkedD2Table7Proof?.refund?[[linkedD2Proof.winner,linkedD2Table7Proof.refund]]:[]);
  assert.equal(outcome.players.reduce((sum,p)=>sum+p.endingStack,0),linkedD2Table7?Object.values(linkedD2Table7Proof.starting).reduce((sum,stack)=>sum+stack,0):100000);
 }else if(linked181){
  assert.equal(outcome.players.length,8);
  assert.deepEqual(outcome.players.map(p=>p.netDelta),Array(8).fill(0));
  assert.deepEqual(outcome.players.map(p=>p.endingStack),Array(8).fill(20000));
  assert.deepEqual(outcome.pots.map(p=>p.amount),[40000]);
  assert.deepEqual(outcome.pots[0].allocations.map(a=>[a.winnerId,a.amount]).sort(),[
   ['d1e3d5ce-0f65-42f4-b51b-f089f954e354',20000],['ac0fab65-253b-4c7a-b80f-65c5c1be3b7a',20000]].sort());
  assert.deepEqual(outcome.refunds,[]);
 }else if(finish136||finish137){
  assert.deepEqual(outcome.pots.map(p=>p.amount),[400]);assert.deepEqual(outcome.refunds,[]);
  assert.deepEqual(outcome.pots[0].allocations.map(a=>[a.winnerId,a.amount]),[[finish137?'5f4dd4c4-a9d0-43a9-b523-ab5ec5d3c103':'533feda3-28c5-4194-bdf3-53a07c41305b',400]]);
  assert.deepEqual(outcome.players.map(p=>p.netDelta).sort((a,b)=>a-b),[-200,200]);
  assert.deepEqual(outcome.players.map(p=>p.endingStack).sort((a,b)=>a-b),finish137?[1200,58800]:[1600,58400]);
 }else if(multiple113){
  const ids=['37597ee5-9d4e-480b-87d4-275f8b39c69f','44791b41-77f8-43fd-8634-9947ef069f87','a6b9e3c6-ce29-4ce9-851b-b3e7a8698dec','d16653aa-7ccb-46b6-bc1a-a6d482eec763'];
  assert.deepEqual(outcome.pots.map(p=>p.amount),[78396,1203,200]);
  assert.deepEqual(outcome.pots[0].allocations.map(a=>[a.winnerId,a.amount]),[[ids[0],78396]]);
  assert.deepEqual(outcome.pots[1].allocations.map(a=>[a.winnerId,a.amount]).sort(),[[ids[2],602],[ids[3],601]].sort());
  assert.deepEqual(outcome.pots[2].allocations.map(a=>[a.winnerId,a.amount]),[[ids[2],200]]);
  assert.deepEqual(outcome.refunds.map(r=>[r.playerId,r.amount]),[[ids[1],201]]);
  assert.deepEqual(ids.map(id=>outcome.players.find(p=>p.playerId===id).endingStack),[78396,201,802,601]);
  assert.deepEqual(outcome.players.map(p=>p.netDelta).sort((a,b)=>a-b),[-20100,-19399,-19298,58797]);
  assert.deepEqual(outcome.handRanks.map(r=>r.playerId).sort(),[ids[0],ids[2],ids[3]].sort());
 }else if(winner104){
  assert.deepEqual(outcome.pots.map(p=>p.amount),[2800]);assert.deepEqual(outcome.refunds,[]);
  assert.deepEqual(outcome.pots[0].allocations.map(a=>[a.winnerId,a.amount]).sort(),[['533feda3-28c5-4194-bdf3-53a07c41305b',1400],['5f4dd4c4-a9d0-43a9-b523-ab5ec5d3c103',1400]].sort());
  assert.deepEqual(outcome.players.map(p=>p.netDelta),[0,0]);assert.deepEqual(outcome.players.map(p=>p.endingStack).sort((a,b)=>a-b),[1400,58600]);
 }else if(winner103){
  assert.deepEqual(outcome.pots.map(p=>p.amount),[2800]);assert.deepEqual(outcome.refunds,[]);
  assert.deepEqual(outcome.pots[0].allocations.map(a=>[a.winnerId,a.amount]),[['533feda3-28c5-4194-bdf3-53a07c41305b',2800]]);
  assert.deepEqual(outcome.players.map(p=>p.netDelta).sort((a,b)=>a-b),[-1400,1400]);
  assert.deepEqual(outcome.players.map(p=>p.endingStack).sort((a,b)=>a-b),[2800,57200]);
 }else if(retainedBoardPlay){
  assert.equal(outcome.players.length,2);
  assert.deepEqual(outcome.players.map(p=>p.netDelta),[0,0]);
  assert.deepEqual(outcome.players.map(p=>p.endingStack).sort((a,b)=>a-b),[600,59400]);
  assert.deepEqual(outcome.pots.map(p=>p.amount),[boardPlayProof.pot]);
  assert.deepEqual(outcome.pots[0].allocations.map(a=>[a.winnerId,a.amount]).sort(),
   [['5f4dd4c4-a9d0-43a9-b523-ab5ec5d3c103',boardPlayProof.award],['533feda3-28c5-4194-bdf3-53a07c41305b',boardPlayProof.award]].sort());
  assert.deepEqual(outcome.refunds,[]);
 }else if(retainedSidepot){
  const aa='5f4dd4c4-a9d0-43a9-b523-ab5ec5d3c103',kk='533feda3-28c5-4194-bdf3-53a07c41305b';
  assert.deepEqual(outcome.pots.map(p=>p.amount),retainedShortStack?[600]:[59700,200]);
  assert.deepEqual(outcome.pots.map(p=>p.allocations.map(a=>[a.winnerId,a.amount])),retainedShortStack?[[[kk,600]]]:[[[aa,59700]],[[kk,200]]]);
  assert.deepEqual(outcome.refunds.map(r=>[r.playerId,r.amount]),retainedShortStack?[]:[[kk,100]]);
  assert.deepEqual(outcome.players.map(p=>p.netDelta).sort((a,b)=>a-b),retainedShortStack?[-300,300]:[-20000,-19800,39800]);
  assert.deepEqual(outcome.players.map(p=>p.endingStack).sort((a,b)=>a-b),retainedShortStack?[600,59400]:[0,300,59700]);
 }else if(singleDayReplay){
  const winner='065801a0-565e-4bd6-9c2d-ee252b7e6494';
  assert.equal(outcome.players.length,singleDayReplay.starting.length);
  assert.deepEqual(outcome.players.map(p=>p.netDelta).sort((a,b)=>a-b),singleDayReplay.nets);
  assert.deepEqual(outcome.pots.map(p=>p.amount),[singleDayReplay.pot]);
  assert.equal(outcome.pots[0].allocations.length,1);assert.equal(outcome.pots[0].allocations[0].winnerId,winner);
  assert.equal(outcome.pots[0].allocations[0].amount,singleDayReplay.pot);
  assert.deepEqual(outcome.refunds,[]);assert.equal(outcome.handRanks.length,1);assert.equal(outcome.handRanks[0].playerId,winner);
  assert.equal(outcome.players.find(p=>p.playerId===winner).endingStack,singleDayReplay.winner);
 }else if(singleDayShowdown){
  const winner='065801a0-565e-4bd6-9c2d-ee252b7e6494';
  assert.equal(outcome.players.length,8);assert.deepEqual(outcome.players.map(p=>p.netDelta).sort((a,b)=>a-b),expectedNets);
  // Folded BB's100 contributes dead money. Both19900 contenders have identical
  // eligibility in both layers; existing potEngine merges these into one pot.
  assert.deepEqual(outcome.pots.map(p=>p.amount),[39900]);
  for(const pot of outcome.pots){assert.equal(pot.allocations.length,1);assert.equal(pot.allocations[0].winnerId,winner);assert.equal(pot.allocations[0].amount,pot.amount);}
  assert.deepEqual(outcome.refunds,[]);assert.equal(outcome.handRanks.length,1);assert.equal(outcome.handRanks[0].playerId,winner);
  assert.equal(outcome.players.find(p=>p.playerId===winner).endingStack,40100);
 }else if(configuredSequential){
  assert.deepEqual(expectedNets,configuredSequential.nets);
  assert.deepEqual(JSON.parse(sql(`SELECT jsonb_agg(starting_stack ORDER BY starting_stack) FROM public.hand_players WHERE hand_id='${hand}';`)),configuredSequential.starting);
  assert.equal(outcome.players.length,configuredSequential.starting.length);assert.deepEqual(outcome.players.map(p=>p.netDelta).sort((a,b)=>a-b),configuredSequential.nets);
  const winner='1c1d8317-d4d9-4ee3-8b8f-6781f4989564';
  assert.deepEqual(outcome.pots.map(p=>p.amount),[configuredSequential.pot]);assert.equal(outcome.pots[0].allocations.length,1);
  assert.equal(outcome.pots[0].allocations[0].winnerId,winner);assert.equal(outcome.pots[0].allocations[0].amount,configuredSequential.pot);
  if(configuredSequential.refund){assert.equal(outcome.refunds.length,1);assert.equal(outcome.refunds[0].playerId,winner);assert.equal(outcome.refunds[0].amount,configuredSequential.refund);}
  else assert.deepEqual(outcome.refunds,[]);
  assert.equal(outcome.players.find(p=>p.playerId===winner).endingStack,configuredSequential.winner);
  assert.equal(outcome.handRanks.length,1);assert.equal(outcome.handRanks[0].playerId,winner);
 }else if(configuredBrowserHand3){
  assert.deepEqual(expectedNets,[-20000,-200,0,0,0,0,0,20200]);
  assert.equal(outcome.players.length,8);assert.deepEqual(outcome.players.map(p=>p.netDelta).sort((a,b)=>a-b),expectedNets);
  const winner='1c1d8317-d4d9-4ee3-8b8f-6781f4989564';
  assert.deepEqual(outcome.pots.map(p=>p.amount),[40200]);
  assert.deepEqual(outcome.refunds,[]);assert.equal(outcome.pots[0].allocations.length,1);
  assert.equal(outcome.pots[0].allocations[0].winnerId,winner);assert.equal(outcome.pots[0].allocations[0].amount,40200);
  assert.equal(outcome.players.find(p=>p.playerId===winner).endingStack,60400);
  assert.equal(outcome.handRanks.length,1);assert.equal(outcome.handRanks[0].playerId,winner);
 }else if(configuredShowdown){
  assert.deepEqual(expectedNets,[-20000,-100,0,20100]);
  assert.equal(outcome.players.length,4);assert.deepEqual(outcome.players.map(p=>p.netDelta).sort((a,b)=>a-b),expectedNets);
  const winner='1c1d8317-d4d9-4ee3-8b8f-6781f4989564';
  assert.deepEqual(outcome.pots.map(p=>p.amount),[40100]);
  assert.equal(outcome.pots[0].allocations.length,1);assert.equal(outcome.pots[0].allocations[0].winnerId,winner);
  assert.equal(outcome.pots[0].allocations[0].amount,40100);
  assert.equal(outcome.refunds.length,1);assert.equal(outcome.refunds[0].playerId,winner);assert.equal(outcome.refunds[0].amount,100);
  assert.equal(outcome.players.find(p=>p.playerId===winner).endingStack,40200);
  assert.equal(outcome.handRanks.length,1);assert.equal(outcome.handRanks[0].playerId,winner);
 }else if(parentShowdown){
  const board=JSON.parse(sql(`SELECT community_cards FROM public.tournament_hands WHERE id='${hand}';`));assert.deepEqual(board,['Tc','Jc','Qc','2d','3h']);
  const royalWinner=sql(`SELECT player_id FROM public.hand_players WHERE hand_id='${hand}' AND hole_cards @> '["Ac","Kc"]'::jsonb;`);assert.ok(isUuid(royalWinner));
  assert.equal(outcome.players.length,8);assert.deepEqual(outcome.players.map(p=>p.netDelta).sort((a,b)=>a-b),expectedNets);
  const deferredTour=process.env.VINPOKER_NATIVE_DEFERRED_BREAK==='1';
  const starting=JSON.parse(sql(`SELECT jsonb_agg(starting_stack ORDER BY starting_stack) FROM public.hand_players WHERE hand_id='${hand}';`));
  assert.deepEqual(starting,deferredTour?[19800,20000,20000,20000,20000,20000,20000,20200]:[19900,20000,20000,20000,20000,20000,20000,20100]);
  assert.deepEqual(outcome.pots.map(p=>p.amount).sort((a,b)=>a-b),deferredTour?[1400,158400]:[700,159200]);
  for(const pot of outcome.pots){assert.equal(pot.allocations.length,1);assert.equal(pot.allocations[0].winnerId,royalWinner);assert.equal(pot.allocations[0].amount,pot.amount);}
  assert.equal(outcome.refunds.length,1);assert.equal(outcome.refunds[0].playerId,royalWinner);assert.equal(outcome.refunds[0].amount,deferredTour?200:100);
  assert.equal(outcome.handRanks.length,1,'public proof must not add losing hand ranks');assert.equal(outcome.handRanks[0].playerId,royalWinner);
  assert.equal(outcome.players.find(p=>p.playerId===royalWinner).endingStack,160000);
 }else{
 const winner=sql(`SELECT hp.player_id FROM public.hand_players hp JOIN public.tournament_hands h ON h.id=hp.hand_id WHERE h.id='${hand}' AND hp.seat_number=h.tracker_bb_position;`);
 assert.deepEqual(outcome.players.map(p=>p.netDelta).sort((a,b)=>a-b),expectedNets);
 assert.equal(outcome.pots[0].allocations[0].winnerId,winner);assert.equal(outcome.pots[0].allocations[0].amount,200);
 if(singleDayParent||linked173)assert.deepEqual(outcome.refunds,[],'equal 100/100 blinds leave no unmatched refund');
 else {assert.equal(outcome.refunds[0].playerId,winner);assert.equal(outcome.refunds[0].amount,100);}
 assert.deepEqual(outcome.handRanks,[]);
 }
 assert.equal(Object.hasOwn(outcome,'privateEvidence'),false);
}
const logical=sql(`SELECT tournament_table_id FROM public.tournament_hands WHERE id='${hand}';`);
const history=JSON.parse(sql(`SET request.jwt.claims='{"role":"anon"}';SET ROLE anon;SELECT public.get_public_tournament_table_history_v2('${fixture.tour}','${logical}',20,NULL,NULL);`));
if(singleDayShowdown)assert.equal(history.items[0].handId,hand);
const historyItem=history.items.find(item=>item.handId===hand);
assert.ok(historyItem);assert.equal(historyItem.result.status,verified?'verified':'needs_attention');assert.equal(business(),before);
if(pending687){
 assert.deepEqual(historyItem.board,['2c','3d','7h','9s','Tc']);
 assert.deepEqual(historyItem.result.recipients.map(p=>[p.playerId,p.potAward,p.netDelta]),[['a11b1317-4885-4835-8d2e-fb435f7b24e2',finalHistoryCase.pot,finalHistoryCase.net]]);
 console.log(`ACTUAL_SINGLE${finalHistoryCase.checkpoint}_HAND${finalHistoryCase.number}_REV${finalHistoryCase.revision}_POT${finalHistoryCase.pot}_REFUND${finalHistoryCase.refund}_HISTORY_PUBLIC_VERIFIED_PASS`);
}
if(pending685){
 assert.deepEqual(historyItem.board,['2c','3d','7h','9s','Tc']);
 assert.deepEqual(historyItem.result.recipients.map(p=>[p.playerId,p.potAward,p.netDelta]),[['a11b1317-4885-4835-8d2e-fb435f7b24e2',80400,40200]]);
 console.log('ACTUAL_SINGLE685_HAND6_REV26_DEAD_SB_POT80400_REFUND19800_HISTORY_PUBLIC_VERIFIED_PASS');
}
if(pending683){
 assert.deepEqual(historyItem.board,['2c','3d','7h','9s','Tc']);
 assert.deepEqual(historyItem.result.recipients.map(p=>[p.playerId,p.potAward,p.netDelta]),[['a11b1317-4885-4835-8d2e-fb435f7b24e2',40000,20000]]);
 console.log('ACTUAL_SINGLE683_HAND5_REV30_POT40000_REFUND20000_ENTRY2_HISTORY_PUBLIC_VERIFIED_PASS');
}
if(pending679){
 assert.deepEqual(historyItem.board,['2s','3h','7d','9c','Th']);
 assert.deepEqual(historyItem.result.recipients.map(p=>[p.playerId,p.potAward,p.netDelta]),[['a11b1317-4885-4835-8d2e-fb435f7b24e2',40000,20000]]);
 console.log('ACTUAL_SINGLE679_HAND4_REV33_AA40000_ENTRY2_HISTORY_PUBLIC_VERIFIED_PASS');
}
if(pending575){
 assert.deepEqual(historyItem.board,['9c','Th','Jd','Qs','Kc']);
 assert.deepEqual(historyItem.result.recipients.map(p=>[p.playerId,p.potAward,p.netDelta]).sort(),[['5f4dd4c4-a9d0-43a9-b523-ab5ec5d3c103',800,0],['533feda3-28c5-4194-bdf3-53a07c41305b',800,0]].sort());
 console.log('ACTUAL_BROWSER575_HAND36_REV23_BOARD_PLAYS_SPLIT800_NO_REFUND_WORKER_ANON_VERIFIED_PASS');
}
if(pending554){
 assert.deepEqual(historyItem.board,['2c','3d','4h','5s','6c']);
 assert.deepEqual(historyItem.result.recipients.map(p=>[p.playerId,p.potAward,p.netDelta]).sort(),[['5f4dd4c4-a9d0-43a9-b523-ab5ec5d3c103',1100,0],['533feda3-28c5-4194-bdf3-53a07c41305b',1100,0]].sort());
 console.log('ACTUAL_BROWSER554_HAND35_REV15_BOARD_PLAYS_SPLIT1100_REFUND57800_WORKER_ANON_VERIFIED_PASS');
}
if(pending477){
 assert.deepEqual(historyItem.board,['As','Kh','Qd','7c','2d']);
 assert.deepEqual(historyItem.result.recipients.map(p=>[p.playerId,p.potAward,p.netDelta,p.holeCards]),[['5f4dd4c4-a9d0-43a9-b523-ab5ec5d3c103',400,200,[]]]);
 console.log('ACTUAL_BROWSER477_HAND34_REV19_BOARD5_REFUND200_WORKER_ANON_VERIFIED_PASS');
}
if(correction290){
 assert.deepEqual(historyItem.board,['2c','3d','7s','9c','Kd']);
 assert.deepEqual(historyItem.result.recipients.map(p=>[p.playerId,p.potAward,p.netDelta]),[['5f4dd4c4-a9d0-43a9-b523-ab5ec5d3c103',400,200]]);
 console.log('ACTUAL_CORRECTION290_HAND32_REV25_WORKER_CURRENT_PUBLIC_PROOF_PASS');
}
if(mixed230){
 assert.deepEqual(historyItem.result.recipients.map(p=>[p.playerId,p.potAward,p.netDelta]).sort(),[
  ['cb52d798-1362-4212-881f-c9227a4a72dc',59700,39800],['305165a1-0209-4baa-b4ff-fea4fb4ba0f1',200,-19800]].sort());
 assert.deepEqual(historyItem.board,['2c','3d','7h','9s','Tc']);
}
if(finish136||finish137){
 assert.deepEqual(historyItem.board,['2c','3d','7s','9c',finish137?'Kc':'Jd']);
 assert.deepEqual(historyItem.result.recipients.map(p=>[p.playerId,p.potAward,p.netDelta]),[[finish137?'5f4dd4c4-a9d0-43a9-b523-ab5ec5d3c103':'533feda3-28c5-4194-bdf3-53a07c41305b',400,200]]);
}
if(multiple113){
 assert.deepEqual(historyItem.result.recipients.map(p=>[p.playerId,p.potAward,p.netDelta]).sort(),[
  ['37597ee5-9d4e-480b-87d4-275f8b39c69f',78396,58797],['a6b9e3c6-ce29-4ce9-851b-b3e7a8698dec',802,-19298],['d16653aa-7ccb-46b6-bc1a-a6d482eec763',601,-19399]].sort());
 assert.deepEqual(historyItem.board,['2c','3d','7h','9s','Tc']);
}
if(process.argv.includes('--identity-revision')){
 assert.equal(verified,true);
 const revision=Number(sql(`SELECT source_revision FROM public.tournament_hands WHERE id='${hand}';`));
 const other=sql(`SELECT id FROM public.tournament_tables WHERE tournament_id='${fixture.tour}' AND id<>'${logical}' ORDER BY id LIMIT 1;`);assert.ok(isUuid(other));
 let fkBlocked=false;
 try{sql(`BEGIN;SET LOCAL request.jwt.claim.sub='${fixture.actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${fixture.actor}"}';SET LOCAL ROLE authenticated;
  UPDATE public.tournament_hands SET tournament_table_id='${other}' WHERE id='${hand}';ROLLBACK;`);}
 catch(error){fkBlocked=String(error.stderr??error).includes('tournament_hands_table_session_match_v3_fkey');}
 assert.equal(fkBlocked,true,'mismatched non-null session tuple must be rejected');assert.equal(business(),before);
 const noOp=JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claim.sub='${fixture.actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${fixture.actor}"}';SET LOCAL ROLE authenticated;
  UPDATE public.tournament_hands SET updated_at=updated_at WHERE id='${hand}';RESET ROLE;
  SELECT jsonb_build_object('revision',(SELECT source_revision FROM public.tournament_hands WHERE id='${hand}'),'verified',(SELECT count(*) FROM public.tournament_settlement_outcomes WHERE hand_id='${hand}' AND status='verified'));ROLLBACK;`));
 assert.equal(noOp.revision,revision);assert.equal(noOp.verified,1);
 for(const [assignment,target] of [['table_id=NULL',logical],['table_session_id=NULL',logical],[`table_session_id=NULL,tournament_table_id='${other}'`,other]]){
 const probe=JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claim.sub='${fixture.actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${fixture.actor}"}';SET LOCAL ROLE authenticated;
  UPDATE public.tournament_hands SET ${assignment} WHERE id='${hand}';RESET ROLE;
  SELECT jsonb_build_object('moved',(SELECT tournament_table_id='${target}' FROM public.tournament_hands WHERE id='${hand}'),
   'revision',(SELECT source_revision FROM public.tournament_hands WHERE id='${hand}'),
   'pending',(SELECT count(*) FROM public.tracker_historical_display_queue q JOIN public.tournament_hands h ON h.id=q.hand_id AND h.source_revision=q.source_revision WHERE h.id='${hand}' AND q.status='pending'),
   'verified',(SELECT count(*) FROM public.tournament_settlement_outcomes WHERE hand_id='${hand}' AND status='verified'),
   'public',(SELECT public.get_public_tournament_table_history_v2('${fixture.tour}','${target}',20,NULL,NULL)));ROLLBACK;`));
 assert.equal(business(),before,'identity diagnostic must rollback all business rows');
 assert.ok(!probe.moved||probe.revision>revision,'IDENTITY_REPARENT_WITHOUT_REVISION '+JSON.stringify(probe));
 if(probe.moved){assert.equal(probe.verified,0);assert.equal(probe.pending,1);assert.notEqual(probe.public.items[0].result.status,'verified');}
 }
 console.log('PAID_VERIFIED_HAND_IDENTITY_REPARENT_REVISION_FENCE_PASS');
 const sourceRows=()=>sql(`SELECT jsonb_build_object('actions',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.hand_actions a WHERE hand_id='${hand}'),'players',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.hand_players p WHERE hand_id='${hand}'));`);
 const originalRows=sourceRows();
 // Trigger coverage only: privileged source writes, not endpoint authority proof.
 // Each vector begins from the same genuine worker-verified paid hand.
 for(const [name,mutation] of [
  ['action amount',`UPDATE public.hand_actions SET action_amount=action_amount+1 WHERE id=(SELECT id FROM public.hand_actions WHERE hand_id='${hand}' ORDER BY id LIMIT 1)`],
  ['action delete',`DELETE FROM public.hand_actions WHERE id=(SELECT id FROM public.hand_actions WHERE hand_id='${hand}' ORDER BY id DESC LIMIT 1)`],
  ['hole cards',`UPDATE public.hand_players SET hole_cards='["2c","3d"]'::jsonb WHERE id=(SELECT id FROM public.hand_players WHERE hand_id='${hand}' ORDER BY id LIMIT 1)`],
  ['participant stack',`UPDATE public.hand_players SET ending_stack=ending_stack+1 WHERE id=(SELECT id FROM public.hand_players WHERE hand_id='${hand}' ORDER BY id LIMIT 1)`],
  ['board',`UPDATE public.tournament_hands SET community_cards='["2c","3d","4h"]'::jsonb WHERE id='${hand}'`],
  ['blind',`UPDATE public.tournament_hands SET tracker_big_blind=tracker_big_blind+1 WHERE id='${hand}'`],
  ['void',`UPDATE public.tournament_hands SET is_voided=true WHERE id='${hand}'`],
 ]){
  const probe=JSON.parse(sql(`BEGIN;${mutation};SELECT jsonb_build_object(
   'revision',(SELECT source_revision FROM public.tournament_hands WHERE id='${hand}'),
   'verified',(SELECT count(*) FROM public.tournament_settlement_outcomes WHERE hand_id='${hand}' AND status='verified'),
   'queued',(SELECT count(*) FROM public.tracker_historical_display_queue q JOIN public.tournament_hands h ON h.id=q.hand_id AND h.source_revision=q.source_revision WHERE h.id='${hand}'),
   'public',(SELECT public.get_public_tournament_table_history_v2('${fixture.tour}','${logical}',20,NULL,NULL)));ROLLBACK;`));
  assert.ok(probe.revision>revision,name+' must advance source revision');
  assert.equal(probe.verified,0,name+' must invalidate proof');
  if(name!=='void')assert.equal(probe.queued,1,name+' must enqueue current generation');
  assert.ok(!probe.public.items.some(item=>item.result?.status==='verified'),name+' must not publish old proof');
  assert.equal(business(),before,name+' business rollback');assert.equal(sourceRows(),originalRows,name+' source rollback');
 }
 console.log('PAID_VERIFIED_SOURCE_TRIGGER_MUTATION_MATRIX_PASS');
 const projectionQuery=`SELECT jsonb_build_object('tour',(SELECT to_jsonb(t) FROM public.tournaments t WHERE id='${fixture.tour}'),
  'hand',(SELECT to_jsonb(h) FROM public.tournament_hands h WHERE id='${hand}'),
  'actions',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.hand_actions a WHERE hand_id='${hand}'),
  'players',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.hand_players p WHERE hand_id='${hand}'),
  'seats',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.tournament_seats s WHERE tournament_id='${fixture.tour}'),
  'money',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m WHERE tournament_id='${fixture.tour}'),
  'entries',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tournament_entries e WHERE tournament_id='${fixture.tour}'),
  'counts',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.tournament_chip_counts c WHERE tournament_id='${fixture.tour}'),
  'proofs',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM public.tournament_settlement_outcomes o WHERE hand_id='${hand}'),
  'queue',(SELECT jsonb_agg(to_jsonb(q) ORDER BY source_revision) FROM public.tracker_historical_display_queue q WHERE hand_id='${hand}'))`;
 const projection=()=>sql(projectionQuery);
 const originalProjection=projection();
 for(const actor of [fixture.player,fixture.actor]){
  const probe=JSON.parse(sql(`BEGIN;CREATE TEMP TABLE void_before AS SELECT (${projectionQuery}) snapshot;
   SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${actor}"}';SET LOCAL ROLE authenticated;
   CREATE TEMP TABLE void_probe AS SELECT public.void_last_hand('${hand}') receipt;RESET ROLE;
   SELECT jsonb_build_object('receipt',(SELECT receipt FROM void_probe),'unchanged',(SELECT snapshot=(${projectionQuery}) FROM void_before),
    'revision',(SELECT source_revision FROM public.tournament_hands WHERE id='${hand}'),
    'voided',(SELECT is_voided FROM public.tournament_hands WHERE id='${hand}'),
    'verified',(SELECT count(*) FROM public.tournament_settlement_outcomes WHERE hand_id='${hand}' AND status='verified'),
    'restored',(SELECT bool_and(e.current_stack=hp.starting_stack AND s.chip_count=hp.starting_stack AND c.chip_count=hp.starting_stack)
      FROM public.hand_players hp JOIN public.tournament_entries e ON e.tournament_id='${fixture.tour}' AND e.player_id=hp.player_id AND e.entry_no=hp.entry_number
      JOIN public.tournament_seats s ON s.entry_id=e.id AND s.is_active
      JOIN public.tournament_chip_counts c ON c.tournament_id=e.tournament_id AND c.player_id=e.player_id AND c.entry_number=e.entry_no WHERE hp.hand_id='${hand}'),
    'public',(SELECT public.get_public_tournament_table_history_v2('${fixture.tour}','${logical}',20,NULL,NULL)));ROLLBACK;`));
  if(actor===fixture.actor){
   assert.equal(probe.receipt.status,'success',JSON.stringify(probe));assert.equal(probe.voided,true);
   assert.ok(probe.revision>revision);assert.equal(probe.verified,0);assert.equal(probe.restored,true);
   assert.ok(!probe.public.items.some(item=>item.result?.status==='verified'));
  }else{assert.equal(probe.receipt.error,'actor_not_allowed');assert.equal(probe.unchanged,true,'denied void must have zero delta before rollback');assert.equal(probe.revision,revision);assert.equal(probe.voided,false);assert.equal(probe.verified,1);}
  assert.equal(business(),before,'void endpoint rollback business');assert.equal(sourceRows(),originalRows,'void endpoint rollback source');
  assert.equal(projection(),originalProjection,'void endpoint rollback projections/proofs/queue');
 }
 console.log('PAID_VERIFIED_VOID_ENDPOINT_OWNER_PLAYER_AUTH_PROJECTIONS_PASS');
}
const observed=calls.length;
for(const [credential,body,status,expectedCode] of [
 ['TEST_HISTORY_SERVICE',{hand_ids:[hand],limit:1},404,'worker_disabled'],
 ['TEST_HISTORY_CANARY',{limit:1},400,'hand_scope_required'],
 ['TEST_HISTORY_CANARY',{hand_ids:['00000000-0000-4000-8000-000000000099'],limit:1},400,'hand_out_of_scope'],
]){
 const denied=await handler(new Request('https://test.invalid/history-worker',{method:'POST',headers:{Authorization:'Bearer '+credential,'Content-Type':'application/json'},body:JSON.stringify(body)}));
 assert.equal(denied.status,status);assert.equal((await denied.json()).code,expectedCode);assert.equal(calls.length,observed,'denied scope must not call SQL');
}
const retry=await handler(new Request('https://test.invalid/history-worker',{method:'POST',headers:{Authorization:'Bearer TEST_HISTORY_CANARY','Content-Type':'application/json'},body:JSON.stringify({hand_ids:[hand],limit:1})}));
assert.equal(retry.status,200);assert.deepEqual(await retry.json(),{ok:true,claimed:0,completed:0,retried:0,needs_attention:0,unresolved:0});
assert.equal(calls.at(-1).name,'claim_tracker_historical_display_jobs_scoped_v1');assert.deepEqual(errors,[]);assert.equal(business(),before);
assert.equal(sql(`SELECT count(*) FROM public.tournament_settlement_outcomes WHERE hand_id='${hand}' AND verification_scope='historical_display' AND status='verified';`),verified?'1':'0');
if((baselineParent&&!pending472&&!pending477&&!pending554&&!pending575&&!pending594&&!pending647&&!pending657&&!parentShowdown&&!retainedSidepot&&!retainedBoardPlay&&!winner103&&!multiple113&&!mixed230&&!finish136&&process.env.VINPOKER_NATIVE_PAID_TOUR==='1')
 || (singleDayParent&&process.argv.includes('--single-day-correction'))||canonicalObserver){
 const oldRevision=Number(sql(`SELECT source_revision FROM public.tournament_hands WHERE id='${hand}';`));
 const publicItem=()=>{
  const page=JSON.parse(sql(`SET request.jwt.claims='{"role":"anon"}';SET ROLE anon;
   SELECT public.get_public_tournament_table_history_v2('${fixture.tour}','${logical}',20,NULL,NULL);`));
  assert.equal(page.access,'public');
  const items=page.items.filter(item=>item.handId===hand);assert.equal(items.length,1);return items[0];
 };
 if(canonicalObserver){const item=publicItem();assert.equal(item.result.status,'verified');assert.ok(item.result.recipients.length>0);}
 let pagination156;
 try{
  if(canonicalObserver&&process.argv.includes('--pagination156')){
   const {beginHistoryPagination156}=await import('./historyPagination156.native.mjs');
   pagination156=await beginHistoryPagination156({sql,fixture,hand,logical});
  }
  await runPaidCorrectionEdge({sql,service,fixture,hand});
  await pagination156?.afterCorrection();
 }finally{await pagination156?.close();}
 const newRevision=Number(sql(`SELECT source_revision FROM public.tournament_hands WHERE id='${hand}';`));
 assert.ok(newRevision>oldRevision);assert.equal(nonHandBusiness(),beforeNonHand);
 assert.equal(sql(`SELECT count(*) FROM public.tournament_settlement_outcomes WHERE hand_id='${hand}' AND verification_scope='historical_display' AND source_revision=${oldRevision} AND status='verified';`),'0');
 assert.equal(sql(`SELECT count(*) FROM public.tracker_historical_display_queue WHERE hand_id='${hand}' AND source_revision=${newRevision} AND status='pending';`),'1');
 if(canonicalObserver){
  // Correction atomically publishes a current chain proof; a queued display
  // verification does NOT imply public pending when that valid proof exists.
  const proof=JSON.parse(sql(`SELECT jsonb_build_object('revision',o.source_revision,'hash',o.source_chain_hash,
    'expectedRevision',s.source_revision,'expectedHash',s.source_chain_hash,'public',o.public_outcome)
    FROM public.tournament_settlement_outcomes o
    CROSS JOIN LATERAL public.get_tournament_settlement_source_hash('${hand}') s
    WHERE o.hand_id='${hand}' AND o.verification_scope='chain' AND o.status='verified'
      AND o.source_revision=${newRevision};`));
  assert.equal(proof.revision,newRevision);assert.equal(proof.revision,proof.expectedRevision);assert.equal(proof.hash,proof.expectedHash);
  const item=publicItem();assert.equal(item.result.status,'verified');
  const allocations=new Set(proof.public.pots.flatMap(pot=>pot.allocations.filter(a=>a.amount>0).map(a=>a.winnerId)));
  const expected=proof.public.players.filter(player=>allocations.has(player.playerId))
    .map(player=>({playerId:player.playerId,netDelta:player.netDelta,potAward:player.potAward})).sort((a,b)=>a.playerId.localeCompare(b.playerId));
  assert.deepEqual(item.result.recipients.map(({playerId,netDelta,potAward})=>({playerId,netDelta,potAward})).sort((a,b)=>a.playerId.localeCompare(b.playerId)),expected);
  assert.deepEqual(item.board,['2c','3d','4h']);
 }
 const republished=await handler(new Request('https://test.invalid/history-worker',{method:'POST',headers:{Authorization:'Bearer TEST_HISTORY_CANARY','Content-Type':'application/json'},body:JSON.stringify({hand_ids:[hand],limit:1})}));
 assert.equal(republished.status,200);assert.deepEqual(await republished.json(),{ok:true,claimed:1,completed:1,retried:0,needs_attention:0,unresolved:0});
 assert.deepEqual(errors,[]);assert.equal(nonHandBusiness(),beforeNonHand);
 assert.equal(sql(`SELECT count(*) FROM public.tournament_settlement_outcomes WHERE hand_id='${hand}' AND verification_scope='historical_display' AND source_revision=${newRevision} AND status='verified';`),'1');
 const currentHistory=JSON.parse(sql(`SET request.jwt.claims='{"role":"anon"}';SET ROLE anon;SELECT public.get_public_tournament_table_history_v2('${fixture.tour}','${logical}',20,NULL,NULL);`));
 assert.equal(currentHistory.items[0].result.status,'verified');
 const afterCorrection=business();
 const replay=await handler(new Request('https://test.invalid/history-worker',{method:'POST',headers:{Authorization:'Bearer TEST_HISTORY_CANARY','Content-Type':'application/json'},body:JSON.stringify({hand_ids:[hand],limit:1})}));
 assert.equal(replay.status,200);assert.deepEqual(await replay.json(),{ok:true,claimed:0,completed:0,retried:0,needs_attention:0,unresolved:0});
 assert.equal(business(),afterCorrection);
 if(canonicalObserver)console.log('CANONICAL_EDGE_CORRECTION_COMMIT_ANON_CURRENT_CHAIN_REPUBLICATION_PASS',JSON.stringify({
  fixture,hand,oldRevision,newRevision,auto:false,transport:'modeled HTTP/Auth; real Edge/compute/SQL; independent committed psql calls',
  limitation:process.argv.includes('--pagination156')?'separate READ COMMITTED observer transaction overlaps correction commit; statements sequential, no active-SELECT barrier/browser/realtime proof':'sequential observer, not browser/realtime or simultaneous database sessions'}));
 console.log('ACTUAL_PAID_EIGHT_SAME_HAND_CORRECTION_INVALIDATION_REPUBLICATION_PASS');
}
if(retainedShortChop)console.log('ACTUAL_BROWSER_SHORT_ALLIN_HAND10_REV16_CHOP_600_EACH_HISTORY_VERIFIED_PASS');
if(winner103)console.log('ACTUAL_BROWSER_HAND29_REV16_AA_WINNER_2800_WORKER_ANON_VERIFIED_PASS');
if(winner104)console.log('ACTUAL_BROWSER_CORRECTION_HAND29_REV19_SPLIT_CURRENT_WORKER_ANON_VERIFIED_PASS');
if(multiple113)console.log('ACTUAL_NATIVE_THREE_POT_ODD_CHIP_REFUND_REV21_WORKER_ANON_VERIFIED_PASS');
if(mixed230)console.log('ACTUAL_MIXED230_REV20_WORKER_TWO_POTS_UNSPENT100_ANON_VERIFIED_PASS');
if(finish136)console.log('ACTUAL_BROWSER_HAND32_REV21_NON_ALLIN_AA_WINNER_400_WORKER_ANON_VERIFIED_PASS');
if(finish137)console.log('ACTUAL_BROWSER_CORRECTED_HAND32_REV24_KK_WINNER_400_WORKER_ANON_VERIFIED_PASS');
if(linked173)console.log('ACTUAL_LINKED_MAIN_EVENT_BROWSER_HAND1_REV27_WORKER_ANON_VERIFIED_PASS');
if(linked181)console.log('ACTUAL_LINKED_FLIGHT_A_BROWSER_ALLIN_REV33_CHOP_20000_EACH_WORKER_ANON_VERIFIED_PASS');
if(linked185)console.log(`ACTUAL_LINKED_D2_${linkedD2Table7?'POST_RELOCATION_TABLE7':'TABLE8'}_BROWSER_HAND${linkedD2Proof.number}_REV${linkedD2Proof.revision}_POT_${linkedD2Pot}_WORKER_ANON_VERIFIED_PASS`);
if(retainedSidepot)console.log(retainedShortStack?'ACTUAL_RETAINED_BROWSER_SHORT_STACK_REV19_WORKER_PUBLIC_VERIFIED_PASS':'ACTUAL_RETAINED_BROWSER_SIDEPOT_REV24_WORKER_MAIN_SIDE_REFUND_PUBLIC_VERIFIED_PASS');
if(parentHand&&!linked181&&!linked185)console.log(singleDayParent?'ACTUAL_SINGLE_DAY_BROWSER_PARENT_HISTORY_WORKER_PUBLIC_PASS':d2Parent?'ACTUAL_D2_QUALIFIED_PARENT_HISTORY_WORKER_PUBLIC_PASS':baselineParent?'ACTUAL_PAID_PARENT_BASELINE_HISTORY_WORKER_PUBLIC_PASS':'ACTUAL_PARENT_CORRECTION_SAME_HAND_CURRENT_REVISION_WORKER_PUBLIC_PASS');
if(!pending687&&!pending685&&!pending683&&!pending679&&!correction290&&!linked181&&!linked185&&!winner103&&!winner104&&!multiple113&&!mixed230&&!finish136&&!finish137)
console.log(pending575?'ACTUAL_HISTORY_WORKER_BROWSER_HAND36_BOARD_PLAYS_CURRENT_PROOF_PUBLIC_PASS':pending554?'ACTUAL_HISTORY_WORKER_BROWSER_HAND35_BOARD_PLAYS_CURRENT_PROOF_PUBLIC_PASS':retainedBoardPlay?`ACTUAL_HISTORY_WORKER_BROWSER_BOARD_PLAYS_REV${boardPlayProof.revision}_SPLIT_${boardPlayProof.award}_EACH_PUBLIC_VERIFIED_PASS`:retainedShortStack?'ACTUAL_HISTORY_WORKER_BROWSER_HU_SHORT_STACK_PUBLIC_VERIFIED_PASS':retainedSidepot?'ACTUAL_HISTORY_WORKER_BROWSER_THREE_WAY_SIDEPOT_PUBLIC_VERIFIED_PASS':singleDayReplay?`ACTUAL_SINGLE_DAY_BROWSER_HAND_${singleDayReplay.number}_SHOWDOWN_CURRENT_PROOF_PUBLIC_VERIFIED_PASS`:singleDayShowdown?'ACTUAL_SINGLE_DAY_HAND2_SHOWDOWN_CURRENT_PROOF_PUBLIC_VERIFIED_PASS':d2Parent?'ACTUAL_HISTORY_WORKER_VERIFIER_QUALIFIED_D2_FOLD_PUBLIC_VERIFIED_PASS':parentShowdown?'ACTUAL_PAID_TERMINAL_SHOWDOWN_HISTORY_WORKER_PUBLIC_VERIFIED_PASS':lostCommitResponse?'ACTUAL_HISTORY_WORKER_LOST_COMMIT_RESPONSE_NO_DUPLICATE_PASS':verified?'ACTUAL_HISTORY_WORKER_VERIFIER_PAID_FOLD_OUTCOME_PUBLIC_VERIFIED_PASS':'ACTUAL_HISTORY_WORKER_VERIFIER_PAID_HAND_NEEDS_ATTENTION_PUBLIC_STATE_PASS');
}
