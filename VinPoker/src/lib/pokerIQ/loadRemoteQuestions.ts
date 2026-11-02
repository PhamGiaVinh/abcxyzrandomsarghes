// Network loader for the authored Poker IQ bank. Kept SEPARATE from the pure
// `remoteContent.ts` (and out of the barrel) so the supabase client never leaks
// into the pure-function test env.
import { supabase } from "@/integrations/supabase/client";
import { DrillHand } from "./types";
import { POKER_IQ_QUESTIONS_KEY, approvedHands, parseQuestionBank } from "./remoteContent";
import {observeTrackerContextRead} from "@/lib/tournament/observeTrackerContextRead";

/**
 * Fetch the APPROVED authored hands. Safe by construction: any failure (no row,
 * network error, malformed JSON, invalid shapes) resolves to `[]`, so the caller
 * simply keeps the built-in static bank. Never throws.
 */
export async function loadRemoteApprovedHands(): Promise<DrillHand[]> {
  try {
    const { data, error } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", POKER_IQ_QUESTIONS_KEY)
      .maybeSingle();
    if (error || !data?.value) return [];
    return approvedHands(parseQuestionBank(data.value));
  } catch {
    return [];
  }
}

/** Load the FULL bank (drafts + approved) for the authoring panel. */
export async function loadQuestionBank(signal?: AbortSignal): Promise<DrillHand[]> {
  const controller=new AbortController();
  const abort=()=>controller.abort();
  signal?.addEventListener('abort',abort,{once:true});
  try {
    if(signal?.aborted)throw new Error('question_bank_read_cancelled');
    const { data, error } = await observeTrackerContextRead(supabase
      .from("app_settings")
      .select("value")
      .eq("key", POKER_IQ_QUESTIONS_KEY)
      .abortSignal(controller.signal).maybeSingle());
    if(error)throw new Error('question_bank_read_unavailable');
    if(data===null)return [];
    const raw:unknown=data.value;
    const parsed=parseQuestionBank(raw);
    // An editor replaces the entire bank. Never silently drop unreadable rows.
    if(!Array.isArray(raw)||parsed.length!==raw.length||new Set(parsed.map(h=>h.id)).size!==parsed.length)
      throw new Error('question_bank_read_invalid');
    return parsed;
  } finally {
    signal?.removeEventListener('abort',abort);
    controller.abort();
  }
}

/** Persist the FULL bank (super_admin-gated by app_settings RLS). */
export async function saveQuestionBank(hands: DrillHand[]): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from("app_settings")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .upsert({ key: POKER_IQ_QUESTIONS_KEY, value: hands as any, updated_at: new Date().toISOString() });
  return { error: error?.message ?? null };
}
