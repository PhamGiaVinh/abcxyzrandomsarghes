# Standalone PT read package: release and acceptance gates

Status: NOT LIVE. This checklist does not authorize apply, merge, deployment or flag activation.

## Exact boundary

The package adds two read RPCs and existing-screen entries for frozen payslip facts.
No partial-payment writer, plan, index, balance calculation, recognition policy,
legacy payment helper, bank transfer or retrospective correction is included.
The operator consumer is the existing authorized Cashier PT control; this package
alone does not supply the separate accountant consumer from PR1795.

Qualified SQL (UTF-8, CRLF/lone CR normalized to LF):

| File | SHA-256 |
| --- | --- |
| `finance_pt_statement_reads_v1.sql` | `871cd603ba0dc81818c15c044e41bc6ad003ccca74d01cb1ebb142ebd39c71cc` |
| `finance_pt_statement_reads_v1.rollback.sql` | `b0f8ee8b014c0acca79738d8f676a2b3f74cf994e812bdbcdd3d86d8ea457bc4` |

Expected function body MD5: detail `191f8b9de02702a828a1628d73ba8658`;
history `5788d4c196fba4cd5bae989f858d155c`.
Both are STABLE, SECURITY DEFINER, owner postgres, empty search_path, execute
granted only to postgres/authenticated. Existing authorizer body is
`cb89ab61460df145c0731806f29da523`, with exact metadata checked by the SQL guard.

## Evidence already obtained

- Native/HTTP/browser qualification45700545714 on fc2d03d5: original captured
  schema only, clean install/rollback and drift refusals, real legacy full-pay
  retry, canonical unpaid/paid views, revoked access and20+4 pagination.
- 90 affected tests, actual root typecheck/build, source review.
-375px and1280px synthetic actual-DB component captures. Authentication bootstrap
  was synthetic; these are not hosted Preview or production login acceptance.
- Preserve failures45699538724 and45700009560 and their diagnosed fixture/oracle
  causes. Neither has been relabeled PASS.

The deliberate label starts only the new original-schema workload. Do not remove
and re-add it or dispatch another run while a handle exists. Thirty-minute timing
starts after seed/setup and real-response assertions, not workflow creation.
Read-load evidence qualifies latest20 history rows and20 real reference details
only, with20 linked-self readers/pool10. It does not qualify deep paging, random
historical details, writes, UI interaction latency, hosted capacity or all TC6.
The other99980 rows are explicit synthetic volume clones, not independently
earned wages or historical accounting/forecast evidence.

## Before an owner apply request

1. Recheck the final source and independent critical review. Preserve passed
   evidence when its source/dependencies remain identical; qualify any changed
   wrapper, migration receipt or workload separately.
2. Read the live catalog again: no target-name overloads; exact legacy authorizer
   metadata and full-payment unique index; no version/name collision. A snapshot
   showing355 free is not a reservation or permission to apply it.
3. The proposed active migration is355 (`20270128000355_finance_pt_statement_reads_v1.sql`),
   byte-equivalent after line-ending normalization to the qualified pending source.
   Catalog allowlisting pins only that filename/hash, not arbitrary future SQL.
   Recheck collision at apply time and run catalog/promotion guards again; do not
   apply a pending file directly. The atomic runner must commit SQL and its exact
   receipt together. Promotion in source alone is not a production apply.
4. Verify a fresh encrypted backup with isolated restore. Use the actual snapshot
   time and the runbook freshness rule, not an old workflow dispatch timestamp.
   A queued export or schema-only capture is not a restorable recovery point.
5. Produce the final manifest: frontend SHA/project/domain, SQL version/name/hash,
   RPC metadata, no Edge change, current OFF flag, proposed activation, rollback,
   backup/restore receipt, source tests and appropriate load result.
6. Ask for approval of that exact package and target. Follow existing approval
   questions rather than creating duplicate runs or silently reinterpreting them.
   Schema-capture approval does not approve backup, migration apply or activation.

## Controlled apply and rollback

Use the canonical controlled DB runbook and protected workflow. No raw SQL Editor
apply, broad db push, history repair, security-hook bypass or replay.
If transport loses the apply response, inspect the exact receipt and functions
before any further action. Classify committed-exact/not-recorded/drift/unknown;
do not automatically repeat the write. Ledger presence alone is insufficient.

After apply, inspect both definitions, signatures, defaults, owners, security,
search paths and ACLs, plus the original unique index and legacy routines.
Rollback SQL removes only these two exact owned functions after checking their
metadata; it intentionally refuses changed definitions. Do not CASCADE or remove
the immutable apply receipt. Any production rollback remains a separately
controlled operation; disabling the frontend entry comes first when appropriate.

## Required hosted acceptance

Preview must serve the actual intended project/root/revision. A green deployment
of `target-source` is not the canonical project. Authenticate normally; do not
copy production session tokens into tests. Honor any active browser takeover.

On `https://vinpoker.vercel.app`, record actual served frontend SHA, RPC catalog,
flag consumer/value, TEST CLB, role and viewport. A timestamp-only version file
does not establish the deployed commit. Test desktop and mobile:

| Actor/action | Required result |
| --- | --- |
| Authorized Cashier opens an existing frozen TEST PT slip | Approved amount, recorded payments and unpaid balance match server facts; payment behavior remains legacy full-only |
| Linked employee opens Lương của tôi | Frozen statements appear separately from current unfinalized accrual; current0 cannot hide an old unpaid obligation |
| Open matching statement details | Same statement/club/dealer/hash, amounts, lines and cash/bank labels |
| More than20 statements | Correct next page with no duplicate/missing row at timestamp/UUID boundary |
| Inactive or now-FT linked employee | Old PT history remains readable under the established server policy |
| Change actor/session/CLB/dealer while reads are pending | Late old response cannot restore private data from old scope |
| Revoke role/link during the session | New read is refused; list/detail and open dialog remove private facts |
| Narrow viewport and long names/amounts | Main actions visible, no horizontal overflow/overlap; amounts readable |

Use approved TEST fixtures only. Native fixture-link mutation and its test JWT
are not authorization to mutate hosted membership or create production payroll.
If hosted TEST does not cover an edge case, label it unverified and keep the
appropriate isolated evidence; do not invent a hosted PASS.

Only after canonical hosted acceptance may this slice be called
PRODUCTION_LIVE_VERIFIED. The complete TC0–TC6 goal remains incomplete until all
mandatory packages, invariants, final journeys and performance gates pass.
