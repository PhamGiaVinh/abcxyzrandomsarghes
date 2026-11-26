# R01 — invitation workspace belongs to the current actor and club

Mode: CRITICAL, because the page can invite or revoke a club operator. This patch changes client context isolation; it does not change server authorization, ownership policy, membership writers, migrations, Edge configuration or flags.

The owner chooses a club, reads its invitations and can revoke only a verified row from that club. A failed B read must remove A rows/actions. A late A response or result from a previous login must not repopulate B. Pending invitations must be distinguishable from effective membership.

Base: `23617d3ead5651c823b14db26226b54077da44be`. Scope: `src/ops/pages/OpsClubAccounts.tsx` and its new colocated regression tests. Existing K01 work remains frozen on its own branch/PR1687.

## Observed failure and repair

Four original-page component cases failed: failed B kept A, late A replaced B, actor change kept A, and a cross-club row exposed a revoke button. Evidence is retained locally in `D:/Quy-trinh-hud-scale-evidence/r01-club-account-scope-20261127/red.json`.

The page now disposes its workspace by actor, session incarnation and owner-club capability set. Club selection clears rows/status, read revisions reject stale results, and a ten-second observation deadline turns unknown reads into an error with a same-club retry. Rows must match the requested club, supported role and canonical pending/active/revoked status. Revoke uses a currently verified row; synchronous single-flight guards prevent overlapping UI mutations. Mutation results from disposed contexts are ignored; no mutation is automatically retried on a timeout.

The existing endpoint remains responsible for authorization and write outcomes. This patch does not prove pending invitations have become effective membership. The list heading describes invitations; each row retains its explicit pending/active/revoked label.

## Verification and remaining work

The new component tests invoke the real page with mocked Auth/capability/read/write boundaries and a native select stand-in. They prove lifecycle isolation, not actual database policy, mail delivery or hosted UI. Model tests retain supported roles and status labels. Typecheck, build, independent review and actual isolated Auth/API/browser verification must be recorded separately; no production-complete claim follows from these tests.

The original R01 criterion asks for an ordinary actor owning both A+B. Both the retained November 19 schema and the current migration source enforce one club per ordinary owner (super-admin exception). A business question is pending; do not disable the trigger or infer current production policy from a local schema. The patch works for either future decision and does not alter that constraint.

Parent Cashier header/cache, other Cashier modules, exports/Realtime and full E07 workloads remain separate open requirements. Current production metadata/Vercel access is unavailable to this connector; this does not block source/local work.

## Release and rollback

Keep this authorization-sensitive change in a Draft PR until actual required checks, runtime evidence and a controlled release approval identify the exact SHA. No DB/Edge apply or feature-flag change is needed for this client patch. Before release confirm the deployed invitation contract still returns the validated statuses. A frontend rollback returns the prior client race behavior and must be assessed against outstanding invitations; it does not undo memberships or sent invitations. Preserve server receipts/audit, and do not replay mutations to verify rollback.
