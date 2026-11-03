// Feature flags for staged rollout of cashier/floor features.
// Flipping a flag is a one-line commit — keep defaults SAFE (hidden) until the
// owner's production UAT passes (plan: Seat Floor Cashier UX, 2026-06-13).
// This exact-string gate intentionally rejects truthy-looking deployment values
// such as "1", "yes", and "TRUE". The server runtime gate must still approve
// the exact Dealer assignment and Voice config before the panel can render.
export function isTrackerVoiceBuildEnabled(value: unknown): boolean {
  return value === "true";
}

// Only the Tour Cashier surface uses this build flag; server club/role gates still apply.
export function isTourCashierBuildEnabled(value: unknown): boolean {
  return value === "production";
}

export const OPS_TOUR_CASHIER_ENABLED = isTourCashierBuildEnabled(import.meta.env.VITE_OPS_TOUR_CASHIER);

/**
 * Floor Table Control V3 is dark unless the build supplies one exact approved
 * flag/environment pair. Truthy-looking, partial, or mixed values stay OFF.
 * This is presentation rollout only: database RPCs remain caller-bound and
 * their grants are independent.
 */
export function isFloorTableControlV3PreviewEnabled(
  flagValue: unknown = import.meta.env.VITE_FLOOR_TABLE_CONTROL_V3,
  environmentValue: unknown = import.meta.env.VITE_FLOOR_UAT_ENV,
): boolean {
  return flagValue === "preview" && environmentValue === "preview";
}

export function isFloorTableControlV3ProductionEnabled(
  flagValue: unknown = import.meta.env.VITE_FLOOR_TABLE_CONTROL_V3,
  environmentValue: unknown = import.meta.env.VITE_FLOOR_UAT_ENV,
): boolean {
  return flagValue === "production" && environmentValue === "production";
}

export function isFloorRedrawSeatLockV1Enabled(
  flagValue: unknown = import.meta.env.VITE_FLOOR_REDRAW_SEAT_LOCK_V1,
  environmentValue: unknown = import.meta.env.VITE_FLOOR_UAT_ENV,
): boolean {
  return (flagValue === "preview" && environmentValue === "preview")
    || (flagValue === "production" && environmentValue === "production");
}

/**
 * The last-hand/history panel is dark unless the build is marked for the
 * reviewed environment. Exact pairs keep previews isolated while allowing an
 * owner-approved production build without a source edit to bypass the gate.
 */
export function isPublicSpectatorLastHandHistoryEnabled(
  flagValue: unknown = import.meta.env.VITE_PUBLIC_SPECTATOR_LAST_HAND_HISTORY,
  environmentValue: unknown = import.meta.env.VITE_FLOOR_UAT_ENV,
): boolean {
  return (flagValue === "preview" && environmentValue === "preview")
    || (flagValue === "production" && environmentValue === "production");
}

