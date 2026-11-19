import { useState, type FormEvent } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";

const createdTable = z.object({ tableId: z.string().uuid() });
const createdPair = z.object({ tableIds: z.tuple([z.string().uuid(), z.string().uuid()]) })
  .refine(({ tableIds }) => tableIds[0] !== tableIds[1]);
const blindFields = [
  ["starts_at_second", "Mốc bắt đầu (giây)"],
  ["small_blind", "Small blind"],
  ["big_blind", "Big blind"],
  ["big_blind_ante", "Big blind ante"],
] as const;

export default function SatelliteBlindSchedule({ pilotId, onCreated }: {
  pilotId: string;
  onCreated: () => void;
}) {
  const client = useSupabaseClient();
  const [levelCount, setLevelCount] = useState(1);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (sending) return;
    const form = new FormData(event.currentTarget);
    const slots = Number(form.get("qualificationSlots"));
    const twoTables = form.get("twoTables") === "on";
    const levels = Array.from({ length: levelCount }, (_, index) =>
      Object.fromEntries(blindFields.map(([field]) => [field, Number(form.get(`${field}-${index}`))])));
    if (!Number.isInteger(slots) || slots < 1 || slots > 9
      || levels.some((level, index) => Object.values(level).some(value => !Number.isSafeInteger(value) || value < 0)
      || level.small_blind < 1 || level.big_blind <= level.small_blind
      || (index > 0 && level.starts_at_second <= levels[index - 1].starts_at_second))) {
      setMessage("Nhập số suất TEST, blind hợp lệ và mốc bắt đầu tăng dần.");
      return;
    }
    setSending(true);
    setMessage(null);
    try {
      const command = twoTables ? "provision_online_satellite_two_tables_v1" : "provision_online_satellite_table_v1";
      const { data, error } = await client.rpc(command as never, {
        p_pilot_id: pilotId,
        p_levels: levels,
        p_qualification_slots: slots,
      } as never);
      if (error) throw error;
      if (twoTables) createdPair.parse(data);
      else createdTable.parse(data);
      onCreated();
    } catch {
      setMessage("Chưa xác nhận được việc tạo bàn. Kiểm tra số người đã đăng ký và thử lại với cùng lịch blind.");
    } finally {
      setSending(false);
    }
  };

  return <form className="space-y-4" onSubmit={submit}>
    <h2 className="text-lg font-semibold">Lịch blind</h2>
    <label className="block space-y-1 text-sm">
      <span>Số suất TEST</span>
      <Input name="qualificationSlots" type="number" inputMode="numeric" min="1" max="9" step="1"
        defaultValue={1} required disabled={sending} />
    </label>
    <label className="flex items-center gap-2 text-sm">
      <input name="twoTables" type="checkbox" disabled={sending} />
      Tạo hai bàn TEST (tối thiểu 4 người)
    </label>
    {Array.from({ length: levelCount }, (_, index) => (
      <fieldset key={index} disabled={sending} className="grid grid-cols-2 gap-3 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">Level {index + 1}</legend>
        {blindFields.map(([field, label]) => (
          <label key={field} className="min-w-0 space-y-1 text-sm">
            <span>{label}</span>
            <Input type="number" inputMode="numeric" min="0" step="1" required
              name={`${field}-${index}`}
              defaultValue={field === "big_blind_ante" || (field === "starts_at_second" && index === 0) ? 0 : undefined}
              readOnly={field === "starts_at_second" && index === 0} />
          </label>
        ))}
      </fieldset>
    ))}
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" disabled={sending} onClick={() => setLevelCount(count => count + 1)}>
        Thêm level
      </Button>
      {levelCount > 1 && <Button type="button" variant="ghost" disabled={sending}
        onClick={() => setLevelCount(count => count - 1)}>Bỏ level cuối</Button>}
      <Button type="submit" disabled={sending}>{sending ? "Đang tạo bàn…" : "Tạo bàn và khóa lịch"}</Button>
    </div>
    {message && <p role="alert">{message}</p>}
  </form>;
}
