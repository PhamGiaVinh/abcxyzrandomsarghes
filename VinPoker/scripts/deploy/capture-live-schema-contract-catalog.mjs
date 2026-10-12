import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_API_BASE = "https://api.supabase.com/v1";

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error(`invalid argument near ${key ?? "end"}`);
    args.set(key.slice(2), value);
  }
  return args;
}

// The Management API executes this under its read-only database role. It returns
// metadata only: no business rows, credentials, or function bodies are selected.
export const CATALOG_SQL = `
WITH relation_catalog AS (
  SELECT jsonb_build_object(
    'schema', namespace.nspname,
    'name', relation.relname,
    'relkind', relation.relkind::text,
    'owner', pg_get_userbyid(relation.relowner),
    'columns', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'ordinal', attribute.attnum,
        'name', attribute.attname,
        'type', format_type(attribute.atttypid, attribute.atttypmod)
      ) ORDER BY attribute.attnum)
      FROM pg_catalog.pg_attribute attribute
      WHERE attribute.attrelid = relation.oid
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped
    ), '[]'::jsonb),
    'definition', CASE
      WHEN relation.relkind IN ('v', 'm') THEN pg_get_viewdef(relation.oid, true)
      ELSE NULL
    END,
    'selectAcl', jsonb_build_object(
      'public', EXISTS (
        SELECT 1 FROM aclexplode(COALESCE(relation.relacl, acldefault('r', relation.relowner))) privilege
        WHERE privilege.privilege_type = 'SELECT' AND privilege.grantee = 0
      ),
      'anon', EXISTS (
        SELECT 1 FROM aclexplode(COALESCE(relation.relacl, acldefault('r', relation.relowner))) privilege
        WHERE privilege.privilege_type = 'SELECT' AND privilege.grantee = to_regrole('anon')::oid
      ),
      'authenticated', EXISTS (
        SELECT 1 FROM aclexplode(COALESCE(relation.relacl, acldefault('r', relation.relowner))) privilege
        WHERE privilege.privilege_type = 'SELECT' AND privilege.grantee = to_regrole('authenticated')::oid
      ),
      'service_role', EXISTS (
        SELECT 1 FROM aclexplode(COALESCE(relation.relacl, acldefault('r', relation.relowner))) privilege
        WHERE privilege.privilege_type = 'SELECT' AND privilege.grantee = to_regrole('service_role')::oid
      )
    ),
    'dependents', jsonb_build_object(
      'relations', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'schema', dependent_namespace.nspname,
          'name', dependent_relation.relname,
          'relkind', dependent_relation.relkind::text
        ) ORDER BY dependent_namespace.nspname, dependent_relation.relname)
        FROM pg_catalog.pg_depend dependency
        JOIN pg_catalog.pg_rewrite rewrite_rule ON rewrite_rule.oid = dependency.objid
        JOIN pg_catalog.pg_class dependent_relation ON dependent_relation.oid = rewrite_rule.ev_class
        JOIN pg_catalog.pg_namespace dependent_namespace ON dependent_namespace.oid = dependent_relation.relnamespace
        WHERE dependency.refobjid = relation.oid
          AND dependency.classid = 'pg_catalog.pg_rewrite'::regclass
          AND dependent_relation.oid <> relation.oid
      ), '[]'::jsonb),
      'functions', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'schema', dependent_namespace.nspname,
          'name', dependent_function.proname,
          'identityArguments', pg_get_function_identity_arguments(dependent_function.oid)
        ) ORDER BY dependent_namespace.nspname, dependent_function.proname, dependent_function.oid)
        FROM pg_catalog.pg_depend dependency
        JOIN pg_catalog.pg_proc dependent_function ON dependent_function.oid = dependency.objid
        JOIN pg_catalog.pg_namespace dependent_namespace ON dependent_namespace.oid = dependent_function.pronamespace
        WHERE dependency.refobjid = relation.oid
          AND dependency.classid = 'pg_catalog.pg_proc'::regclass
      ), '[]'::jsonb)
    )
  ) AS item
  FROM pg_catalog.pg_class relation
  JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname IN ('public', 'storage')
    AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
), function_catalog AS (
  SELECT jsonb_build_object(
    'schema', namespace.nspname,
    'name', routine.proname,
    'owner', pg_get_userbyid(routine.proowner),
    'securityDefiner', routine.prosecdef,
    'configuration', COALESCE(to_jsonb(routine.proconfig), '[]'::jsonb),
    'definitionMd5', CASE WHEN routine.prokind IN ('f','p') THEN
      md5(replace(replace(pg_get_functiondef(routine.oid),chr(13)||chr(10),chr(10)),chr(13),chr(10))) ELSE NULL END,
    'arguments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'ordinal', argument.ordinal,
        'name', routine.proargnames[argument.ordinal],
        'type', format_type(argument.type_oid, NULL)
      ) ORDER BY argument.ordinal)
      FROM unnest(routine.proargtypes::oid[]) WITH ORDINALITY AS argument(type_oid, ordinal)
    ), '[]'::jsonb),
    'executeAcl', jsonb_build_object(
      'public', EXISTS (
        SELECT 1 FROM aclexplode(COALESCE(routine.proacl, acldefault('f', routine.proowner))) privilege
        WHERE privilege.privilege_type = 'EXECUTE' AND privilege.grantee = 0
      ),
      'anon', EXISTS (
        SELECT 1 FROM aclexplode(COALESCE(routine.proacl, acldefault('f', routine.proowner))) privilege
        WHERE privilege.privilege_type = 'EXECUTE' AND privilege.grantee = to_regrole('anon')::oid
      ),
      'authenticated', EXISTS (
        SELECT 1 FROM aclexplode(COALESCE(routine.proacl, acldefault('f', routine.proowner))) privilege
        WHERE privilege.privilege_type = 'EXECUTE' AND privilege.grantee = to_regrole('authenticated')::oid
      ),
      'service_role', EXISTS (
        SELECT 1 FROM aclexplode(COALESCE(routine.proacl, acldefault('f', routine.proowner))) privilege
        WHERE privilege.privilege_type = 'EXECUTE' AND privilege.grantee = to_regrole('service_role')::oid
      )
    )
  ) AS item
  FROM pg_catalog.pg_proc routine
  JOIN pg_catalog.pg_namespace namespace ON namespace.oid = routine.pronamespace
  WHERE namespace.nspname = 'public'
)
SELECT jsonb_build_object(
  'schemaVersion', 1,
  'relations', COALESCE((SELECT jsonb_agg(item ORDER BY item->>'schema', item->>'name') FROM relation_catalog), '[]'::jsonb),
  'functions', COALESCE((SELECT jsonb_agg(item ORDER BY item->>'schema', item->>'name', item->'arguments') FROM function_catalog), '[]'::jsonb)
) AS catalog;
`;

