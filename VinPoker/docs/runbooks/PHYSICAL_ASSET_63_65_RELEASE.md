# Quads physical asset declaration — source release packet

Scope: declare inactive numbered physical assets only. No table opening, session,
dealer assignment, attendance, chip, payroll or notification writes. Not live yet.
RPC signature remains `declare_club_physical_table_v1(uuid,integer,uuid,uuid)`.

## Required chain

- Retain original migration63 bytes; it has a reproduced revoked-authority race.
- Apply63 and forward65 in a single controlled package transaction, with exact
  ledger records in that transaction. Do not expose intermediate63 as final API.
- 65 pins source63 body MD5 `f6539c58bf0ddba6e7ef1fdf97af6e2a`, owner postgres,
  exact signature and empty search path, then rechecks server-derived authority
  after receipt mutex and after club lock. Unexpected body/overload aborts.
- Require live read-only dependency/body/grant/catalog qualification, recoverable
  fresh backup, exact reviewed source, required runtime CI and human release gate.
- Follow CONTROLLED_DB_APPLY; this document is not a command to replay migrations
  or permission to bypass failed checks. A protected apply transport still needs
  preparation and verification before dispatch. `physical-asset-63-65-release-plan.mjs`
  now prepares the exact single transaction with helper pins, shared package lock,
  two source receipts and exact object/ACL postchecks; it has no direct CLI/network
  apply path. The protected transport has not been implemented or dispatched.
- After DB postchecks, deploy matching frontend and verify canonical alias. Only
  then declare Quads21/22 through authenticated UI; if names already exist, stop
  and inspect provenance. Never adopt/delete old named assets automatically.

## Evidence and limitations

Real retained-schema PG17 clone, actual auth/receipt helpers: initial63 reproduces
commit after membership revocation while caller waits on exact club backend.
65 passes club wait and existing receipt replay wait (pg_blocking_pids barriers),
role/tenant/CAS/retry tests. Transactional fixtures rollback0; overlap fixtures
commit synthetic rows only in guarded disposable DBs. Neither proves live UAT.

Postcheck fixed API body MD5 `c4c0bab3f601386c8b4f44d849c255df`, postgres owner,
SECURITY DEFINER, empty search path, authenticated-only EXECUTE (not PUBLIC/anon/
service_role), one overload. Receipt replay after revocation must be denied with
no new asset/receipt. These are boundary rechecks, not serialization of every
revocation after the final check.
If any postcheck is unavailable or mismatches, stop frontend/canary rollout and
inspect the exact committed state. Do not retry the package or claim rollback.

Rollback: hide the declaration UI and forward-revoke execution; retain assets
and receipts. Do not restore vulnerable63, delete referenced assets or ledger.
Existing canonical frontend remains usable while this Draft package is held.
