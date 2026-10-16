# G0–G9 evidence map — local-only, 16 October 2026

This is an execution handoff, NOT acceptance of the site. Baseline source
`7c79ebd7a`, plus the paid-tour roster test in this package. Fresh fetch confirms
origin/main `ed3db6ac600710e95fe4408c475941916c23ab19`. Goal API ACTIVE.
No live catalog, deployment or feature flag is inferred from these local tests.
Owner's local-only/resource hold remains: no push/CI dispatch/production apply,
Edge/frontend release, Auto/Daybreak activation, Docker/heavy build/full typecheck.

| Goal | Local evidence available | Required evidence still missing / next action |
|---|---|---|
| G0 | Owned clean branch/checkpoints; native schema through121; fresh main fetch | Full current live migration/function/Edge/deployment/flag manifest not refreshed under release hold. Never substitute old ledger or local schema. |
| G1 | CI definitions and ordered local migration rehearsals prepared | Required remote checks/quota/recovery/approved exact release manifest and execution. No review gate bypass. |
| G2 | Native payroll82/83, profiles84, actor85, tenant86; Cashier paid/re-entry/recovery; Finance read fixes | Served UI, hosted Auth/Data API, live ACL/overloads and actor/club-switch UAT. |
| G3 | Earlier actual main source/PG ramps2/10/40, shortage/overlap/fault/response-loss; check-in/manual Swing/Voice coupling | Hosted dispatcher/Edge/cron receipts; three real rest15 rotations; tournament canary and desktop/375 evidence. Existing 40-local proof is NOT a new missing test to rerun blindly. |
| G4 | Atomic create/config88/91, clock89, receipts/true CAS and lifecycle overlaps | Exact deployed revision and real two-table creation/config journey in browser. |
| G5 | Local mode/pending/move/close, restore/re-entry safety; paid chip COMMIT/replay/chain undo couplingON/OFF | Same-tour eight-player journey through all operations, real browser375, hosted contracts and current legacy-data disposition. |
| G6 | Paid correction/history real worker/proof; TV event isolation/Storage metadata; Voice Board/hole/Finish SQL+engine/client boundaries, stale UI/provider generations; Finish recovery121 | Actual mic/provider/HTTP/Auth/CORS, real Storage bytes/retention, hosted worker schedules, anonymous browser multi-flight/reconnect, showdown Finish compatibility and required full checks. |
| G7 | Earlier source triage records GTO retirement, queue meanings and schedule provenance disclosure | Verify F1–F9 on served revision; financial/security claims need live proof, performance belongsG9. Do not rewrite retired GTO or invent schedule approval. |
| G8 | New durable local two-table/eight-paid/four-check-in roster checkpoint; other paid two-player integrated journeys | A SINGLE full TEST tour: chip setup→paid registrations→dealer assignment/three rotations→hand/correction→bust/restore→colorup/undo→break/close/end→all projections. Desktop+375 UI/RPC/DB receipts. Partial fixtures cannot close it. |
| G9 | Focused lightweight checks and per-test timings, not app latency | 20 samples×Floor/Tracker/Swing/Cashier/Chip, cold/warm/RPC raw data+p95; full required typechecks/build/CI, exact production SHA and smoke/UAT. |

## New shared roster checkpoint (actual durable local commit)

Test: `tests/cashier/paidTourRoster.native.mjs`, explicit gated exact loopbackPG17
via existing `createPaidJourneyFixture`. No fixture INSERT of payments/entries/seats.
Seven further registrations/payments use canonical Cashier RPCs; four synthetic
dealers use canonical UTC+7 check-in and exact-key replay. Two active sessions,
8 distinct seated entries/160000 chips,8 payment movements,4 checked-in attendance;
AutoOFF, no hands yet. Optional balancing uses exact-session Floor RPC, never
rewrites seat rows. Not Auto-assignment/rotation/payroll/TV/browser proof.

Qualified run `3433de`, terminal0/PGstopped. Retained owned local test audit:
- Club `435b8b6f-1320-466f-927f-9f3e82a778fb`
- Tournament `14b5a2a0-6599-49a4-b471-d8c1c07ff145`
- Table `959c931e-c3de-4813-8e20-a3abdaf6a699`, session `775a7ec7-59b2-405e-b628-61ea76c3bbb9`
- Table `ae4439c7-9f4e-41e5-b6f0-04f107729e27`, session `4d6a4dd5-0b13-47f8-8536-f0ac6977f3ad`

Next: extend this same scoped journey with Chip setup/issuance and projection
checks, then supported assignment and hand lifecycle. Preserve all audit and
unknown outcomes; do not reset the tour to mask failures. Keep rest/payroll/
payout/rounding unchanged. Full completion still requires the original plan.
