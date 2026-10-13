import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { issuanceArgs, readIssuanceIntent, readIssuanceState, settleIssuanceIntent, validIssuanceCount, validateIssuanceReceipt, type IssuanceIntent, type IssuanceScope } from "@/lib/chipIssuanceIntent";
import { waitForManualPlayerResponse } from "@/lib/floorManualPlayerIntent";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
type Props = { actorId: string | null; clubId: string | null; tournamentId: string;
  templates: { id: string; name: string; issued_count: number }[]; coupling: boolean; opsStarted: boolean;
  busy: boolean; setBusy: (value: boolean) => void; reload: () => void };
async function request(name: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await waitForManualPlayerResponse<{ data: unknown; error: unknown }>((supabase as any).rpc(name, args));
  if (error) throw Error("ISSUANCE_TRANSPORT_UNVERIFIED");
  return data;
}
export function IssuanceCard(props: Props) {
  if (!props.actorId || !props.clubId) return <p role="alert">Chưa xác minh được tài khoản và CLB để phát chip.</p>;
  return <ScopedIssuanceCard key={JSON.stringify([props.actorId, props.clubId, props.tournamentId])} {...props} actorId={props.actorId} clubId={props.clubId} />;
}
function ScopedIssuanceCard({ actorId, clubId, tournamentId, templates, coupling, opsStarted, busy, setBusy, reload }: Props & { actorId: string; clubId: string }) {
  const [states, setStates] = useState<Record<string, { count: number; revision: number }>>({});
  const [intents, setIntents] = useState<Record<string, IssuanceIntent>>({});
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [generation, setGeneration] = useState(0);
  const active = useRef(false), alive = useRef(false);
  const templateIds = JSON.stringify(templates.map(t => t.id));
  const scope = (templateId: string): IssuanceScope => ({ actorId, clubId, tournamentId, templateId });
  const journalKey = (id: string) => `vinpoker:issuance-pending:${JSON.stringify([actorId, clubId, tournamentId, id])}`;
  useEffect(() => { alive.current = true; return () => { alive.current = false; if (active.current) setBusy(false); }; }, [setBusy]);
  useEffect(() => {
    let disposed = false;
    setStates({}); setLoadError(null);
    const ids = JSON.parse(templateIds) as string[];
    try {
      const saved: Record<string, IssuanceIntent> = {};
      for (const id of ids) {
        const raw = sessionStorage.getItem(journalKey(id));
        if (raw !== null) { const i = readIssuanceIntent(raw, scope(id)); if (!i.resolved) saved[id] = i; }
      }
      setIntents(saved); setBlocked(false);
    } catch { setBlocked(true); setError("Không xác minh được yêu cầu đã lưu. Chưa gửi thao tác mới."); return; }
    void Promise.all(ids.map(async id => {
      const data = await request("get_chip_issuance_state_v1", { p_stack_template_id: id, p_expected_actor: actorId });
      return [id, readIssuanceState(data, scope(id))] as const;
    })).then(rows => { if (!disposed) setStates(Object.fromEntries(rows)); })
      .catch(() => { if (!disposed) setLoadError("Không tải được số bộ từ server. Hãy đọc lại trước khi thao tác."); });
    return () => { disposed = true; };
  }, [actorId, clubId, tournamentId, templateIds, generation]);
  function finish(i: IssuanceIntent, receipt: unknown) {
    const proof = validateIssuanceReceipt(i, receipt);
    if (proof.status === "unknown") { setError("Chưa xác minh được kết quả. Giữ nguyên mã để đối chiếu; không tạo yêu cầu mới."); return; }
    settleIssuanceIntent(sessionStorage, journalKey(i.templateId), i);
    setIntents(old => { const next = { ...old }; delete next[i.templateId]; return next; });
    setValues(old => { const next = { ...old }; delete next[i.templateId]; return next; });
    if (proof.status === "rejected") setError(({ STALE_STATE: "Số bộ đã thay đổi. Hãy đọc lại trước khi xác nhận mới.", INVENTORY_NEGATIVE: "Thao tác này làm tồn chip âm. Kiểm tra phát/thu và color-up trước khi tiếp tục.", IDEMPOTENCY_CONFLICT: "Mã yêu cầu đã dùng cho dữ liệu khác. Cần đối chiếu, chưa gửi thao tác mới." } as Record<string, string>)[proof.error] ?? "Server đã từ chối yêu cầu. Hãy kiểm tra số bộ và quyền thao tác.");
    else toast.success(proof.coupled ? "Đã xác minh phát/thu chip và kho két." : "Đã xác minh số bộ phát.");
    setGeneration(g => g + 1); reload(); // Always read current state; old receipt is not current inventory.
  }
  async function run(templateId: string, reconcile: boolean) {
    if (active.current || busy || blocked) return;
    const prior = intents[templateId], state = states[templateId];
    if (reconcile && !prior) return;
    const count = Number(values[templateId] ?? state?.count);
    if (!prior && (!state || values[templateId]?.trim() === "" || !validIssuanceCount(count))) { setError("Nhập số bộ nguyên hợp lệ ≥ 0 sau khi server đã xác minh."); return; }
    const i = prior ?? { ...scope(templateId), count, revision: state.revision, requestId: crypto.randomUUID() };
    try {
      const raw = sessionStorage.getItem(journalKey(templateId));
      if (raw !== null) {
        const current = readIssuanceIntent(raw, scope(templateId));
        if (prior ? current.resolved || JSON.stringify(current) !== JSON.stringify(i)
          : !current.resolved) throw Error("ISSUANCE_JOURNAL_CHANGED");
      }
      const serialized = JSON.stringify(i);
      sessionStorage.setItem(journalKey(templateId), serialized);
      if (sessionStorage.getItem(journalKey(templateId)) !== serialized) throw Error("ISSUANCE_JOURNAL_WRITE_FAILED");
    } catch { setBlocked(true); setError("Không lưu được yêu cầu an toàn. Chưa gửi thao tác; cần đọc lại yêu cầu đã lưu."); return; }
    setIntents(old => ({ ...old, [templateId]: i }));
    active.current = true; setBusy(true); setError(null);
    try {
      const result = await request(reconcile ? "get_chip_issuance_receipt_v1" : "chip_ops_set_issuance_v2", issuanceArgs(i));
      if (!alive.current) return;
      if (reconcile) {
        const envelope = result as { status?: string; result?: unknown } | null;
        if (envelope?.status !== "committed") { setError("Chưa tìm thấy receipt đã chốt. Giữ nguyên mã; chưa kết luận thất bại."); return; }
        finish(i, envelope.result);
      } else finish(i, result);
    } catch { if (alive.current) setError("Chưa biết server đã chốt hay chưa. Đối chiếu hoặc gửi lại nguyên yêu cầu; không tạo mã mới."); }
    finally { active.current = false; if (alive.current) setBusy(false); }
  }
  return <Card className="border-border"><CardHeader className="pb-3"><CardTitle className="text-base text-foreground">
    {coupling ? "3. Phát / thu stack (tự động trừ két)" : "3. Số bộ đã phát"}
  </CardTitle></CardHeader><CardContent className="space-y-3">
    {opsStarted && <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /><div>Giải đã phát sinh giao dịch chip. Sửa số bộ phát sẽ thay đổi tồn hiện tại — chỉ sửa khi thật sự phát/thu thêm.</div>
    </div>}
    {(error || loadError) && <p role="alert" className="text-sm text-destructive">{error || loadError}</p>}
    <Button variant="outline" disabled={busy} onClick={() => { setError(null); setGeneration(g => g + 1); }}>Đọc lại trạng thái và yêu cầu</Button>
    <Table><TableHeader><TableRow><TableHead>Mẫu stack</TableHead><TableHead>Số bộ</TableHead><TableHead>Thao tác</TableHead></TableRow></TableHeader><TableBody>
      {templates.map(t => { const pending = intents[t.id], state = states[t.id];
        const delta = Number(values[t.id] ?? state?.count) - (state?.count ?? 0);
        return <TableRow key={t.id}><TableCell>{t.name}</TableCell><TableCell>
          <Input aria-label={`Số bộ ${t.name}`} type="number" inputMode="numeric" min={0} step={1} value={pending ? String(pending.count) : values[t.id] ?? String(state?.count ?? t.issued_count)}
            disabled={busy || blocked || !!pending || !state} onChange={e => setValues(old => ({ ...old, [t.id]: e.target.value }))} />
          {!state && <span role="status">Chưa xác minh trạng thái server</span>}
          {coupling && state && !pending && Number.isSafeInteger(delta) && delta !== 0 && <p className="text-xs text-warning">{delta > 0 ? `+${delta} bộ → xuất chip khỏi két` : `${delta} bộ → thu chip về két`}</p>}
        </TableCell><TableCell>
          {pending && <Button variant="outline" disabled={busy || blocked} onClick={() => void run(t.id, true)}>Đối chiếu {t.name}</Button>}
          <Button disabled={busy || blocked || (!pending && !state)} onClick={() => void run(t.id, false)}>{pending ? `Gửi lại nguyên yêu cầu ${t.name}` : `Lưu ${t.name}`}</Button>
        </TableCell></TableRow>;
      })}
    </TableBody></Table>
  </CardContent></Card>;
}
