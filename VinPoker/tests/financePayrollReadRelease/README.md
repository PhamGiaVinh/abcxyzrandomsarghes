# Standalone PT payslip read release

This package is assembled from `main` without the pending installment foundation.
It adds only `get_pt_statement_installments_v1` and `list_my_pt_statements_v1`,
the existing payroll control's detail entry, and recipient history inside
`Lương của tôi`. `financePtStatementDetails` remains false. No new finance menu.

The old payment client, financial indexes, schemas, triggers, writers, status and
summary reports remain unchanged. Both new RPCs explicitly grant execution only
to authenticated callers and retain authoritative CLB/resource/self checks.
The established payslip reader's exact authorization definition and metadata are
prerequisites. Existing target names, including overloads, refuse installation.
Rollback checks both owned definitions before dropping only those new RPCs.

## Qualification scope

The workflow restores approved schema-only capture45651278424, exactSHA and
checksum, into loopback PostgreSQL17. No production credentials are used.

1. A clean clone installs and rolls back; legacy-definition, SECDEF, ACL and
   overloaded-name faults must refuse without partial installation.
2. A digest verifies original routine/relation/trigger/default-ACL preservation.
3. Actual legacy finalization freezes5M; existing full-pay records one5M bank
   receipt and exact retry. The new readers observe unpaid5M and then paid5M/0.
4. Actual Supabase client/components → PostgREST → DB at375/1280 exercise operator
   and recipient discovery/details, inactive/nowFT history and link/membership
   revocation. Browser routes permit only reads; the separate test coordinator
   uses the unchanged legacy writer. Auth/link bootstrap is synthetic, so this
   is not hosted authentication, Preview or production acceptance.
5. Pagination-only clones cover20+4 timestamp/UUID boundaries. These are not
   independently finalized earnings. Accountant revocation, private table grants,
   endpoint ACLs and the original unique full-payment index are checked.

Synthetic images use `animations: disabled` so a finite opening animation is
finished before visual inspection. Only the sanitized PNG artifact is retained.
Neither a green job nor those images prove new read-load capacity or TC6.

## Evidence and remaining gates

Reused source: unchanged parser/context and recipient behavior from PR1800/8ba26209
qualified under45694641242. That is supporting evidence, not qualification of
this new assembly. Its original schema/index arrangement needs its own runtime
and appropriate read-performance evidence. Do not rerun an unchanged passed
workload merely because a UI commit exists.

No production apply, flag activation or deployment is authorized by this file.
Critical review, catalog/metadata/collision checks, encrypted backup plus isolated
restore, exact owner gate, correct deployed revision and authenticated TEST
desktop/mobile web acceptance remain required.

Future installment installation must require these exact released readers
instead of creating the same functions again. Never include future plan/index/
trigger/status/report/resolver/payment changes in this standalone read release.
The full TC0–TC6 finance goal remains incomplete.
