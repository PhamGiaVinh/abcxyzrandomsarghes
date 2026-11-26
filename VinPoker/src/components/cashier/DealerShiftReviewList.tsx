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
    </div>}
  </section>;
}
