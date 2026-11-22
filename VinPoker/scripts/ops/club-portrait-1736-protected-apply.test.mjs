import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {test} from 'node:test';
import {applyPortrait, preparePortrait} from './club-portrait-1736-protected-apply.mjs';

test('a missing source or existing bucket stops before any write', () => {
  let writes=0;
  assert.throws(() => applyPortrait('', {
    json: () => ({db:'postgres',actor:'postgres',ready:false}),
    execute: () => {writes++;},
  }, () => {}), /preflight/);
  assert.equal(writes,0);
});

test('a lost commit acknowledgement is classified using the exact receipt, with one write', () => {
  const rows=[{db:'postgres',actor:'postgres',ready:true},{count:1,exact:true}];
  let writes=0;
  const messages=[];
  assert.throws(() => applyPortrait('', {
    json: () => rows.shift(),
    execute: () => {writes++; throw new Error('connection lost');},
  }, message => messages.push(message)), /receipt/);
  assert.equal(writes,1);
  assert.deepEqual(messages,['CLUB_PORTRAIT_1736_STOP receipt=committed-exact']);
});

test('native PG17 writes the candidate, exact ledger, ACLs, triggers and Storage origin atomically', {
  skip: process.env.PORTRAIT_RELEASE_NATIVE !== '1',
}, () => {
  const releaseRoot=resolve(process.env.RELEASE_SOURCE_ROOT);
  const atomic=preparePortrait(releaseRoot);
  const query=sql=>execFileSync('psql',['postgresql://postgres:postgres@127.0.0.1:5432/postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],{
    input:sql,encoding:'utf8',
  }).trim();
  assert.equal(query("SELECT current_user='postgres' AND current_database()='postgres' AND to_regclass('public.clubs') IS NULL"),'t');
  query(`CREATE SCHEMA storage; CREATE SCHEMA auth; CREATE SCHEMA floor_private; CREATE ROLE authenticated; CREATE ROLE anon;
    CREATE SCHEMA extensions; CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
    CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text, statements text[]);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT NULL::uuid$$;
    CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    CREATE TABLE storage.objects(bucket_id text,name text,owner_id text,metadata jsonb);
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;`);
  query(readFileSync(resolve(releaseRoot,'tests/clubPlayerPortrait/club-fixture.sql'),'utf8'));
  const native={execute:query,json: sql=>JSON.parse(query(sql))};
  const reports=[];
  applyPortrait(atomic,native,m=>reports.push(m));
  assert.deepEqual(reports,['CLUB_PORTRAIT_1736_COMMITTED_EXACT_AND_POSTCHECK_PASS']);
  assert.throws(()=>applyPortrait(atomic,native,()=>{}),/preflight/);
  assert.equal(query('SELECT count(*) FROM supabase_migrations.schema_migrations'),'1');
});

