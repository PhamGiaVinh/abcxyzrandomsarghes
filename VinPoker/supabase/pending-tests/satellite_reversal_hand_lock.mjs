// Proves the hand INSERT/participant trigger boundary versus reversal on disposable PG17.
// The Tracker start RPC and browser path are exercised separately.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const target = "d3000000-0000-4000-8000-000000000012";
const source = "d3000000-0000-4000-8000-000000000011";
const table = "d4000000-0000-4000-8000-000000000011";
const owner = "d1000000-0000-4000-8000-000000000011";
const hand = "d9000000-0000-4000-8000-000000000021";
const correction = "d9000000-0000-4000-8000-000000000001";
const ticket = `(SELECT id FROM public.satellite_tickets WHERE source_tournament_id='${source}' AND serial_no=1)`;
const children = new Set();

function start(name, sql, files = []) {
  const child = spawn("psql", [
    "-X", "-qAt", "-d", "hostaddr=127.0.0.1 port=5432 dbname=postgres user=postgres connect_timeout=3",
    "-v", "ON_ERROR_STOP=1", ...files, ...(sql ? ["-f", "-"] : []),
  ], { env: { ...process.env, PGAPPNAME: name, PGOPTIONS: "-c statement_timeout=15000" } });
  children.add(child);
  let output = "";
  let diagnostic = "";
  child.stdout.on("data", value => { output += value; });
  child.stderr.on("data", value => { diagnostic += value; });
  const result = new Promise(resolve => {
    child.once("error", error => resolve({ code: -1, output, diagnostic: error.message }));
    child.once("close", code => {
      children.delete(child);
      resolve({ code, output, diagnostic });
    });
  });
  child.stdin.on("error", () => {});
  child.stdin.end(sql ?? "");
  return result;
}

async function checked(result, label) {
  const { code, output, diagnostic } = await result;
  assert.equal(code, 0, `${label}: ${diagnostic.slice(0, 500)}`);
  return output.trim();
}

async function requireObservation(query, label) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (await checked(start("sat-hand-observer", query), label) === "t") return;
    await delay(50);
  }
  assert.fail(label);
}

async function race(first, second, winning, waiting) {
  const firstResult = start(first, winning.sql, winning.files);
  await requireObservation(`SELECT EXISTS (SELECT 1 FROM pg_stat_activity
    WHERE application_name='${first}' AND wait_event='PgSleep' AND xact_start IS NOT NULL);`,
  `${first} did not hold its transaction open`);
  const secondResult = start(second, waiting);
  await requireObservation(`SELECT EXISTS (SELECT 1 FROM pg_stat_activity waiter
    JOIN pg_stat_activity holder ON holder.pid=ANY(pg_blocking_pids(waiter.pid))
    WHERE holder.application_name='${first}' AND waiter.application_name='${second}');`,
  `${second} did not wait for ${first}`);
  await checked(firstResult, first);
  await checked(secondResult, second);
  console.log(`Observed blocking and verified outcome: ${first} then ${second}`);
}

try {
  assert.equal(process.env.GITHUB_ACTIONS, "true", "Disposable workflow only");
  assert.equal(await checked(start("sat-hand-guard", `
    SELECT current_database()='postgres' AND current_setting('server_version_num')::int BETWEEN 170000 AND 179999
      AND EXISTS (SELECT 1 FROM public.tournaments WHERE id='${target}' AND name='Redeem target')
      AND EXISTS (SELECT 1 FROM public.satellite_tickets WHERE id=${ticket} AND status='redeemed')
      AND NOT EXISTS (SELECT 1 FROM public.tournament_hands WHERE tournament_id='${target}');`), "disposable fixture guard"), "t");

  await race("sat-hand-first", "sat-reversal-second", { sql: `
    BEGIN;
    INSERT INTO public.tournament_hands(id,tournament_id,table_id,hand_number)
      VALUES ('${hand}','${target}','${table}',1);
    SELECT pg_sleep(8);
    COMMIT;` }, `
    BEGIN;
    SELECT set_config('request.jwt.claim.sub','${owner}',true);
    SELECT public.satellite_request_redemption_correction_v1(
      ${ticket},'Unused voucher issued to wrong bearer','${correction}');
    DO $test$
    BEGIN
      PERFORM public.satellite_approve_redemption_reversal_v1(
        ${ticket},'${correction}','Owner approved unused voucher reversal',
        'd9000000-0000-4000-8000-000000000022');
      RAISE EXCEPTION 'reversal passed after the winner committed its hand';
    EXCEPTION WHEN check_violation THEN
      IF SQLERRM <> 'satellite_reversal_unsafe_after_play_or_move' THEN RAISE; END IF;
    END $test$;
    ROLLBACK;`);

  assert.equal(await checked(start("sat-hand-clean", `
    DELETE FROM public.tournament_hands WHERE id='${hand}' AND tournament_id='${target}';
    SELECT NOT EXISTS(SELECT 1 FROM public.tournament_hands WHERE tournament_id='${target}')
      AND NOT EXISTS(SELECT 1 FROM public.satellite_redemption_reversals WHERE ticket_id=${ticket});`),
  "remove only the committed fixture hand"), "t");

  await race("sat-reversal-first", "sat-hand-second", {
    files: ["-v", "hold_reversal_commit=on", "-f", "supabase/pending-tests/satellite_redemption_reversal_v1.sql"],
  }, `
    DO $test$
    BEGIN
      INSERT INTO public.tournament_hands(id,tournament_id,table_id,hand_number)
        VALUES ('${hand}','${target}','${table}',1);
      INSERT INTO public.hand_players(hand_id,tournament_id,player_id,entry_number,seat_number,starting_stack,ending_stack)
      SELECT '${hand}',e.tournament_id,e.player_id,e.entry_no,1,10000,10000
        FROM public.tournament_entries e
        JOIN public.satellite_tickets t ON t.registration_id=e.registration_id
        WHERE t.id=${ticket};
      RAISE EXCEPTION 'a reversed fixture entry joined the hand';
    EXCEPTION WHEN check_violation THEN
      IF SQLERRM <> 'satellite_reversed_entry_cannot_play' THEN RAISE; END IF;
    END $test$;`);

  assert.equal(await checked(start("sat-hand-final", `
    SELECT NOT EXISTS(SELECT 1 FROM public.tournament_hands WHERE id='${hand}')
      AND (SELECT count(*)=1 FROM public.satellite_redemption_reversals WHERE ticket_id=${ticket});`),
  "final reversal/hand state"), "t");
} finally {
  for (const child of children) child.kill();
}