export const FEATURES = {
  /**
   * Owner Daily Digest web report — owner-only, read-only surface in VinPoker Ops.
   * ON 2026-08-10 at the owner's explicit request so club Owners can open the read-only
   * report from VẬN HÀNH. The server-authorized RPC remains the data boundary; the
   * browser never recalculates rake/F&B/payout/payroll and fails closed if it is absent.
   */
  ownerDailyDigestWebReport: true,
  /**
   * Cashier "Đăng ký giải" tab — confirm a PENDING online registration → auto-draw
   * seat → receipt (via the live confirm_registration_and_assign_seat RPC).
   * ENABLED in production 2026-06-14 after preview UAT passed (#148). Visible to all
   * cashiers. Kill-switch: set false to hide from regular cashiers (admins/club
   * owners still see it).
   */
  cashierRegistrations: true,
  /**
   * Cashier "Buy-in tại quầy" (offline cash / walk-in): pick tournament → name →
   * buy-in + fee → auto-draw seat + receipt via `create_offline_buyin_and_seat`.
   * ENABLED 2026-06-14: RPC applied live + hardened (PUBLIC/anon revoked) in a
   * controlled session, owner UAT passed. Now the section is visible to all
   * cashiers and the Buy-in button calls the live RPC. Kill-switch: set false to
   * hide the section from regular cashiers (admins/owners keep it) and disable the
   * button ("Cần bật RPC").
   */
  offlineBuyIn: true,
  /**
   * Registration VOID (cancel + refund/revenue reversal). This high-risk path
   * remains independent from cashier re-entry and defaults OFF.
   */
  registrationExtensions: false,
  /**
   * Cashier re-entry for a busted player. Kept separate so enabling re-entry
   * can never expose the registration VOID/refund path by accident.
   */
  cashierReentry: false,
  /**
   * SePay reconciliation — Cashier "Đối soát SePay" tab. Surfaces the reconcile worklist
   * (SePay-API-verified transfers) via the read-only `sepay_cashier_settlement_worklist` RPC, so a
   * cashier can confirm (→ `manual_confirm_bank_transaction`) or ignore (→ `ignore_bank_transaction`).
   * Default **OFF**: hidden from regular cashiers (admins/club owners still see it for UAT). Flip true
   * ONLY after the worklist RPC (`20261116000000`) + the reconcile chain (`20261113`–`20261115` + the
   * sepay-reconcile edge fn) are applied live and owner UAT passes.
   */
  sepayReconcile: false,
  /**
   * SePay auto-confirm UI mirror — reserved status indicator for the server-side `SEPAY_AUTO_CONFIRM`
   * env kill-switch. NOT used in v1 (Direction 1 is flag-only; the cashier confirms manually). Keep false.
   */
  sepayAutoConfirm: false,
  /**
   * Dynamic VietQR on the tournament buy-in screen (TournamentRegisterModal). When ON, the payment
   * card renders a NAPAS VietQR (built locally) that pre-fills the receiving account + exact amount +
   * the bare reference_code memo, so the customer can't mistype them → reliable SePay auto-confirm.
   * Frontend-only; does NOT touch settle/confirm. The QR carries no data settle trusts — it is a
   * convenience pre-fill; the static QR + manual fields stay as fallback. For production the BIN comes
   * from an explicit platform_bank_accounts.bank_bin (Stage 2 #577); the free-text name map is a
   * legacy/UAT fallback only.
   * **ON 2026-06-29** after the owner's real MB bank-app scan passed (account + amount + memo pre-filled
   * correctly) and the receiving account's explicit bank_bin (MB 970422) was set via the picker.
   * Kill-switch: set false to instantly revert to the static QR (no other change needed).
   */
  dynamicVietQr: true,
  /**
   * Player-facing online RE-ENTRY (PATCH 4): a busted player whom the floor removed can self-buy back in —
   * tap "Mua lại" → REENTRY dynamic VietQR → pay → SePay full-auto re-seats. Default **OFF**. While false,
   * TournamentDetail behaves EXACTLY as before (no re-entry queries run, no source_entry_id reference — safe
   * even before the STAGE-B migration is applied) and the "Mua lại" button is hidden. Flip to true ONLY after
   * STAGE A/B/C migrations are applied live, the headless tests pass, the tournament-reentry edge fn is
   * deployed, and the club is opted in (same as the initial full-auto). Kill-switch: set false to hide the
   * re-entry path instantly.
   */
  dynamicReentry: true,
  /**
   * Move-player dialog + System-A row locking (used by the floor map "Sơ đồ bàn"
   * + the registration queue; the standalone Table Draw tab was removed 2026-06-15).
   * Enabled 2026-06-13: guard v2 (20260818000000) APPLIED LIVE and verified —
   * actor bound to auth.uid(), PUBLIC/anon execute revoked, spoof/anon/noop
   * tests passed (see controlled patch session report).
   */
  movePlayer: true,
  /** Realtime queue updates — requires tournament_registrations in the realtime publication. */
  registrationRealtime: false,
  /**
   * Dealer Swing "Sửa nhầm bàn" wrong-table correction modal (#33C).
   * Backend reconcile_dealer_room_state is LIVE (20260817000002 + club-scope
   * fix 20260818000002, both applied 2026-06-13 in controlled sessions).
   * Kill-switch: flipping to false restores the disabled placeholder button.
   */
  wrongTableCorrection: true,
  /**
   * Dealer Swing "Sửa domino nhiều bàn" multi-table room-reconcile wizard (#33F).
   * Same LIVE backend reconcile_dealer_room_state (incl. park-and-place swap
   * fix 20260819000004). Default OFF for owner UAT — flip to true is one line.
   * Independent of wrongTableCorrection.
   */
  roomReconcileWizard: false,
  /**
   * Remote TD AI: lets the assistant call the `td-ai-assistant` Edge Function so
   * it gives real AI advice across rulings, tournament operations, floor
   * procedure and basic strategy — grounded ONLY in the committed corpus
   * (no-hallucination validator drops any uncited/fabricated rule). The provider
   * is configured by Edge secrets, NOT hardcoded: `TD_AI_PROVIDER` (gemini
   * default / groq / openrouter) + `TD_AI_MODEL` + the matching key
   * (`GEMINI_API_KEY` / `GROQ_API_KEY` / `OPENROUTER_API_KEY`). **ON**
   * (owner-approved): the function is in the Deploy Edge Functions step so it
   * ships on merge. `useTdAi` calls it and STILL falls back to the offline
   * keyword corpus on ANY failure (function absent, network, quota/429, missing
   * key), so the panel keeps working even if the model is unavailable.
   * Kill-switch: set false to force the offline-only path. Advisory only.
   */
  tdAiRemote: true,
  /**
   * Online Poker UI under /poker/* — friends-practice model. **ON** (2026-06-17):
   * the open-table rework (#293) is live — migration 20260921000000 applied (host_user_id
   * + op_create_open_table/op_sit_open/op_transfer_host/op_leave_open_table), edge deployed,
   * online_poker_config.enabled=true, crons active. 2-disposable-account E2E passed
   * (create→host · sit_open · auto-deal · play · transfer_host · leave→reassign). Players
   * create open tables, self-set their own chips (no wallet), first sitter is the host
   * (transferable + auto-reassign). Kill-switch: set false to restore <PokerComingSoon/>.
   */
  onlinePoker: true,
  /**
   * Online Poker REBUY — the "Mua thêm chip" button in the bustout dialog. Default
   * **OFF**: while false the button stays disabled ("sẽ bổ sung sau"). This is a UI gate
   * ONLY, NOT a security gate — the real gate is the `op_rebuy_open` RPC being unapplied.
   * Flip to true ONLY after migration 20260929000000 is applied live (E5B) and edge
   * deployed. The RPC server-dictates the amount (= table starting_stack_default) and is
   * busted-only, so it never lets the client set an arbitrary stack.
   * E5B DONE 2026-06-19: op_rebuy_open applied live (Management-API, grants verified,
   * schema_migrations untouched) + edge redeployed with rebuy_open. Enabled here for
   * Preview UAT; merge to production only after owner confirms busted→rebuy→stack-returns.
   */
  onlinePokerRebuy: true,
  /**
   * Club Admin → Owner Finance Dashboard at /club/admin/finance. Read-only money-flow
   * (staking fees + staking payout fees + tournament rake − SAVED dealer payroll; never
   * recomputes payroll). Default **OFF** (dark). While false the route + the ClubAdmin
   * entry link are hidden from everyone except super_admin (so the owner can UAT). Flip
   * to true after owner UAT (and optionally once the get_club_finance_summary read RPC
   * ships in Phase 3). No DB writes.
   */
  clubFinanceDashboard: false,
  /**
   * Owner "Tài chính & Đối soát" (Accounting Control) cockpit at /club/admin/accounting-control.
   * UI/CLIENT-ONLY SHELL: 11 tabs (Tổng quan · Chốt sổ · Event P&L · Series P&L · Tiền & Bank ·
   * Phải trả giải · F&B · Lương & chi phí · Ký quỹ staking · Cảnh báo · Báo cáo tháng) rendered
   * ENTIRELY from typed mock fixtures — NO DB/RPC/Edge/types import, no writes, zero money-path
   * logic; the lazy chunk never touches the supabase client. Every money value carries a
   * data-state badge (Dự báo/Tạm tính/Đã đối soát/Đã chốt); prize pool + escrow are styled as
   * liability/custody, never revenue; contribution is never labeled "profit". Tabs "Chốt sổ" &
   * "Báo cáo tháng" are SPEC/NOT-BUILT mocks of the Daily Close / Monthly Report contracts.
   * Was OFF (dark) during build; **ON 2026-07-03 at owner's explicit request** ("bật với mọi
   * club") so every club owner/admin can review the mock cockpit from the VẬN HÀNH menu +
   * ClubAdmin card. STILL UI/mock/read-only — flipping this shows a clearly-labelled
   * "DỮ LIỆU MẪU (mock)" page; it touches NO money path. Kill-switch: set false to hide the
   * page + both entry points again. Real data wiring is a later, separately-flagged phase —
   * see docs/design/accounting-control-ui.md.
   */
  accountingControl: true,
  /**
   * Accounting Control — W1: wire the "Tổng quan" tab to REAL read-only data from the live
   * `get_club_finance_summary` RPC (via `useClubFinanceSummary`, RLS-scoped to the owner's club,
   * current month). When ON, the "Tiền của club" block shows real retained revenue + saved dealer
   * wage cost + "còn lại sau lương" (all Tạm tính — actuals-to-date, not closed); the GTD subsidy,
   * the "Tiền giữ hộ" (pool/payout/escrow) block, the entries forecast, and every other tab stay
   * MOCK, clearly tagged "(mock — chưa nối)". Read-only — no writes, no new RPC. PT-wage line and
   * F&B stay a known gap until #656 R2 applies live + their own increments (see
   * docs/design/accounting-control-wiring-plan.md). While false, Tổng quan renders today's mock
   * exactly (zero extra reads). **ON 2026-07-03 at owner request** (after #656 R1/R2/R3 applied
   * live) — Tổng quan "Tiền của club" now shows real numbers; golden-diff = they must equal
   * /club/admin/finance for the same month. Kill-switch: set false to revert to mock.
   */
  accountingControlLiveOverview: true,
  /**
   * Accounting Control — W4: wire the "Lương & chi phí" tab to REAL read-only payroll cost from
   * the live `get_club_finance_summary` RPC (same hook as W1): total SAVED payroll (net incl PT
   * after #656 R2), gross, adjustments, unpaid total, and the per-period list with status. The
   * per-ROLE split (dealer/floor/cashier/PT) and the table-hour cost are NOT in that RPC → they
   * stay mock, tagged "(mock — chưa nối)". Read-only, never recomputes saved payroll. Default
   * **OFF**: while false the tab renders today's mock. Flip after UAT (numbers must equal the
   * payroll totals on /club/admin/finance). Kill-switch: set false.
   */
  accountingControlLivePayroll: false,
  /**
   * Accounting Control — W3-B: wire the "Phải trả giải" tab to REAL read-only payout liability from
   * the new `get_club_payout_liability` RPC (owed = finalized finished_place × tournament_prizes,
   * matches get_member_history; paid = paid-to-date from the tournament_prize_payments ledger;
   * outstanding = owed − paid). Read-only. Owed shows only for finalized tournaments ("chưa chốt"
   * otherwise, never 0); paid = 0 until the separate `prizePayoutTracking` cashier write flag is on
   * (labeled "chưa ghi nhận trả"). **Source-only migration** `20261216000000` must be applied live
   * first — while OFF or RPC absent (42883/42P01) the tab renders mock ("chưa áp dụng"). Default
   * **OFF**. Flip after owner-gated apply + golden-diff UAT (owed == manual Σ over the same
   * tournaments). Kill-switch: set false.
   * APPLIED LIVE 2026-07-04 (migration 20261216000000 via one-shot owner-gated apply, POST-verify
   * all green) → flipped ON. Paid still 0 until the B2 cashier write flag ships.
   */
  accountingControlLivePayout: true,
  /**
   * Cashier "Trả thưởng giải" and the "Đã trả thưởng" section in PayoutEnginePanel.
   * When ON, a post-close tournament shows one row per IN-MONEY finished place (from the SECDEF read
   * RPC `get_tournament_payout_recipients`) with a "Ghi nhận đã trả" button → confirmation dialog →
   * `record_tournament_prize_payment_v2` (server derives amount + recipient, checks the confirmation
   * token and stores an actor/request receipt). Writing a paid row makes the READ-side
   * "Phải trả giải" tab's `paid`/`outstanding` go real automatically. WRITE-side mirror of
   * `accountingControlLivePayout` (READ). Requires the payout124 read/write/receipt contracts.
   * When OFF, entrypoints stay hidden; an absent read RPC shows "Cần áp dụng".
   * Accounting Control itself stays READ-ONLY — this write lives ONLY in the cashier
   * surface. Idempotent (already_paid = success). Kill-switch: set false to hide the write section.
   */
  prizePayoutTracking: true,
  /**
   * Blind editor "Lưu" (full-replace save) in BlindEditorPanel. Default **OFF**
   * because it needs the source-only `update_blind_structure` RPC
   * (20260825000000) applied live first. While false the editor is usable as a
   * read-only / draft-local preview and Save shows disabled "Cần bật RPC" — it
   * NEVER calls the RPC, so it can't silently fail or wipe the live structure.
   * Flip to true ONLY after the RPC is applied live in a controlled DB session.
   */
  blindEditorSave: true,
  // Editable suggestion in tournament setup; the existing create flow owns saving.
  blindDraftSuggest: false,
  /**
   * Reusable blind-structure templates ("thư viện cấu trúc blind"). Default **OFF**
   * because it needs both the `update_blind_structure` RPC (20260825000000) AND the
   * `blind_structure_templates` table (20260920000000) applied live first. While
   * false: no template UI renders ("Lưu thành mẫu" / "Tải mẫu" in the blind editor
   * and the "Cấu trúc blind" picker in Tạo giải are hidden) so nothing queries the
   * missing table. Flip to true ONLY after both objects are applied in a controlled
   * DB session (the editor full-replace path also requires blindEditorSave=true).
   */
  blindTemplates: true,
  /**
   * Dealer Shift Planner V2.1 — "Xếp lịch dealer" tab in DealerSwingDashboard
   * (staff scheduling: schedule dealers per day/week with flexible check-in times,
   * SEPARATE from the live Dealer Swing rotation system). **ON** (2026-06-14, post-UAT):
   * migration `20260827000000_dealer_shift_planner.sql` is applied live and the tab
   * runs in mode="live". With this true, ALL dealer-control staff (not just
   * owner/admin) see the tab on the Dealer Swing page. Save/Publish is Phase 2C.
   */
  dealerShiftPlanner: true,
  /**
   * Dealer Shift Planner V2 — guided 4-step redesign of the "Xếp lịch dealer"
   * tab (owner-approved mockups 2026-07-02): week strip + Tạo lịch → Thêm thủ
   * công (pick-from-list) → Rà soát → Phát hành & báo dealer (one action =
   * save + publish + Telegram + app), actionable dealer requests, day/week
   * image exports. Same RPCs as V1 (save_shift_run / publish_shift_run /
   * send-shift-schedule) — pure UI/flow change. OFF until owner UAT; while
   * false, the V1 ShiftPlannerTab renders unchanged (instant kill-switch).
   */
  shiftPlannerV2: false,
  /**
   * Shift Planner V2 auto-fill ("⚡ Tự động xếp", Patch 3): the solver honours
   * per-dealer shift_preference (som/muon/linh_hoat) + the floor's per-day "chia
   * final" pins (dealer_schedule_runs.params.final_designations), records
   * unfillable designees as shortages, and gap-fills over manual edits. OFF until
   * owner UAT — while false the "⚡ Tự động xếp" button is hidden for staff
   * (owner/admin preview it via the role gate). Kill-switch: set false to hide.
   */
  shiftPlannerAutofill: false,
  /**
   * Dealer Swing "Tối ưu nhân sự" card — live staffing optimizer in the operator
   * right rail (owner request 2026-07-04). Shows required-vs-present dealers (target
   * from the real swing rotation cadence: swing_duration + min_inter_swing_rest) and,
   * when overstaffed, ranks who could be released to cut labor cost. READ-ONLY
   * advisory: the actual check-out reuses the existing DC batch-checkout dialog — no
   * new money-path code. ENABLED 2026-07-05 (owner UAT request) — visible to
   * admin/club-admin/club-owner/floor on the Dealer Swing right rail. Kill-switch:
   * set false to hide the card instantly (no other change needed).
   */
  dealerStaffingOptimizer: true,
  /**
   * "Áp lương hàng loạt" — bulk-apply salary to EXISTING dealers in Dealer
   * Management (owner request 2026-07-07: hundreds of dealers imported before the
   * batch-salary field existed have empty salary; editing one-by-one is
   * impractical). PT → hourly rate, FT → monthly (+ derived day/hour rates,
   * mirroring AddDealerDialog). Writes the same dealers columns the per-dealer ✏️
   * edit already writes, behind a final confirm; RLS-protected. ENABLED on ship
   * (owner asked to use it immediately). Kill-switch: set false to hide the button.
   */
  bulkSalaryApply: true,
  /**
   * Bulk dealer import — "Nhập hàng loạt từ file" in Dealer Management. Upload an
   * image/PDF/Excel/CSV of a name list → the auth-gated `parse-dealer-list` Gemini
   * edge fn extracts ONLY names → review → bulk-create dealers (tier B fixed, one
   * FT/PT choice for the whole batch). Reuses the existing dealers insert path
   * (RLS-protected); no new migration/RPC. OFF until owner UAT; while false the
   * button is not rendered, the dialog never mounts, and Gemini is never called.
   * Flipped ON 2026-07-05 (owner-requested) so the button is visible for UAT;
   * the analyze step still needs the GEMINI_API_KEY secret set on the edge fn.
   */
  bulkDealerImport: true,
  /**
   * Tracker Live Action Engine MVP — live per-action playback on the public
   * tournament viewer (/live/:id). While a hand is in_progress, the viewer
   * fast-polls so spectators see each recorded action in near-real-time
   * (`record_action` only writes `hand_actions`, which fires no
   * `tournament_hands` realtime event, so the default path updates only after
   * the hand is finalised). Frontend-only — no DB/publication change; a later
   * phase can swap the fast-poll for a `hand_actions` realtime subscription
   * (controlled publication op).
   *
   * **ON** (RPT-style live chips): drives the spectator's per-seat committed-chip
   * pills (`current_bet`), the colored flying chips, and the "◀ chờ" whose-turn
   * spotlight. ALL of its effects are VIEWER-ONLY — the fast-poll is `spectator`-
   * gated + visibility-aware, the toActId pass is `spectator`-gated, and the bet
   * pill renders only under `viewerLayout` — so the operator/TV are byte-identical.
   * Kill-switch: set false → the viewer falls back to realtime + 30s polling (no
   * live pills/spotlight), exactly as before.
   */
  liveActionEngine: true,
  /**
   * Spectator HAND FEED — an RPT-Live-style "completed hands" feed on the public
   * viewer (/live/:id): one rich card per completed hand (tags ALL-IN/BIG POT/HIGH
   * HAND/Eliminated, pot in chips + BB, board, per-player chip delta abs&BB, revealed
   * or face-down hole cards, winner). READ-ONLY: derived entirely from already-
   * persisted data (tournament_hands / hand_players / hand_actions / eliminations);
   * no write-path / RPC / Edge / publication change. Default **OFF**: while false the
   * viewer renders exactly as today (the feed hook never mounts → zero extra reads).
   * Flip true (after UAT on a preview branch) to show the feed; kill-switch = false.
   *
   * 🟢 HOLE-CARD GUARANTEE: hole_cards are persisted ONLY when the operator reveals
   * them at showdown/runout (already face-up at the physical table); there is NO
   * hidden/RFID hole-card source, and this feed shows COMPLETED hands only → the
   * viewer can never know more than the table showed → no leak, no delay needed.
   * ⚠️ If an RFID / hole-card-camera source is ever added, this guarantee BREAKS and
   * a broadcast delay + reveal policy becomes mandatory before showing any hand.
   */
  liveHandFeed: true, // GO-LIVE 2026-06-22: spectator hand feed enabled (owner-approved)
  /**
   * Live-tracker table FX (presentational): a chip-push-to-pot animation on
   * bet/call/raise/all-in + a card-reveal-once stagger on the felt, enriched synth
   * sounds (flop riffle / turn / river deal swooshes, card-muck fold, chip clink),
   * AND the same sounds + chip-push fired while a hand is PLAYED back in replay
   * ("Phát lại"). ADDITIVE: visual FX (chip-push / board stagger) is gated by the
   * LiveFelt PROPS the VIEWER passes, so operator / TV stay byte-identical at RUNTIME.
   * When OFF: viewer + replay render + sound exactly as today (replay is silent, as it
   * always was). Frontend-only. Kill-switch: set false.
   */
  liveTableFx: true, // GO-LIVE 2026-06-22: chip-push + enriched sounds + replay audio (owner-approved)
  /**
   * VinPoker-native table motion v2. Drives deal, muck, board, showdown and
   * verified pot-award overlays from persisted live/replay events. Display-only;
   * never computes cards, pot or winners. Ships OFF for preview/UAT.
   */
  liveTableMotionV2: true,
  /**
   * Public live-tracker EVENT TABS (RPT-Live style): opening `/live/:id` no longer
   * drops straight onto the felt — it shows a 5-tab event page (Cập nhật / Lịch sử
   * ván / Giải thưởng / Cấu trúc / Hình ảnh). The felt mounts ON DEMAND (tap the
   * "Bàn đang chơi" card to watch live, or a hand to replay). Public-viewer-only
   * (LiveHub); TournamentLiveView/operator/TV untouched. OFF → today's stacked
   * layout (felt always shown), byte-identical. Frontend-only. Kill-switch: set false.
   */
  liveEventTabs: true,
  /**
   * Public spectator snapshot v2: server-filtered table catalog, confirmed chip
   * ranking and published payout data with per-section freshness metadata.
   * Owner-approved public rollout after the read contract, bounded worker and
   * TEST tournament snapshot were verified in production. Only recorded cards
   * are published through the public hand RPC.
   */
  publicSpectatorRealtimeV2: true,
  /**
   * Current-session `last_completed` and the one-table history panel.  It ships
   * dark so migration/worker/frontend can be reviewed in that order; the public
   * projection itself remains read-only and does not change poker authority.
   */
  publicSpectatorLastHandHistory: isPublicSpectatorLastHandHistoryEnabled(),
  /**
   * ── Tracker Ops + Viewer UX upgrade program (RPT parity, plan 2026-07-02) ──
   * PR-F0 flag bootstrap: ALL program flags land here FIRST (default OFF) so the
   * parallel batch PRs never touch this file again (no rebase conflicts). Each flag
   * flips ON individually after its batch passes owner UAT — one-line commits.
   */
  /**
   * PR-O1 (A1): operator blind auto-seed — SB/BB/ante auto-fill from the live
   * `get_tournament_clock` level on every new hand (with provenance "Level N ·
   * SB/BB · fetched at HH:MM"), stale-level banner shows next-hand amounts, one-tap
   * blind posting. Clock fetch failure → manual entry (NEVER auto-fill zero).
   * Amounts stay editable — a confirm assist, not a silent mutate. Frontend-only.
   */
  trackerBlindAutoSeed: false,
  /**
   * PR-O1 (A2): "Ván tiếp theo →" express CTA after record_hand — carries hand
   * number + button suggestion + blinds (A1) to start-confirm in one step, with a
   * double-click guard (no duplicate/orphan hands). Frontend-only.
   */
  trackerNextHandExpress: false,
  /**
   * PR-O2 (A3): in-console chip quick-edit (same `update_seats` Edge call as
   * EditChipsDialog — no new backend) + pre-submit projected-stack preview in
   * review. Chip-integrity guards: between-hands only, reason required, server-
   * confirmed base, re-fetch after update (no optimistic drift). Frontend-only.
   */
  trackerChipQuickEdit: false,
  /**
   * UAT wave 2 (Fix 1): cover-call all-in runout auto-flow. When ON: once a covering
   * stack's call closes betting with everyone else all-in, the engine waives the lone
   * coverer's pointless per-street "check" (isRoundComplete true / actorToAct null via
   * EngineState.coverCallWaiver), so the board runs out enter_flop → enter_turn →
   * enter_river with no action states; the runout reveal panel also gains a guarded
   * "Tiếp tục không lật" escape when the operator has no hole-card info. OFF (default):
   * behavior byte-identical to today — THE COVER-CALL BUG REMAINS until this flips.
   * Operator-only; no server change (client simply stops sending runout-street actions).
   * **ON 2026-07-03** for owner UAT (no external users; #674 merged). Kill-switch: set false.
   */
  trackerCoverCallRunout: true,
  /**
   * All-in runout ONE-SCREEN (operator): during a multi-way all-in runout, replace
   * the per-street BoardEntryPanel (enter flop → Gửi → enter turn → Gửi → enter
   * river → Gửi, ~11 taps) with a SINGLE panel that takes every remaining board slot
   * at once + one "Chia hết bài" button. That button fires the EXISTING
   * update_community_cards payload in staged cumulative calls (flop → turn → river,
   * ~0.9s apart) so the /live viewer still gets a street-by-street reveal. No DB/Edge
   * change — same edge action, same cumulative-array semantics as handleUpdateCommunityCards,
   * just orchestrated in one operator gesture. OFF (default): the per-street panel is
   * byte-identical to today. Operator-only; the per-street flow stays as the fallback.
   */
  trackerRunoutOneScreen: false,
  /**
   * Operator workflow aids (small, additive quick-wins from the workflow audit):
   *  • "Lấy blind mới ngay" — a button that pulls the live tournament-clock level on
   *    demand (the 25s auto-poll can be stale after a level change) and re-seeds the SB/BB
   *    inputs, but ONLY when no blind has been posted yet this hand (never mutates posted
   *    amounts). Reuses the existing get_tournament_clock read.
   *  • Chip-conservation DIAGNOSTIC — when the review's start/end totals don't match, the
   *    banner also shows the exact "Lệch: ±X" amount + a plain hint, so the operator can
   *    find the wrong ending stack instead of guessing.
   * OFF (default): neither surfaces (byte-identical). No DB/Edge change; operator-only.
   */
  trackerWorkflowAids: true,
  /**
   * Tablet 2-column layout for the RACETRACK operator console. Today the console is a
   * single centered column (felt on top, guided action region + log stacked below), so
   * on a tablet the operator scrolls between the felt and the action buttons. When ON,
   * at ≥xl (1280px+) the felt moves to a LEFT column and the guided region + log sit in
   * a fixed RIGHT column, both visible at once (the approved mockup). Below xl (phones,
   * narrow tablets) it stays the single column — the wide 13/6 racetrack felt needs
   * ≥1280px for a 2-col split without cramping. OFF (default): the single-column layout
   * is byte-identical to today. Presentational only — no data/handler change.
   */
  trackerTabletLayout: true,
  // Only deploy this bundle after the operational Floor alert RPC is live and verified.
  trackerOperationalFloorAlerts: true,
  /**
   * Felt UI v2 (owner "fix UI UX toàn bộ" wave): bigger seat pods on the RICH operator
   * felt — 44px avatars (was 32px), full player names on up to 2 lines (no more
   * "Adrian …" ellipsis), wider pod clamps, re-tuned seat anchors so the taller pods
   * still fit the oval — AND the owner's Sakura card back (gold 5-petal medallion on a
   * wine lattice, from vinpoker-card-back.html) replacing the guilloché design in the
   * SHARED CardBack (operator hole backs + /live viewer + hand feed change together —
   * owner-approved; colors ride the --poker-card-* tokens so dark↔warm still works).
   * OFF (default): pods AND card back byte-identical to today. Presentational only.
   */
  trackerFeltV2: true,
  /**
   * Owner-recorded action sounds for the tracker (operator console + /live viewer).
   * When ON: check / fold / deal flop / deal turn+river / gom-chip-về-pot play the
   * owner's MP3 clips (public/sounds/tracker/, see LICENSES.md there); the operator
   * console gains action sounds (today it is silent) + a mute toggle sharing the
   * viewer's `tracker_sound_muted` localStorage key; bet/call/raise/all_in keep the
   * existing poker-bet.mp3. OFF (default): the sound engine's MP3 mapping and both
   * surfaces' audio behavior are byte-identical to today (operator stays silent).
   */
  trackerActionSounds: true,
  /**
   * "Hoàn tác cả vòng" (street rollback) for the operator console: rolls back a SENT
   * flop/turn/river — deletes all of that street's actions server-side (the existing
   * delete_last_action, one per action, each mirrored by one local undo pop), THEN
   * shrinks the persisted board (the existing update_community_cards wholesale
   * replace), landing back on enter_{street} so the operator can fix an earlier
   * action or edit + resend the cards. The /live viewer sees the street's cards
   * disappear (owner-approved). Blocked after a page reload when the street already
   * has recorded actions (the local undo stack can't mirror the deletes — owner P0),
   * and during all-in runout / showdown / review. No DB/Edge change (reuses two
   * existing endpoints). **ON 2026-07-08** (Đợt F0, owner-approved) — was OFF (controls
   * strip + every handler byte-identical); the flip only surfaces the already-built
   * "Hoàn tác cả vòng" button on active hands.
   */
  trackerStreetRollback: true,
  /**
   * xCards face deck (owner "fix UI UX toàn bộ" wave): replaces the built-in text card
   * FACE (rank + suit on a cream card) with the owner-chosen xCards vector deck
   * (public/cards/xcards/, LGPL v3 — see LICENSES.md there) inside the SHARED PokerCard
   * component, so the operator felt + /live viewer + hand feed all change together. Only
   * the FACE-UP branch is touched — the empty slot + the face-DOWN back are untouched
   * (the Sakura back stays), and a face image that fails to load falls back to today's
   * text face. When OFF: PokerCard renders the text face byte-identical to today.
   * Presentational only — no data/handler change; never renders for a hidden card.
   * Shipped ON at the owner's request ("bật hết") after they picked the xCards deck.
   */
  trackerCardFaces: true,
  /**
   * Showdown reveal ORDER (viewer): at showdown the showing players' hole cards
   * flip IN SEQUENCE (last aggressor on the final street first, else first-to-act
   * from the SB, then clockwise) ~0.5s apart, instead of all at once. Implemented
   * as a viewer-side staggered card-reveal animation ordered by the pure
   * `showdownRevealOrder()` — reliable regardless of poll cadence; works live +
   * replay. The operator still enters all cards + one "Lật bài" (the showdown panel
   * just lists players in reveal order with a ①②③ hint). OFF (default): cards reveal
   * simultaneously as today (byte-identical). Reduced-motion → no stagger.
   * Frontend-only; no DB/RPC/Edge change (broadcast unchanged).
   * **ON 2026-07-03** for owner UAT (no external users; #682 merged). Kill-switch: false.
   */
  trackerShowdownRevealOrder: true,
  /**
   * Pre-hand "Set up table roster" in the operator tracker: before a hand starts, a
   * TRACKER/FLOOR operator sets each seat's NAME + CHIP + optional AVATAR and adds a
   * walk-in to an empty seat. ALL writes go through ONE atomic SECURITY DEFINER RPC
   * `set_tracker_table_roster_seat` (guards tracker/floor/owner/super_admin itself,
   * writes seat + tournament_chip_counts in one txn so the start_hand seed can't
   * desync). TWO-TIER GATE: OFF (default) → the old chip-only quick-edit renders,
   * byte-identical, no new column/RPC touched. ON but the migration `20261215000000`
   * NOT applied → the RPC (42883) / avatar_url select (42703) is caught and the panel
   * degrades to a "chưa áp dụng" state, never crashes. NO edge deploy (the shared
   * tournament-live-draw edge is untouched).
   * APPLIED LIVE 2026-07-05: owner ran migration `20261215000000` in the SQL Editor
   * (col + RPC + grants + storage policy verified: col=1, grants=authenticated/
   * service_role, policy=1, spoofguard=actor_not_allowed). The storage policy was
   * rewritten to a text-comparison since `safe_uuid_from_storage_folder` isn't in the
   * live DB. Flag now ON. Kill-switch: set back to false.
   */
  trackerSeatSetup: true,
  /**
   * Mid-hand DISPLAY-ONLY seat edit: while a hand is in progress, let a TRACKER/FLOOR
   * operator fix a player's NAME or AVATAR (a typo shouldn't force VOIDing the whole
   * hand — the #1 operator pain in the workflow audit). Chips stay LOCKED mid-hand by
   * necessity: start_hand snapshots starting_stack into hand_players and record_hand
   * settles from THAT snapshot, so a mid-hand chip write is silently lost — chip fixes
   * remain a finish/void + ChipQuickEditPanel job. Writes go through a SEPARATE narrow
   * SECURITY DEFINER RPC `set_tracker_seat_display` (name + avatar only, no chip column,
   * no hand_in_progress guard) — the live money-path `set_tracker_table_roster_seat` is
   * NOT re-created. TWO-TIER GATE like trackerSeatSetup: OFF (default) → no mid-hand
   * editor surfaces at all (byte-identical). ON but migration `20261220000000` NOT
   * applied → the RPC 42883 is caught → "chưa áp dụng" degrade. Owner applies the
   * migration in a gated session, THEN flips this. Kill-switch: set false.
   * **ON 2026-07-08** (Đợt F0, owner-approved) — migration 20261220000000 apply status
   * unconfirmed; the 42883 degrade (useStandaloneHandInput.ts:577 → midHandEditSupported
   * false → console gate at RacetrackHandInputConsole.tsx:454 hides the editor) makes the
   * flip safe either way: honest "chưa áp dụng" instead of a crash.
   */
  trackerMidHandEdit: true,
  /**
   * Sửa hand ĐÃ HOÀN THÀNH từ lịch sử (F2). A "Sửa hand" button in HandHistoryPanel
   * opens a DISPLAY-ONLY editor for a completed, non-voided hand: board cards, hole
   * cards, and the action list (edit type/amount, delete a row). Writes go through the
   * narrow SECURITY DEFINER RPC `edit_completed_hand` (mig 20261225000000) which touches
   * ONLY community_cards / hole_cards / hand_actions and NEVER chips/results, binds the
   * actor to auth.uid() itself, and logs an immutable hand_edit_log row. TWO-TIER GATE:
   * OFF (default) → HandHistoryPanel byte-identical (no button). ON but the RPC not
   * applied → 42883 caught → "chưa áp dụng" degrade + the button hides.
   */
  trackerHandHistoryEdit: true,
  /**
   * Sửa hand đã hoàn thành + TỰ TÍNH LẠI CHIP (Đợt G). When ON, the completed-hand
   * editor can re-score the winner and propagate corrected chip stacks forward through
   * later hands via the pure resettle-forward engine (resettleForward.ts), then commit
   * the result through the SECURITY DEFINER RPC `apply_resettle_forward`
   * (mig 20261226000000) — a chips-only, conservation-guarded atomic write that NEVER
   * changes who is eliminated (any bust flip is refused and routed to void+re-enter) and
   * logs an immutable resettle_forward_log row. TWO-TIER GATE: OFF (default) → no
   * re-settle path (F2 display-only edit unchanged). ON but the RPC not applied → 42883
   * caught → "chưa áp dụng" degrade. Money-path: owner applies the migration + UATs.
   */
  trackerResettleForward: true, // GO-LIVE 2026-07-09 (owner-requested); RPC 20261226000000 applied live (#815). Kill-switch: set false.
  /**
   * Multi-table lock visibility + takeover (operator). The table picker shows who
   * holds each in-progress hand ("khóa bởi <tên> · X phút") via the read-only RPC
   * `get_tracker_table_locks`, and offers a "Tiếp quản" button for a STALE lock
   * (heartbeat older than the 5-min TTL) that calls `takeover_hand_lock` before
   * opening the table — so a shift-change tracker no longer has to wait out the TTL
   * or refresh blindly. When ON, the heartbeat "lock lost" toast also NAMES whoever
   * took over instead of the generic "phiên hết hạn". TWO-TIER GATE: OFF (default) →
   * the picker + heartbeat are byte-identical (no new RPC called). ON but the
   * migration `20261221000000` NOT applied → the lock RPC 42883 is caught and the
   * picker simply omits lock info (no crash).
   * ⚠ Before flipping ON, verify the live record_action enforces the lock
   * (migration 20260928000000): SELECT prosrc LIKE '%tracker_lock_blocks%' FROM
   * pg_proc WHERE proname='record_action'; else takeover is unsafe (two writers).
   * Kill-switch: set false.
   */
  trackerMultiTable: false,
  /**
   * PR-V1 (B1): replay HUD parity — BB/ANTE + to-act + POT bar under the felt,
   * SUMMARY|ACTIONS tabs (winner rows ±BB + hand-summary bullets from revealed data
   * only), prev/next hand + jump-to-end (silent) + breadcrumb. Viewer-only;
   * unreliable frame data → field hidden (best-effort, never fake). Frontend-only.
   */
  liveReplayHud: true,
  /**
   * Public Viewer RPT-inspired focus shell. This is presentation-only: a dedicated
   * /live/:id chrome, URL-persisted tabs, touch-sized controls, compact spectator
   * feeds and a responsive replay composition. It never changes the operator/TV
   * path or any hand/pot/winner data. Default OFF; owner visual UAT is required.
   */
  liveViewerRPTShell: true,
  /**
   * PR-V2 (B2): compact-wide RPT-style felt on portrait phones (felt ≈ ⅓ of the
   * viewport, pods around the rim, stacks in BB, controls+summary below). Viewer-only
   * variant — operator/TV byte-identical is a hard merge gate (full-render equality
   * test + before/after screenshots + DOM diff). HIGHEST-RISK visual flag.
   * PR-A1 (#666) merged the implementation dark; flipped ON here for OWNER VISUAL UAT
   * (no external users → owner-only preview). Rollback: set back to false.
   */
  liveFeltCompact: true,
  /**
   * liveBetChips — render each player's committed bet as a chip-DISC on BOTH the
   * operator `TrackerRacetrack` felt AND the `/live` viewer (`LiveFelt`), instead of
   * the operator's plain text puck / the viewer disc vanishing on a street change.
   * Operator: `TrackerRacetrack` upgrades its text puck → `ChipStack` disc under the
   * `betChips` prop. Viewer: `TournamentLiveView` carries a display-only
   * `display_committed_bet` (whole-hand), so `LiveFelt` keeps the disc for the whole
   * hand (does NOT reuse/overload `total_committed`). Frontend-only; no DB/Edge.
   * Operator/TV byte-identical when OFF (guards: liveFeltOperatorProps /
   * manualUnchanged / racetrackPayloadParity). Ships OFF; owner flips after preview
   * UAT. Kill-switch: false.
   */
  liveBetChips: true,
  /**
   * trackerFeltDealerFix — operator `TrackerRacetrack` geometry fix for the bottom
   * "DEALER / người chia cố định" station overlapping Ghế 1/9 and the "▲ Tracker đứng
   * đây" cue. When ON: bottom seats (1, 9) are nudged up and the cue merges into the
   * dealer block (one bottom-center element, no self-overlap); the RICH portrait felt
   * also uses the de-crowded TRACKER_PORTRAIT_SEATS_FIX map on a taller oval so the 9
   * pods fit without overlap at 390px (pinned by TrackerRacetrack.geometry.test). Falsy
   * ⇒ today's geometry (byte-identical). Presentational only. Kill-switch: flip to false.
   */
  trackerFeltDealerFix: true,
  /**
   * PR-V3 (B3): viewer "moments" — pot-collect sweep at street end, elimination
   * moment, level-up toast, header Reload. Reduced-motion guarded; no auto-sound;
   * animations never block state updates. Frontend-only.
   */
  liveMoments: false,
  /**
   * PR-N1 (B5): SPOTLIGHT editorial posts (staff commentary + photo on the public
   * feed). TWO-TIER GATE: while false the UI NEVER queries `tournament_posts`; if
   * flipped true before the source-only migration is owner-applied, the UI catches
   * the missing table (42P01) and renders a disabled "chưa áp dụng" state — never a
   * crash. Flip ONLY after the owner applies the migration in a controlled session.
   */
  liveSpotlightPosts: true,
  /**
   * Public Live Center, mobile history-first viewer and public clock adapters.
   * The flag remains OFF until the read-only RPCs are applied and Preview UAT passes.
   */
  liveViewerPulseV2: true,
  /**
   * Public Tournament Live Viewer V2: sticky tournament rail, authoritative
   * 9-seat table directory and chrome-less public route. Source lands dark;
   * Production must remain OFF until the sanitized public contract and UAT pass.
   */
  publicTournamentRailV1: false,
  /**
   * Floor bust + payout confirmation through the server-authoritative atomic RPC.
   * OFF preserves the current Floor workflow and makes no new write call.
   */
  floorAtomicPayout: false,
  /**
   * Atomic completed-hand edit and forward resettle through the dedicated Edge path.
   * The controlled production rollout is owner-approved. The build acknowledgement
   * remains mandatory before the browser may invoke the write path.
   */
  trackerAtomicResettle: true,
  /**
   * Owner-only verification for completed historical hands. The control asks
   * the server to prove existing rows before it creates a display outcome for
   * replay; it never repairs stacks or settles from the browser. Enabled after
   * the migration and Edge path passed the owner-authorized rollout gate.
   */
  trackerHistoricalSettlementDisplay: true,
  /**
   * Batch commit for independently verified historical display outcomes. The
   * workspace may always run a read-only preview scan, but this write CTA stays
   * OFF until owner UAT proves the full tournament/table/hand workflow.
   */
  trackerHistoricalSettlementBulk: false,
  /**
   * Durable historical display worker and owner/admin queue view. Both stay
   * dark until the database and Edge gates pass owner UAT.
   */
  trackerHistoryCompletionWorker: false,
  /**
   * Viewer Felt V2 — responsive, CoinPoker-style public spectator poker table.
   * Fixes the mobile bug where hole cards overlap each other / the central board by
   * sizing every card with the felt's own width (CSS container query + clamp), and
   * (PR-B) ships premium geometry + compact pods. PUBLIC-VIEWER-ONLY: gated by the
   * LiveFelt `viewerLayout` prop, which `TournamentLiveView` sets ONLY when
   * `spectator` (LiveHub is the sole setter of spectator=true) — so operator hand
   * input + TV stay byte-identical. When false the felt renders exactly as today.
   * The V2 path also forces its own neon premium surface, so the redesign never
   * depends on `liveHandFeed`/`viewerNeon` being on. Frontend-only. Kill-switch: set false.
   */
  liveViewerFeltV2: true,
  /**
   * Tracker Engine Mode (Phase 1) — engine-assisted operator Hand Input. While
   * ON, the pure `trackerEngine` drives action order (correct heads-up / 3+
   * seeding), legal actions, "Bet to" (street-total) sizing, automatic
   * betting-round close + local street progression, and fold-win / simple
   * selected-winner settlement pre-fill — with manual tap-any-seat override kept
   * (out-of-turn shows a warning, not a hard-block). Default **OFF**: while false
   * the operator flow is the existing manual path (except the always-on pre-start
   * guard requiring an explicit dealer-button selection). Frontend-only — no
   * DB/RPC/Edge; settlement persists via the existing `record_hand` ending_stack
   * payload and the live viewer reads street from community_cards / hand_actions
   * as today. Phase 2 adds the hand evaluator + exact side-pot settlement.
   *
   * Restored to the documented OFF default 2026-06-19: PR #313 (a "[DO NOT MERGE]
   * UAT preview" branch) was merged by accident and flipped this to true on main,
   * shipping the un-UAT'd engine flow to ALL operators with no runtime toggle.
   * Real Engine Mode UAT must run on a preview branch (flag ON) while main/prod
   * stays OFF — never via main.
   */
  trackerEngineMode: false,
  /**
   * Tracker Unified Ops V2 master gate. Source-only PRs keep this OFF.
   *
   * OFF preserves the current standalone and embedded Hand Input paths and does
   * not load/query any V2 backend contract. ON replaces both writer mounts with
   * the exact-table Unified Ops boundary; the legacy Seat Setup / Chip Quick Edit
   * controller must not remain mounted behind CSS. Preview enablement is a
   * separate owner-gated commit and must never be merged into main before UAT.
   */
  trackerUnifiedOpsFlow: false,
  /**
   * Voice-assisted dealer input for the Tracker console. Source ships dark: the
   * panel is not mounted and no microphone/session RPC runs while false.
   */
  trackerVoiceInput: isTrackerVoiceBuildEnabled(import.meta.env.VITE_TRACKER_VOICE_INPUT),
  /** Ops-only aggregate player analytics. Never exposed by the public viewer. */
  trackerPlayerAnalytics: false,
  /**
   * Final autonomous action gate. This source flag is intentionally insufficient
   * on its own; the server capability/allowlist/confidence gates must also pass.
   */
  trackerVoiceAutoCommit: false,
  /**
   * Standalone operator Hand Input console (`/tracker/hand-input`) — the full-screen
   * floor-control surface (2-col desktop / 3-tab mobile) per the approved mockup.
   * Decoupled from `trackerEngineMode`: this flag ONLY enables the standalone console
   * (page mount + the "open console" entry button in the operator Nhập-hand tab); it
   * does NOT change the embedded HandInputPanel. The console reuses the SAME engine
   * write-path (7 Edge payload builders) as the embedded panel — no DB/RPC/Edge change.
   * Default **OFF**: while false the route shows a friendly notice, never mounts the
   * controller hook, and the entry button is hidden → zero change to the live operator
   * flow. Flip to true (after operator UAT on the preview branch) to let floor staff
   * open the new console. Kill-switch: set false to instantly hide it again.
   */
  trackerHandInputConsole: true, // GO-LIVE 2026-06-21: operator console enabled as the racetrack (owner-approved)
  /**
   * Racetrack operator console — when ON, `/tracker/hand-input` renders the
   * RacetrackHandInputConsole (TrackerRacetrack felt + ActionDock) instead of the
   * LiveFelt-based StandaloneHandInputConsole. BOTH use the SAME `useStandaloneHandInput`
   * hook + the same guided sub-panels, so every engine feature (settlement / runout /
   * elimination / dead-button) is identical — only the felt + action-step presentation
   * differ. Default **OFF**: the route keeps the existing StandaloneHandInputConsole, so
   * production is unchanged. Flip to true (after operator UAT) to make the racetrack live.
   */
  trackerRacetrackUi: true, // GO-LIVE 2026-06-21: racetrack IS the operator console (owner-approved)
  /**
   * Racetrack RICH felt — additive visual enrichment of <TrackerRacetrack>: per-seat
   * hole cards (face / face-down) + avatars, main+side-pot chips, a distinct
   * engine-suggestion cue, a pre-hand waiting overlay, responsive portrait/landscape
   * seat maps, and the burgundy+gold poker-felt skin (reusing the existing
   * --poker-felt/--poker-gold tokens + PokerCard/CardBack). Presentational ONLY — it
   * reads MORE of the data the hook already produces (playerHoleCards, potBreakdown,
   * avatar_url, engineActor) and changes NO write-path / engine / RPC / Edge. Default
   * **OFF**: while false the console passes ONLY today's props, so the racetrack renders
   * byte-identical to the current live console (mirrors LiveFelt's opt-in physicalSeats
   * pattern). Flip to true (after operator UAT on the preview branch) to make the
   * richer table live; kill-switch = set false.
   */
  trackerRacetrackRich: true, // GO-LIVE 2026-06-22: rich operator felt enabled (owner-approved)
  /**
   * Dealer Mobile App (/dealer/*) — dealer-facing portal over the Shift Planner
   * V2.1 layer (view shifts, confirm, ROSTER check-in/out, careers/marketplace).
   * **ON** (2026-06-16, owner-approved launch for dealer UAT): the app is visible
   * to all users and runs on LIVE data (source = "live" since `dealerShiftPlanner`
   * is also ON + its additive migration `20260827000000` is applied). Un-logged-in
   * visitors to /dealer now see <DealerLogin/> (account code + password the Telegram
   * bot issues, or the one-tap magic link) instead of the shared email login. Reads
   * only `dealer_shift_assignments` / `dealers` / `profiles`; NEVER touches the live
   * Dealer Swing / attendance / payroll tables. Self-service write RPCs
   * (confirm/check-in, Migration A) + careers tables (Migration B) are NOT applied
   * live yet, so the action buttons stay preview-only (toast) and careers tabs run
   * on mock — no missing-table crashes. Kill-switch: set false to re-hide the app
   * (back to <DealerComingSoon/> for non-admins).
   */
  dealerMobileApp: true,
  /**
   * Dealer Swing Feature/Final table dealer pools (ADR 012) — CONFIG-UI flag.
   * When true: the table-mode badges, the config dialog, and the "Đội dealer tâm điểm"
   * right-rail box render and read live data via get_table_dealer_rules (Patch 6 wired the
   * real RPCs — no longer a mock). This flag ONLY reveals the config UI; it is NOT the
   * enforcement gate. Enforcement (the seat trigger + picker pool-filter blocking a non-pool
   * dealer on a feature/final table) is a SEPARATE kill-switch,
   * app_settings('dealer_feature_tables_enabled'), which stays OFF until owner-flipped
   * post-UAT → so configuring a pool here is INERT (saved, not yet protecting; the UI shows
   * an "enforcement OFF" banner). Reads are authz'd by get_table_dealer_rules
   * (is_club_dealer_control OR super_admin); the box is also role-gated in DealerSwingTab.
   */
  dealerFeatureTables: true,
  /**
   * Dealer self-salary screen — "Lương của tôi" in the dealer app (/dealer/salary),
   * READ-ONLY. FT shows the saved monthly payslip (full breakdown); PT shows a live
   * accruing balance + payment history. Dealers never pay themselves (the club pays
   * + resets). Default **OFF** (dark): while false the bottom-nav "Lương" tab is
   * hidden. Salary-A ships only a MOCK preview screen (no DB/RPC); the real per-dealer
   * data (get_my_dealer_payroll / get_my_pt_wage) + the PT wage ledger are wired in
   * Salary-D AFTER the B1 backend is applied live + types regenerated. Flip to true
   * ONLY after that. The /dealer/salary route is ALSO flag-gated — it redirects to
   * /dealer when off (not just nav-hidden), so direct navigation can't reach it.
   */
  dealerSelfSalary: true,
  /**
   * Scheduled pool entry for dealer self check-in (app + Telegram). UI-only mirror
   * of the server flag `dealer_selfcheckin_config.scheduled_pool_enabled`. When ON,
   * the dealer app shows the pool-entry note ("đã có mặt · vào pool lúc HH:MM" while
   * early, "đang trong pool" once the scheduled start is reached) and the check-in
   * toast reflects pending vs entered. **ON** (2026-06-16, Phase C): migration
   * `20260915000000` is applied live, the telegram-bot is redeployed, and the server
   * flag `dealer_selfcheckin_config.scheduled_pool_enabled` is set true. This flag is
   * UI-only — the rule is enforced server-side regardless of it; it just shows the
   * pool note. Kill-switch: the authoritative off-switch is the SERVER flag
   * (`UPDATE dealer_selfcheckin_config SET scheduled_pool_enabled=false`); set this
   * false too to also hide the UI note. See plan: dealer self check-in → scheduled
   * pool entry.
   */
  dealerPoolBridge: true,
  /**
   * Dealer Swing "Đóng tour" — Archive & Close Tour. Floor closes a whole tour:
   * the server archives the full swing snapshot (tour, tables, assignments,
   * break pool, reserved, audit) into `dealer_swing_archives` and ONLY THEN, in
   * the same transaction, releases every tour table + sends its dealers to the
   * break pool (on_break) — via the SECURITY DEFINER RPC
   * `archive_and_close_dealer_tour` (PR2 source-only, owner-gated apply).
   * The confirm dialog requires typing "DONG TOUR". **ON** (2026-06-15): the
   * migration `20260902000000_dealer_swing_close_tour.sql` (RPC + archive table)
   * is APPLIED LIVE + verified in a controlled session, and the owner chose a
   * GLOBAL launch — so all dealer-control staff see "Đóng tour". The RPC is
   * still permission-gated (each closes only their own club's tours) + idempotent
   * + archives before any release. Kill-switch: set false to hide the button.
   */
  dealerSwingCloseTourArchive: true,
  /**
   * P4b-2 Insurance Participation Layer admin UI at /club/admin/insurance — manage each
   * dealer's insurance_mode (NONE/STATUTORY/SERIES_ONLY), region, salary base + include
   * flags; read the region rate table. Default **OFF** (dark). While false the route and
   * the ClubAdmin entry card are hidden. Flip to true ONLY after the P4b Phase 1 tables
   * (`dealer_insurance_profiles`, `insurance_policy_rates`, migration 20260910000000) are
   * applied live. Until then the screen shows a "chưa áp dụng" notice and Save is disabled.
   * Read/write only the two config tables — NEVER touches calculate_dealer_payroll.
   */
  insuranceProfiles: false,
  /**
   * Floor Table Ops (Phase A1 + A2) — "Mở bàn" (open/reopen table), "Thêm người"
   * (pure seat placement, NO money), "Đóng bàn" (broken-table redraw → fill empty
   * seats, shortest-table-first), and "Bốc lại" (scheduled/tournament redraw:
   * final_table / table_count_threshold / itm / manual_custom, preview→confirm) on
   * the floor table-detail sheet / map. **ON for combined A1+A2 UAT.** All four RPCs
   * are applied live & verified in controlled DB sessions: `open_tournament_table`
   * 20260912000000, `floor_assign_player_to_seat` 20260913000000,
   * `close_tournament_table` 20260914000000, `redraw_tournament` 20260918000000
   * (SECURITY DEFINER, search_path=public, authenticated-only). Floor seat moves
   * only — never touches cashier money flow, payroll, or dealer swing. Rollback:
   * set back to false → redeploy (RPCs stay live but inert without this UI).
   */
  floorTableOps: true,
  /**
   * Session-based Floor/Dealer/Tracker table-control convergence.
   *
   * Default OFF: V3 writers are additionally revoked at the database boundary
   * until the additive contract is applied, authenticated Preview UAT passes,
   * and an owner-gated rollout explicitly re-grants the exact writers.  This
   * switch must never be used as an authorization mechanism.
   */
  floorTableControlV3:
    isFloorTableControlV3PreviewEnabled() || isFloorTableControlV3ProductionEnabled(),
  /**
   * Floor Free Sit: release the selected V3 seat while preserving the entry and
   * exact stack in the existing waiting state. Its production deployment follows
   * verified migration application and authenticated UAT.
   */
  floorFreeSitV1: true,
  // Server-reserved Tracker destination seats apply only after the active hand
  // ends. Deploy this bundle only after the Floor DB, Edge and queue ACL gates.
  floorDeferredTrackerMoveV1: true,
  /**
   * Persisted 8/9-max redraw + empty-seat locks. Dark by default and separate
   * from Floor V3 because its additive tables/RPCs require their own DB gate.
   */
  floorRedrawSeatLockV1: isFloorRedrawSeatLockV1Enabled(),
  /**
   * Ops phone app (mobileOpsV2) — Dealer Swing action wiring. The `/ops/dealer-swing`
   * page renders every operator action (swing 1 table, assign a specific dealer via the
   * picker, send-to-break, single + batch check-out) but keeps each button on a stub
   * "đang nối" toast until this flag is ON. Flip to true ONLY after the owner UATs on
   * Preview and confirms the real board is correct. The wired handlers mirror the desktop
   * DealerSwingTab handlers 1:1 (perform_swing / assign-dealer force_dealer_id /
   * manage-break start / checkout-dealer) — same server RPCs/edge fns, same RLS
   * (`is_club_dealer_control`); no new write path, no migration. Kill-switch: set false →
   * every button reverts to the stub. Đóng tour / sửa nhầm bàn / check-in QR stay stubbed
   * (need a shift/club selector the phone does not track yet). Owner-approved live rollout: **ON**.
   */
  opsSwingActions: true,
  /**
   * Wide rollout gate for the completed Dealer Swing phone workflow. Keep OFF
   * through merge and production dark deploy. A server-side TEST-club allowlist
   * can enable UAT without turning this source gate on for every club.
   */
  opsSwingPhoneCompletion: false,
  /**
   * Club "Lịch series" — a per-club gallery of MANY series-schedule images (posters +
   * match schedules) shown as a swipeable carousel on the public ClubDetail page and
   * managed by admins in Media Center (MediaClubSchedules), alongside the single
   * daily/weekly schedule images. Default **OFF**: needs the source-only
   * `club_series_images` table (20261022000000) applied live first. While false the
   * admin upload section and the ClubDetail carousel do not render / never query the
   * missing table. Flip to true ONLY after the table is applied in a controlled DB session.
   */
  clubSeriesSchedule: true,
  /**
   * Multi-day tournaments ("Main Event" + flights + final day). Default **OFF**:
   * needs the source-only `tournament_events` table + `tournaments.event_id/phase/
   * flight_label` columns (20261024000000) applied live first, then the atomic
   * create RPC (MD-1B). While false: the "Multi-day" create option is hidden and
   * NOTHING queries `tournament_events` or the new columns (no select, no group-by
   * event_id) — so a not-yet-applied schema can never break the page. Flip to true
   * ONLY after the schema + create RPC are applied live in a controlled DB session.
   */
  multiDayTournaments: true,
  /**
   * New neon-green broadcast Tournament Clock (PR Clock-B). When true, every screen that
   * composes TvClockScreen (/tv/:id, /display/:token clock layout, ?mock=1) renders the new
   * VinPokerTournamentClock fed by mapTvDataToClock instead of the legacy Tv* layout. Default
   * **ON** (Clock-C, owner-enabled after UAT): live TV/tournament clocks now render the
   * neon-green VinPokerTournamentClock. Presentational-only swap: no DB writes, reads are
   * additive (starting_stack/guarantee_amount/buy_in/rake_amount/cover_url in the TV select).
   * Kill-switch: set false to instantly restore the legacy Tv* layout.
   */
  tournamentClockV2: true,
  /**
   * Tournament/Main Event TV layout editor + paired-display branding contract v3.
   * ON for the owner-opened Centerpoint production UAT. Every editor mutation
   * remains fail-closed behind can_edit_tv_tournament_layout_v1 and the server
   * release/club/role gate; this source flag only ships the integrated reader UI.
   */
  tvLayoutEditorV1: true,
  /**
   * Per-tournament SERVICE FEE (phí dịch vụ) — a SECOND configured per-entry charge, separate from
   * rake. Player price = buy_in + rake_amount + service_fee_amount. Default **OFF** (dark). While
   * false: the ClubAdmin tournament create/edit "Phí dịch vụ" input is hidden, the cashier offline/
   * re-entry fee default stays = rake only, and the Owner Finance "Phí dịch vụ" line is suppressed.
   * Flip to true ONLY after BOTH owner-gated migrations are applied live: `20260915000000`
   * (tournaments.service_fee_amount column) AND `20260916000000` (get_club_finance_summary v3 with the
   * serviceFee stream), and the tournament-register edge fn is redeployed. The column defaults to 0, so
   * every existing tour is unaffected until an owner sets a service fee > 0.
   * **ON** (2026-06-17): both migrations applied live + golden-diff verified (output identical
   * except serviceFee=0), edge fn deployed. Kill-switch: set false to hide the UI again.
   */
  tournamentServiceFee: true,
  /**
   * Club Admin -> Verified Market Jeju V1 at /club/admin/market-intelligence.
   * Read-only inspection of the committed public seed release: no Supabase,
   * club data, network, forecasting, or recommendations. Enabled after the
   * owner-approved UAT gate; keep false as the immediate rollback switch.
   */
  seriesMarketVerifiedJeju: true,
  /**
   * Read-only Historical GTD Stress inside Verified Market Jeju.
   * Uses the committed exact Comparable V0 bundle and the trusted P1b adapter;
   * never assembles quantiles or evidence quality in the UI. Default **OFF**
   * pending authenticated Preview UAT. No DB, forecast, probability,
   * recommendation, optimization, or money-path action.
   */
  seriesMarketGtdStress: true,
  /**
   * Read-only Vietnam Schedule Supply intelligence inside the existing
   * /club/admin/market-intelligence route. Consumes only the corrected D1A
   * release/artifact/receipt/correction graph through a fail-closed adapter.
   * No Supabase, private club data, turnout, recommendation, money action, or
   * poster rendering. Default OFF until authenticated owner Preview UAT.
   */
  seriesMarketVietnamSupply: true,
  /**
   * Club Admin → Series Intelligence demo entry at /club/admin/series-intelligence.
   * Frontend-only owner-facing SHELL that explains the Club Intelligence flow
   * (CSV → Data Readiness → Tournament Economics Mini Audit → Series Workflow),
   * the required CSV columns and the safety boundary. No engine, no data, no
   * backend, no DB/RPC/Edge. Default **OFF** (dark): while false the ClubAdmin
   * entry card is hidden; the route still renders for club admins/owners who open
   * it directly (preview) and shows a small "internal demo" note. Flip to true to
   * surface the card for the series-owner demo.
   */
  clubSeriesIntelligence: true,
  /**
   * Series Intelligence — CSV import (test / what-if data). When ON, the collapsed "CSV thủ công"
   * section becomes a real importer: download a template, upload a CSV, and the dashboard renders
   * the parsed events (source: 'csv') with a "dữ liệu test" banner. Browser-only and READ-ONLY —
   * nothing is written to the DB; the data lives in the page session and clears on "Về dữ liệu live".
   * When OFF, the legacy static placeholder (disabled CTA) shows instead.
   */
  seriesIntelligenceCsvImport: true,
  /**
   * Series Intelligence — Forward-layer Monte Carlo EV/Risk (PATCH 3). When ON, the page shows a
   * MonteCarloPanel: pick a festival's events from the reference distribution, assume ρ/α/cost/bankroll,
   * and see a SCENARIO / what-if (EV distribution, P(loss), Risk-of-Ruin, P(overlay)) — explicitly NOT a
   * forecast. Pure client-side; reads only the loaded historical CSVs (never live DB/registrations); no
   * Supabase/RPC/Edge/migration. Also gates the ScheduleGeneratorPanel (PATCH B) + its EV-feed (B.2).
   * **ON (owner UAT, 2026-06-21):** flipped at the owner's request to surface the forward-layer panels for
   * review. Still client-only / read-only / no DB — kill-switch: set false to hide again.
   */
  forwardLayerMonteCarlo: true,
  /**
   * Series Intelligence — CAPTURE v0 Decision Log admin. When ON, the route
   * `/club/admin/series-decision-log` shows a club-owner skeleton to read + manually log decisions into
   * `series_decision_logs` (recommended vs decision vs public action). DATA CAPTURE ONLY — no model, no
   * prediction. Requires the source-only migration `20261125000000_series_capture_v0.sql` to be applied
   * live first (the 4 capture tables); until then the writes have no target. Default **OFF** (dark): the
   * route redirects home when off. Kill-switch: set false to hide the admin skeleton.
   */
  seriesDecisionLog: true,
  /**
   * Series Intelligence — D2C Decision Room V1. Owner-scoped packet/actual
   * read model and explicit D2A/D2B RPC actions. Default OFF until the
   * source-only Preview UAT proves the live contract and mobile states.
   * Kill-switch: set false to keep the existing CAPTURE console unchanged.
   */
  seriesDecisionPacketV1: true,
  /**
   * D3A prospective research capture queue. Read-only queue plus explicit owner actions through the existing
   * CAPTURE hook and D2B native-actual RPC. Default OFF until owner Preview UAT; no migration or new RPC.
   */
  seriesProspectiveResearchCohortV1: false,
  /**
   * Series Intelligence — turnout forecast (transparent ridge log-linear, RESEARCH tier). When ON, step ④
   * of the SI page shows the TurnoutForecastPanel: predicts entries for an upcoming event from the club's
   * OWN past events with a confidence band + tier + walk-forward CV error vs a median baseline. Labeled
   * Hypothesis ("dự báo thống kê — chưa backtest đủ") — NEVER "Model Estimate". Pure client-side, leakage
   * discipline locked (actuals are targets only). Default **OFF** (dark). Flip conditions: ≥12 events with
   * entries + walk-forward CV beats the baseline + owner sign-off. Kill-switch: set false to hide.
   */
  seriesTurnoutForecast: true,
  /**
   * Series Intelligence — B2 forecast provenance capture/card. OFF keeps the existing manual snapshot
   * payload and surface byte-for-byte compatible until Preview UAT approves the live flag.
   */
  seriesForecastProvenance: true,
  /**
   * Series Intelligence — regime caveat (lớp chế độ, static). When ON, every forward-looking number
   * (scenario outlook, Monte Carlo overlay, festival EV, turnout forecast) carries a one-line caveat:
   * "Giả định: chế độ thị trường/pháp lý hiện tại còn giữ…". Text-only honesty layer per the framework's
   * regime principle — no state, no interactivity (the local-only owner switch is a SEPARATE deferred
   * increment). Default **OFF** (dark); kill-switch: set false to hide the caveat lines.
   */
  seriesRegimeNotice: true,
  /**
   * Series Intelligence — "Biên đóng góp theo loại giải" (contribution margin by event type). When ON,
   * the Owner Command Center shows per-type rows: fee revenue kept − observed GTD overlay cost (only for
   * events WITH a GTD; missing-GTD events are counted + noted, never guessed). Explicitly NOT full
   * profit: subtitle states it excludes staff/marketing/operations. Buy-in is never treated as revenue.
   * Pure client-side descriptive math (Observed Pattern). Default **OFF** (dark); kill-switch: false.
   */
  seriesMarginByType: true,
  /**
   * Series Intelligence — fractional-Kelly GTD commitment hint (quant spec §3.5, OPTIONAL/deferred).
   * When ON, the festival EV panel shows a one-line "Gợi ý tham khảo theo Kelly phân đoạn (¼–½)" that
   * requires the owner to ENTER a bankroll (never inferred from data); σ approximated from P5–P95 and
   * stated as such; Hypothesis-labeled, not financial advice. Default **OFF**; build only after PR0–6
   * UAT passes and the owner explicitly asks. Kill-switch: set false to hide.
   */
  seriesKellyHint: true,
  /**
   * Series Intelligence — LOCAL-ONLY "regime changed" switch (PR5b). When ON, the Command Center shows
   * a RegimeSwitch letting the owner mark the market/legal regime as CHANGED, which escalates every
   * RegimeNotice caveat to an active warning. Stored in localStorage on THIS browser only — it is NOT a
   * club setting (other people/devices/agents don't see it); the switch copy states this. Rides on
   * `seriesRegimeNotice` (self-hides when that is off). The DB-backed official flag (audit of who
   * flipped it) is a separate owner-gated increment. Default **OFF**; kill-switch: set false.
   */
  seriesRegimeSwitch: true,
  /**
   * Series Intelligence — TP8 regime tripwire + per-club (P2-11). When ON: (a) the LOCAL "regime changed"
   * mark is scoped PER-CLUB (keyed by clubId, with a one-time migration of any legacy global mark + read-old-
   * key backward-compat) so one owner's clubs don't share it; (b) RegimeSwitch shows a static local WATCHLIST
   * of 5 regime-change signals — ticking ≥2 SUGGESTS the owner consider marking the regime changed (a nudge,
   * never auto-flips). Off (default) ⇒ the mark stays on the legacy global key = pre-TP8 behavior, and the
   * watchlist is hidden. LOCAL-only (localStorage), never the DB. Default **OFF**; kill-switch: false.
   */
  seriesRegimeTripwire: true,
  /**
   * Series Intelligence — G7 forecast calibration card in the ⑥ CAPTURE console. When ON, it scores past
   * forecast snapshots against real actuals (client-side, reads the existing capture tables — NO new DB)
   * and reports in-band rate vs the 90% target + systematic bias. Under-powered by design: below 10
   * scored forecast↔actual pairs it shows a "chưa đủ dữ liệu (X/10)" state and makes no calibration
   * claim. Measured facts only (Observed Pattern). Default **OFF** until real pairs accrue; kill-switch: false.
   */
  seriesCalibration: true,
  /**
   * Series Intelligence — TP9 shadow decisions (P2-12). When ON, the decision dialog gets a "quyết định
   * KHÔNG tổ chức (shadow)" toggle; a shadow decision is a recorded did-not-run choice (stamped with the
   * "[SHADOW] " text convention until the is_shadow column is applied + types regenerated). Shadow decisions
   * are EXCLUDED from calibration scoring (no real outcome to grade) but COUNTED and shown ("N quyết định
   * không-làm"). Pure client-side; no new DB write path (uses the existing decision insert). Default **OFF**;
   * kill-switch: false.
   */
  seriesShadowDecision: true,
  /**
   * Series Intelligence — W1 "Trợ lý Series" at the top of the SI page. When ON, shows the fixed 8-step
   * workflow ring (next step highlighted) + up to 3 concrete "hôm nay cần làm gì" tasks derived from the
   * loaded data (upcoming giải with no forecast · finished giải with no result · GTD gaps · weekly
   * review). Pure derivation (deriveAssistantTasks) — no prediction, no DB write; reads native events +
   * capture snapshots/decisions read-only. Turns the page from a dashboard-to-read into a guide. Works
   * on CSV test data too (softer copy). Default **OFF**; kill-switch: set false to hide the assistant.
   */
  seriesAssistant: true,
  /**
   * Series Intelligence — owner-scoped Club Pulse V1. When ON, the operations page reads the fixed
   * get_series_club_live_pulse_v1 RPC and shows seven aggregate metrics with explicit freshness and
   * unavailable states. No client-side counting, polling, realtime claim, or write path. Active for
   * owner rollout; kill-switch: set false to hide the live pulse surface.
   */
  seriesClubPulseV1: true,
  /**
   * Series Intelligence — V Copilot V1. When ON, sends a minimal owner question to the authenticated
   * series-intelligence-copilot Edge function and renders only evidence-validated output. No browser secret,
   * direct Gemini call, editable money action, or autonomous decision. Kill-switch: set false.
   */
  seriesVCopilotV1: true,
  /**
   * Series Intelligence — V Candidate Authoring V1. When ON, owners can choose
   * a real scheduled tournament and explicitly promote one server-verified
   * candidate for V to read. Default OFF until the additive database contract,
   * authenticated Preview UAT and a narrow flag-on gate are complete.
   */
  seriesVCandidateAuthoringV1: true,
  /**
   * Series Intelligence — TP3 small-field overlay distribution. When ON, overlay simulations whose
   * central field is below 60 entries use a discrete Negative Binomial sampler instead of a continuous
   * log-normal draw, so tiny fields keep realistic integer count mass. Fields at/above 60 stay on the
   * existing log-normal path. Default **OFF**; flag-off must remain byte-identical for risk outputs.
   */
  seriesSmallFieldDist: true,
  /**
   * Series Intelligence — TP2 calendar/edition forecast features (P1-4). When ON, the turnout model adds
   * three known-before-the-event numeric features at the full tier (n ≥ 8): isHoliday (VN holiday/Tết
   * window), isPayday (1st–10th of month), and editionTrend (ln of this brand's edition number, counting
   * only strictly-earlier editions — leakage-safe). Below 8 events, or with the flag off, the design matrix
   * is byte-identical to before. Labeled Observed Pattern, never causal. Default **OFF**; kill-switch: false.
   */
  seriesCalendarFeatures: true,
  /**
   * Series Intelligence — W6 registration-pace check (Bước ④). When ON, a panel lets the owner compare
   * sign-ups-so-far to a CRUDE linear pace toward the forecast, to spot "đang chậm → đẩy bài/satellite"
   * early. All inputs owner-entered; the pace reference is an honest crude assumption (real sign-up
   * back-loads, stated plainly) — Hypothesis, not a claim. No DB/registration read. Default **OFF**.
   */
  seriesRegistrationPace: true,
  /**
   * Series Intelligence — TP1 nowcast (P1-8). When ON, the registration-pace panel adds a real-data
   * nowcast: pick an upcoming giải → it pulls live sign-ups from the auto-captured series_registration_
   * events (read-only) + learns the pace curve τ from PAST completed events (leakage-safe) + blends that
   * with the owner's model forecast in log space (weight rises near the event + with pace reliability).
   * Falls back to model-only / manual when pace data isn't reachable. Hypothesis-labeled, no fake curve.
   * Default **OFF**; kill-switch: false (panel keeps the crude manual pace of W6).
   */
  seriesNowcast: false,
  /**
   * Series Intelligence — W7 "nhập chiến dịch Telegram 1 chạm" in the ⑥ CAPTURE console. When ON, reads
   * the club's already-SENT marketing posts (read-only) and lets the owner pick one + type its spend +
   * link it to a giải, saving a `series_campaign_logs` row via the existing capture insert — so marketing
   * stops being measured by hand. Degrades gracefully (manual entry) when marketing data isn't readable
   * (no role / RLS). Reads marketing_posts read-only; no new RPC/migration. Default **OFF**; kill-switch: false.
   */
  seriesMarketingImport: true,
  /**
   * Series Intelligence — TP4 within-series price sensitivity (P0-1). When ON, a card in Bước ② fits a
   * per-brand 2-variable OLS (ln entries = c − γ·ln buy_in + δ·edition) over the club's OWN event history
   * and reports γ per brand + a pooled median, for brands with ≥3 editions and ≥2 distinct buy-in levels.
   * Descriptive only — labeled Observed Pattern with a bold endogeneity disclaimer (organizers price high
   * when they already expect a big field), NEVER a causal/tested claim. Pure client-side, no DB. Default
   * **OFF**; kill-switch: false.
   */
  seriesPriceElasticity: true,
  /**
   * Series Intelligence — TP6 capacity / censoring (P1-5). When ON: (a) events that HIT their venue capacity
   * (entries ≥ capacity, a truncated/censored observation) are DROPPED from the turnout-forecast fit and the
   * within-series elasticity, so the model doesn't learn a false ceiling; (b) an upcoming event with a known
   * capacity has its forecast band capped at the seat count (attendance can't exceed seats). Capacity is read
   * from the optional CSV `capacity` column (native has no source yet → null, no effect). Flag off ⇒ byte-
   * identical outputs. Methodology transparency, not a new claim. Default **OFF**; kill-switch: false.
   */
  seriesCensoring: true,
  /**
   * Series Intelligence — TP5 rival clash (P0-2). When ON, the turnout-forecast form gets two manual inputs —
   * "đối thủ có giải lớn cùng ngày?" + optional rival GTD — and, when the owner marks a clash, the result shows
   * a caution chip: the forecast is likely biased HIGH because the model has NOT learned rival-event competition
   * (players are split). The forecast number is NOT changed — this is an honest manual reminder (Hypothesis),
   * never a causal adjustment. Recording the rival context to the snapshot's rival_* columns is deferred to the
   * capture flow after the TP-M migration is applied (text convention until then). Default **OFF**; kill-switch: false.
   */
  seriesRivalClash: true,
  /**
   * Series Intelligence — W5 naive baseline next to the turnout forecast. When ON, the forecast result
   * card shows the "dumbest honest guess" (mean turnout of the last 3 SAME-TYPE past events, leakage-safe)
   * + how far the model's number sits from it, so the owner can feel whether the model earns its
   * complexity (quant rule: always compare to a naive baseline). Pure measured fact — no prediction.
   * Default **OFF**; kill-switch: set false to hide the baseline line.
   */
  seriesNaiveBaseline: true,
  /**
   * Series Intelligence — A3 Baseline Battery ("Mốc dự báo đơn giản"). When ON, a compact card next to the
   * turnout forecast compares the model against a FAMILY of simple, honest baselines (historical median,
   * trailing-window mean, same-weekday, and the existing last-N naive), each scored on EXACTLY the same
   * canonical walk-forward folds as the model (A2 machinery — no second CV loop / split / scoring path). It
   * shows each baseline's prediction for the upcoming event + its walk-forward error, and only claims the
   * model is "tốt hơn baseline" when both are scored on identical folds with non-null metrics and the
   * capability gate's minimum fold requirement (A4a) is met — otherwise an honest "chưa đủ dữ liệu để kết
   * luận". Pure client compute (no DB/RPC/Edge). Default **OFF**: while false the panel is byte-identical to
   * today (the battery never runs). Kill-switch: set false to hide the card.
   */
  seriesBaselineBattery: true,
  /**
   * Series Intelligence — A4b honest insufficient-data result + UX (final item of Quant Apply Wave 1). When
   * ON, the turnout forecast panel renders through an honest adapter (`toHonestForecastResult`) instead of the
   * old "not available" branch: with too little history it shows an EmptyExplainer (WHY it's unavailable + WHAT
   * data is needed) — NEVER a fabricated "0 khách" and NEVER "độ bất định tối đa"; with just enough for a
   * simple reference it shows a clearly-labelled "Mốc tham khảo" (baseline name + value + fold count, explicitly
   * "chưa phải dự báo từ mô hình"); with enough data the existing full forecast card renders unchanged. Reuses
   * the A4a capability gate (reasons) + the A3 baseline battery (no new median/naive); the adapter works
   * whether or not seriesBaselineBattery is on. Pure client compute (no DB/RPC/Edge). Default **OFF**: while
   * false the panel + forecastTurnout output are byte-identical to today (the adapter never runs). Kill-switch:
   * set false to restore the old empty/warning branch.
   */
  seriesInsufficientDataUx: true,
  /**
   * Series Intelligence — W2 consistent "why is this block empty?" explainers. When ON, self-hidden /
   * empty SI blocks (forecast when too little history, F&B when no orders in the window, …) render a
   * uniform 3-line card: WHAT it is · WHY it's empty · HOW to unlock — so an empty block never reads as
   * "the app is broken". Presentational only, no data/logic change. Default **OFF**; kill-switch: false.
   */
  seriesEmptyExplainer: true,
  /**
   * Series Intelligence — W4 "gọn" Command Center layout (Bước ②). When ON, below the 4-KPI overview the
   * rest of the cards fold into 3 tap-to-open groups (Tiền / Rủi ro & dữ liệu / Chi tiết) instead of one
   * long scroll, so a non-technical owner sees the headline numbers first and drills in on demand. Pure
   * layout — the SAME cards render, no number/logic change; flag OFF = the exact previous flat order.
   * Default **OFF**; kill-switch: set false to restore the flat layout.
   */
  seriesCommandCenterGrouped: true,
  /**
   * GTD #2 — server-authoritative TRUE prize pool / overlay. When ON, the GTD overlay card
   * reads `get_tournament_prize_pool` (SUM of confirmed buy_in) and shows the real "thực thu"
   * overlay for events with confirmed entries, falling back to the #415 "ước tính" estimate
   * otherwise. Default **OFF** (dark) — the RPC is source-only/not applied yet; flip to true
   * only AFTER the controlled apply of 20261011000000.
   *
   * ON (2026-06-20): RPC applied live + verified (security/grants/owner-scope) and the 3 pre-flip
   * gates passed (refund/void edge · cross-tenant isolation · reconcile). See get_tournament_prize_pool.
   */
  gtdTruePrizePool: true,
  /**
   * Payroll per-dealer MANUAL BHXH + tax override. Adds two optional inputs to the dealer
   * edit/create dialogs ("BHXH thủ công" + "Thuế TNCN thủ công"): để trống = tự động tính,
   * nhập 0 = không thu, nhập số = dùng số đó. Default **OFF** (dark) because it needs the two
   * owner-gated migrations applied live first: `20261001000000` (dealers.manual_bhxh_vnd /
   * manual_tax_vnd columns) AND `20261001000001` (calculate_dealer_payroll override body,
   * golden-diff verified no-op when NULL). While false the inputs are hidden and the
   * dialogs never write the (absent) columns. Flip to true ONLY after both are applied +
   * types regenerated. The formula treats NULL as auto-compute, so applying the migrations
   * alone changes ZERO payroll numbers until the owner actually sets an override.
   * **ON** (2026-06-19): both migrations applied live + golden-diff verified (net byte-identical
   * for all 39 active dealers; overrides NULL = no-op). The dealer edit/create dialogs now show
   * the "Khấu trừ thủ công" inputs. Kill-switch: set false to hide them again.
   */
  manualPayrollDeductions: true,
  /**
   * Salary v2 — operator dealer-salary tab split into two sub-tabs: "Theo tháng · Full-time"
   * (the existing monthly payroll + payment lifecycle, reused unchanged) and "Theo giờ ·
   * Part-time" (live accruing wage balance + full-payment-then-reset). Default **OFF** (dark):
   * the PT sub-tab calls the Salary-B1 RPCs (get_club_pt_wages / pay_part_time_balance) which
   * are merged as source but NOT applied live yet, so while false the parent renders the legacy
   * DealerPayrollTab directly (byte-identical) and the V2 wrapper never mounts. Flip to true ONLY
   * after the B1 migrations (20261028000000/01) are applied live + types regenerated.
   */
  salaryTabV2: true,
  /**
   * Immutable FT payroll statements for clubs beyond the HSOP canary. Keep OFF
   * through source merge and TEST-club UAT; the server rollout remains the
   * authoritative master switch and allowlist for every statement/PDF action.
   */
  payrollStatementPdfAllClubs: false,
  /**
   * Immutable payroll Telegram delivery remains dark by default. The database
   * master switch and per-club allowlist are authoritative; this source flag
   * only prevents a wide frontend surface before an owner-approved rollout.
   */
  payrollStatementTelegramDeliveryAllClubs: false,
  /**
   * Chip Ops — read-only Issued-Chip-Inventory screen (/chip-ops) + the Chip-Master role.
   * The screen shows server-computed per-denomination chip counts + a reconciliation badge for
   * a tournament (RPC `get_issued_chip_inventory`); strictly read-only. Default **OFF** (dark):
   * both the chip_ops_* foundation (migration 20261015000000) and the club_chip_masters role
   * (20261016000000) are source-only / NOT applied live yet. While false: the ClubAdmin entry
   * card is hidden, the /chip-ops route redirects, AND `useAuth` never queries
   * club_chip_masters (so it cannot 42P01 before the table exists — see lib/chipMaster.ts).
   * Flip to true ONLY after BOTH migrations are applied in a controlled DB session + types
   * regenerated. The panel degrades gracefully if the RPC is still absent.
   * **ON** (2026-06-22): the 1a foundation (`20261015000000`) is applied live, so the
   * owner-scoped inventory RPC works. Apply `20261016000000` (Chip-Master role) too to
   * enable delegation + stop the guarded club_chip_masters lookup from 404-ing.
   */
  chipOps: true,
  /**
   * Remote Poker IQ questions — lets the live drill (/poker-iq) merge questions a
   * Super Admin authored in the admin panel (Poker IQ → Câu hỏi, stored in the
   * `app_settings` key `poker_iq_questions`) on top of the built-in static hand
   * bank. Only `approved` authored questions are ever merged, and every hand is
   * shape-guarded (≥2 options + a valid preferredBaseline) before use, so a
   * corrupt bank can never break the drill. Default **OFF** (dark): while false the
   * drill plays the built-in static bank EXACTLY as today (zero extra reads, no
   * behaviour change) — the authoring panel still works so the owner can build &
   * review the bank first. Flip to true to start serving the authored questions to
   * players. Frontend-only — no DB/RPC/Edge/migration (app_settings already exists
   * with public-read / super_admin-write RLS). Kill-switch: set false.
   */
  pokerIqRemoteQuestions: true,
  /**
   * Marketing module — the club-scoped `marketing` role + the /marketing surface (compose →
   * schedule → auto-dispatch to channels) + the `marketing-dispatch` Edge cron. Default **OFF**
   * (dark): it needs the source-only migrations applied live first (`20261101000000` enum,
   * `20261101000001` role, `20261101000002` core schema/RPCs, `20261101000003` dispatch cron).
   * While false:
   *   - the /marketing route redirects and the nav entry is hidden;
   *   - `useAuth` NEVER queries `club_marketers` (see lib/marketer.ts) so it cannot 42P01 before
   *     the table exists;
   *   - the dispatch Edge fn / cron simply have no due posts (or are not yet scheduled).
   * Flip to true ONLY after the four migrations are applied in a controlled DB session, the
   * `marketing-dispatch` Edge fn is deployed, and owner UAT passes on a preview branch.
   * P0 scope is **Telegram-only** — Facebook/Zalo channels stay disabled in the composer until a
   * real per-club integration exists. Kill-switch: set false to hide the whole module again.
   *
   * **ON** (2026-06-24, owner-authorized go-live): the four migrations were applied live + the
   * marketing-dispatch Edge fn deployed + cron scheduled via the marketing-apply workflow (run
   * 28097001780, all steps green incl. dry-invoke=no_posts). Tab now visible in VẬN HÀNH for
   * marketers / club owners / admins. Kill-switch: set false to hide the module again.
   */
  marketingModule: true,
  /**
   * Marketing approval gate. Default **OFF** because the owner chose direct-publish: a marketer
   * can schedule their own posts without a separate approver (a compliance hard-block still runs
   * at schedule time — see `marketing_schedule_post`). Flip to true later to require club-owner
   * approval before a post can be scheduled (the `approved_by`/`approved_at` columns already
   * exist for this). UI-only intent today; the server enforces direct-publish until the approval
   * RPCs are added in a later phase.
   */
  marketingRequireApproval: false,
  /**
   * F&B (Food & Beverage) module — pre-paid food/drink sales + mandatory inventory & COGS.
   * `fnbModule` is the MASTER switch; it ALSO gates the useAuth `club_fnb_staff` lookup (see
   * lib/fnbStaff.ts) so it can never 42P01 before that table exists live. The sub-flags gate each
   * surface: `fnbCounter` (quầy + table ordering), `fnbKitchen` (live Kitchen Display),
   * `fnbInventory` (ingredients/recipes/stock-in/stocktake admin tabs), `fnbFinance` (the F&B line
   * in the Owner Finance dashboard — additionally needs the per-club fnb_settings.fnb_in_club_net).
   * ALL default **OFF** (dark): the source-only migrations 20261111000000..07 are NOT applied live
   * yet, so every F&B page redirects / shows a placeholder and nothing queries the absent fnb_*
   * tables. Flip each ONLY after the matching backend is applied in a controlled DB session + UAT.
   */
  fnbModule: true,
  fnbCounter: true,
  fnbKitchen: true,
  fnbInventory: true,
  fnbFinance: true,
  /**
   * F&B A1 — COMP (đồ miễn phí): cashier/owner authorises a free order (subtotal=0, stock still
   * decrements, COGS snapshotted). Migrations 20261111000012 (schema + fnb_create_comp_order) AND
   * 20261111000013 (comp split in finance/report) applied live 2026-07-02; owner golden-diffed the
   * Owner Finance Dashboard before/after — numbers matched. LIVE.
   */
  fnbComp: true,
  /**
   * F&B A2 — link a regular counter order to a REAL table (game_tables) and/or a seated player
   * (tournament_seats.player_id) for "F&B theo bàn / theo player" reporting — knowing/reporting ONLY,
   * never a player tab/balance/debt. Gates the table/player pickers on the counter AND the new F&B
   * report view. Requires migration 20261111000014 (table_ref/player_ref cols + fnb_create_order 9-arg
   * + fnb_list_link_targets read RPC + fnb_get_report byTable/byPlayer) applied live first.
   * Migration 20261111000014 applied live 2026-07-02 (owner controlled-apply; pronargs=9 verified).
   * ON.
   */
  fnbTableLink: true,
  /**
   * F&B A3 — per-shift cash reconciliation (chốt ca): the counter cashier opens a cash shift, takes
   * F&B orders during it, then closes it by counting the drawer and seeing the variance (khớp/thiếu/
   * thừa) vs the system-expected cash. Time-window design — a shift owns every order whose paid_at
   * falls in [opened_at, closed_at]; the live money RPCs (fnb_mark_paid / fnb_create_order /
   * fnb_create_comp_order) are NOT touched. Requires migrations 20261111000015 (fnb_cashier_shifts) +
   * 20261111000016 (open/close/report RPCs) applied live first. Gates the "Chốt ca" tab on the
   * counter. Migrations 20261111000015/16 applied live 2026-07-02 (owner controlled-apply, PASS).
   * ON after preview UAT.
   */
  fnbShifts: true,
  /**
   * F&B GUEST QR ORDERING (khách quét QR gọi món) — one QR sticker per table opens the chrome-less
   * /fnb/order?t=<token> page: guest confirms "Bạn đang ngồi tại Bàn X", picks a seat, orders from
   * the club menu, then pays by VietQR bank transfer (SePay auto-confirm) or cash (a server collects
   * at the table via /fnb/serve). Gates the guest page, the /fnb/serve server surface, and the
   * FnbAdmin "QR bàn" tab. Requires migrations 20261111000017/18/19 + 20261212000000 applied live
   * AND the per-club fnb_settings.guest_order_enabled switch. Enabled at owner request 2026-07-04.
   * ⚠️ 20261212000000 (SePay FNB- settle) MUST be applied BEFORE any table QR is printed/scanned,
   * else an FNB- transfer settles as flagged_no_match and the one-settlement-per-txn idempotency
   * parks it. Kill-switch: set back to false. (See plan PART 11.)
   */
  fnbGuestOrder: true,
  /**
   * F&B PUBLIC DEMO (/fnb/demo) — a SELF-CONTAINED static showcase for showing the F&B vision to a
   * guest. The page imports NO supabase client and calls NO RPC (every button is a no-op toast), so
   * it can never read or mutate real data. Intentionally **ON** so the "F&B (Xem thử)" item shows in
   * the VẬN HÀNH menu for owners/admins. Kill-switch: set false to hide the demo entirely. The real
   * F&B module (orders / inventory / finance) is NOT on production — it lives on the agent/fnb-module
   * branch behind its own flags and is unaffected by this demo.
   */
  fnbDemo: true,
  /**
   * Payout "Engine 3-neo" — server-authoritative tournament payout curve (auto N / min-cash floor /
   * smooth top-heavy-or-flat distribution / tiers / exact pool preservation), replacing the
   * manual-rows Prizes panel. This is the GLOBAL master switch; the actual per-club rollout is
   * narrowed by `payoutEngineClubs` / `payoutEngineAllClubs` via `isPayoutEngineEnabledForClub`.
   * **ON (staged) 2026-06-29** after backend (PR-2a) + Edge (PR-2b) went live, the per-club gate
   * (#594) merged, and a full live UI write drill (Drill A) passed — but allow-listed to ONE club
   * only (Hanoi Royal Poker `22222222`); every other club keeps the old manual panel UNCHANGED.
   * Official payouts are only ever written by the close-registration snapshot→apply flow — never
   * recomputed live. Kill-switch: set false (or empty the allowlist) → instant revert to the old
   * panel for every club.
   */
  payoutEngine: true,
  /**
   * Per-club allowlist for the Engine-3-neo payout panel (STAGED ROLLOUT). Only consulted
   * when `payoutEngine` is true. Add a club's UUID here to enable the new PayoutEnginePanel
   * for THAT club only — every other club keeps the old PrizeStructurePanel. Empty = no club
   * (safe default). Resolved by `isPayoutEngineEnabledForClub` below.
   */
  payoutEngineClubs: ['22222222-2222-2222-2222-222222222222'] as string[], // Hanoi Royal Poker — first club live
  /**
   * Wide-rollout switch for the payout panel: when true (and `payoutEngine` is true) EVERY
   * club gets the engine panel without listing each id. Keep false during staged rollout.
   */
  payoutEngineAllClubs: true,
  /**
   * Native CUSTOM payout mode (PR-C) — adds a `CUSTOM — CLB tự cấu hình` style to the payout panel
   * where the club dictates the exact split as percentages (server stores basis points, Σ=10000).
   * Default **OFF** (kill-switch). Only meaningful where `payoutEngine` is already enabled for the
   * club. Flip true ONLY after the CUSTOM migration (20261123000000) is applied live and the
   * compute-payouts Edge with the CUSTOM path is deployed; while false the CUSTOM option is hidden
   * and the backend CUSTOM path is never invoked.
   */
  payoutCustomMode: true,
  /**
   * CUSTOM payout extras (import an Excel/CSV payout sheet · save & reload the club's own CUSTOM
   * structures as named templates). Default **OFF** (kill-switch). Only meaningful where
   * `payoutCustomMode` is already on. Flip true ONLY after the templates migration
   * (20261126000000) is applied live; while false the import/save UI is hidden and
   * payout_templates is never read/written for CUSTOM.
   */
  payoutCustomTemplates: true,
  /**
   * Planned payout settings (PR-4) — pre-fills the payout generator (kiểu giải/ITM%/min-cash/
   * làm tròn) from `tournaments.planned_*` (columns already live since 20261120000000, previously
   * unused) and adds a "Lưu mặc định cho giải này" button that writes them back. Uses the
   * EXISTING `tournaments` UPDATE RLS (`is_club_dealer_control` — club owner or TD/floor-control) —
   * no new RPC or migration. **ON** (2026-07-02, owner-approved): no DB dependency to wait on
   * (existing columns/RLS only), so it went live directly. Kill-switch: set false to restore the
   * old behavior (hardcoded DAILY/15%/2×/rounding-by-buy-in defaults, no save button).
   */
  payoutPlannedSettings: true,
  /**
   * CUSTOM payout auto-suggest — a client-only assist in the CUSTOM branch of PayoutEnginePanel:
   * either pick a shape (Top nặng/Cân bằng/Phẳng) or type the top-prize % and the panel fills the
   * editable `customRows` with a full descending, Σ=100%, banded ladder (via `src/lib/payoutSuggest`).
   * Pure pre-fill of editable rows — nothing persists; the server still re-validates on snapshot.
   * No backend/Edge/migration. Default **OFF** (kill-switch): while false the suggest controls are
   * hidden and CUSTOM behaves exactly as today (manual rows / import / templates). Flip true after
   * Preview UAT. Only meaningful where `payoutCustomMode` is already on.
   * **ON 2026-07-11** (owner-approved after #857 merged). Kill-switch: set false.
   */
  payoutCustomSuggest: true,
  /**
   * Satellite manual payout — giải vé (satellite): thêm khối "Satellite (nhập tay)" trong
   * PayoutEnginePanel (máy tính) để operator TỰ NHẬP cơ cấu vé + tiền (mỗi dòng: khoảng hạng +
   * phần thưởng tự do), lưu ở `tournaments.satellite_payout` (jsonb) qua RLS UPDATE sẵn có — KHÔNG
   * qua payout engine (không Σ=pool/snapshot/close), KHÔNG RPC mới. Hiện lại ở Trả thưởng (cockpit
   * điện thoại + panel máy tính + màn TV). Default **OFF** (kill-switch): while false khối satellite
   * ẩn, payout không đổi. Flip true sau khi apply migration 20261238000000 + UAT Preview.
   */
  payoutSatelliteManual: true,
  /** Server-locked Satellite award plans and mode-specific setup. SOURCE ONLY; keep
   * OFF until the plan migration, ticket ledger, Cashier redemption, legal review,
   * and authenticated TEST UAT are all approved. This does not enable ticket use. */
  satelliteAwardsV1: false,
  /**
   * TV payout board — two-tier display (PR-5). Collapses a LIVE_STANDARD run's equal-amount
   * bands (e.g. ranks 10-12) into one "10–12" row instead of 3 duplicate rows, and raises the
   * shown-rows cap (grouped, so a 19-ITM LIVE_STANDARD run now fits without truncation). Pure
   * client-side render change over the SAME `tournament_prizes` data the TV already reads — no
   * new fetch/RPC/migration. **ON** (2026-07-02, owner-approved): pure client render, no DB
   * dependency. Kill-switch: set false to restore `TvPayoutsScreen`'s old behavior (first 12
   * ranks, one row per rank, no band grouping).
   */
  tvPayoutBandedDisplay: true,
  /**
   * Player History (Phase 1 — data foundation). When ON, the cashier offline buy-in form shows an
   * optional "Số điện thoại" field with a member lookup, so walk-ins are anchored to ONE per-club
   * `club_members` row and their entries/results accumulate. The real server-side switch is the
   * per-club `club_settings.player_history_enabled` flag: with that false, the linking trigger +
   * offline RPC do nothing and no member rows are created, so the DB stays fully inert per club.
   * **ON** (2026-07-02, owner-approved): all three migrations (20261208/09/10) applied live +
   * verified (indexes, grants, triggers, single 6-arg offline RPC — no PostgREST overload) and
   * `player_history_enabled=true` set for all 4 clubs. Kill-switch: set false to instantly hide the
   * cashier phone field again (server-side objects stay, just unused by the UI).
   */
  playerHistory: true,
  /**
   * Close Report (Chốt giải) — operator tournament settlement + finalize on the Floor. When ON, a
   * live/final_table tournament shows a "Chốt giải" report: entries by source, money-IN (buy-in
   * pass-through + rake + service fee) vs money-OUT (prize by place + cashout), the club-revenue
   * (= rake + service) and cashier-drawer reconciliation, read-only staking/dealer link status, and
   * a 2-step "Chốt giải" lock (Owner/Cashier only). Locking calls the source-only `close_tournament`
   * RPC (idempotent, audited via tournament_state_transitions, snapshots into tournament_close_report)
   * and does NOT auto-fire staking release or the dealer "Đóng tour" — those stay explicit so it can
   * never double-fire the existing auto-finalize paths. Money doctrine: buy-in and prize are
   * PASS-THROUGH (never club revenue); the report recomputes NOTHING that is already a saved value
   * (payroll, ledger). Default **OFF** (dark): while false the report/button never render and nothing
   * queries the source-only `close_tournament` RPC or `tournament_close_report` table, so an
   * un-applied schema can't break the Floor. Flip to true ONLY after the enum-unify +
   * tournament_close_report + close_tournament migration is applied live in a controlled DB session
   * and owner UAT passes. Kill-switch: set false.
   *
   * **ON** (2026-07-03, owner UAT): migration `20261213000000` applied live (tournament_close_report
   * + close_tournament RPC + enum value 'completed' added first); flipped ON so Owner/Cashier can UAT
   * on a TEST tournament. Kill-switch: set false to hide the "Chốt giải" button instantly.
   */
  closeReport: true,
  /**
   * Floor "Loại" out-confirm dialog. When ON, tapping "Loại" on the floor table map opens a
   * plain, guided confirm dialog that previews the player's finishing place + prize money
   * ("[Tên] về hạng [N] — [tiền]") BEFORE the (unchanged) bust runs. Non-ITM outs show the
   * place only ("ngoài cơ cấu giải"), never a fake prize. Frontend-only: it reads the already
   * live `tournament_prizes` (get_tournament_prizes) read-only and computes place from the
   * live active-seat count the panel already loads — it changes NO write path (the bust is the
   * same `update_seats is_active=false` call; the server auto-records the official result via
   * the player-history chain exactly as before). Default **OFF** (per flag policy): while false
   * the "Loại" button busts immediately, byte-identical to today. Flip to true (one line) after
   * owner UAT to surface the confirm step — a low-risk safety improvement. Kill-switch: set false.
   * **ON** (2026-07-03, owner-approved): frontend-only, reads already-live tournament_prizes; the bust
   * write-path is unchanged. Kill-switch: set false to bust immediately again (byte-identical to before).
   */
  floorOutConfirm: true,
  /**
   * mobileOpsV2 — iPhone-first operator shell under `/ops/*` (SafeAreaPageShell + 5-tab bottom nav:
   * Hôm nay / Giải đấu / Bàn / Cảnh báo / Thêm). Prototype = màn "Floor hôm nay" với DỮ LIỆU MẪU,
   * read-only, KHÔNG thao tác tiền. Frontend-only: không DB/RPC/Edge/migration; không đụng `Layout.tsx`
   * hay `/dealer/*`. Default **OFF** (per flag policy): while false the `/ops/*` routes show a "chưa bật"
   * notice (except admin/owner preview) and nothing mounts → prod unchanged.
   * **ON** (2026-07-04, owner request "bật cờ ops đi"): `/ops/*` visible to floor/cashier/tracker/admin.
   * All screens are **DỮ LIỆU MẪU / read-only** (floor never touches money) — a preview for owner UAT while
   * real-data wiring is a separate owner-gated step. Kill-switch: set false. Spec: docs/design/ios-floor-ux-spec.md.
   */
  mobileOpsV2: true,
  /**
   * Read-only desktop terminal for Owner / Super Admin inside the Ops Control
   * Deck. It resolves a trusted club before mounting any source reader. Keep
   * dark through source merge; Preview and production activation are separate.
   */
  opsIntelligenceCommandCenterV1: true,
  /** Quant Data Health Q0 stays dark until its read RPCs are reviewed and applied. */
  opsQuantDataHealthQ0: true,
  /** Owner/Super Admin desktop-only Quant Operations Terminal. Read-only; current Command Center is the kill-switch fallback. */
  opsQuantDashboardQ1: true,
  /**
   * cockpitFloorActions — nâng cấp cockpit giải trên điện thoại (`OpsTournamentCockpit`): tab "Bàn"
   * hiện sơ đồ bàn INLINE (thay redirect) + tab "Người chơi" 3 tab Tất cả/Đang chơi/Busted, người
   * đang chơi CHẠM ĐỂ THAO TÁC (Sửa chip/Loại/Chuyển/Phiếu — dùng chung `FloorPlayerActions` với màn
   * Bàn), busted chỉ xem. Client-only, tái dùng Edge/RPC đã live (không backend/migration mới).
   * Default **OFF** (kill-switch): while false cockpit S2 = redirect cũ, S3 = leaderboard read-only cũ.
   * Flip true sau UAT Preview. (Refactor OpsTables tách hook/handlers ship live, hành vi y nguyên.)
   * **ON 2026-07-11** (owner-approved sau #863 merged). Kill-switch: set false.
   */
  cockpitFloorActions: true,
  /**
   * staffApp — NEW `/staff/*` self-service portal for NON-dealer staff (floor, cashier,
   * tracker, service, security). Mirrors the dealer app shell but reads a SEPARATE `staff`
   * table + `staff_attendance` (never `dealers` / `dealer_attendance`), so the live dealer
   * app is untouched. MVP screens: Home + app check-in/out button, Attendance list, Account.
   * **ON** (2026-07-11, owner-approved): staff_directory + staff_attendance (+ staff payroll)
   * applied live + verified, types regenerated (#829/#835) → the portal now uses LIVE data. Real
   * staff whose auth account is linked (staff.user_id) can open `/staff`, check in/out (writes
   * staff_attendance), and view attendance + salary; non-linked users see "chưa liên kết". Until
   * staff records are added + linked, the portal is live-but-empty by design. Kill-switch: set
   * false to instantly re-hide the whole portal (source objects stay, just unused by the UI).
   */
  staffApp: true,
  /**
   * staffSelfSalary — the "Lương của tôi" screen inside the /staff portal (READ-ONLY),
   * parallel to `dealerSelfSalary` for the dealer app. Gates both the bottom-nav "Lương"
   * tab AND the /staff/salary route (direct navigation redirects to /staff when off).
   * Depends on the LATER staff-payroll increment (a parallel `staff_pt_wage_payments`
   * twin + FT rollup — NOT the dealer payroll objects). Default **OFF**; keep false until
   * that backend is applied live + types regenerated.
   * **ON** (2026-07-10, owner-approved): PR-S4 `staff_pt_wage_payments` + `get_my_staff_salary`
   * applied live + verified (6/6), types regenerated (#835), and `StaffSalaryScreen` wired
   * (read-only). NOTE: the whole `/staff` portal is still gated by `staffApp` (OFF), so flipping
   * this only surfaces the "Lương" tab in owner/admin preview with MOCK data — no real-user
   * exposure until `staffApp` is flipped after UAT. Kill-switch: set false.
   */
  staffSelfSalary: true,
  /**
   * clubExpenses — NEW "Sổ chi phí" operating-expense ledger. Gates the owner/cashier
   * WRITE entry page (`/club/admin/expenses`) where a club records operating costs (rent,
   * utilities, marketing, supplies…). The ledger is APPEND-ONLY (corrections = a new
   * adjustment row, never edit/delete); writes go through the `record_club_expense` RPC
   * (Owner+Cashier, actor=auth.uid()). Default **OFF** (per flag policy): while false the
   * route shows "chưa bật" (except admin/owner preview) and nothing mounts. The backing
   * `club_expenses` migration is SOURCE-ONLY / not applied live yet. The READ display in
   * Accounting Control's "Lương & chi phí" tab and the get_club_finance_summary fold are
   * SEPARATE later increments (each additive + golden-diff + own gate).
   * **ON** (2026-07-13, owner-approved go-live): club_expenses RPCs live (accountant-scoped via
   * 20261236000000); the entry page + accountant Sổ chi phí tab write to Supabase. Kill-switch: set false.
   */
  clubExpenses: true,
  /**
   * staffSalaryChot — the salary chốt/duyệt workspace (accountant computes + chốt the monthly
   * salary and submits it; the club owner approves/rejects; a run is marked paid only after
   * approval). Backs the accountant workspace at `/accountant` (StaffSalaryChot). Reads the
   * live S6/S7 objects (staff_salary_runs/periods + club_accountants). While false the page
   * runs on mock; true = live RPCs. **ON** (2026-07-11, owner-approved — re-lands the flag that
   * PR #844 was meant to ship but never merged). Kill-switch: set false to re-hide.
   */
  staffSalaryChot: true,
  /**
   * accountantWorkspace — the full multi-tab "Kế toán" workspace at `/accountant` (Bảng
   * lương NV · Lương dealer · Nhân viên & lương · Sổ chi phí · F&B thu chi · Báo cáo).
   * Tabs whose backend authz needs migration 20261236000000 self-detect via
   * `get_accountant_capabilities` and show an explicit "chờ áp DB" notice — never a crash,
   * never a silently-empty screen. Default **OFF** (review P0-5): while false, `/accountant`
   * renders exactly the pre-workspace page (StaffSalaryChot).
   * **ON** (2026-07-13, owner-approved go-live): migration 20261236000000 applied + verified 7/7;
   * the full 6-tab workspace is live (tabs still self-detect capabilities). Kill-switch: set false
   * to restore the pre-workspace page.
   */
  accountantWorkspace: true,
} as const;

