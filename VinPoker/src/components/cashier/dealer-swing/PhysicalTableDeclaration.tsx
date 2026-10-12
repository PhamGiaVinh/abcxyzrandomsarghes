import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { createFloorTableControlV3Client } from "@/lib/floorTableControlV3";

type Props = {
  actorId: string; clubId: string; clubName: string;
  declareAsset: ReturnType<typeof createFloorTableControlV3Client>["declarePhysicalTable"];
  onDeclared: () => void;
};
type Intent = { actorId: string; clubId: string; tableNumber: number; requestId: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const rejected: Record<string, string> = {
  unauthorized: "denied", actor_not_allowed: "denied", invalid_request: "invalidRequest",
  ACTOR_CHANGED: "actorChanged",
  invalid_table_number: "invalidNumber", club_not_found: "clubMissing", table_number_taken: "taken",
  IDEMPOTENCY_CONFLICT: "conflict", PHYSICAL_ASSET_RPC_UNAVAILABLE: "unavailable",
  FLOOR_TABLE_CONTROL_V3_DISABLED: "unavailable",
};

export function PhysicalTableDeclaration(props: Props) {
  const [generation, setGeneration] = useState(0);
  return <ScopedDeclaration key={JSON.stringify([props.actorId, props.clubId, generation])}
    {...props} onReread={() => setGeneration(value => value + 1)} />;
}

function ScopedDeclaration({ actorId, clubId, clubName, declareAsset, onDeclared, onReread }: Props & { onReread: () => void }) {
  const { t } = useTranslation();
  const storageKey = `vinpoker:physical-asset-pending:${JSON.stringify([actorId, clubId])}`;
  const [saved] = useState<{ intent: Intent | null; error: boolean }>(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw === null) return { intent: null, error: false };
      const value = JSON.parse(raw);
      if (!value || Array.isArray(value) || Object.keys(value).sort().join() !== "actorId,clubId,requestId,tableNumber"
        || value.actorId !== actorId || value.clubId !== clubId || !Number.isInteger(value.tableNumber)
        || value.tableNumber < 1 || value.tableNumber > 100 || typeof value.requestId !== "string"
        || !uuid.test(value.requestId)) throw new Error("invalid_intent");
      return { intent: value, error: false };
    } catch { return { intent: null, error: true }; }
  });
  const [pending, setPending] = useState<Intent | null>(saved.intent);
  const [journalError, setJournalError] = useState(saved.error);
  const [number, setNumber] = useState(saved.intent ? String(saved.intent.tableNumber) : "");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState<number | null>(null);
  const writing = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const clearIntent = () => {
    try {
      sessionStorage.removeItem(storageKey);
      if (sessionStorage.getItem(storageKey) !== null) throw new Error("intent_not_cleared");
      setPending(null);
      return true;
    } catch { setJournalError(true); return false; }
  };
  const submit = async () => {
    if (writing.current || journalError) return;
    const tableNumber = Number(number);
    if (!pending && (!/^\d{1,3}$/.test(number) || tableNumber < 1 || tableNumber > 100)) {
      setMessage(t("physicalTableDeclaration.errors.invalidNumber")); return;
    }
    const intent = pending ?? { actorId, clubId, tableNumber, requestId: crypto.randomUUID() };
    try {
      const serialized = JSON.stringify(intent);
      sessionStorage.setItem(storageKey, serialized);
      if (sessionStorage.getItem(storageKey) !== serialized) throw new Error("intent_not_saved");
    } catch { setJournalError(true); return; }
    setPending(intent); setMessage(null); setSuccess(null);
    writing.current = true; setBusy(true);
    let completed = false;
    try {
      const result = await declareAsset({ actorId: intent.actorId, clubId: intent.clubId, tableNumber: intent.tableNumber, requestId: intent.requestId });
      if (!alive.current) return;
      if (result.ok === false) {
        const code = rejected[result.error];
        if (code) {
          // Authorization/schema rejection can occur after an earlier commit.
          // Only these server paths prove the exact authorized key has no receipt.
          if (result.error === "table_number_taken" || result.error === "club_not_found") clearIntent();
          setMessage(t(`physicalTableDeclaration.errors.${code}`));
        }
        else setMessage(t("physicalTableDeclaration.unknown"));
      } else if (clearIntent()) {
        setSuccess(intent.tableNumber); setNumber(""); completed = true;
      }
    } catch {
      if (alive.current) setMessage(t("physicalTableDeclaration.unknown"));
    } finally {
      writing.current = false;
      if (alive.current) setBusy(false);
    }
    if (completed && alive.current) {
      try { onDeclared(); } catch { setMessage(t("physicalTableDeclaration.refreshFailed")); }
    }
  };

  return <>
    <Button size="sm" variant="outline" onClick={() => setOpen(true)}>{t("physicalTableDeclaration.action")}</Button>
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("physicalTableDeclaration.title")}</DialogTitle>
          <DialogDescription>{clubName} · {t("physicalTableDeclaration.description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Label htmlFor="physical-table-number">{t("physicalTableDeclaration.number")}</Label>
          <Input id="physical-table-number" type="number" inputMode="numeric" min={1} max={100}
            value={number} onChange={event => setNumber(event.target.value)} disabled={busy || !!pending || journalError} />
          {pending && <p role="status" className="text-sm text-muted-foreground">{t("physicalTableDeclaration.pending", { number: pending.tableNumber })}</p>}
          {success !== null && <p role="status" className="text-sm">{t("physicalTableDeclaration.success", { number: success })}</p>}
          {journalError ? <div role="alert" className="space-y-2 text-sm text-destructive">
            <p>{t("physicalTableDeclaration.journalError")}</p>
            <Button variant="outline" onClick={onReread} disabled={busy}>{t("physicalTableDeclaration.readJournal")}</Button>
          </div> : message && <p role="alert" className="text-sm text-destructive">{message}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>{t("physicalTableDeclaration.close")}</Button>
          <Button disabled={busy || journalError || (!pending && !number)} onClick={() => void submit()}>
            {t(busy ? "physicalTableDeclaration.busy" : pending ? "physicalTableDeclaration.retry" : "physicalTableDeclaration.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
