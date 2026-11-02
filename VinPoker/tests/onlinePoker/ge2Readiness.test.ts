// tests/onlinePoker/ge2Readiness.test.ts
// The GE-2 Phase D readiness reporter must be safe: it prints NO secret values, it
// FAILS CLOSED when prerequisites are missing, and it REFUSES to "proceed" unless the
// exact owner gate phrase is given. Driven as a subprocess (the real CLI) so we test
// end-to-end behaviour without importing the .mjs into TypeScript.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import {FEATURES} from '../../src/lib/featureFlags';
import {RUNTIME_LIVE} from '../../src/lib/onlinePoker/types';

const SCRIPT = resolve(fileURLToPath(import.meta.url), '../../../scripts/ge2-readiness-report.mjs');
const GATE = 'Proceed with G4 DB enable drill';

/** Run the reporter; returns { code, out }. Never throws (captures non-zero exits). */
function run(args: string[], extraEnv: Record<string, string> = {}): { code: number; out: string } {
  try {
    const out = execFileSync('node', [SCRIPT, ...args], {
      encoding: 'utf8',
      env: { ...process.env, ...extraEnv },
    });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

const ALL_ENV: Record<string, string> = {
  SUPABASE_URL: 'https://example.test', SUPABASE_ANON_KEY: 'anon-xxxx',
  P1_EMAIL: 'p1@test', P1_PASSWORD: 'pw1', P2_EMAIL: 'p2@test', P2_PASSWORD: 'pw2',
  SUPABASE_DB_PASSWORD: 'dbpw',
};
const EMPTY_ENV: Record<string, string> = Object.fromEntries(Object.keys(ALL_ENV).map((k) => [k, '']));
const DARK_SOURCE:Record<string,string>={
  'src/lib/featureFlags.ts':'onlinePoker: false',
  'src/lib/onlinePoker/types.ts':'export const RUNTIME_LIVE = false;',
  'src/pages/OnlinePokerTable.tsx':'if (!FEATURES.onlinePoker) return <PokerComingSoon />;',
};
const fixtureReport=(overrides:Record<string,string>={},missing:string|null=null)=>{
  // Keep the actual shebang CLI module in Node, outside Vitest's module transform.
  const source=`import {buildReadinessReport} from ${JSON.stringify(pathToFileURL(SCRIPT).href)};
    const files=${JSON.stringify({...DARK_SOURCE,...overrides})};
    console.log(JSON.stringify(buildReadinessReport({read:path=>files[path]??null,
      has:path=>path!==${JSON.stringify(missing)},env:${JSON.stringify(ALL_ENV)},gatePhrase:${JSON.stringify(GATE)}})));`;
  return JSON.parse(execFileSync('node',['--input-type=module','-e',source],{encoding:'utf8'}));
};

describe('ge2-readiness-report — never prints secret values', () => {
  it('omits secret env VALUES from the markdown output', () => {
    const SECRET = 'S3CR3T_dbpw_zzz999';
    const ANON = 'anonkey_abc123_should_not_print';
    const { out } = run([], { ...EMPTY_ENV, SUPABASE_DB_PASSWORD: SECRET, SUPABASE_ANON_KEY: ANON });
    expect(out).not.toContain(SECRET);
    expect(out).not.toContain(ANON);
    // it still reports presence by NAME
    expect(out).toContain('SUPABASE_DB_PASSWORD');
  });
});

describe('ge2-readiness-report — fails closed', () => {
  it('proceed=NO and prereqs pending when the env is missing', () => {
    const { out } = run(['--json'], EMPTY_ENV);
    const j = JSON.parse(out);
    expect(j.prereqReady).toBe(false);
    expect(j.proceed).toBe(false);
  });

  it('the real CLI respects the current source gates instead of assuming the repo is still dark', () => {
    const { code, out } = run(['--json'], EMPTY_ENV);
    const j = JSON.parse(out);
    const dark=!FEATURES.onlinePoker&&!RUNTIME_LIVE;
    expect(j.sourceReady).toBe(dark);
    expect(code).toBe(dark?0:1);
    expect(j.proceed).toBe(false);
  });

  it('accepts a complete synthetic dark source pack without enabling anything',()=>{
    const report=fixtureReport();
    expect(report.source).toHaveLength(12);
    expect(report.source.every((check:{ok:boolean})=>check.ok)).toBe(true);
    expect(report.sourceReady).toBe(true);
    expect(report.prereqReady).toBe(true);
    expect(report.gateGiven).toBe(true);
    expect(report.proceed).toBe(true);
  });

  it.each([
    {'src/lib/featureFlags.ts':'onlinePoker: true'},
    {'src/lib/onlinePoker/types.ts':'export const RUNTIME_LIVE = true;'},
    {'src/pages/OnlinePokerTable.tsx':'return <LivePokerTable />;'},
  ])('refuses a source pack with an enabled or missing self-gate even with all prerequisites: %j',overrides=>{
    const report=fixtureReport(overrides);
    expect(report.prereqReady).toBe(true);
    expect(report.gateGiven).toBe(true);
    expect(report.sourceReady).toBe(false);
    expect(report.proceed).toBe(false);
  });

  it('refuses a missing Edge source even when every drill prerequisite is supplied',()=>{
    const report=fixtureReport({},'supabase/functions/online-poker-action/index.ts');
    expect(report.sourceReady).toBe(false);
    expect(report.proceed).toBe(false);
    expect(report.source.find((check:{name:string})=>check.name==='Edge online-poker-action source present')?.ok).toBe(false);
  });
});

describe('ge2-readiness-report — refuses to proceed without the exact gate phrase', () => {
  it('no gate phrase ⇒ gateGiven=false, proceed=false (even with env present)', () => {
    const j = JSON.parse(run(['--json'], ALL_ENV).out);
    expect(j.gateGiven).toBe(false);
    expect(j.proceed).toBe(false);
  });

  it('a WRONG phrase is refused', () => {
    const j = JSON.parse(run(['--json', 'please', 'enable', 'poker'], ALL_ENV).out);
    expect(j.gateGiven).toBe(false);
    expect(j.proceed).toBe(false);
  });

  it('the EXACT phrase is recognised (gateGiven=true)', () => {
    const j = JSON.parse(run(['--json', GATE], ALL_ENV).out);
    expect(j.gateGiven).toBe(true);
    // proceed still depends on the local secret files existing (absent here), so we
    // only assert the phrase was accepted — never that it auto-proceeds.
  });
});
