// Pure helpers for RESUMING an in-progress ("orphan") tournament hand in the
// operator Hand Input panel.
//
// Background: when the operator reopens a table that has a hand still
// `status = 'in_progress'`, the panel must rebuild the exact mid-hand state
// from what is persisted — the recorded `hand_actions` rows plus the hand's
// `button_seat` / `community_cards` — because nothing else is snapshotted.
// The previous resume path only flipped `handStarted` without reloading any of
// this, so the local `nextActionOrder` counter stayed at 1 and the next
// recorded action collided with `action_order = 1` of the existing hand.
//
// These functions are intentionally pure (no React, no Supabase) so the resume
// invariants can be unit-tested deterministically.

export type ResumeStreet = "preflop" | "flop" | "turn" | "river" | "showdown";

const STREET_SEQUENCE: ResumeStreet[] = ["preflop", "flop", "turn", "river", "showdown"];

/** Validate the persisted deck before claiming the hand or hydrating card UI.
 * Legacy NULL/empty trailing slots mean undealt, never a hole in a dealt street. */
export function readResumeCards(board: unknown, rows: unknown,
  participants: ReadonlyArray<{player_id:string;entry_number:number}>): {
    communitySlots:(string|null)[]; communityCount:number; playerHoleCards:Record<string,string[]>;
  } {
  const badBoard=()=>new Error("Bài chung đã lưu không hợp lệ. Chưa tiếp tục hand; hãy gọi Floor.");
  const badHole=()=>new Error("Không xác minh được bài tẩy/entry đã lưu của hand.");
  const rawBoard=board===null?[]:board;
  if (!Array.isArray(rawBoard)||rawBoard.length>5) throw badBoard();
  const dealt:string[]=[];const used=new Set<string>();let empty=false;
  for(const card of rawBoard){
    if(card===null){empty=true;continue;}
    if(empty||typeof card!=='string'||!/^[2-9TJQKA][shdc]$/.test(card)||used.has(card))throw badBoard();
    dealt.push(card);used.add(card);
  }
  if(![0,3,4,5].includes(dealt.length))throw badBoard();
  if(!Array.isArray(rows)||participants.length===0)throw badHole();
  const expected=new Map<string,number>();
  for(const player of participants){
    if(!player.player_id||!Number.isSafeInteger(player.entry_number)||player.entry_number<1||expected.has(player.player_id))throw badHole();
    expected.set(player.player_id,player.entry_number);
  }
  const seen=new Set<string>(),playerHoleCards:Record<string,string[]>={};
  for(const row of rows){
    if(!row||typeof row!=='object'||Array.isArray(row)||!('player_id' in row)||typeof row.player_id!=='string'
      ||!expected.has(row.player_id)||!('entry_number' in row)||expected.get(row.player_id)!==row.entry_number||seen.has(row.player_id)
      ||!('hole_cards' in row)||row.hole_cards===undefined)throw badHole();
    const cards=row.hole_cards===null?[]:row.hole_cards;
    if(!Array.isArray(cards)||(cards.length!==0&&cards.length!==2))throw badHole();
    const verified:string[]=[];
    for(const card of cards){
      if(typeof card!=='string'||!/^[2-9TJQKA][shdc]$/.test(card)||used.has(card))throw badHole();
      used.add(card);verified.push(card);
    }
    seen.add(row.player_id);
    if(verified.length)playerHoleCards[row.player_id]=verified;
  }
  if(seen.size!==expected.size)throw badHole();
  return {communitySlots:[0,1,2,3,4].map(index=>dealt[index]??null),communityCount:dealt.length,playerHoleCards};
}

/** Minimal shape of a persisted `hand_actions` row needed to replay a hand. */
export interface ResumeActionRow {
  player_id: string;
  action_type: string;
  action_amount: number | null;
  action_order: number;
  street: string | null;
}

/** Minimal mutable player fields the replay reads/writes. */
export interface ResumePlayer {
  player_id: string;
  starting_stack: number;
  current_stack: number;
  current_bet: number;
  total_bet: number;
  is_folded: boolean;
  is_all_in: boolean;
}

/**
 * The order to assign to the NEXT action after a resume: one past the highest
 * recorded `action_order`. Empty hand → 1. This is the core fix for the
 * action-order collision bug.
 */
export function nextActionOrderFrom(rows: { action_order: number }[]): number {
  return rows.reduce((max, r) => Math.max(max, r.action_order), 0) + 1;
}

/**
 * Which street the operator should resume on: the furthest along of
 *  (a) the street implied by how many community cards are already dealt, and
 *  (b) the street of the last recorded action.
 * Taking the max handles both "flop just dealt, no action yet" and
 * "actions recorded but community not re-sent".
 */
export function deriveResumeStreet(
  rows: { street: string | null }[],
  communityCount: number
): ResumeStreet {
  const fromCommunity: ResumeStreet =
    communityCount >= 5 ? "river" : communityCount >= 4 ? "turn" : communityCount >= 3 ? "flop" : "preflop";

  let fromActions: ResumeStreet = "preflop";
  for (const r of rows) {
    const s = (r.street ?? "preflop") as ResumeStreet;
    if (STREET_SEQUENCE.indexOf(s) > STREET_SEQUENCE.indexOf(fromActions)) fromActions = s;
  }

  return STREET_SEQUENCE.indexOf(fromCommunity) >= STREET_SEQUENCE.indexOf(fromActions)
    ? fromCommunity
    : fromActions;
}

/**
 * Rebuild mid-hand player state by replaying the recorded actions over the
 * dealt-in players (reset to their starting stacks). Mirrors the same per-action
 * stack math as the live `handleAction`, but applies the ALREADY-recorded
 * `action_amount`. `current_bet` is reset to 0 at each street boundary (matching
 * `nextStreet()` in the panel). Returns fresh copies — input is not mutated.
 *
 * Generic so the caller's richer player objects (PlayerState) keep all their
 * other fields (display_name, seat_number, …) via the spread.
 */
export function replayActions<T extends ResumePlayer>(base: T[], rows: ResumeActionRow[]): T[] {
  const players = base.map((p) => ({
    ...p,
    current_stack: p.starting_stack,
    current_bet: 0,
    total_bet: 0,
    is_folded: false,
    is_all_in: false,
  }));
  const byId = new Map(players.map((p) => [p.player_id, p]));

  const sorted = [...rows].sort((a, b) => a.action_order - b.action_order);
  let prevStreet: string | null = sorted.length ? sorted[0].street ?? "preflop" : null;

  for (const r of sorted) {
    const street = r.street ?? "preflop";
    if (street !== prevStreet) {
      // New betting round: everyone's per-street bet resets to 0.
      players.forEach((p) => {
        p.current_bet = 0;
      });
      prevStreet = street;
    }

    const p = byId.get(r.player_id);
    if (!p) continue;
    const amt = r.action_amount ?? 0;

    switch (r.action_type) {
      case "fold":
        p.is_folded = true;
        break;
      case "check":
        break;
      case "post_ante":
        // Antes leave the stack and enter the pot, but are NOT a matchable bet.
        p.current_stack = Math.max(0, p.current_stack - amt);
        p.total_bet += amt;
        if (p.current_stack === 0) p.is_all_in = true;
        break;
      default:
        // call / bet / raise / all_in / post_sb / post_bb
        p.current_stack = Math.max(0, p.current_stack - amt);
        p.current_bet += amt;
        p.total_bet += amt;
        if (p.current_stack === 0) p.is_all_in = true;
        break;
    }
  }

  return players;
}