function extractCatalog(payload) {
  const rows = Array.isArray(payload) ? payload : payload?.result;
  const row = Array.isArray(rows) ? rows[0] : null;
  const catalog = row?.catalog ?? row?.jsonb_build_object;
  if (!catalog || typeof catalog !== "object") throw new Error("read-only catalog query returned an invalid payload");
  if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.relations) || !Array.isArray(catalog.functions)) {
    throw new Error("read-only catalog query returned an invalid catalog");
  }
  return catalog;
}

export async function captureLiveSchemaCatalog({ projectRef, accessToken, fetchImpl = fetch, apiBase = DEFAULT_API_BASE }) {
  if (!/^[a-z0-9]{20}$/i.test(projectRef ?? "")) throw new Error("invalid Supabase project ref");
  if (!accessToken) throw new Error("SUPABASE_ACCESS_TOKEN is required for the read-only catalog probe");
  const response = await fetchImpl(`${apiBase}/projects/${projectRef}/database/query/read-only`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: CATALOG_SQL }),
  });
  if (!response.ok) throw new Error(`read-only catalog query failed with HTTP ${response.status}`);
  return extractCatalog(await response.json());
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const projectRef = args.get("project-ref");
  const output = args.get("output");
  if (!projectRef || !output) throw new Error("project-ref and output are required");
  const catalog = await captureLiveSchemaCatalog({
    projectRef,
    accessToken: process.env.SUPABASE_ACCESS_TOKEN,
  });
  writeFileSync(resolve(output), `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
  console.log(`Read-only schema catalog captured (${catalog.relations.length} relations, ${catalog.functions.length} functions).`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : "read-only schema catalog capture failed");
    process.exitCode = 1;
  });
}
