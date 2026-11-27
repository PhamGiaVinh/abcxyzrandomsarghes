# R02 — scoped Dealer Control invitations

CRITICAL. Draft PR #1710 remains unmerged. Nothing in this document authorizes
production apply, deployment, flags or a main merge.

Owner A grants Dealer Control A to a person who already works as Cashier B.
The receiver gains Dealer Swing A, keeps Cashier B, and gains no ownership,
accountant role, global role or authority over payroll A. Revoking the invitation
removes only Dealer Control A, including already-open workspaces.

## Composition

- Retain the existing R02 pending invitation migration
  `20261119141550_ops_dealer_control_invites.sql` unchanged.
- Include the reviewed R01 actor/session/owner-context fences and the Ops
  permission refresh implementation from PRs #1819 and #1820.
- The real Ops entry crosses into `/dealer-swing`. Its operational document now
  revalidates current club authority through a dedicated hook: two seconds after
  each completed read, no overlap, ten-second overall deadline, actor/session
  fence, and immediate retirement of a changed boundary before club labels load.
  Unchanged scope preserves the workspace. Swing receives only dealer clubs;
  payroll requires independent payroll authority in those same clubs. Cashier B
  remains a separate valid module. Verified superadmins retain the existing
  global payroll path even without assigned clubs; withdrawal removes that path.
- A full-schema local test found preexisting permissive payroll policies: a
  Cashier B actor could directly approve a period in A while the secure RPC
  correctly rejected that actor. A second real-session test demonstrated an
  adjustment arriving during approval. These block the claimed role boundary.
- New pending `20261126234643_payroll_period_table_authority_v1.sql` narrows five
  raw payroll tables. Canonical owners, cashiers and accountants retain scoped
  reads. Existing payroll RPC definitions and ACLs remain unchanged. Draft
  adjustment INSERT uses only the five columns sent by the existing UI, binds
  its creator and denies forged approval metadata. Draft DELETE is scoped by
  club, not by the adjustment's creator.
- A private, non-callable trigger takes the same parent-period row lock as
  approval, then checks current authority and status before a client adjustment
  INSERT/DELETE completes. Employee salary history stays behind its existing
  caller-bound RPC. No stored salary or receipt is recalculated.

## Local evidence

Evidence directory: `D:/Quy-trinh-hud-scale-evidence/r02-continuation-20261127`.
The database is an independent full-schema clone, not a minimal substitute for
Auth or the membership helpers. The original retained source database is intact.

- Payroll native regression: owner/accountant/cashier tenant reads, actual R02
  service grant, no payroll A after that grant, valid draft INSERT RETURNING,
  creator/approval forgery rejection, owner deletion of another cashier's draft,
  frozen state, employee own/foreign history, saved 5,000,000 VND unchanged.
- Two actual connections: adjustment INSERT and DELETE wait for approval and
  fail after approval commits; the inserted row is absent/the original row stays.
- Nine apply guards reject unexpected policy, table/column grants, disabled RLS,
  helper/trigger-body/trigger-ACL/schema drift and contradictory tenant links.
  Every negative transaction rolls back.
- Native invitation acceptance tests cover a confirmed receiver, exact retries,
  expired/fresh/former-owner invitations, scoped revocation and membership readers.
- Concurrent grant/revoke retries observe a real PostgreSQL backend lock wait,
  produce only one grant and one revoke event, and preserve Cashier B.
- Full project typecheck passes with a 4 GiB Node heap. The earlier default-heap
  OOM is retained in the evidence; it was not a compiler PASS.
- Seven Deno handler tests pass. The earlier 37 focused frontend tests remain
  valid for the unchanged invitation UI/provider source. Fifteen new operational
  hook/dashboard tests pass, including the unassigned superadmin regression.
  Full project typecheck, build, targeted lint and all four Ops/context guards pass.
- Actual local run 1740 uses GoTrue password sign-in, the original application
  documents and Deno handler, PostgREST and the independent full-schema DB. Both
  receiver views are open before grant. Dealer Swing A activates; there is no
  unrelated B selector or payroll tab. Revoke removes Hub access and the already
  open operational document, while Cashier B remains. The observed 2,045 ms is
  one functional upper bound, not a workload or p95 qualification.
- Real receiver HTTP reads return no payroll A rows and one authorized B period;
  direct approval A is `403/42501`. After revoke, the inventory RPC follows its
  existing `200` with empty-array denial contract. Five financial table row
  fingerprints stay identical. Five widths (320/375/414/768/1280) have no horizontal
  overflow; no browser page error or external request. Auth/API/Deno are stopped.
  The local gateway's unavailable welcome-email endpoint is not an email proof.

Run the native SQL files only against the guarded disposable local database.
`tests/ops/payrollStorageAuthority.concurrent.cjs` documents its local-only
environment and uses `psql` or `PSQL_BIN`. SQL fixture transactions roll back;
concurrent test fixtures are retained with fresh IDs for inspection.

## Release gate and rollback

Apply the reviewed payroll prerequisite before enabling Dealer Control invites.
Verify the exact live catalog, helper bodies, migration ledger and existing rows
first. Unknown catalog/body drift must stop apply. The original invitation SQL
also requires an exact baseline/candidate RPC preflight in its controlled apply
package; its file must not be silently edited to accept a different baseline.

Both invitation flags default OFF: `VITE_OPS_DEALER_CONTROL_INVITES_ENABLED` and
`OPS_DEALER_CONTROL_INVITES_ENABLED`. Local flags ON are test configuration only.
Turning them OFF stops new invitations; it does not revoke pending invitations
that can still be accepted within their one-hour window. A containment procedure
must explicitly revoke the affected pending invitations when required.

Keep the new invitation readers/revoker and ledger after creating Dealer Control
rows. Restoring an older revoker can treat Dealer Control as Cashier and fail to
remove the intended membership. Preserve audit/history and forward-fix rather
than restore the permissive payroll policies.

Still unqualified here: real email delivery/callback, hosted frontend/Edge/DB,
the absent legacy `get_payroll_audit_log` RPC, whole-program E01–E10 and performance
workloads. Supabase production read permission and the correct Vercel project
remain external release dependencies. The full Goal 0–6 stays open.

An additional E05 follow-up is reproduced with rollback-only native calls: the
unchanged legacy secure payroll transition accepts a global `club_admin` marker
without ownership/cashier/accountant membership in the target club. R02 adds no
such global role, but its storage fix is not a claim that all payroll RPC tenant
boundaries are repaired. Keep that P1 open for the payroll authority packet.
