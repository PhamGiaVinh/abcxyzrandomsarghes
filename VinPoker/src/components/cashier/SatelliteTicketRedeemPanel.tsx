import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { z } from "zod";
import { useAuth } from "@/hooks/useAuth";
import { sessionReadEpoch } from "@/lib/sessionReadEpoch";

type Verified = {
  ok: true; ticketId: string; status: string; serial: number;
  winnerPlayerId: string; redeemedForPlayerId: string | null;
  targetTournamentId: string; targetEntryPriceVnd: string;
  targetBuyInVnd: string; targetFeeVnd: string;
};
type Player = { user_id: string; display_name: string | null };
const receiptSchema = z.object({
  ok:z.literal(true),status:z.enum(['redeemed','reversed']),ticketId:z.string().uuid(),
  winnerPlayerId:z.string().uuid(),redeemedForPlayerId:z.string().uuid(),
  registrationId:z.string().uuid(),entryId:z.string().uuid(),receiptId:z.string().uuid(),
  receiptCode:z.string().min(1),buyInVnd:z.string().regex(/^\d+$/),feeVnd:z.string().regex(/^\d+$/),
});
type Receipt = z.infer<typeof receiptSchema>;
function readReceipt(value:unknown):Receipt {
  const parsed=receiptSchema.safeParse(value);
  if(!parsed.success)throw new Error('Cannot verify the server receipt. Keep the request ID and reload the receipt before retrying.');
  return parsed.data;
}
const rpc = supabase.rpc.bind(supabase) as unknown as (name: string, args: Record<string, unknown>) =>
  Promise<{ data: unknown; error: { message: string } | null }>;
const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/** Cashier-only operational surface. The bearer code never enters a URL or log. */
export function SatelliteTicketRedeemPanel() {
  const {user,session}=useAuth();
  if(!user)return <Card className="p-4" role="alert">Sign in to verify or redeem a Satellite ticket.</Card>;
  return <ScopedSatelliteTicketRedeemPanel key={JSON.stringify([user.id,sessionReadEpoch(session)])}/>;
}