/**
 * Per-club gate for the Engine-3-neo PayoutEnginePanel. `FEATURES.payoutEngine` stays the
 * GLOBAL master switch; this narrows it per club so the new panel can go live for ONE club
 * first while every other club keeps the old PrizeStructurePanel. Resolution order:
 *   1. master `payoutEngine` off → never on (whatever the allowlist says);
 *   2. `payoutEngineAllClubs` true → every club (wide rollout);
 *   3. otherwise → only club ids present in `payoutEngineClubs`.
 * No clubId (or not allow-listed) → false → caller renders the old manual panel. The
 * `features` arg is injectable for tests; production callers pass just the clubId.
 */
export function isPayoutEngineEnabledForClub(
  clubId?: string | null,
  features: {
    payoutEngine: boolean;
    payoutEngineAllClubs: boolean;
    payoutEngineClubs: readonly string[];
  } = FEATURES,
): boolean {
  if (!features.payoutEngine) return false;
  if (features.payoutEngineAllClubs) return true;
  if (!clubId) return false;
  return features.payoutEngineClubs.includes(clubId);
}

/**
 * A source flag alone cannot prove the private Edge/DB settlement contract is
 * deployed. Atomic resettle may invoke the write path only after a build has an
 * explicit capability acknowledgement from the controlled rollout runbook.
 */
export function canUseTrackerAtomicResettle(flagEnabled: boolean, capabilityAcknowledged: boolean): boolean {
  return flagEnabled && capabilityAcknowledged;
}

export function isTrackerAtomicResettleAvailable(): boolean {
  return canUseTrackerAtomicResettle(
    FEATURES.trackerAtomicResettle,
    import.meta.env.VITE_TRACKER_ATOMIC_RESETTLE_CAPABILITY === "confirmed",
  );
}
