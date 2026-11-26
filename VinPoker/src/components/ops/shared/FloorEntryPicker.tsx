import { useEffect, useMemo, useState } from "react";
import { RotateCcw, Search, UserRoundPlus } from "lucide-react";
import type { FloorRestorableEntry, FloorSeatableEntry } from "@/lib/floorTableControlV3";
import { formatStack } from "@/lib/format";
import { cn } from "@/lib/utils";

export type FloorEntrySelection =
  | { kind: "seat"; entryId: string }
  | { kind: "restore"; entryId: string };

type PickerGroup = FloorEntrySelection["kind"];

export function FloorEntryPicker({
  seatableEntries,
  restorableEntries,
  value,
  onChange,
  availability,
  onRetry,
}: {
  seatableEntries: readonly FloorSeatableEntry[];
  restorableEntries: readonly FloorRestorableEntry[];
  value: FloorEntrySelection | null;
  onChange: (value: FloorEntrySelection | null) => void;
  availability?: Record<PickerGroup, "ready" | "loading" | "failed">;
  onRetry?: () => void;
}) {
  const [group, setGroup] = useState<PickerGroup>(value?.kind ?? "seat");
  const [query, setQuery] = useState("");
  const status = availability?.[group] ?? "ready";

  useEffect(() => {
    if (value) setGroup(value.kind);
  }, [value]);

  const rows = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("vi");
    const source = group === "seat" ? seatableEntries : restorableEntries;
    return source.filter((entry) => {
      if (!normalizedQuery) return true;
      return entry.displayName.toLocaleLowerCase("vi").includes(normalizedQuery)
        || String(entry.entryNo).includes(normalizedQuery);
    });
  }, [group, query, restorableEntries, seatableEntries]);

  return (
    <section className="space-y-3" aria-label="Chọn người chơi">
      <div className="grid grid-cols-2 gap-2" role="tablist" aria-label="Nhóm người chơi">
        <button
          type="button"
          data-ops-action="floor.tables.select_add_entry_group"
          role="tab"
          aria-selected={group === "seat"}
          className={groupButtonClass(group === "seat")}
          onClick={() => { setGroup("seat"); setQuery(""); onChange(null); }}
        >
          <UserRoundPlus className="h-4 w-4" aria-hidden="true" />
          Chưa có ghế <span className="font-mono">{availability && availability.seat !== "ready" ? "—" : seatableEntries.length}</span>
        </button>
        <button
          type="button"
          data-ops-action="floor.tables.select_add_entry_group"
          role="tab"
          aria-selected={group === "restore"}
          className={groupButtonClass(group === "restore")}
          onClick={() => { setGroup("restore"); setQuery(""); onChange(null); }}
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Đã loại <span className="font-mono">{availability && availability.restore !== "ready" ? "—" : restorableEntries.length}</span>
        </button>
      </div>

      <label className="relative block">
        <span className="sr-only">Tìm theo tên hoặc số entry</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input
          type="search"
          inputMode="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Tìm tên hoặc số entry"
          className="h-12 w-full rounded-xl border border-input bg-background pl-10 pr-3 text-base text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/50"
        />
      </label>

      <div className="max-h-64 space-y-2 overflow-y-auto overscroll-contain pr-1" role="tabpanel">
        {status === "loading" ? <p role="status">Đang xác minh danh sách người chơi…</p> :
          status === "failed" ? (
            <div role="alert">
              Chưa tải được danh sách người chơi.
              {onRetry && <button type="button" data-ops-action="floor.tables.refresh" onClick={onRetry}>Thử lại</button>}
            </div>
          ) : rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
            {query.trim()
              ? "Không tìm thấy người chơi phù hợp."
              : group === "seat"
                ? "Mọi entry hợp lệ đã có ghế."
                : "Chưa có người chơi đã loại để khôi phục."}
          </div>
        ) : rows.map((entry) => {
          const selected = value?.kind === group && value.entryId === entry.entryId;
          return (
            <button
              key={entry.entryId}
              type="button"
              data-ops-action="floor.tables.select_add_entry"
              aria-pressed={selected}
              data-testid={`floor-entry-${group}-${entry.entryId}`}
              onClick={() => onChange({ kind: group, entryId: entry.entryId })}
              className={cn(
                "flex min-h-14 w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/50",
                selected
                  ? "border-primary bg-primary/12"
                  : "border-border bg-card/55 hover:border-primary/45 hover:bg-accent/35",
              )}
            >
              <span className={cn(
                "grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-bold",
                group === "seat" ? "bg-primary/12 text-primary" : "bg-amber-400/12 text-amber-200",
              )}>
                {group === "seat" ? "IN" : "OUT"}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-foreground">{entry.displayName}</span>
                <span className="mt-0.5 block font-mono text-xs text-muted-foreground">
                  Entry {entry.entryNo} · {formatStack(entry.currentStack)} chip
                </span>
              </span>
              <span className="shrink-0 text-xs font-medium text-primary">{selected ? "Đã chọn" : "Chọn"}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function groupButtonClass(selected: boolean): string {
  return cn(
    "inline-flex min-h-12 items-center justify-center gap-1.5 rounded-xl border px-2 text-xs font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/50",
    selected
      ? "border-primary/55 bg-primary/12 text-primary"
      : "border-border bg-card/55 text-muted-foreground hover:text-foreground",
  );
}