function ScopedSatelliteTicketRedeemPanel() {
  const [code, setCode] = useState("");
  const [verified, setVerified] = useState<Verified | null>(null);
  const [query, setQuery] = useState("");
  const [players, setPlayers] = useState<Player[]>([]);
  const [bearer, setBearer] = useState("");
  const [sourceEntry, setSourceEntry] = useState("");
  const [busted, setBusted] = useState<{ id: string; entry_no: number }[]>([]);
  const [requestId, setRequestId] = useState("");
  const [receiptRequestId, setReceiptRequestId] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const verificationGeneration=useRef(0);
  const alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;verificationGeneration.current+=1;};},[]);

  const verify = async () => {
    if (!isUuid(code) || busy) { setError("Enter the full private ticket code."); return; }
    const generation=++verificationGeneration.current;
    setBusy(true); setError(null); setVerified(null); setReceipt(null);
    try {
      const result = await rpc("satellite_verify_ticket_v1", { p_code: code });
      if(generation!==verificationGeneration.current)return;
      if (result.error) throw new Error(result.error.message);
      const value = result.data as Verified;
      if (value?.ok !== true || !value.ticketId) throw new Error("Incomplete ticket verification");
      setVerified(value);
    } catch (cause) { if(generation===verificationGeneration.current)setError(cause instanceof Error ? cause.message : "Verification failed"); }
    finally { if(alive.current)setBusy(false); }
  };
  const findPlayers = async () => {
    if (query.trim().length < 2) { setError("Search by at least two name characters."); return; }
    setBusy(true); setError(null);
    const { data, error: searchError } = await supabase.from("profiles")
      .select("user_id,display_name").ilike("display_name", `%${query.trim()}%`).limit(20);
    setBusy(false);
    if (searchError) setError(searchError.message);
    else setPlayers((data ?? []) as Player[]);
  };
  const chooseBearer = async (playerId: string) => {
    setBearer(playerId); setSourceEntry(""); setBusted([]);
    if (!verified) return;
    const { data, error: entryError } = await supabase.from("tournament_entries")
      .select("id,entry_no").eq("tournament_id", verified.targetTournamentId)
      .eq("player_id", playerId).eq("status", "busted")
      .order("entry_no", { ascending: false }).limit(10);
    if (entryError) setError(entryError.message);
    else setBusted((data ?? []) as { id: string; entry_no: number }[]);
  };
  const redeem = async () => {
    if (busy || !verified || verified.status !== "issued" || !bearer) return;
    const id = isUuid(requestId) ? requestId : globalThis.crypto.randomUUID();
    setRequestId(id); setBusy(true); setError(null);
    try {
      const result = await rpc("satellite_redeem_ticket_v1", {
        p_current_code: code, p_request_id: id,
        p_redeemed_for_player_id: bearer, p_source_entry_id: sourceEntry || null,
      });
      if(!alive.current)return;
      if (result.error) throw new Error(result.error.message);
      const loaded = await rpc("satellite_get_redemption_receipt_v1", { p_request_id: id });
      if(!alive.current)return;
      if (loaded.error) throw new Error(loaded.error.message);
      setReceipt(readReceipt(loaded.data)); setReceiptRequestId(id);
      setRequestId(globalThis.crypto.randomUUID()); setCode(""); setVerified(null);
    } catch (cause) { if(alive.current)setError(cause instanceof Error ? cause.message : "Redeem failed; reload the server receipt before retrying"); }
    finally { if(alive.current)setBusy(false); }
  };
  const reloadReceipt = async () => {
    const id = receiptRequestId || requestId;
    if (!isUuid(id) || busy) { setError("Enter a valid request ID."); return; }
    setBusy(true); setError(null);
    try {
      const result = await rpc("satellite_get_redemption_receipt_v1", { p_request_id: id });
      if(!alive.current)return;
      if (result.error) throw new Error(result.error.message);
      setReceipt(readReceipt(result.data));
      setReceiptRequestId(id);
      setRequestId(globalThis.crypto.randomUUID());
      setCode(""); setVerified(null); setBearer(""); setSourceEntry(""); setBusted([]);
    } catch(cause) {if(alive.current)setError(cause instanceof Error?cause.message:'Receipt recovery failed. Keep the request ID and retry receipt lookup.');}
    finally {if(alive.current)setBusy(false);}
  };

  return <Card className="space-y-3 p-4">
    <h2 className="font-semibold">Satellite ticket · Cashier</h2>
    <p className="text-xs text-muted-foreground">Verify the private code, select the actual bearer, then redeem. No cash is collected for this ticket.</p>
    <div className="space-y-1"><Label htmlFor="sat-ticket-code">Private ticket code</Label><Input id="sat-ticket-code" type="password" autoComplete="off" value={code} onChange={e => { verificationGeneration.current+=1; setCode(e.target.value); setVerified(null); setError(null); }} /></div>
    <Button variant="outline" disabled={busy} onClick={() => void verify()}>Verify ticket</Button>
    {verified && <div role="status" className="space-y-1 rounded border p-3 text-sm">
      <p>Ticket #{verified.serial} · {verified.status}</p>
      <p>Winner ID: {verified.winnerPlayerId}</p>
      <p>Target value: {verified.targetEntryPriceVnd} VND = {verified.targetBuyInVnd} buy-in + {verified.targetFeeVnd} fees</p>
      {verified.status !== "issued" && <p className="text-amber-500">This ticket cannot be redeemed again.</p>}
    </div>}
    {verified?.status === "issued" && <div className="space-y-3 border-t pt-3">
      <div className="space-y-1"><Label htmlFor="sat-bearer-query">Find actual bearer</Label><div className="flex gap-2"><Input id="sat-bearer-query" value={query} onChange={e => setQuery(e.target.value)} /><Button variant="outline" disabled={busy} onClick={() => void findPlayers()}>Search</Button></div></div>
      <Select value={bearer} onValueChange={value => void chooseBearer(value)}><SelectTrigger aria-label="Actual bearer"><SelectValue placeholder="Select actual bearer" /></SelectTrigger><SelectContent>{players.map(player => <SelectItem key={player.user_id} value={player.user_id}>{player.display_name ?? player.user_id} · {player.user_id}</SelectItem>)}</SelectContent></Select>
      {bearer && <p className="text-xs">Winner: {verified.winnerPlayerId} · Bearer: {bearer}. These may differ.</p>}
      {busted.length > 0 && <div className="space-y-1"><Label>Re-entry from busted entry (optional)</Label><Select value={sourceEntry || "initial"} onValueChange={value => setSourceEntry(value === "initial" ? "" : value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="initial">Initial registration</SelectItem>{busted.map(entry => <SelectItem key={entry.id} value={entry.id}>Busted entry #{entry.entry_no}</SelectItem>)}</SelectContent></Select></div>}
      <Button disabled={busy || !bearer} onClick={() => void redeem()}>Redeem for selected bearer</Button>
    </div>}
    <div className="space-y-1 border-t pt-3"><Label htmlFor="sat-redeem-request">Request ID · retained for retry until success</Label><div className="flex gap-2"><Input id="sat-redeem-request" value={requestId} onChange={e => setRequestId(e.target.value)} /><Button variant="outline" disabled={busy} onClick={() => void reloadReceipt()}>Reload receipt</Button></div><p className="text-xs text-muted-foreground">A new ID is generated after each completed redeem. Reload receipt uses the latest completed request.</p></div>
    {receipt && <div role="status" className="rounded border p-3 text-sm"><p>Server receipt · {receipt.status ?? "redeemed"}</p><p>Winner: {receipt.winnerPlayerId} · Bearer: {receipt.redeemedForPlayerId}</p><p>Registration: {receipt.registrationId}</p><p>Entry: {receipt.entryId} · Seat receipt: {receipt.receiptId}</p><p>Receipt code: {receipt.receiptCode}</p><p>{receipt.buyInVnd} VND buy-in + {receipt.feeVnd} VND fees · no new cash collected</p></div>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </Card>;
}
