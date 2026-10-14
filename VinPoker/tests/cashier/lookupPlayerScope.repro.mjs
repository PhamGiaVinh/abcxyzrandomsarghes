import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';

// Execute the real handler, removing only imports as in existing handler repro harnesses.
// Fixtures exercise Edge control flow, not live PostgREST/RLS or deployed Edge proof.
const source = readFileSync(process.env.CASHIER_LOOKUP_TEST_SOURCE || new URL('../../supabase/functions/cashier-lookup-player/index.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('index.ts', source, ts.ScriptTarget.ES2022, true);
const withoutImports = ts.factory.updateSourceFile(ast, ast.statements.filter(node => !ts.isImportDeclaration(node)));
const body = ts.transpileModule(ts.createPrinter().printFile(withoutImports), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

function harness({ superAdmin = false, empty = false, crossClub = false, fail, unauthorized = false, emptyScope = false, outsider = false, withPurchases = false, malformed, authStatus } = {}) {
  const reads = [];
  const profile = { user_id: 'player-test', display_name: 'TEST Player', phone: 'TEST_PHONE', bank_name: 'TEST_BANK', bank_account_number: 'TEST_ACCOUNT', bank_account_holder: 'TEST_HOLDER' };
  const deals = empty ? [] : [{ id: 'deal-test', club_id: crossClub ? 'club-b' : 'club-a', player_id: 'player-test', status: 'funded', buy_in_amount_vnd: 100000, percentage_sold: 50, filled_percent: 30 }];
  const client = {
    auth: {
      getUser: async () => ({ data: { user: unauthorized || authStatus !== undefined ? null : { id: 'cashier-test' } }, error: authStatus !== undefined ? { status: authStatus, message: 'auth read failure' } : unauthorized ? { message: 'invalid token' } : null }),
      getClaims: async () => ({ data: { claims: unauthorized || authStatus !== undefined ? null : { sub: 'cashier-test' } }, error: authStatus !== undefined ? { status: authStatus, message: 'auth read failure' } : unauthorized ? { message: 'invalid token' } : null }),
    },
    rpc: async (name, args) => {
      assert.equal(name, 'cashier_club_ids'); assert.equal(args._user_id, 'cashier-test');
      return fail === 'scope' ? { data: null, error: { message: 'scope backend unavailable' } } : { data: malformed === 'scope' ? null : emptyScope ? [] : ['club-a'], error: null };
    },
    from(table) {
      const filters = [];
      reads.push({ table, filters });
      let single = false;
      const query = {
        select() { return query; }, order() { return query; }, limit() { return query; },
        eq(key, value) { filters.push([key, [value]]); return query; },
        in(key, values) { filters.push([key, values]); return query; },
        maybeSingle() { single = true; return query; },
        then(resolve, reject) {
          if (fail === table) return Promise.resolve({ data: null, error: { message: `${table} backend unavailable` } }).then(resolve, reject);
          if (fail === 'backers' && table === 'profiles' && !single) return Promise.resolve({ data: null, error: { message: 'backers backend unavailable' } }).then(resolve, reject);
          let data;
          if (table === 'user_roles') data = [{ role: superAdmin ? 'super_admin' : outsider ? 'player' : 'cashier' }];
          else if (table === 'profiles') data = single ? profile : [{ user_id: 'backer-test', display_name: 'TEST Backer' }];
          else if (table === 'staking_deals') data = deals.filter(row => filters.every(([key, values]) => values.includes(row[key])));
          else if (table === 'staking_purchases') data = withPurchases ? [{ id: 'purchase-test', deal_id: 'deal-test', backer_id: 'backer-test', percent: 30, amount_vnd: 30000, status: 'funded', committed_at: '2026-10-14T00:00:00Z' }] : [];
          else throw new Error(`unexpected table ${table}`);
          if (malformed === table) data = null;
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  let handler;
  const z = { object: () => ({}), string: () => ({ uuid: () => ({}) }) };
  new Function('Deno', 'createClient', 'retryFetch', 'parseBody', 'z', body)(
    { serve: callback => { handler = callback; }, env: { get: name => `TEST_${name}` } },
    () => client, fetch, async req => ({ ok: true, data: await req.json() }), z,
  );
  assert.equal(typeof handler, 'function');
  return {
    reads,
    async run() {
      const response = await handler(new Request('https://test.invalid/cashier-lookup-player', {
        method: 'POST', headers: { Authorization: 'Bearer TEST_TOKEN', 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: 'player-test' }),
      }));
      return { status: response.status, body: await response.json() };
    },
  };
}

for (const scenario of [{ empty: true }, { crossClub: true }]) {
  test(`cashier cannot read a private player profile without a scoped active deal: ${JSON.stringify(scenario)}`, async () => {
    const h = harness(scenario); const result = await h.run();
    assert.equal(result.status, 200); assert.equal(result.body.player, null);
    assert.deepEqual(result.body.deals, []);
    assert.equal(h.reads.some(read => read.table === 'profiles'), false, 'do not fetch sensitive profile before proving relationship');
  });
}
test('authorized scoped deal retains the canonical player and unchanged amount projection', async () => {
  const h = harness(); const result = await h.run();
  assert.equal(result.status, 200); assert.equal(result.body.player.id, 'player-test');
  assert.equal(result.body.deals.length, 1); assert.equal(result.body.deals[0].club_id, 'club-a');
  assert.equal(result.body.deals[0].remaining_vnd, 20000); assert.equal(result.body.deals[0].sum_funded_vnd, 0);
});
test('superadmin retains explicitly global player lookup without an active deal', async () => {
  const result = await harness({ superAdmin: true, empty: true }).run();
  assert.equal(result.status, 200); assert.equal(result.body.player.id, 'player-test');
});
test('invalid authentication never reads a private table', async () => {
  const h = harness({ unauthorized: true }); const result = await h.run();
  assert.equal(result.status, 401); assert.equal(h.reads.length, 0);
});
for (const authStatus of [503, 0]) {
  test(`authentication infrastructure failure ${authStatus} is unavailable, never permission denial or data access`, async () => {
    const h = harness({ authStatus }); const result = await h.run();
    assert.equal(result.status, 503); assert.equal(result.body.error, 'Authentication unavailable');
    assert.equal(h.reads.length, 0);
  });
}
test('ordinary non-cashier cannot perform a privileged player lookup', async () => {
  const h = harness({ outsider: true }); const result = await h.run();
  assert.equal(result.status, 403); assert.equal(h.reads.some(read => read.table === 'profiles'), false);
});
test('authoritative empty club scope remains distinct from a failed scope read', async () => {
  const h = harness({ emptyScope: true }); const result = await h.run();
  assert.equal(result.status, 200); assert.equal(result.body.player, null);
  assert.equal(h.reads.some(read => read.table === 'profiles'), false);
});
test('funded purchase and backer projection keep existing money values unchanged', async () => {
  const result = await harness({ withPurchases: true }).run();
  assert.equal(result.status, 200); assert.equal(result.body.deals[0].sum_funded_vnd, 30000);
  assert.equal(result.body.deals[0].remaining_vnd, 20000);
  assert.equal(result.body.deals[0].purchases[0].backer_name, 'TEST Backer');
});
test('backer read failure does not publish a partially verified purchase projection', async () => {
  const result = await harness({ fail: 'backers', withPurchases: true }).run();
  assert.equal(result.status, 500); assert.equal(result.body.player, undefined);
  assert.match(result.body.error, /(?:lookup|scope) unavailable/i);
});
for (const malformed of ['user_roles', 'scope', 'staking_deals', 'staking_purchases']) {
  test(`malformed ${malformed} success is not authoritative empty data`, async () => {
    const result = await harness({ malformed }).run();
    assert.equal(result.status, 500); assert.equal(result.body.player, undefined);
    assert.match(result.body.error, /(?:lookup|scope) unavailable/i);
  });
}
for (const fail of ['user_roles', 'scope', 'staking_deals', 'profiles', 'staking_purchases']) {
  test(`${fail} failure is backend unavailable, not verified empty/zero or missing permission`, async () => {
    const result = await harness({ fail }).run();
    assert.equal(result.status, 500); assert.equal(result.body.player, undefined);
    assert.match(result.body.error, /(?:lookup|scope) unavailable/i);
  });
}
