import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Same image digest observed in the qualified ECR dump and official Docker Hub.
export const VERSION = '17.6.1.121';
export const DIGEST = 'sha256:69e57a409628a809e3778a4d176eb97e32d7c961131ac025b77ad094c0b2d49e';
export const SOURCE = `docker.io/supabase/postgres@${DIGEST}`;
export const TARGET = `public.ecr.aws/supabase/postgres:${VERSION}`;
const format = '{"id":{{json .Id}},"digests":{{json .RepoDigests}}}';

export function preload(version, execute = spawnSync, environment = process.env) {
  if (version !== VERSION) throw new Error('Linked Postgres image version requires review');
  const env = Object.fromEntries(Object.entries(environment).filter(([key]) =>
    !/^(SUPABASE_|PG|GH_TOKEN$|GITHUB_TOKEN$|VERCEL_TOKEN$)/u.test(key)));
  const run = args => {
    const result = execute('docker', args, { env, encoding: 'utf8', timeout: 300000, maxBuffer: 2 * 1024 * 1024 });
    if (result.status !== 0) throw new Error('Pinned dump image preparation failed; raw output withheld');
    return result.stdout;
  };
  const inspect = ref => {
    const value = JSON.parse(run(['image', 'inspect', ref, '--format', format]));
    if (!/^sha256:[a-f0-9]{64}$/u.test(value.id ?? '') || !Array.isArray(value.digests)
      || !value.digests.some(item => typeof item === 'string' && item.endsWith(`@${DIGEST}`))) {
      throw new Error('Pinned dump image digest mismatch');
    }
    return value.id;
  };
  run(['pull', SOURCE]);
  const imageId = inspect(SOURCE);
  run(['tag', SOURCE, TARGET]);
  if (inspect(TARGET) !== imageId) throw new Error('Dump image alias differs from reviewed image');
  return { version: VERSION, digest: DIGEST };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    preload(readFileSync('supabase/.temp/postgres-version', 'utf8').trim());
    console.log('PINNED_POSTGRES_DUMP_IMAGE_READY');
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Dump image preparation failed');
    process.exitCode = 1;
  }
}
