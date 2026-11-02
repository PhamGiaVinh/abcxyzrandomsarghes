import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export type SupabaseAdmin = any;

/* ------------------------------------------------------------------ */
/*  Format helpers                                                     */
/* ------------------------------------------------------------------ */

// R8: full name everywhere, @mention appended when available —
// "Trần Ngọc Anh @Synsyn223", never a bare @username without the name.
export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function mention(dealer: { full_name: string; telegram_username?: string | null; telegram_user_id?: number | null }): string {
  const safe = escapeHtml(dealer.full_name);
  if (dealer.telegram_username) return `${safe} @${dealer.telegram_username}`;
  if (dealer.telegram_user_id) {
    return `<a href="tg://user?id=${dealer.telegram_user_id}">${safe}</a>`;
  }
  return safe;
}

function formatSwingMessage(params: {
  tableName: string;
  tourName?: string;
  outgoingDealer: { full_name: string; telegram_username?: string | null };
  incomingDealer: { full_name: string; telegram_username?: string | null } | null;
  minutesLeft: number;
}): string {
  const { tableName, tourName, outgoingDealer, incomingDealer, minutesLeft } = params;
  const tourInfo = tourName ? ` (${tourName})` : "";
  const out = mention(outgoingDealer);
  if (!incomingDealer) {
    return `⚠️ ${tableName}${tourInfo}: ${out} ra —`;
  }
  const incoming = mention(incomingDealer);
  return `📋 ${tableName}${tourInfo}: ${out} ra, ${incoming} vào (còn ${minutesLeft} phút).`;
}

function formatPreAnnounceMessage(params: {
  tableName: string;
  tourName?: string;
  outgoingDealer: { full_name: string; telegram_username?: string | null };
  minutesLeft: number;
}): string {
  const { tableName, tourName, outgoingDealer, minutesLeft } = params;
  const tourInfo = tourName ? ` (${tourName})` : "";
  const out = mention(outgoingDealer);
  return `⏰ ${tableName}${tourInfo}: ${out} còn ~${minutesLeft} phút.`;
}

export function formatBreakMessage(params: {
  dealer: { full_name: string; telegram_username?: string | null };
  durationMinutes: number;
  startTime?: string;
}): string {
  const { dealer, durationMinutes, startTime } = params;
  const d = mention(dealer);
  let msg = `☕ ${d} đang nghỉ (${durationMinutes} phút).`;
  if (startTime) msg += ` Bắt đầu lúc: ${startTime}.`;
  return msg;
}

function formatBreakEndMessage(params: {
  dealer: { full_name: string; telegram_username?: string | null };
  tableName: string;
}): string {
  const { dealer, tableName } = params;
  const d = mention(dealer);
  return `✅ ${d} đã nghỉ xong, quay lại ${tableName}.`;
}

export function formatCloseTableMessage(params: {
  tableName: string;
  dealer: { full_name: string; telegram_username?: string | null; telegram_user_id?: number | null };
  tourName?: string;
}): string {
  const { tableName, dealer } = params;
  return `Đóng bàn : ${escapeHtml(tableName)} - Dealer ${mention(dealer)} được nghỉ.`;
}

export function formatMassAssignMessage(assignments: Array<{
  tableName: string;
  dealer: { full_name: string; telegram_username?: string | null; telegram_user_id?: number | null };
}>): string {
  if (!assignments.length) return "";
  const lines = assignments.map(
    (a, i) => `${i + 1}.${escapeHtml(a.tableName)} → ${mention(a.dealer)}`
  );
  return `Mở Bàn (${assignments.length} bàn)\n${lines.join("\n")}`;
}

function formatTierWarningMessage(params: {
  tier: string;
  tableTier: string;
  dealerName: string;
  tableName: string;
}): string {
  const { tier, tableTier, dealerName, tableName } = params;
  return `⚠️ *Tier không phù hợp:* ${dealerName} (${tier}) → ${tableName} (${tableTier}).`;
}

