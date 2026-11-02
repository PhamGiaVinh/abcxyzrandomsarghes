import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {describe, expect, it} from 'vitest';

const actor = '11111111-1111-4111-8111-111111111111';
async function run({failure = '', missing = false, malformed = false, thrown = false, populated = false} = {}) {
  let handler!: (req: Request) => Promise<Response>;
  const client = {from: (table: string) => {
    let secondary = false;
    const query = {
      select: () => query, eq: () => query, order: () => query, limit: () => query,
      maybeSingle: () => query, in: () => {secondary = true; return query;},
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
        const seam = table === 'staking_deals' && secondary ? 'payout_deals' : table === 'profiles' && secondary ? 'raters' : table;
        let data: unknown = table === 'profiles' && !secondary ? (missing ? null : {user_id: actor, display_name: 'TEST'}) : [];
        if (malformed && table === 'staking_purchases') data = null;
        if (populated) {
          if (seam === 'staking_deals') data = [{id: 'deal', status: 'completed', result_prize_vnd: 1000, player_payout_vnd: 600, buy_in_amount_vnd: 500}];
          if (seam === 'staking_purchases') data = [{id: 'purchase', deal_id: 'deal', percent: 10, amount_vnd: 50, status: 'funded'}];
          if (seam === 'payout_deals') data = [{id: 'deal', status: 'completed', result_prize_vnd: 1000}];
          if (seam === 'deal_ratings') data = [{id: 'rating', rater_id: 'rater', rating: 5}];
          if (seam === 'raters') data = [{user_id: 'rater', display_name: 'TEST RATER'}];
        }
        return (thrown ? Promise.reject(new Error('PRIVATE SQL DETAIL')) : Promise.resolve({data, error: seam === failure ? {message: 'PRIVATE SQL DETAIL'} : null})).then(resolve, reject);
      },
    };
    return query;
  }};
  const source = readFileSync('supabase/functions/get-public-profile/index.ts', 'utf8')
    .replace(/^import .*;\r?$/gm, '');
  runInNewContext(ts.transpileModule(source, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS}}).outputText, {
    createClient: () => client,
    Deno: {env: {get: () => 'LOCAL_TEST'}, serve: (fn: typeof handler) => {handler = fn;}},
    URL, Request, Response,
  });
  const response = await handler(new Request(`http://local.invalid/profile?userId=${actor}`));
  return {status: response.status, body: await response.json()};
}

describe('actual public profile handler, isolated I/O', () => {
  it.each(['profiles', 'staking_deals', 'staking_purchases', 'deal_ratings', 'payout_deals', 'raters'])('does not publish zero aggregates when %s fails', async failure => {
    const {status, body} = await run({failure, populated: true});
    expect(status).toBe(503);
    expect(body).toEqual({error: 'PROFILE_DATA_UNAVAILABLE'});
  });
  it('retains genuine empty aggregates as zero', async () => {
    const {status, body} = await run();
    expect(status).toBe(200);
    expect(body.player).toMatchObject({dealsCreated: 0, dealsCompleted: 0, itmCount: 0, avgRoi: 0});
    expect(body.backer).toMatchObject({totalStaked: 0, totalReturned: 0, netPnl: 0});
  });
  it('retains existing arithmetic and rater projection on successful reads', async () => {
    const {status, body} = await run({populated: true});
    expect(status).toBe(200);
    expect(body.player).toMatchObject({dealsCompleted: 1, totalProfit: 100, avgRoi: 20});
    expect(body.backer).toMatchObject({totalStaked: 50, totalReturned: 100, netPnl: 50});
    expect(body.ratings[0].rater.display_name).toBe('TEST RATER');
  });
  it('distinguishes an absent profile from backend failure', async () => {
    expect((await run({missing: true})).status).toBe(404);
  });
  it('rejects unavailable list data without fabricating zero', async () => {
    expect((await run({malformed: true})).status).toBe(503);
  });
  it('does not expose transport exception details', async () => {
    const result = await run({thrown: true});
    expect(result.status).toBe(503);
    expect(JSON.stringify(result.body)).not.toContain('PRIVATE');
  });
});
