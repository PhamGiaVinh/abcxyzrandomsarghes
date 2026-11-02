import { useCallback, useEffect, useRef, useState } from "react";
import { useSupabaseClient,useSupabaseBackendScope } from "@/integrations/supabase/SupabaseClientContext";
import { callMultiDayFloorRpc } from "@/ops/floor/multiDayFloorRpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MultiDayInitialDrawWorkspace } from './MultiDayInitialDrawWorkspace';
import {parseD2Roster,type D2Player} from '@/ops/floor/multiDayInitialDraw';
import {waitForManualPlayerResponse} from '@/lib/floorManualPlayerIntent';
import {readFinalizationIntent,parseFinalizationIntent,persistFinalizationIntent,clearFinalizationIntent,definitiveFirstFinalizationFailure,type MultiDayFinalizationIntent} from '@/ops/floor/multiDayFinalizationIntent';
import {readQualificationIntent,parseQualificationIntent,persistQualificationIntent,clearQualificationIntent,type MultiDayQualificationIntent} from '@/ops/floor/multiDayQualificationIntent';
import {readApprovalIntent,parseApprovalIntent,persistApprovalIntent,clearApprovalIntent,type MultiDayApprovalIntent} from '@/ops/floor/multiDayApprovalIntent';
import {readCorrectionIntent,parseCorrectionIntent,persistCorrectionIntent,clearCorrectionIntent,type MultiDayCorrectionIntent} from '@/ops/floor/multiDayCorrectionIntent';
import {readRulesIntent,parseRulesIntent,persistRulesIntent,clearRulesIntent,type MultiDayRulesIntent} from '@/ops/floor/multiDayRulesIntent';
import {EndFlightControl} from './EndFlightControl';
import {MultiDayPayoutConfigurationPreview} from './MultiDayPayoutConfigurationPreview';
import {prizeConfigurationJournalKey} from '@/ops/floor/multiDayPrizeConfigurationIntent';
import {MultiDayIndividualResultsPanel} from './MultiDayIndividualResultsPanel';
import {individualResultsJournalKey} from '@/ops/floor/multiDayIndividualResults';

type FloorRead = {
  releaseEnabled: boolean;
  capabilities: { canFinalizePayout: boolean; canRequestAdjustment: boolean; canApproveAdjustment: boolean };
  eventItmPercent: number;
  rules: null | { policy: string; itmPercent: number; day2Percent: number; minCashX: number; buyInVnd?:number };
  qualification: null | { sourceHash: string; participationCount: number; lockedAt: string };
  finalization: null | (Payout & { requestId: string; finalizedAt: string });
  correctionRequests: Array<{ requestId: string; kind: string; deltaVnd: number; reason: string; state: string }>;
};
type Bag = { bagId: string; playerId: string; stack: number; version: number };
type Flight = { flightId: string; status: string | null; dayStatus: string | null; validEntries: number; itmTarget: number; day2Target: number; eligibleBags: Bag[] };
type Qualification = { state: string; sourceHash: string; policy: string; flights: Flight[] };
type Payout = {
  state: string; rulesVersion: string; fundingRevision: string;
  qualificationRevision: string; payoutInputHash: string;
  directPoolVnd: number; transferPoolVnd: number; feesVnd: number;
  recordedOverlayVnd: number; requiredShortfallVnd: number;
  paidPlayerVnd: number; unpaidObligationVnd: number;
  clubRetainedTieVnd: number; unallocatedPoolVnd: number;
  obligations: Array<{ playerId: string; participationId: string; rank?: number; totalVnd: number; paidVnd: number; unpaidVnd: number }>;
  sourceSnapshot: { payments?: Array<{ id: string; playerId: string; amountVnd: number }> };
};
type Postfinal = { revision: string; paidPlayerVnd: number; unpaidObligationVnd: number; unallocatedPoolVnd: number;
  reversiblePayments?: Array<{id:string;playerId:string;participationId:string;amountVnd:number}> };

const money = (value: number | undefined) => value == null ? "—" : `${Number(value).toLocaleString("en-US")} VND`;
const message = (error: unknown) => {
  const text = error instanceof Error ? error.message
    : error && typeof error === "object" && "message" in error
      ? String((error as { message: unknown }).message) : String(error);
  if (/multi_day_payout_recalculate|stale_source|40001/i.test(text)) return "Source changed. Refresh the preview before retrying.";
  if (/\bmulti_day_payout_rank_amount_missing\b/i.test(text)) return "Final Day prize amounts are missing for one or more paid places. Review the payout configuration before finalizing obligations. No payment was executed.";
  if (/release_off|gate_denied/i.test(text)) return "The Multi-day package is off for this club.";
  if (/owner_required|actor_denied|42501/i.test(text)) return `TD/Floor or owner access denied for this club: ${text}`;
  return text;
};