export function formatEmergencyPreAssignMessage(params: {
  tableName: string;
  outDealer: { full_name: string; telegram_username?: string | null; telegram_user_id?: number | null };
  inDealer: { full_name: string; telegram_username?: string | null; telegram_user_id?: number | null };
  swingAt: Date;
  minutesLeft: number;
}): string {
  const hhmm = (d: Date) =>
    d.toLocaleTimeString("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Asia/Ho_Chi_Minh",
    });
  // Match the batch pre_assign format so operators see a consistent "Tiếp theo" message
  return [
    `Có 1 cập nhật:`,
    ` 📋 Tiếp theo ${escapeHtml(params.tableName)}: ${mention(params.outDealer)} ra, ${mention(params.inDealer)} vào (${hhmm(params.swingAt)}, còn ${params.minutesLeft} phút)`,
  ].join("\n");
}

export function formatBreakAlertMessage(params: {
  dealer: { full_name: string; telegram_username?: string | null };
  urgency: string;
  reason: string;
}): string {
  const { dealer, urgency, reason } = params;
  const d = mention(dealer);
  const urgencyLabel = urgency === "immediate" ? "KHẨN" : "SẮP ĐẾN";
  return `🔴 [${urgencyLabel}] ${d} — ${reason}. Cần nghỉ sớm.`;
}

function formatPreAssignMessage(params: {
  tableName: string;
  tourTier?: string;
  outgoingDealer: { full_name: string; telegram_username?: string | null };
  incomingDealer: { full_name: string; telegram_username?: string | null };
  minutesLeft: number;
  time: string;
}): string {
  const { tableName, tourTier, outgoingDealer, incomingDealer, minutesLeft, time } = params;
  const tierInfo = tourTier && tourTier !== "MEDIUM" ? ` (${tourTier})` : "";
  const out = mention(outgoingDealer);
  const inc = mention(incomingDealer);
  return `📋 Tiếp theo ${tableName}${tierInfo}: ${out} ra, ${inc} vào (${time}, còn ${minutesLeft} phút)`;
}

function formatAutoFillMessage(assignments: Array<{
  tableName: string;
  dealer: { full_name: string };
  tourTier?: string;
}>): string {
  if (!assignments.length) return "";
  const lines = assignments.map((a) => {
    const tierInfo = a.tourTier && a.tourTier !== "MEDIUM" ? ` (${a.tourTier})` : "";
    return `  • ${a.tableName}${tierInfo} → ${a.dealer.full_name}`;
  });
  return `🔄 *Tự động fill* (${assignments.length} bàn):\n${lines.join("\n")}`;
}

function formatPreAssignFallbackMessage(params: {
  tableName: string;
  oldDealer: { full_name: string; telegram_username?: string | null };
  reason: string;
}): string {
  const { tableName, oldDealer, reason } = params;
  const out = mention(oldDealer);
  return `⚠️ ${tableName}: Pre-assign fallback — ${out}, lý do: ${reason}. Chọn dealer mới.`;
}

function formatBatchSwingMessage(swings: Array<{
  tableName: string;
  outgoingDealer: { full_name: string; telegram_username?: string | null };
  incomingDealer: { full_name: string; telegram_username?: string | null } | null;
  minutesLeft: number;
}>): string {
  if (!swings.length) return "";
  const lines = swings.map((s) => {
    const out = mention(s.outgoingDealer);
    if (s.incomingDealer) {
      const inc = mention(s.incomingDealer);
      return `  • ${s.tableName}: ${out} → ${inc} (còn ${s.minutesLeft} phút)`;
    }
    return `  ⚠️ ${s.tableName}: ${out} — CHƯA CÓ DEALER.`;
  });
  return `📋 *Swing* (${swings.length} bàn):\n${lines.join("\n")}`;
}

function formatCheckoutAlertMessage(params: {
  dealerName: string;
  tableName: string;
  isPreAssigned: boolean;
}): string {
  const { dealerName, tableName, isPreAssigned } = params;
  const prefix = isPreAssigned ? "🔔" : "🚨";
  const extra = isPreAssigned ? " (đã pre-assign, cần tìm dealer mới)" : " — BÀN TRỐNG!";
  return `${prefix} ${dealerName} check-out khỏi bàn ${tableName}${extra}`;
}

/* Tournament Break */

export function formatTournamentBreakMessage(params: {
  durationMinutes: number;
  dealerCount: number;
  tableCount: number;
}): string {
  const { durationMinutes, dealerCount, tableCount } = params;
  return `⏸ *TOURNAMENT BREAK*\n• Thời gian: ${durationMinutes} phút\n• Dealer nghỉ: ${dealerCount}\n• Bàn tạm dừng: ${tableCount}`;
}

