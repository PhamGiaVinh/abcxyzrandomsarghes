import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createClient} from '@supabase/supabase-js';
import {createPayout379Read} from './payout379.read.local.mjs';

// Real SDK serialization + native PG semantics, not hosted PostgREST/E2E proof.
assert.equal(process.env.VINPOKER_PAYOUT697_LOCAL, '1');
const panel = readFileSync('src/components/cashier/tournament-live/PayoutEnginePanel.tsx', 'utf8');
const edge = readFileSync('supabase/functions/compute-payouts/index.ts', 'utf8');
const filter = panel.match(/\.or\("(status\.is\.null,status\.not\.in\.\([^"]+\))"\)/)?.[1];
assert.equal(filter, 'status.is.null,status.not.in.(void,voided,cancelled,canceled,refunded,rejected)');
const excluded = JSON.parse(edge.match(/const EXCLUDED_ENTRY_STATUS = (\[[^;]+\]);/)?.[1]);
assert.equal(`status.is.null,status.not.in.(${excluded.join(',')})`, filter);
assert.ok(edge.includes('.or(`status.is.null,status.not.in.(${EXCLUDED_ENTRY_STATUS.join(",")})`)'));
const tour = 'c367013a-3ed3-48af-ad48-3915acadc50e';
let requests = 0;
const client = createClient('http://127.0.0.1:54329', 'LOCAL_QUERY_SERIALIZATION_ONLY', {
  auth: {persistSession: false, autoRefreshToken: false, detectSessionInUrl: false},
  global: {fetch: async (input, options) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'http://127.0.0.1:54329');
    assert.equal(url.pathname, '/rest/v1/tournament_entries');
    assert.equal(url.searchParams.get('tournament_id'), `eq.${tour}`);
    assert.equal(url.searchParams.get('or'), `(${filter})`);
    assert.equal(options.method, 'HEAD');
    requests++;
    return new Response(null, {status: 200, headers: {'content-range': '*/9'}});
  }},
});
const response = await client.from('tournament_entries').select('id', {count: 'exact', head: true})
  .eq('tournament_id', tour).or(filter);
assert.equal(response.error, null);
assert.equal(response.count, 9);
assert.equal(requests, 1);

const sql = `BEGIN READ ONLY;
DO $$ DECLARE source text; canonical bigint; transport bigint; BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 SELECT pg_get_functiondef('public.prepare_payout_snapshot(uuid,numeric,text,numeric,bigint,bigint,text,boolean,text,jsonb)'::regprocedure) INTO source;
 ASSERT source ~ 'COALESCE\\(status, ''''\\) NOT IN \\(''void'',''voided'',''cancelled'',''canceled'',''refunded'',''rejected''\\)';
 WITH states(status) AS (VALUES(NULL::text),('registered'),('seated'),('busted'),(''),('void'),('voided'),('cancelled'),('canceled'),('refunded'),('rejected'))
 SELECT count(*) FILTER(WHERE COALESCE(status,'') NOT IN ('void','voided','cancelled','canceled','refunded','rejected')),
 count(*) FILTER(WHERE status IS NULL OR status NOT IN ('void','voided','cancelled','canceled','refunded','rejected'))
 INTO canonical,transport FROM states;
 ASSERT canonical=5 AND transport=canonical;
 SELECT count(*) FILTER(WHERE COALESCE(status,'') NOT IN ('void','voided','cancelled','canceled','refunded','rejected')),
 count(*) FILTER(WHERE status IS NULL OR status NOT IN ('void','voided','cancelled','canceled','refunded','rejected'))
 INTO canonical,transport FROM public.tournament_entries WHERE tournament_id='${tour}';
 ASSERT canonical=9 AND transport=canonical;
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_payout_runs WHERE tournament_id='${tour}');
END $$;
ROLLBACK;
SELECT 'PAYOUT697_SDK_FILTER_NATIVE_NULL_EXCLUSION_PARITY_READONLY_PASS';`;
const result = spawnSync('wsl', ['-d', 'PokerVision-P16-4C-Eval', '--', 'env', 'PGHOST=127.0.0.1', 'PGPORT=55441',
  'PGUSER=postgres', 'PGDATABASE=vinpoker_ops_cash115_qualified_c', 'psql', '-w', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'],
  {input: sql, encoding: 'utf8', timeout: 20000});
assert.equal(result.error, undefined);
assert.equal(result.status, 0, result.stderr);
assert.equal(result.stdout.trim(), 'PAYOUT697_SDK_FILTER_NATIVE_NULL_EXCLUSION_PARITY_READONLY_PASS');
console.log(result.stdout.trim());
// Exercise the existing browser read adapter with authenticated native SQL too.
const nativeRead = statement => {
  const read = spawnSync('wsl', ['-d', 'PokerVision-P16-4C-Eval', '--', 'env', 'PGHOST=127.0.0.1', 'PGPORT=55441',
    'PGUSER=postgres', 'PGDATABASE=vinpoker_ops_cash115_qualified_c', 'psql', '-w', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'],
    {input: `BEGIN READ ONLY;SET LOCAL request.jwt.claim.sub='40b8f243-bf3b-4aaa-962b-db788380207c';SET LOCAL ROLE authenticated;${statement}ROLLBACK;`, encoding: 'utf8', timeout: 20000});
  assert.equal(read.status, 0, read.stderr);
  return read.stdout.trim();
};
const fixture = {tour: '6a7fb4a3-8b46-44be-a71a-ca12a052ee08', club: '7f3c6f90-3667-4c8c-9a00-6f00da680d84'};
const log = [], headers = {};
const bridge = createPayout379Read({sql: nativeRead, query: statement => JSON.parse(nativeRead(statement)),
  fixture, actor: '40b8f243-bf3b-4aaa-962b-db788380207c', log, hangingReads: new Set()});
const url = new URL('http://127.0.0.1:54329/rest/v1/tournament_entries');
url.searchParams.set('select', 'id');url.searchParams.set('tournament_id', `eq.${fixture.tour}`);
url.searchParams.set('or', `(${filter})`);
assert.equal(bridge.handle(url, 'HEAD', null, {setHeader: (name, value) => {headers[name] = value;}},
  (status, body) => {assert.equal(status, 200);assert.equal(body, null);}), true);
assert.equal(headers['Content-Range'], '*/3');
assert.equal(log.at(-1).count, 3);
bridge.verify();
console.log('PAYOUT697_EXISTING_READ_ADAPTER_AUTHENTICATED_NATIVE_COUNT3_PASS');
