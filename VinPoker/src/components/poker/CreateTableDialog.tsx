// src/components/poker/CreateTableDialog.tsx
// Friends-practice: create an OPEN table. You set the blinds + your own starting
// chips and become the host (seated at seat 1). Others join freely and self-set
// their chips. op_create_open_table re-validates everything (chips/blinds STRINGS).

import { useRef, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2 } from 'lucide-react';

const MAX_CHIPS = 1_000_000_000;
const onlyDigits = (s: string) => s.replace(/[^0-9]/g, '');

export function CreateTableDialog({
  open, onOpenChange, onCreate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** create the table; returns once the host is seated (caller navigates on success) */
  onCreate: (args: { name: string; sb: string; bb: string; buyin: string; maxSeats: number }) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [sb, setSb] = useState('25');
  const [bb, setBb] = useState('50');
  const [buyin, setBuyin] = useState('5000');
  const [maxSeats, setMaxSeats] = useState(9);
  const [busy, setBusy] = useState(false);
  const creating = useRef(false);

  const sbN = Math.floor(Number(sb)), bbN = Math.floor(Number(bb)), buyinN = Math.floor(Number(buyin));
  const blindsOk = sbN >= 1 && bbN > sbN && bbN <= MAX_CHIPS;
  const buyinOk = buyinN >= 1 && buyinN <= MAX_CHIPS;
  const valid = blindsOk && buyinOk;

  const create = async () => {
    if (!valid || creating.current) return;
    creating.current = true;
    setBusy(true);
    try { await onCreate({ name: name.trim(), sb: String(sbN), bb: String(bbN), buyin: String(buyinN), maxSeats }); }
    finally { creating.current = false; setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!creating.current) onOpenChange(v); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Tạo bàn mới</DialogTitle>
          <DialogDescription>Bạn đặt blind + số chip, và là chủ bàn. Bạn bè vào ghế trống để chơi.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-sm font-medium">Tên bàn</label>
            <Input value={name} maxLength={40} placeholder="Bàn của bạn" onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">Small blind</label>
              <Input inputMode="numeric" value={sb} onChange={(e) => setSb(onlyDigits(e.target.value))} className="tabular-nums" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Big blind</label>
              <Input inputMode="numeric" value={bb} onChange={(e) => setBb(onlyDigits(e.target.value))} className="tabular-nums" />
            </div>
          </div>
          {!blindsOk && <p className="text-[11px] text-destructive">Big blind phải lớn hơn small blind.</p>}

          <div className="space-y-1">
            <label className="text-sm font-medium">Chip của bạn (mang vào)</label>
            <Input inputMode="numeric" value={buyin} onChange={(e) => setBuyin(onlyDigits(e.target.value))} className="tabular-nums text-lg font-bold" />
            {buyinOk && bbN > 0 && <p className="text-[11px] text-muted-foreground tabular-nums">≈ {Math.round(buyinN / bbN)} BB</p>}
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Số ghế tối đa</label>
            <div className="flex gap-1.5">
              {[2, 6, 9].map((x) => (
                <button
                  key={x}
                  type="button"
                  onClick={() => setMaxSeats(x)}
                  className={`flex-1 rounded-md border px-2 py-1.5 text-sm ${maxSeats === x ? 'border-primary bg-primary/15 text-primary' : 'border-border hover:border-primary/60'}`}
                >
                  {x} ghế
                </button>
              ))}
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground">Chip ảo để đấu tập — không phải tiền thật.</p>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Hủy</Button>
          <Button onClick={create} disabled={busy || !valid}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Tạo & ngồi vào'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
