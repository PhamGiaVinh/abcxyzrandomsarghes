// Local Vite/Playwright fixture only; not an application entry or production route.
import React from "react";
import { createRoot } from "react-dom/client";
import "../../src/index.css";
import "../../src/i18n";
import { ClockPanel } from "../../src/components/cashier/tournament-live/ClockPanel";
import { AuthProvider } from "../../src/hooks/useAuth";
import { PrizesPanel } from "../../src/components/cashier/tournament-live/viewer-hub/PrizesPanel";
import { VinPokerTournamentClock } from "../../src/components/tournament-clock/VinPokerTournamentClock";
import { TrackerReadOnlyRoster } from "../../src/components/cashier/tournament-live/handinput/unified/TrackerReadOnlyRoster";
import { DashboardTab } from "../../src/components/chip-ops/DashboardTab";
import { FloorTableModePicker } from "../../src/components/ops/shared/FloorTableModePicker";
import { FloorSeatRoster } from "../../src/components/ops/shared/FloorSeatRoster";
import { FloorEntryPicker, type FloorEntrySelection } from "../../src/components/ops/shared/FloorEntryPicker";
import { Button } from "../../src/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../../src/components/ui/sheet";
import { PlayerActionSheet } from "../../src/components/cashier/tournament-live/PlayerActionSheet";
import { MediaClubSchedules } from "../../src/components/admin/MediaClubSchedules";
import { Toaster } from "sonner";

function PlayerActionFixture() {
  const [open, setOpen] = React.useState(true);
  const [moved, setMoved] = React.useState(false);
  return <main><p>{moved ? 'Move intent TEST received' : 'Local player actions TEST'}</p>
    <PlayerActionSheet open={open} onOpenChange={setOpen} entryId="entry-test" canMove busting={false}
      seat={{seat_id:'seat-test',player_id:'player-test',player_name:'Player TEST',entry_number:1,
        table_id:'table-test',table_name:'Table TEST',seat_number:1,chip_count:20000}}
      onMove={() => setMoved(true)} onBust={() => {}} />
  </main>;
}

const FLOOR_SEATABLE = [
  { entryId: "entry-a", playerId: "player-a", entryNo: 1, displayName: "Nguyễn Văn Tên Rất Dài Tại Bàn Final", currentStack: 30_000_000, registrationId: "reg-a" },
  { entryId: "entry-b", playerId: "player-b", entryNo: 27, displayName: "Tom Dwan", currentStack: 15_000, registrationId: "reg-b" },
];
const FLOOR_RESTORABLE = [
  { entryId: "entry-c", playerId: "player-c", entryNo: 3, displayName: "Phil Ivey", currentStack: 0 },
];

function FloorMobileFixture() {
  const [open, setOpen] = React.useState(true);
  const [selection, setSelection] = React.useState<FloorEntrySelection | null>(null);
  return (
    <main className="operations-typography min-h-screen bg-background p-4 text-foreground">
      <p className="text-sm text-muted-foreground">LOCAL TEST · Floor mobile · Không kết nối production</p>
      <Button className="mt-4 min-h-12" onClick={() => setOpen(true)}>Mở danh sách Bàn 2</Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          closeLabel="Đóng danh sách bàn"
          className="operations-typography h-[100dvh] w-full overflow-y-auto overscroll-contain pl-[max(1rem,calc(env(safe-area-inset-left)+0.5rem))] pr-[max(1rem,calc(env(safe-area-inset-right)+0.5rem))] pt-[max(1.5rem,calc(env(safe-area-inset-top)+0.75rem))] pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:max-w-xl sm:p-6"
        >
          <SheetHeader className="pr-14 text-left">
            <SheetTitle>Bàn 2 · 2/9</SheetTitle>
            <p className="text-xs text-muted-foreground">Manual Floor · Ghế 3 đang trống</p>
          </SheetHeader>
          <div className="mt-5 space-y-4">
            <FloorSeatRoster
              seats={[
                { seatNumber: 1, playerName: "CODEX_FLOOR_UAT_PLAYER_WITH_A_VERY_LONG_NAME", chipsLabel: "30.000.000", entryNumber: 1 },
                { seatNumber: 2, playerName: "Phil Ivey", chipsLabel: "0", entryNumber: 3 },
              ]}
            />
            <section className="space-y-3 rounded-xl border border-border bg-card/55 p-3">
              <h2 className="text-sm font-semibold">Thêm người vào Ghế 3</h2>
              <FloorEntryPicker seatableEntries={FLOOR_SEATABLE} restorableEntries={FLOOR_RESTORABLE} value={selection} onChange={setSelection} />
              <Button className="min-h-12 w-full" disabled={!selection}>{selection?.kind === "restore" ? "Khôi phục vào ghế này" : "Thêm vào ghế này"}</Button>
            </section>
          </div>
        </SheetContent>
      </Sheet>
    </main>
  );
}

function Fixture() {
  const [mode, setMode] = React.useState<"manual" | "tracker">("manual");
  const surface = new URLSearchParams(location.search).get("surface");
  if (surface === "schedule-upload") return <main className="mx-auto max-w-5xl p-4"><MediaClubSchedules /><Toaster /></main>;
  if (surface === "player-actions") return <PlayerActionFixture />;
  if (surface === "floor") return <FloorMobileFixture />;
  if (surface === "clock") return <VinPokerTournamentClock data={{
    title: "Giải vô địch câu lạc bộ · FINAL TABLE", players: 9, entries: 199, reEntries: 99,
    prizePool: "420.000.000 VND", totalChips: "98.765.432", averageStack: "10.973.937",
    levelLabel: "Level 20", secondsLeft: 1200, nextBreakSecondsLeft: 3600,
    currentLevel: "500.000 / 1.000.000 / 1.000.000", nextLevel: "1.000.000 / 2.000.000 / 2.000.000",
    payouts: [{ rank: "1st", amount: "250.000.000 VND" }], footerNote: "Kết thúc đăng ký tại Level 8",
  }} />;
  if (surface === "panels") return <main className="operations-typography mx-auto max-w-5xl space-y-6 p-4">
    <p>LOCAL TEST · Đồng hồ / Payout / Tracker</p>
    <AuthProvider><ClockPanel tournamentId="responsive-test" /></AuthProvider>
    <PrizesPanel tournamentId="responsive-test" />
    <TrackerReadOnlyRoster roster={[{ seat_id: "seat-test", entry_id: "entry-test", player_id: "player-test", entry_number: 999999, seat_number: 1, seat_stack: 987654321000, tracker_stack: 987654321000, entry_stack: 987654321000, display_name: "Nguyễn_Văn_Tên_Rất_Dài_".repeat(5), avatar_url: null }]} />
  </main>;
  return <main className="operations-typography mx-auto max-w-5xl space-y-6 p-4">
    <p className="text-sm text-muted-foreground">LOCAL TEST · Dữ liệu giả lập · Không kết nối production</p>
    <h1 className="text-xl">Chip Master · Kiểm tra hiển thị</h1>
    <DashboardTab tournamentId="responsive-test" inv={{ total_value: 0, reconciled: false, denominations: [] }} denoms={[]} />
    <section style={{ maxWidth: 320 }} aria-label="Panel hẹp trên desktop">
      <h2 className="mb-3 text-lg">Loại bàn</h2>
      <FloorTableModePicker value={mode} onChange={setMode} />
    </section>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