export type MultiDayFloorEventProps = {
  eventId: string; onReleaseRead?: (enabled: boolean) => void; surface?: "design" | "payout";
};
export function MultiDayFloorEventWorkspace(props:MultiDayFloorEventProps&{actorId:string|undefined;sessionEpoch:number}) {
  if(!props.actorId)return <p role="alert">Sign in before loading the multi-day event.</p>;
  return <MultiDayFloorEventScope key={JSON.stringify([props.eventId,props.actorId,props.sessionEpoch])} {...props} actorId={props.actorId}/>;
}
function MultiDayFloorEventScope({ eventId, onReleaseRead, surface = "design",actorId,sessionEpoch }: MultiDayFloorEventProps&{actorId:string;sessionEpoch:number}) {
  const client = useSupabaseClient();
  const backendScope=useSupabaseBackendScope();
  const [individualHeld,setIndividualHeld]=useState(()=>{
    try{return sessionStorage.getItem(individualResultsJournalKey(actorId,eventId))!==null;}catch{return true;}
  });
  const [configurationHeld,setConfigurationHeld]=useState(()=>{
    try{return sessionStorage.getItem(prizeConfigurationJournalKey(actorId,eventId))!==null;}catch{return true;}
  });
  const rpc = useCallback(<T,>(name: string, args: Record<string, unknown>) =>
    waitForManualPlayerResponse(callMultiDayFloorRpc<T>(client, name, args)), [client]);
  const [read, setRead] = useState<FloorRead | null>(null);
  const [qualification, setQualification] = useState<Qualification | null>(null);
  const [payout, setPayout] = useState<Payout | null>(null);
  const [postfinal, setPostfinal] = useState<Postfinal | null>(null);
  const [participantLabels,setParticipantLabels]=useState<D2Player[]>([]);
  const [labelState,setLabelState]=useState<'idle'|'loading'|'ready'|'unavailable'>('idle');
  const [verifiedReadVersion,setVerifiedReadVersion]=useState(0);
  const participantLabel=(row:{participationId:string;playerId:string})=>{
    const player=participantLabels.find(p=>p.participationId===row.participationId&&p.playerId===row.playerId);
    return player?.name?.trim()?`${player.name} · ${row.playerId}`:row.playerId;
  };
  const [policy, setPolicy] = useState("SELECT_LARGEST");
  const [minCashX, setMinCashX] = useState("1");
  const [day2Percent, setDay2Percent] = useState("");
  const [selectedBags, setSelectedBags] = useState<string[]>([]);
  const [kind, setKind] = useState("OBLIGATION_DELTA");
  const [participationId, setParticipationId] = useState("");
  const [paymentId, setPaymentId] = useState("");
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [endFlightHeld,setEndFlightHeld]=useState(false);
  const [journal,setJournal]=useState<{intent:MultiDayFinalizationIntent|null;error:string|null}>(()=>{
    try{return {intent:readFinalizationIntent(sessionStorage,actorId,eventId),error:null};}
    catch{return {intent:null,error:'Cannot verify retained finalization request. Writes are held; do not create a new request.'};}
  });
  const finalIntent=useRef(journal.intent);
  const [qualificationJournal,setQualificationJournal]=useState<{intent:MultiDayQualificationIntent|null;error:string|null}>(()=>{
    try{return {intent:readQualificationIntent(sessionStorage,actorId,eventId),error:null};}
    catch{return {intent:null,error:'Cannot verify retained qualification request. Event writes are held.'};}
  });
  const qualificationIntent=useRef(qualificationJournal.intent);
  const [approvalJournal,setApprovalJournal]=useState<{intent:MultiDayApprovalIntent|null;error:string|null}>(()=>{
    try{return {intent:readApprovalIntent(sessionStorage,actorId,eventId),error:null};}
    catch{return {intent:null,error:'Cannot verify retained approval request. Event writes are held.'};}
  });
  const approvalIntent=useRef(approvalJournal.intent);
  const [correctionJournal,setCorrectionJournal]=useState<{intent:MultiDayCorrectionIntent|null;error:string|null}>(()=>{
    try{return {intent:readCorrectionIntent(sessionStorage,actorId,eventId),error:null};}
    catch{return {intent:null,error:'Cannot verify retained correction request. Event writes are held.'};}
  });
  const correctionIntent=useRef(correctionJournal.intent);
  const [rulesJournal,setRulesJournal]=useState<{intent:MultiDayRulesIntent|null;error:string|null}>(()=>{
    try{return {intent:readRulesIntent(sessionStorage,actorId,eventId),error:null};}
    catch{return {intent:null,error:'Cannot verify retained rules request. Event writes are held.'};}
  });
  const rulesIntent=useRef(rulesJournal.intent);
  const otherWritesHeld=!!journal.intent||!!journal.error||!!qualificationJournal.intent||!!qualificationJournal.error||!!approvalJournal.intent||!!approvalJournal.error||!!correctionJournal.intent||!!correctionJournal.error||!!rulesJournal.intent||!!rulesJournal.error;
  const eventWritesHeld=otherWritesHeld||configurationHeld||individualHeld;
  const pendingIds = useRef(new Map<string, string>());
  const generation=useRef(0),alive=useRef(true),writing=useRef(false);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;generation.current+=1;};},[]);
  const requestId = (key: string) => {
    if (!pendingIds.current.has(key)) pendingIds.current.set(key, crypto.randomUUID());
    return pendingIds.current.get(key)!;
  };

  const refresh = useCallback(async () => {
    if(!alive.current)return;
    const revision=++generation.current;
    const currentScope=()=>alive.current&&generation.current===revision;
    setLoading(true);
    setRead(null);setQualification(null);setPayout(null);setPostfinal(null);setSelectedBags([]);
    setParticipantLabels([]);setLabelState('idle');
    setError(null);
    try {
      const current = await rpc<FloorRead>("multi_day_floor_read_v1", { p_event_id: eventId });
      if(!currentScope())return;
      setRead(current);
      setVerifiedReadVersion(revision);
      onReleaseRead?.(current.releaseEnabled);
      if (current.rules) {
        setPolicy(current.rules.policy);
        setMinCashX(String(current.rules.minCashX));
        setDay2Percent(String(current.rules.day2Percent));
        const q = await rpc<Qualification>("multi_day_qualification_preview_v1", { p_event_id: eventId });
        if(!currentScope())return;
        setQualification(q);
        if (current.finalization) {
          setPayout(current.finalization);
          const post=await rpc<Postfinal>("multi_day_payout_postfinal_state_v1", { p_event_id: eventId });
          if(!currentScope())return;
          setPostfinal(post);
        } else if (current.qualification) {
          try {
            const p = await rpc<Payout>("multi_day_payout_preview_v1", { p_event_id: eventId });
            if(!currentScope())return;
            setPayout(p);
          } catch (cause) {
            if(!currentScope())return;
            setPayout(null);
            // A locked qualification precedes Final Day results. The server's
            // explicit not-ready outcome is expected here, not a failed read.
            const detail=message(cause);
            if (!/\bmulti_day_payout_results_not_ready\b/.test(detail)) {
              setError(`Payout preview unavailable: ${detail}`);
            }
          }
          setPostfinal(null);
        } else { setPayout(null); setPostfinal(null); }
      } else { setDay2Percent((value) => value || String(current.eventItmPercent)); setQualification(null); setPayout(null); setPostfinal(null); }
    } catch (cause) {
      if(!currentScope())return;
      setRead(null);setQualification(null);setPayout(null);setPostfinal(null);
      // A missing pending RPC means the release migration is not installed;
      // preserve the existing production Floor controls in that case only.
      if (!/multi_day_floor_read_v1|42883/i.test(message(cause))) onReleaseRead?.(true);
      setError(message(cause));
    }
    finally { if(currentScope())setLoading(false); }
  }, [eventId, onReleaseRead, rpc]);

  useEffect(()=>{
    if(surface!=='payout'||!payout||!read?.qualification)return;
    let active=true;
    const sequence=generation.current;
    const current=()=>active&&alive.current&&sequence===generation.current;
    setParticipantLabels([]);setLabelState('loading');
    void rpc<unknown>('multi_day_final_roster_v1',{p_event_id:eventId}).then(value=>{
      const roster=parseD2Roster(value,eventId);
      if(roster.qualificationHash!==read.qualification!.sourceHash)throw new Error('PARTICIPANT_LABEL_SOURCE_CHANGED');
      if(current()){setParticipantLabels(roster.players);setLabelState('ready');}
    }).catch(()=>{if(current()){setParticipantLabels([]);setLabelState('unavailable');}});
    return()=>{active=false;};
  },[eventId,read,payout,rpc,surface,verifiedReadVersion]);

  useEffect(() => { void refresh(); }, [refresh]);
  const act = async (work: () => Promise<unknown>, success: string, key?: string,recovery?:'finalize'|'qualify'|'approve'|'correction'|'rules') => {
    if (writing.current || configurationHeld || individualHeld || loading || !read || !alive.current||journal.error||qualificationJournal.error||approvalJournal.error||correctionJournal.error||rulesJournal.error
      ||(recovery!=='finalize'&&finalIntent.current)||(recovery!=='qualify'&&qualificationIntent.current)
      ||(recovery!=='approve'&&approvalIntent.current)||(recovery!=='correction'&&correctionIntent.current)
      ||(recovery!=='rules'&&rulesIntent.current)) return;
    writing.current=true;
    setBusy(true); setError(null); setNotice(null);
    try { await work(); if(!alive.current)return; if (key) pendingIds.current.delete(key); setNotice(success); await refresh(); }
    catch (cause) { if(alive.current)setError(message(cause)); }
    finally { writing.current=false;if(alive.current)setBusy(false); }
  };
  const toggleBag = (id: string) => setSelectedBags((ids) => ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  const due = qualification?.flights.reduce((sum, flight) => sum + flight.day2Target, 0) ?? 0;
  const lockKey = `lock:${eventId}:${qualification?.sourceHash}:${[...selectedBags].sort().join(",")}`;
  const finalizeKey = `finalize:${eventId}:${payout?.payoutInputHash}`;
  const finalize=()=>void act(async()=>{
    let intent=finalIntent.current;
    const firstSend=intent===null;
    if(!intent){
      if(!payout)throw Error('Payout source is unavailable.');
      intent=parseFinalizationIntent({actorId,eventId,args:{p_event_id:eventId,p_expected_rules_version:payout.rulesVersion,
        p_expected_funding_revision:payout.fundingRevision,p_expected_qualification_revision:payout.qualificationRevision,
        p_expected_payout_input_hash:payout.payoutInputHash,p_request_id:requestId(finalizeKey)}},actorId,eventId);
      try{persistFinalizationIntent(sessionStorage,intent);}
      catch(cause){setJournal({intent:null,error:'Cannot retain finalization request. No new request was sent.'});throw cause;}
      finalIntent.current=intent;setJournal({intent,error:null});
    }
    try{await rpc('multi_day_finalize_payout_v1',intent.args);}
    catch(cause){
      if(alive.current&&firstSend&&definitiveFirstFinalizationFailure(cause)){
        clearFinalizationIntent(sessionStorage,intent);finalIntent.current=null;pendingIds.current.delete(finalizeKey);setJournal({intent:null,error:null});setPayout(null);
      }
      throw cause;
    }
    if(!alive.current)return;
    clearFinalizationIntent(sessionStorage,intent);finalIntent.current=null;setJournal({intent:null,error:null});
  },'Payout obligations finalized. No payment was executed.',undefined,'finalize');
  const lockQualification=()=>void act(async()=>{
    let intent=qualificationIntent.current;const firstSend=intent===null;
    if(!intent){
      if(!qualification)throw Error('Qualification source is unavailable.');
      intent=parseQualificationIntent({actorId,eventId,policy:qualification.policy,args:{p_event_id:eventId,p_bag_ids:selectedBags,
        p_expected_source_hash:qualification.sourceHash,p_request_id:requestId(lockKey)}},actorId,eventId);
      try{persistQualificationIntent(sessionStorage,intent);}
      catch(cause){setQualificationJournal({intent:null,error:'Cannot retain qualification request. No new request was sent.'});throw cause;}
      qualificationIntent.current=intent;setQualificationJournal({intent,error:null});
    }
    try{
      const receipt=await rpc<Record<string,unknown>>('multi_day_lock_qualification_v1',intent.args);
      if(receipt.policy!==intent.policy)throw Error('Qualification receipt policy is unverified. Keep the retained request.');
    }catch(cause){
      if(alive.current&&firstSend&&definitiveFirstFinalizationFailure(cause)){
        clearQualificationIntent(sessionStorage,intent);qualificationIntent.current=null;pendingIds.current.delete(lockKey);
        setQualificationJournal({intent:null,error:null});setQualification(null);setSelectedBags([]);
      }
      throw cause;
    }
    if(!alive.current)return;
    clearQualificationIntent(sessionStorage,intent);qualificationIntent.current=null;setQualificationJournal({intent:null,error:null});
  },'Qualification locked from sealed bags.',undefined,'qualify');
  const correctionKey = `correction:${eventId}:${kind}:${participationId}:${paymentId}:${delta}:${reason}:${evidence}:${postfinal?.revision}`;
  const lockRules=()=>void act(async()=>{
    let intent=rulesIntent.current;const firstSend=intent===null;
    if(!intent){
      if(minCashX.trim()===''||day2Percent.trim()==='')throw Error('Enter explicit minimum cash and Day2 values before locking rules.');
      intent=parseRulesIntent({actorId,eventId,itmPercent:read?.eventItmPercent,args:{p_event_id:eventId,p_policy:policy,
        p_min_cash_x:Number(minCashX),p_day2_percent:Number(day2Percent)}},actorId,eventId);
      try{persistRulesIntent(sessionStorage,intent);}
      catch(cause){setRulesJournal({intent:null,error:'Cannot retain rules request. No new rules were sent.'});throw cause;}
      rulesIntent.current=intent;setRulesJournal({intent,error:null});
    }
    try{
      const receipt=await rpc<Record<string,unknown>>('multi_day_set_qualification_rules_v2',intent.args);
      if(receipt.itmPercent!==intent.itmPercent)throw Error('Rules receipt ITM is unverified. Keep the retained request.');
    }catch(cause){
      if(alive.current&&firstSend&&definitiveFirstFinalizationFailure(cause)){
        clearRulesIntent(sessionStorage,intent);rulesIntent.current=null;setRulesJournal({intent:null,error:null});setRead(null);
      }
      throw cause;
    }
    if(!alive.current)return;
    clearRulesIntent(sessionStorage,intent);rulesIntent.current=null;setRulesJournal({intent:null,error:null});
  },'Rules saved and frozen.',undefined,'rules');
  const requestCorrection=()=>void act(async()=>{
    let intent=correctionIntent.current;const firstSend=intent===null;
    if(!intent){
      if(kind==='PAYMENT_REVERSAL'&&!postfinal?.reversiblePayments?.some(row=>row.id===paymentId
        &&row.participationId===participationId&&Number(delta)===-row.amountVnd)) {
        throw new Error('Refresh current paid records and select the matching full payment before requesting reversal.');
      }
      intent=parseCorrectionIntent({actorId,eventId,args:{p_event_id:eventId,p_kind:kind,p_participation_id:participationId,
        p_original_payment_id:kind==='PAYMENT_REVERSAL'?paymentId:null,p_delta_vnd:Number(delta),p_expected_revision:postfinal?.revision,
        p_reason:reason,p_evidence_ref:evidence,p_request_id:requestId(correctionKey)}},actorId,eventId);
      try{persistCorrectionIntent(sessionStorage,intent);}
      catch(cause){setCorrectionJournal({intent:null,error:'Cannot retain correction request. No new request was sent.'});throw cause;}
      correctionIntent.current=intent;setCorrectionJournal({intent,error:null});
    }
    try{await rpc('multi_day_request_payout_correction_v1',intent.args);}
    catch(cause){
      if(alive.current&&firstSend&&definitiveFirstFinalizationFailure(cause)){
        clearCorrectionIntent(sessionStorage,intent);correctionIntent.current=null;setCorrectionJournal({intent:null,error:null});
        pendingIds.current.delete(correctionKey);setPostfinal(null);
      }
      throw cause;
    }
    if(!alive.current)return;
    clearCorrectionIntent(sessionStorage,intent);correctionIntent.current=null;setCorrectionJournal({intent:null,error:null});
  },'Correction requested. Owner approval is still required.',undefined,'correction');
  const approve=(request?:string)=>void act(async()=>{
    let intent=approvalIntent.current;const firstSend=intent===null;
    if(!intent){
      intent=parseApprovalIntent({actorId,eventId,args:{p_request_id:request,p_approval_request_id:requestId(`approve:${request}`)}},actorId,eventId);
      try{persistApprovalIntent(sessionStorage,intent);}
      catch(cause){setApprovalJournal({intent:null,error:'Cannot retain approval request. No new approval was sent.'});throw cause;}
      approvalIntent.current=intent;setApprovalJournal({intent,error:null});
    }
    try{await rpc('multi_day_approve_payout_correction_v1',intent.args);}
    catch(cause){
      if(alive.current&&firstSend&&definitiveFirstFinalizationFailure(cause)){
        clearApprovalIntent(sessionStorage,intent);approvalIntent.current=null;setApprovalJournal({intent:null,error:null});
        pendingIds.current.delete(`approve:${intent.args.p_request_id}`);setPostfinal(null);
      }
      throw cause;
    }
    if(!alive.current)return;
    clearApprovalIntent(sessionStorage,intent);approvalIntent.current=null;setApprovalJournal({intent:null,error:null});
  },'Correction approved and reconciled; no payment executed.',undefined,'approve');

  return <section aria-label={surface === "design" ? "Verified Multi-day design" : "Verified Multi-day payout"} className="space-y-3 rounded-md border border-border p-3 text-sm">
    <div className="flex items-center justify-between gap-2">
      <h3 className="font-semibold">Verified Multi-day {surface === "design" ? "design" : "payout"}</h3>
      <Button type="button" variant="outline" size="sm" onClick={() => void refresh()} disabled={loading || busy}>Refresh source</Button>
    </div>
    {loading && <p role="status">Loading server state…</p>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {surface==='payout'&&
      <MultiDayPayoutConfigurationPreview key={JSON.stringify([eventId,actorId,sessionEpoch,verifiedReadVersion])}
        eventId={eventId} qualificationHash={read?.qualification?.sourceHash??''}
        rankedPlaces={qualification?.flights.reduce((sum,flight)=>sum+flight.itmTarget,0)??0} buyInVnd={read?.rules?.buyInVnd}
        authoringEnabled={!loading&&!!read?.qualification&&!read.finalization&&!!qualification}
        saveContext={backendScope?{actorId,eventId,backendScope,ownerEnabled:!!read?.capabilities?.canFinalizePayout,
          held:loading||busy||!read||!qualification||otherWritesHeld||individualHeld,onHeld:setConfigurationHeld,onSaved:()=>void refresh()}:undefined}/>}
    {surface==='payout'&&backendScope&&<MultiDayIndividualResultsPanel actorId={actorId} eventId={eventId} backendScope={backendScope}
      active={!loading&&!!read?.releaseEnabled&&!!read.qualification&&!read.finalization}
      held={busy||otherWritesHeld||configurationHeld||endFlightHeld} onHeld={setIndividualHeld}/>}
    {configurationHeld&&<p role="status">Payout configuration request is pending or unverified. Other event writes are held.</p>}
    {notice && <p role="status">{notice}</p>}
    {journal.error&&<p role="alert">{journal.error}</p>}
    {qualificationJournal.error&&<p role="alert">{qualificationJournal.error}</p>}
    {approvalJournal.error&&<p role="alert">{approvalJournal.error}</p>}
    {correctionJournal.error&&<p role="alert">{correctionJournal.error}</p>}
    {rulesJournal.error&&<p role="alert">{rulesJournal.error}</p>}
    {rulesJournal.intent&&<div className="space-y-2 rounded border border-amber-500/40 p-3">
      <p>Rules outcome is not yet reconciled. The exact original rules are retained; other event writes are held.</p>
      <Button type="button" disabled={busy||loading||!read} onClick={lockRules}>Retry retained rules request</Button>
    </div>}
    {correctionJournal.intent&&<div className="space-y-2 rounded border border-amber-500/40 p-3">
      <p>Correction outcome is not yet reconciled. The original payload, revision and request are retained; other event writes are held.</p>
      <Button type="button" disabled={busy||loading||!read||!!journal.intent||!!qualificationJournal.intent||!!approvalJournal.intent} onClick={requestCorrection}>Retry retained correction request</Button>
    </div>}
    {approvalJournal.intent&&<div className="space-y-2 rounded border border-amber-500/40 p-3">
      <p>Approval outcome is not yet reconciled. The original correction and approval request are retained; other event writes are held.</p>
      <Button type="button" disabled={busy||loading||!read||!!journal.intent||!!qualificationJournal.intent} onClick={()=>approve()}>Retry retained approval request</Button>
    </div>}
    {journal.intent&&<div className="space-y-2 rounded border border-amber-500/40 p-3">
      <p>Finalization outcome is not yet reconciled. The original request and revisions are retained; other event writes are held.</p>
      <Button type="button" disabled={busy||loading||!read||!!qualificationJournal.intent} onClick={finalize}>Retry retained finalization request</Button>
    </div>}
    {qualificationJournal.intent&&<div className="space-y-2 rounded border border-amber-500/40 p-3">
      <p>Qualification outcome is not yet reconciled. The original bag selection, source revision and request are retained.</p>
      <Button type="button" disabled={busy||loading||!read||!!journal.intent} onClick={lockQualification}>Retry retained qualification request</Button>
    </div>}
    {surface==='design'&&read&&!loading&&qualification&&qualification.flights.map(flight=><EndFlightControl
      key={flight.flightId} actorId={actorId} eventId={eventId} flightId={flight.flightId} ended={flight.status!==null}
      canStart={read.releaseEnabled&&!endFlightHeld&&(!read.qualification||flight.status==='locked')} blocked={busy||eventWritesHeld}
      onPendingChange={setEndFlightHeld} onEnded={()=>void refresh()}/>)}
    {read && !loading && <fieldset disabled={eventWritesHeld||endFlightHeld} className="min-w-0 space-y-3">
      <p>Package: {read.releaseEnabled ? "Enabled for this club" : "Off for this club"}. Server authorization applies to every action.</p>
      {surface === "design" && <div className="space-y-2 border-t pt-3">
        <h4 className="font-medium">Main Event rules</h4>
        <p>ITM: {read.rules?.itmPercent ?? read.eventItmPercent}% · Day2: {read.rules?.day2Percent ?? "not locked"}% per flight, each rounded up from valid entries. ITM sets paid places; Day2 sets qualification seats.</p>
        {read.rules ? <p>Policy: {read.rules.policy} · Minimum cash: {read.rules.minCashX}× frozen entry price. Rules locked before the first registration or entry.</p> : <>
          <p>Configure before the first registration or entry. The server freezes these rules.</p>
          <Label htmlFor={`policy-${eventId}`}>Bag selection policy</Label>
          <select id={`policy-${eventId}`} className="w-full rounded border bg-background p-2" value={policy} onChange={(e) => setPolicy(e.target.value)}>
            <option value="SELECT_LARGEST">SELECT_LARGEST — largest bag; other bags earn separate minimum cash</option>
            <option value="SUM_STACKS">SUM_STACKS — combine all bags; no extra bag cash</option>
          </select>
          <Label htmlFor={`cash-${eventId}`}>Minimum cash multiplier</Label>
          <Input id={`cash-${eventId}`} type="number" min="0" max="100" step="0.01" value={minCashX} onChange={(e) => setMinCashX(e.target.value)} />
          <Label htmlFor={`day2-${eventId}`}>Day2 % per flight</Label>
          <Input id={`day2-${eventId}`} type="number" min={read.eventItmPercent} max="100" step="0.01" value={day2Percent} onChange={(e) => setDay2Percent(e.target.value)} />
          <Button type="button" disabled={busy || !read.releaseEnabled || minCashX.trim()==='' || !Number.isFinite(Number(minCashX)) || Number(minCashX)<0 || Number(minCashX)>100 || day2Percent.trim() === "" || !Number.isFinite(Number(day2Percent)) || Number(day2Percent) < read.eventItmPercent || Number(day2Percent) > 100} onClick={lockRules}>Lock rules</Button>
        </>}
      </div>}
      {surface === "design" && qualification && <div className="space-y-2 border-t pt-3">
        <h4 className="font-medium">Qualification: {read.qualification ? "Locked" : qualification.state === "READY" ? "Ready to lock" : "Planned"}</h4>
        <p className="break-all text-xs">Source revision: {read.qualification?.sourceHash ?? qualification.sourceHash}</p>
        {qualification.flights.map((flight) => <div key={flight.flightId} className="rounded border p-2">
          <p className="font-medium">Flight {flight.flightId.slice(0, 8)} · play {flight.status ?? "not ended"} · bagging {flight.dayStatus ?? "not locked"}</p>
          <p>{flight.validEntries} valid entries → ITM {flight.itmTarget} · Day2 target {flight.day2Target} (each ceil) · {flight.eligibleBags.length} eligible sealed bags</p>
          {!read.qualification && qualification.state === "READY" && flight.eligibleBags.map((bag) => <label key={bag.bagId} className="flex items-center gap-2 py-1">
            <input type="checkbox" checked={selectedBags.includes(bag.bagId)} onChange={() => toggleBag(bag.bagId)} />
            Player {bag.playerId.slice(0, 8)} · {Number(bag.stack).toLocaleString("en-US")} chips · sealed version {bag.version}
          </label>)}
        </div>)}
        {!read.qualification && <Button type="button" disabled={busy || qualification.state !== "READY" || selectedBags.length !== due || !read.releaseEnabled}
          onClick={lockQualification}>Lock qualification ({selectedBags.length}/{due})</Button>}
      </div>}
      {surface === "design" && read.qualification && <MultiDayInitialDrawWorkspace eventId={eventId} actorId={actorId} sessionEpoch={sessionEpoch} />}
      {surface === "payout" && read.qualification && <div className="space-y-2 border-t pt-3">
        <h4 className="font-medium">Final Day payout</h4>
        {!payout ? <p>Payout preview is not ready. Finish results and reconcile funding, then refresh source.</p> : <>
          {read.finalization&&<p className="font-medium">Original finalized snapshot (immutable)</p>}
          <p>State: {payout.state}. Preview is server-derived; no ICM or deal calculation.</p>
          <div className="grid gap-1 sm:grid-cols-2">
            <p>Direct pool: {money(payout.directPoolVnd)}</p><p>Redeemed ticket transfers: {money(payout.transferPoolVnd)}</p>
            <p>Fees (outside pool): {money(payout.feesVnd)}</p><p>Recorded overlay: {money(payout.recordedOverlayVnd)}</p>
            <p>Required shortfall (not funded): {money(payout.requiredShortfallVnd)}</p><p>{read.finalization?'Original paid players':'Paid players'}: {money(payout.paidPlayerVnd)}</p>
            <p>{read.finalization?'Original unpaid obligations':'Unpaid obligations'}: {money(payout.unpaidObligationVnd)}</p><p>Club-retained tie remainder: {money(payout.clubRetainedTieVnd)}</p>
            <p>{read.finalization?'Original unallocated pool':'Unallocated pool'}: {money(payout.unallocatedPoolVnd)}</p>
          </div>
          <div className="space-y-1 break-all text-xs text-muted-foreground">
            <p>Rules revision: {payout.rulesVersion}</p><p>Funding revision: {payout.fundingRevision}</p>
            <p>Qualification revision: {payout.qualificationRevision}</p><p>Payout input hash: {payout.payoutInputHash}</p>
          </div>
          {labelState==='loading'&&<p role="status" className="text-xs text-muted-foreground">Loading canonical participant names…</p>}
          {(labelState==='unavailable'||labelState==='ready'&&payout.obligations.some(row=>!participantLabels.some(p=>p.participationId===row.participationId&&p.playerId===row.playerId&&p.name?.trim())))&&
            <p role="status" className="text-xs text-muted-foreground">Participant names are unavailable for some records; full player IDs are shown. Refresh source to retry.</p>}
          <div className="overflow-x-auto">
            <table className="w-full table-fixed text-left text-xs">
              <caption className="pb-2 text-left font-medium">Final Day player payouts</caption>
              <thead><tr className="border-b"><th scope="col" className="w-12 py-2">Rank</th><th scope="col" className="p-2">Player</th><th scope="col" className="w-28 py-2 text-right">Obligation</th></tr></thead>
              <tbody>{payout.obligations.map(row=>{
                const player=participantLabels.find(p=>p.participationId===row.participationId&&p.playerId===row.playerId);
                return <tr key={row.participationId} className="border-b align-top">
                  <td className="py-2">{row.rank===undefined?'—':`#${row.rank}`}</td>
                  <td className="break-words p-2 [overflow-wrap:anywhere]">
                    <p className="font-medium">{player?.name?.trim()||row.playerId}</p>
                    <p className="mt-1 text-muted-foreground">Paid {money(row.paidVnd)} · Unpaid {money(row.unpaidVnd)}</p>
                  </td>
                  <td className="break-words py-2 text-right tabular-nums">{money(row.totalVnd)}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>
          {!read.finalization && (read.capabilities?.canFinalizePayout ? <Button type="button" disabled={busy || payout.state !== "READY" || payout.requiredShortfallVnd !== 0 || !read.releaseEnabled}
            onClick={finalize}>Finalize obligations</Button>
            : <p>Owner-only Finalize obligations. TD/Floor can review this preview but cannot finalize it.</p>)}
        </>}
        {read.finalization && postfinal && <div className="space-y-2 border-t pt-3">
          <p>Current accounting after payments and corrections · revision <span className="break-all font-mono text-xs">{postfinal.revision}</span>. Paid {money(postfinal.paidPlayerVnd)} · unpaid {money(postfinal.unpaidObligationVnd)} · unallocated {money(postfinal.unallocatedPoolVnd)}.</p>
          <p>Corrections append records; they do not edit the original snapshot or execute a payment.</p>
          {!read.capabilities?.canRequestAdjustment && <p>Owner-only correction request. TD/Floor can review the finalized record.</p>}
          {read.capabilities?.canRequestAdjustment && <>
          <Label htmlFor={`kind-${eventId}`}>Correction type</Label>
          <select id={`kind-${eventId}`} className="w-full rounded border bg-background p-2" value={kind} onChange={(e) => {setKind(e.target.value);setPaymentId('');setDelta('');}}>
            <option value="OBLIGATION_DELTA">Obligation delta</option><option value="PAYMENT_REVERSAL">Reverse a historical paid marker</option>
          </select>
          <Label htmlFor={`person-${eventId}`}>Original obligation</Label>
          <select id={`person-${eventId}`} className="w-full rounded border bg-background p-2" value={participationId} onChange={(e) => {setParticipationId(e.target.value);setPaymentId('');if(kind==='PAYMENT_REVERSAL')setDelta('');}}>
            <option value="">Select player</option>{payout?.obligations.map((row) => <option key={row.participationId} value={row.participationId}>{participantLabel(row)} · {money(row.totalVnd)}</option>)}
          </select>
          {kind === "PAYMENT_REVERSAL" && <><Label htmlFor={`payment-${eventId}`}>Original paid record</Label>
            <select id={`payment-${eventId}`} className="w-full rounded border bg-background p-2" value={paymentId} onChange={(e) => {
              setPaymentId(e.target.value);const row=postfinal.reversiblePayments?.find(row=>row.id===e.target.value&&row.participationId===participationId);
              setDelta(row?String(-row.amountVnd):'');
            }}>
              <option value="">Select paid record</option>{postfinal.reversiblePayments?.filter(row=>row.participationId===participationId).map((row) => <option key={row.id} value={row.id}>{participantLabel(row)} · {money(row.amountVnd)} · {row.id}</option>)}
            </select>{!postfinal.reversiblePayments&&<p role="alert">Current paid records are unavailable. Refresh after the matching backend contract is applied; the frozen snapshot is not a current payment list.</p>}</>}
          <Label htmlFor={`delta-${eventId}`}>Signed delta (VND; reversal is negative)</Label><Input id={`delta-${eventId}`} type="number" step="1" value={delta} onChange={(e) => setDelta(e.target.value)} />
          <Label htmlFor={`reason-${eventId}`}>Reason</Label><Input id={`reason-${eventId}`} value={reason} onChange={(e) => setReason(e.target.value)} />
          <Label htmlFor={`evidence-${eventId}`}>Evidence reference</Label><Input id={`evidence-${eventId}`} value={evidence} onChange={(e) => setEvidence(e.target.value)} />
          <Button type="button" disabled={busy || !participationId || !Number.isSafeInteger(Number(delta)) || Number(delta) === 0 || reason.trim().length < 8 || evidence.trim().length < 8 || (kind === "PAYMENT_REVERSAL" && !postfinal.reversiblePayments?.some(row=>row.id===paymentId&&row.participationId===participationId&&Number(delta)===-row.amountVnd))}
            onClick={requestCorrection}>Request correction</Button>
          </>}
          {read.correctionRequests.map((request) => <div key={request.requestId} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2">
            <span>{request.kind} · {money(request.deltaVnd)} · {request.state} · {request.reason}</span>
            {request.state === "PENDING_APPROVAL" && (read.capabilities?.canApproveAdjustment ? <Button type="button" size="sm" variant="outline" disabled={busy || !read.releaseEnabled}
              onClick={() => approve(request.requestId)}>Approve</Button>
              : <span>Owner-only Approve</span>)}
          </div>)}
        </div>}
      </div>}
    </fieldset>}
  </section>;
}
