import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dealNextHand } from '../../supabase/functions/_shared/pokerRuntime/dealNextHand.ts';
import { applyAction, createHand, shuffledDeck } from '../../supabase/functions/_shared/pokerEngine/index.ts';
import { actionToRow, deserializeAuthoritative, ENGINE_VERSION, serializeAuthoritative } from '../../supabase/functions/_shared/pokerAdapter/index.ts';

const tableId = 'ab510000-0000-4000-8000-000000000001';
const first = 'ab510000-0000-4000-8000-000000000002';
const second = 'ab510000-0000-4000-8000-000000000003';

function sql(source) {
  const result = spawnSync('psql', ['-X', '-Atq', '-v', 'ON_ERROR_STOP=1'], {
    encoding: 'utf8', input: source, timeout: 10_000,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function json(source) { return JSON.parse(sql(source)); }
function file(path) { return readFileSync(new URL(path, import.meta.url), 'utf8'); }

function session(name) {
  const child = spawn('psql', ['-X', '-Atq', '-v', 'ON_ERROR_STOP=1'], {
    env: { ...process.env, PGAPPNAME: name, PGOPTIONS: '-c statement_timeout=8000' },
    stdio: 'pipe',
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', part => { stdout += part; });
  child.stderr.setEncoding('utf8').on('data', part => { stderr += part; });
  const closed = new Promise(resolve => child.on('close', resolve));
  return {
    send: statement => child.stdin.write(statement + '\n'),
    async waitFor(marker) {
      for (let n = 0; n < 100 && !stdout.includes(marker); n++) await delay(40);
      assert.ok(stdout.includes(marker), stderr);
    },
    async finish() {
      child.stdin.end();
      assert.equal(await closed, 0, stderr);
      return stdout.trim().split(/\r?\n/);
    },
    stop: () => child.kill(),
  };
}

// Only recreate the observed function body in this throwaway database.
// Archived migration files are never replayed as migrations.
function archivedFunction(name, path, group = 'legacy-unapplied') {
  const start = `CREATE OR REPLACE FUNCTION public.${name}(`;
  const source = file(`../../supabase/migration-archive/${group}/${path}`).replace(/\r\n/g, '\n');
  const offset = source.indexOf(start);
  assert.ok(offset >= 0);
  const end = source.indexOf('$$;', source.indexOf('AS $$', offset) + 5);
  assert.ok(end > offset);
  return source.slice(offset, end + 3);
}

async function waitForPostgresLock(name) {
  assert.match(name, /^g03-[a-z-]+$/);
  for (let n = 0; n < 40; n++) {
    if (sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity
      WHERE application_name='${name}' AND wait_event_type='Lock')`) === 't') return;
    await delay(50);
  }
  assert.fail('Second connection must actually be blocked on the first transaction');
}

function startStatement(args) {
  const payload = Buffer.from(JSON.stringify(args)).toString('hex');
  return `
    SET ROLE service_role;
    WITH input AS (SELECT convert_from(decode('${payload}','hex'),'UTF8')::jsonb AS p)
    SELECT public.op_start_hand(p->'p_state', p->'p_deck', p->'p_board_future', p->'p_holes',
      p->'p_events', p->>'p_engine_version', (p->>'p_act_deadline')::timestamptz,
      (p->>'p_actor_user_id')::uuid) FROM input;
  `;
}

test('the shared server deal persists one native hand with consistent public and private state', async () => {
  assert.equal(process.env.PGHOST, '127.0.0.1');
  assert.equal(process.env.PGDATABASE, 'online_poker_runtime_ci');
  assert.equal(sql('SELECT current_database()'), 'online_poker_runtime_ci');
  assert.equal(sql("SELECT to_regclass('public.online_poker_tables') IS NULL"), 't');
  sql(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE TABLE public.clubs(id uuid PRIMARY KEY);
    CREATE TYPE public.app_role AS ENUM ('super_admin');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION public.has_role(uuid, public.app_role) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
    CREATE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=now(); RETURN NEW; END $$;
    ${file('../../supabase/migrations/20260817000000_online_poker_core.sql')}
    ${file('../../supabase/migrations/20260820000000_online_poker_runtime_rpcs.sql')}
    ${archivedFunction('op_submit_action', '20260907000000_op_submit_action_settlement_seat_writeback.sql')}
    ${archivedFunction('op_stand_up', '20260908000000_op_stand_up_block_folded_midhand.sql')}
    ${archivedFunction('op_close_table_if_empty', '20261002000000_op_auto_close_empty_table.sql', 'historical-never-replay')}
    CREATE TRIGGER trg_op_close_empty AFTER UPDATE OF user_id ON public.online_poker_seats
    FOR EACH ROW WHEN (OLD.user_id IS NOT NULL AND NEW.user_id IS NULL)
    EXECUTE FUNCTION public.op_close_table_if_empty();
    INSERT INTO auth.users VALUES ('${first}'), ('${second}');
    INSERT INTO public.online_poker_tables(id,name,sb,bb,min_buyin,max_buyin,starting_stack_default)
    VALUES ('${tableId}','Disposable TEST',5,10,0,1000,100);
    INSERT INTO public.online_poker_seats(table_id,seat_no,user_id,stack,status)
    VALUES ('${tableId}',2,'${first}',100,'sitting'), ('${tableId}',5,'${second}',100,'sitting');
  `);
  assert.deepEqual(json(`
    SELECT json_object_agg(proname, md5(prosrc))
    FROM pg_proc WHERE pronamespace='public'::regnamespace
      AND proname IN ('op_start_hand','op_submit_action','op_stand_up','op_close_table_if_empty')
  `), {
    op_start_hand: '10282a2bb252d87125652c048de5d502',
    op_submit_action: 'b0dd7ff7cd2d70b84198d35de5f14f6e',
    op_stand_up: '140a23e7260f0d70a11c097c7986061f',
    op_close_table_if_empty: '905b8fbbdbf57aa27598e51027a64b52',
  });
  sql(file('../../supabase/pending-migrations/20261119193713_online_poker_complete_deal_stack_writeback.sql'));

  const reads = {
    online_poker_tables: `SELECT row_to_json(t) FROM public.online_poker_tables t WHERE id='${tableId}'`,
    online_poker_seats: `SELECT json_agg(s) FROM public.online_poker_seats s WHERE table_id='${tableId}'`,
    online_poker_hands: `SELECT COALESCE((SELECT json_build_object('hand_no',hand_no,'button_seat',button_seat)
      FROM public.online_poker_hands WHERE table_id='${tableId}' ORDER BY hand_no DESC LIMIT 1),'null'::json)`,
  };
  const admin = {
    from(table) {
      assert.ok(Object.hasOwn(reads, table));
      const query = {
        select: () => query, eq: () => query, order: () => query, limit: () => query,
        maybeSingle: async () => ({ data: json(reads[table]), error: null }),
        then: resolve => resolve({ data: json(reads[table]), error: null }),
      };
      return query;
    },
    async rpc(name, args) {
      assert.equal(name, 'op_start_hand');
      const data = json(startStatement(args));
      return { data, error: null };
    },
  };
  assert.equal((await dealNextHand(admin, tableId, first)).reason, 'disabled');
  assert.equal(sql('SELECT count(*) FROM public.online_poker_hands'), '0');
  sql('UPDATE public.online_poker_config SET enabled=true');
  const hand = await dealNextHand(admin, tableId, first);
  assert.ok(hand.ok, JSON.stringify(hand));
  assert.equal(hand.handNo, 1);
  assert.equal(hand.buttonSeat, 2);
  assert.equal((await dealNextHand(admin, tableId, null)).reason, 'already_active');
  const state = json(`
    SELECT json_build_object('count',count(*),'pot',max(pot),'publicSecret',
      bool_or(state ? 'deck' OR EXISTS(
        SELECT 1 FROM jsonb_array_elements(state->'seats') s WHERE s ? 'holeCards')))
    FROM public.online_poker_hands;
  `);
  assert.deepEqual(state, { count: 1, pot: 15, publicSecret: false });
  assert.equal(sql("SELECT count(*) FROM public.online_poker_hand_secrets"), '4');
  assert.equal(sql("SELECT sum(stack+total_committed) FROM public.online_poker_hand_seats"), '200');
  assert.equal(sql("SELECT has_function_privilege('authenticated','public.op_start_hand(jsonb,jsonb,jsonb,jsonb,jsonb,text,timestamptz,uuid)','EXECUTE')"), 'f');
  const standDuringHand = json(`
    SET request.jwt.claim.sub='${first}'; SET ROLE authenticated;
    SELECT public.op_stand_up('${tableId}', 'disposable-g03-stand-blocked');
  `);
  assert.equal(standDuringHand.outcome, 'in_active_hand');
  assert.equal(sql('SELECT count(*) FROM public.online_poker_chip_ledger'), '0');

  const context = json(`SET ROLE service_role; SELECT public.op_load_action_context('${hand.handId}')`);
  assert.equal(context.outcome, 'ok');
  const before = deserializeAuthoritative(context.state, context.live_deck, context.holes);
  const action = { type: 'fold', seat: 2 };
  assert.equal(before.toAct, action.seat);
  const folded = applyAction(before, action);
  assert.equal(folded.error, undefined);
  assert.equal(folded.state.status, 'complete');
  const split = serializeAuthoritative(folded.state);
  const args = {
    action: actionToRow(action),
    state: split.stateJson,
    liveDeck: split.liveDeck,
    events: folded.events.map(({ type, payload }) => ({ type, payload })),
  };
  const payload = Buffer.from(JSON.stringify(args)).toString('hex');
  const submit = () => json(`
    SET ROLE service_role;
    WITH input AS (SELECT convert_from(decode('${payload}','hex'),'UTF8')::jsonb AS p)
    SELECT public.op_submit_action('${hand.handId}', '${first}', p->'action', p->'state',
      p->'liveDeck', p->'events', 0, NULL, 'disposable-g03-fold-retry') FROM input;
  `);
  const receipt = submit();
  assert.equal(receipt.outcome, 'ok');
  assert.equal(receipt.state_version, 1);
  assert.deepEqual(submit(), receipt);
  assert.equal(sql('SELECT count(*) FROM public.online_poker_actions'), '1');
  assert.equal(sql("SELECT string_agg(stack::text,',' ORDER BY seat_no) FROM public.online_poker_hand_seats"), '95,105');
  const next = await dealNextHand(admin, tableId, null);
  assert.ok(next.ok, JSON.stringify(next));
  assert.equal(next.handNo, 2);
  assert.equal(next.buttonSeat, 5);
  assert.equal(
    sql(`SELECT string_agg(starting_stack::text,',' ORDER BY seat_no)
      FROM public.online_poker_hand_seats WHERE hand_id='${next.handId}'`),
    '95,105',
    'The following hand must start from the previous hand’s terminal stacks',
  );

  const shortTable = 'ab510000-0000-4000-8000-000000000004';
  const shortHand = 'ab510000-0000-4000-8000-000000000005';
  sql(`
    INSERT INTO public.online_poker_tables(id,name,sb,bb,min_buyin,max_buyin,starting_stack_default)
    VALUES ('${shortTable}','Disposable blind all-in TEST',5,10,0,1000,10);
    INSERT INTO public.online_poker_seats(table_id,seat_no,user_id,stack,status)
    VALUES ('${shortTable}',2,'${first}',5,'sitting'), ('${shortTable}',5,'${second}',10,'sitting');
  `);
  let seed = 1977;
  const deck = shuffledDeck(() => seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  const allIn = createHand({
    handId: shortHand, tableId: shortTable, handNo: 1, buttonSeat: 2, sb: 5n, bb: 10n,
  }, [...deck], [{ seat: 2, playerId: first, stack: 5n }, { seat: 5, playerId: second, stack: 10n }]);
  assert.equal(allIn.error, undefined);
  assert.equal(allIn.state.status, 'complete');
  assert.deepEqual(allIn.state.seats.map(seat => seat.stack), [0n, 15n]);
  const terminal = serializeAuthoritative(allIn.state);
  const allInArgs = {
    p_state: terminal.stateJson, p_deck: deck, p_board_future: terminal.liveDeck,
    p_holes: terminal.holes, p_events: allIn.events.map(({ type, payload }) => ({ type, payload })),
    p_engine_version: ENGINE_VERSION, p_act_deadline: null, p_actor_user_id: null,
  };
  const startAllIn = () => admin.rpc('op_start_hand', allInArgs);
  sql(`UPDATE public.online_poker_tables SET status='paused' WHERE id='${shortTable}'`);
  assert.equal((await startAllIn()).data.detail, 'stale table configuration');
  sql(`UPDATE public.online_poker_tables SET status='open',bb=15 WHERE id='${shortTable}'`);
  assert.equal((await startAllIn()).data.detail, 'stale table configuration');
  sql(`UPDATE public.online_poker_tables SET bb=10 WHERE id='${shortTable}'`);
  sql(`UPDATE public.online_poker_seats SET stack=11 WHERE table_id='${shortTable}' AND seat_no=5`);
  await assert.rejects(startAllIn, /online_poker_stale_terminal_seats/);
  assert.equal(sql(`SELECT count(*) FROM public.online_poker_hands WHERE id='${shortHand}'`), '0');
  assert.equal(sql(`SELECT string_agg(stack::text,',' ORDER BY seat_no)
    FROM public.online_poker_seats WHERE table_id='${shortTable}'`), '5,11');
  sql(`UPDATE public.online_poker_seats SET stack=10 WHERE table_id='${shortTable}' AND seat_no=5`);
  const leader = session('g03-terminal-leader');
  const follower = session('g03-terminal-follower');
  try {
    leader.send(`BEGIN;
      SELECT 1 FROM public.online_poker_seats WHERE table_id='${shortTable}' ORDER BY seat_no FOR UPDATE;
      \\echo leader_has_seats`);
    await leader.waitFor('leader_has_seats');
    follower.send(startStatement(allInArgs));
    await waitForPostgresLock('g03-terminal-follower');
    leader.send(startStatement(allInArgs) + '\nCOMMIT;');
    const [winner, duplicate] = await Promise.all([leader.finish(), follower.finish()]);
    assert.equal(JSON.parse(winner.at(-1)).outcome, 'ok');
    assert.equal(JSON.parse(duplicate.at(-1)).detail, 'stale hand sequence');
  } finally {
    leader.stop();
    follower.stop();
  }
  assert.equal(sql(`SELECT status FROM public.online_poker_hands WHERE id='${shortHand}'`), 'complete');
  assert.equal(sql(`SELECT string_agg(stack::text,',' ORDER BY seat_no)
    FROM public.online_poker_seats WHERE table_id='${shortTable}'`), '0,15',
    'An immediately complete deal must also persist its terminal stacks');
  assert.equal((await startAllIn()).data.detail, 'stale hand sequence');
  assert.equal(sql(`SELECT count(*) FROM public.online_poker_hands WHERE table_id='${shortTable}'`), '1');

  const closingTable = 'ab510000-0000-4000-8000-000000000006';
  const closingHand = 'ab510000-0000-4000-8000-000000000007';
  sql(`
    INSERT INTO public.online_poker_tables(id,name,sb,bb,min_buyin,max_buyin,starting_stack_default)
    VALUES ('${closingTable}','Disposable close overlap TEST',5,10,0,1000,10);
    INSERT INTO public.online_poker_seats(table_id,seat_no,user_id,stack,status)
    VALUES ('${closingTable}',2,'${first}',5,'sitting'), ('${closingTable}',5,'${second}',10,'sitting');
  `);
  const closingArgs = {
    ...allInArgs,
    p_state: { ...allInArgs.p_state, config: { ...allInArgs.p_state.config, tableId: closingTable, handId: closingHand } },
  };
  const leaver = session('g03-terminal-leaver');
  const staleDeal = session('g03-close-stale-deal');
  try {
    leaver.send(`BEGIN;
      SET ROLE authenticated; SET request.jwt.claim.sub='${first}';
      SELECT public.op_stand_up('${closingTable}', 'disposable-g03-close-first');
      SET request.jwt.claim.sub='${second}';
      SELECT public.op_stand_up('${closingTable}', 'disposable-g03-close-second');
      \\echo standups_uncommitted`);
    await leaver.waitFor('standups_uncommitted');
    staleDeal.send(startStatement(closingArgs));
    await waitForPostgresLock('g03-close-stale-deal');
    leaver.send('COMMIT;');
    const [standups, denied] = await Promise.all([leaver.finish(), staleDeal.finish()]);
    assert.deepEqual(standups.slice(0, 2).map(line => JSON.parse(line).outcome), ['ok', 'ok']);
    assert.equal(JSON.parse(denied.at(-1)).detail, 'stale table configuration');
  } finally {
    leaver.stop();
    staleDeal.stop();
  }
  assert.equal(sql(`SELECT status FROM public.online_poker_tables WHERE id='${closingTable}'`), 'closed');
  assert.equal(sql(`SELECT count(*) FROM public.online_poker_hands WHERE table_id='${closingTable}'`), '0');
  assert.equal(sql(`SELECT sum(amount) FROM public.online_poker_chip_ledger WHERE table_id='${closingTable}'`), '15');
});