export function formatForceBreakMessage(params: {
  dealer: { full_name: string; telegram_username?: string | null };
  durationMinutes: number;
  reason: string;
}): string {
  const { dealer, durationMinutes, reason } = params;
  const d = mention(dealer);
  return `🔴 *FORCE BREAK*\n${d} — ${reason}\nThời gian: ${durationMinutes} phút`;
}

/* Meal Break */

export function formatMealBreakMessage(params: {
  dealer: { full_name: string; telegram_username?: string | null; telegram_user_id?: number | null };
  baseDuration: number;
  bonusMinutes: number;
  totalDuration: number;
  poolSize: number;
  tablesActive: number;
}): string {
  const { dealer, baseDuration, bonusMinutes, totalDuration, poolSize, tablesActive } = params;
  const d = mention(dealer);
  return `🍚 ${d} nghỉ ăn cơm\n` +
    `⏱ ${totalDuration}p (${baseDuration}p + ${bonusMinutes}p bonus)\n` +
    `📊 ${tablesActive} bàn / ${poolSize} dealer`;
}

/* ------------------------------------------------------------------ */
/*  DM helpers                                                         */
/* ------------------------------------------------------------------ */

export async function notifyFloorManagerDM(
  botToken: string,
  admin: SupabaseAdmin,
  clubId: string,
  text: string,
): Promise<void> {
  if (!botToken) return;
  try {
    const { data } = await admin
      .from("club_settings")
      .select("floor_manager_chat_id")
      .eq("club_id", clubId)
      .maybeSingle();
    const fmChatId = (data as any)?.floor_manager_chat_id;
    if (fmChatId) {
      await sendTelegramNotification(botToken, String(fmChatId), text);
    }
  } catch { /* non-critical */ }
}

export async function notifyDealerDM(
  botToken: string,
  dealer: { telegram_user_id?: number | null; full_name: string },
  text: string,
): Promise<boolean> {
  if (!botToken || !dealer.telegram_user_id) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: String(dealer.telegram_user_id),
        text,
        parse_mode: "HTML",
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function notifyIncomingDealer(
  botToken: string,
  dealer: { telegram_user_id?: number | null; full_name: string; telegram_username?: string | null },
  tableName: string,
  minutesLeft: number,
  chatId?: string,
): Promise<void> {
  const msg = `🔔 Chuẩn bị: <b>${escapeHtml(tableName)}</b> sau ~${minutesLeft} phút.`;

  if (dealer.telegram_user_id) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: String(dealer.telegram_user_id),
          text: msg,
          parse_mode: "HTML",
        }),
      });
      if (res.ok) return;
    } catch { /* fallback */ }
  }
}

/* ------------------------------------------------------------------ */
/*  Send notification                                                   */
/* ------------------------------------------------------------------ */

export async function getClubTelegramChatId(
  admin: SupabaseAdmin,
  clubId: string,
): Promise<string | null> {
  const { data } = await admin
    .from("club_settings")
    .select("telegram_chat_id")
    .eq("club_id", clubId)
    .maybeSingle();
  return (data as any)?.telegram_chat_id ?? null;
}

export async function sendTelegramNotification(
  botToken: string,
  chatId: string,
  text: string,
  options?: {
    retries?: number;
    logError?: (msg: string) => void;
    parse_mode?: string;
    disable_web_page_preview?: boolean;
    [key: string]: unknown;
  },
): Promise<boolean> {
  if (!botToken || !chatId) return false;

  const maxRetries = options?.retries ?? 3;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: String(chatId),
          text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
      });

      if (res.ok) return true;

      const err = await res.text();
      console.error(`Telegram attempt ${i + 1} failed:`, res.status, err);
      if (i === maxRetries - 1 && options?.logError) {
        options.logError(`HTTP ${res.status}: ${err}`);
      }
    } catch (err: any) {
      console.error(`Telegram attempt ${i + 1} exception:`, err);
      if (i === maxRetries - 1 && options?.logError) {
        options.logError(err.message);
      }
    }

    if (i < maxRetries - 1) {
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)));
    }
  }
  return false;
}
