/**
 * telegramNotifier.ts
 *
 * Batch-grouping Telegram notifier for dealer swing events.
 *
 * Pattern:
 *   1. Enqueue typed events during processing
 *   2. Events auto-flush after 800ms of inactivity
 *   3. On flush, events are grouped by type → one message per group
 *   4. Fire-and-forget — never blocks the main flow
 *
 * Message format (examples):
 *   "Có 2 cập nhật - HANOI ROYAL:
 *     🪑 Vào bàn T21: Vương Duy @Vduyyy
 *     🪑 Vào bàn T22: Dương Phúc Thịnh @Thinhduong"
 *
 *   "Có 2 cập nhật:
 *     ☕ Đang break: Nguyễn Mai Kiều Anh @kieuanhbb59 (20 phút)"
 *
 *   "Có 2 cập nhật - HANOI ROYAL:
 *     📋 Tiếp theo T29: Nguyễn Tuấn Minh @minhminhh2 ra, Lương Ngọc Khánh @ace23072001 vào (11:54, còn 3 phút)"
 */

import { escapeHtml, mention, sendTelegramNotification } from "./telegram.ts";

// ── Event types ────────────────────────────────────────────────────────────

export interface BreakStartEvent {
  type: "break_start";
  dealerName: string;
  username: string | null;
  durationMin: number;
  telegramUserId: number | null;
}

export interface PreAssignEvent {
  type: "pre_assign";
  tableName: string;
  zone: string | null;
  outName: string;
  outUsername: string | null;
  outTelegramUserId: number | null;
  inName: string;
  inUsername: string | null;
  inTelegramUserId: number | null;
  swingAt: Date;
  minutesLeft: number;
}

export type DealerEvent =
  | BreakStartEvent
  | PreAssignEvent;

// ── Format helpers ─────────────────────────────────────────────────────────

function fmt(name: string, username: string | null, telegramUserId: number | null): string {
  return mention({ full_name: name, telegram_username: username, telegram_user_id: telegramUserId });
}

function hhmm(date: Date): string {
  return date.toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Ho_Chi_Minh",
  });
}

function formatEventLine(event: DealerEvent): string {
  switch (event.type) {
    case "break_start":
      return `☕ Đang break: ${fmt(event.dealerName, event.username, event.telegramUserId)} (${event.durationMin} phút)`;

    case "pre_assign":
      return [
        `📋 Tiếp theo ${escapeHtml(event.tableName)}:`,
        `${fmt(event.outName, event.outUsername, event.outTelegramUserId)} ra,`,
        `${fmt(event.inName, event.inUsername, event.inTelegramUserId)} vào`,
        `(${hhmm(event.swingAt)}, còn ${event.minutesLeft} phút)`,
      ].join(" ");
  }
}

// ── Batch message builder ──────────────────────────────────────────────────

function buildBatchMessage(events: DealerEvent[]): string {
  if (events.length === 0) return "";

  // Detect zone (all events must share the same zone)
  const zones = events
    .map((e) => ("zone" in e ? (e as any).zone : null))
    .filter((z: string | null) => z !== null);

  const uniqueZones = [...new Set(zones)];
  const zoneLabel = uniqueZones.length === 1 && uniqueZones[0]
    ? ` - ${escapeHtml(uniqueZones[0])}`
    : "";

  const header = `Có ${events.length} cập nhật${zoneLabel}:`;
  const lines = events.map((e) => ` ${formatEventLine(e)}`);

  return [header, ...lines].join("\n");
}

// ── Group events by type for batch logic ───────────────────────────────────

function groupEventsByType(events: DealerEvent[]): DealerEvent[][] {
  const groups: DealerEvent[][] = [];

  const breaks = events.filter((e) => e.type === "break_start");
  if (breaks.length) groups.push(breaks);

  const preAssigns = events.filter((e) => e.type === "pre_assign");
  if (preAssigns.length) groups.push(preAssigns);

  return groups;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── TelegramNotifier class ─────────────────────────────────────────────────

export class TelegramNotifier {
  private botToken: string;
  private chatId: string;
  private queue: DealerEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly BATCH_WINDOW_MS = 800;

  constructor(botToken: string, chatId: string) {
    this.botToken = botToken;
    this.chatId = chatId;
  }

  /** Add an event to the batch queue. Auto-flushes after 800ms of inactivity. */
  enqueue(event: DealerEvent): void {
    this.queue.push(event);

    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      this.flushSync().catch((err) =>
        console.warn("[TelegramNotifier] flush error:", err.message)
      );
    }, this.BATCH_WINDOW_MS);
  }

  /**
   * Flush all queued events immediately.
   * Fire-and-forget — errors are logged, never thrown.
   */
  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flushSync();
  }

  private async flushSync(): Promise<void> {
    if (this.queue.length === 0) return;

    const batch = this.queue.splice(0);
    const groups = groupEventsByType(batch);

    for (const group of groups) {
      const message = buildBatchMessage(group);
      if (!message) continue;

      await sendTelegramNotification(this.botToken, this.chatId, message);
      await sleep(200);
    }
  }
}
