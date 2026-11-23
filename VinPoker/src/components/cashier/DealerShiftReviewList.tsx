import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

const reviewRows = z.array(z.object({
  attendance_id: z.string().uuid(), dealer_id: z.string().uuid(), dealer_name: z.string(),
  shift_date: z.string(), checked_in_at: z.string().nullable(), checked_out_at: z.string().nullable(),
  table_name: z.string().nullable(), reason: z.string().nullable(),
}));

function time(value: string | null) {
  return value ? new Date(value).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) : "Chưa xác định";
}

const correctionRows = z.array(z.object({
  id: z.string().uuid(), dealer_name: z.string(), shift_date: z.string(),
  original_check_in: z.string().nullable(), original_check_out: z.string().nullable(),
  proposed_check_in: z.string(), proposed_check_out: z.string(),
  reason: z.string(), status: z.enum(["pending", "approved", "rejected"]),
  decision_reason: z.string().nullable(), can_decide: z.boolean(),
}));
const correctionLabels = { pending: "Chờ duyệt", approved: "Đã duyệt", rejected: "Đã trả lại" };

function CorrectionQueue({ club, from, to }: { club: string; from: string; to: string }) {
  const [rows, setRows] = useState<z.infer<typeof correctionRows> | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const response = await supabase.rpc("list_dealer_shift_payroll_corrections_v1" as never,
      { p_club: club, p_from: from, p_to: to } as never);
    if (response.error) throw response.error;
    setRows(correctionRows.parse(response.data));
  }

  async function refresh() {
    setBusy(true);
    setError("");
    try { await load(); }
    catch { setError("Chưa tải được đề nghị sửa công."); }
    finally { setBusy(false); }
  }

  async function decide(approve: boolean) {
    if (!selected || reason.trim().length < 3 || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await supabase.rpc("decide_dealer_shift_payroll_correction_v1" as never, {
        p_club: club, p_correction: selected, p_approve: approve, p_reason: reason.trim(),
      } as never);
      if (response.error) throw response.error;
      setSelected(null);
      setReason("");
      await load();
    } catch {
      setError("Chưa xác minh được quyết định. Tải lại danh sách để kiểm tra trạng thái.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="space-y-2">
    <Button variant="outline" disabled={busy} onClick={() => void refresh()}>
      {rows ? "Tải lại đề nghị" : "Xem đề nghị sửa công"}
    </Button>
    {busy && <p role="status">Đang xử lý…</p>}
    {error && <p role="alert">{error}</p>}
    {rows?.length === 0 && <p>Không có đề nghị sửa công trong kỳ.</p>}
    {rows?.map(row => <article key={row.id} className="space-y-2 rounded border p-3 text-sm">
      <p><strong>{row.dealer_name}</strong> · {row.shift_date} · {correctionLabels[row.status]}</p>
      <p>Giờ gốc: {time(row.original_check_in)} – {time(row.original_check_out)}</p>
      <p>Giờ đề nghị: {time(row.proposed_check_in)} – {time(row.proposed_check_out)}</p>
      <p>Căn cứ: {row.reason}</p>
      {row.decision_reason && <p>Lý do quyết định: {row.decision_reason}</p>}
      {row.can_decide && (selected === row.id ? <div className="space-y-2">
        <label className="block">Lý do quyết định
          <textarea className="block w-full rounded border bg-background p-2" maxLength={1000}
            value={reason} disabled={busy} onChange={event => setReason(event.target.value)} />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy || reason.trim().length < 3} onClick={() => void decide(true)}>Duyệt</Button>
          <Button variant="outline" disabled={busy || reason.trim().length < 3} onClick={() => void decide(false)}>Trả lại</Button>
          <Button variant="ghost" disabled={busy} onClick={() => setSelected(null)}>Hủy</Button>
        </div>
      </div> : <Button variant="outline" disabled={busy} onClick={() => { setSelected(row.id); setReason(""); }}>Xem xét đề nghị</Button>)}
    </article>)}
  </div>;
}

export function DealerShiftReviewList({ club, from, to }: { club: string; from: string; to: string }) {
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState(0);
  const [rows, setRows] = useState<z.infer<typeof reviewRows> | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!open) return;
    let current = true;
    async function load() {
      setRows(null);
      setError(false);
      try {
        const response = await supabase.rpc("list_dealer_shift_payroll_reviews_v1" as never,
          { p_club: club, p_from: from, p_to: to } as never);
        if (response.error) throw response.error;
        const parsed = reviewRows.parse(response.data);
        if (current) setRows(parsed);
      } catch {
        if (current) setError(true);
      }
    }
    void load();
    return () => { current = false; };
  }, [club, from, to, open, version]);

  return <section>
    <Button variant="outline" aria-expanded={open} onClick={() => setOpen(!open)}>Đối chiếu công từ Swing</Button>
    {open && <div className="mt-2 space-y-2">
      {error ? <p role="alert">Chưa đọc được ca cần đối chiếu. <Button variant="outline" onClick={() => setVersion(version + 1)}>Tải lại</Button></p>
        : rows === null ? <p role="status">Đang đọc công trong kỳ…</p>
        : rows.length === 0 ? <p>Không có ca đã đóng cần đối chiếu trong kỳ này.</p>
        : <ul className="space-y-2">{rows.map(row => <li key={row.attendance_id} className="rounded border p-3 text-sm">
            <strong>{row.dealer_name}</strong> · {row.shift_date} {row.table_name && <>· {row.table_name}</>}
            <p>Giờ vào: {time(row.checked_in_at)} · Giờ ra: {time(row.checked_out_at)}</p>
            {row.reason && <p>Lý do xử lý ca: {row.reason}</p>}
          </li>)}</ul>}
      <CorrectionQueue key={JSON.stringify([club, from, to])} club={club} from={from} to={to} />
    </div>}
  </section>;
}
