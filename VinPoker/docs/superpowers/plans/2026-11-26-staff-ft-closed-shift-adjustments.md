# Staff FT Closed-Shift Adjustments Implementation Plan

> Execution: one writer in the existing managed worktree, task-by-task using the local Superpowers executing-plans reference. Independent final auditor is read-only under AGENTS12.2; no recursive implementation agents.

**Goal:** Deliver the owner-approved5M base → real late checkout → pending200k → owner approval → separate recorded200k supplement, without rewriting the base or duplicating money.

**Architecture:** Snapshot completed attendance and the policy at prospective freeze. A month-serialized checkout observer creates immutable adjustment-request revisions; owner approval inserts a linked salary run into the existing Finance/payment stream. Existing readers learn verified parent/child semantics and expose pending source evidence; the new action flag defaults OFF.

**Tech Stack:** existing PostgreSQL17/local PostgREST, Supabase SECURITY DEFINER/RLS contracts, React/TypeScript/TanStack Query, existing shadcn components. No new package/service.

**Spec:** `../specs/2026-11-26-staff-ft-closed-shift-adjustments.md`.

## Global Constraints

- CRITICAL/RED; owner business decision above is authorized for local implementation only. No production apply, ledger mutation, deployment, secret write, flag-on or merge.
- Save all historical rows/receipts unchanged. Legacy missing evidence is unknown, not reconstructed.
- Keep PT monthly-summary and existing payment-intent semantics. Amounts are server-derived.
- Preserve one active base per club/staff/period, month lock ordering and post-wait authorization.
- Exact pending migration generated locally by CLI: `supabase/pending-migrations/20261126144343_staff_salary_closed_shift_adjustments_v1.sql`; paired `ROLLBACK_20261126144343_staff_salary_closed_shift_adjustments_v1.sql`.
- Full Goal0–6/E01–E10 remains open. Current expired schema CI input is not replaced by a different schema.

## Review Focus

- Rate/policy change after freeze: late work uses the original snapshot, not today's configuration.
- Two checkouts or approve/retry races: one current pending revision and one child per approved request; stale IDs cannot pay.
- Open/missing/legacy source: no invented completed day, no fabricated historical source and no implicit departure time.
- Parent/child across staff, club or period: reject before any record/cost/payment; malformed duplicate staff rows remain errors.
- Rollback after child payment: keep both receipts readable, disable affected new actions, never restore incompatible uniqueness or delete evidence.

## Task1 — Freeze completed FT work with source snapshot

**Files:** pending migration above; `tests/staffSalary/l02Payment.closedShift.sql`; existing `get_staff_salary_month`/`chot_staff_salary_month` callers remain compatible.

**Interfaces:** private immutable `floor_private.staff_salary_sources_v1(run_id,snapshot,created_at)`, RLS enabled and no client grants; private source calculator `floor_private.staff_salary_source_v1(uuid,integer,integer,jsonb DEFAULT NULL) RETURNS jsonb`. Update the two existing FT functions prospectively, retaining their ACL/signatures and source-body drift guards. Bind the caller's club/rate/standard policy when invoking the calculator. Snapshot version, source attendance IDs/dates/times, pending open IDs, monthly rate, standard days, deductions and freeze server time. PT branches unchanged. Do not add attendance payload to the broadly-readable legacy salary table.

- [x] Write native test:25 completed dates + one deterministic open-attendance fixture,rate5200000/std26 → preview/freeze5000000,closed25/pending1,approved base stable; inspect exact source snapshot. Actual check-in producer is retained in the baseline reproduction; full UI producer journey remains Task4.
- [x] Run against the current fixture and observe RED (preserved external reproduction: current freeze5200000).
- [x] Implement closed-source calculation and prospective private snapshot insert, preserving existing mutex/authority/frozen-period behavior.
- [x] Run native GREEN plus existing input/report/PT/stale tests on a fresh isolated clone; payment writer unchanged. Two real checkout/freeze connections overlap; legacy values/tuple identities and function ACL are unchanged. Rollback HOLD/forward/replay/drift and foreign-admin source denial pass.
- [x] Commit only the verified source/test paths and record task evidence in the ledger; commit `ebc8a1ecbbcdbe444b2a662496649ddaf2c5a0f9`. This task alone is not product delivery.

## Task2 — Pending revisions and owner-approved linked run

**Files:** a second additive pending migration/rollback, generated with `supabase migration new staff_salary_supplement_requests_v1` when Task2 begins; `tests/staffSalary/l02Payment.adjustment.sql`; `tests/staffSalary/l02Payment.adjustment.concurrent.sh`. Do not edit the Task1 migration after its commit.

**Interfaces:** new private `floor_private.staff_salary_adjustment_requests_v1` (base run, immutable source fingerprint/snapshot/positive net amount and separate gross delta, pending/superseded/approved state, approver/time, unique child run); private `floor_private.refresh_staff_salary_adjustment_v1(uuid) RETURNS jsonb`; owner-only `public.approve_staff_salary_adjustment_v1(uuid) RETURNS jsonb`; scoped/self-safe `public.get_staff_salary_run_source_v1(uuid) RETURNS jsonb`; operator `public.get_staff_salary_adjustments_v1(uuid,integer,integer) RETURNS jsonb`.

New source RPCs must use explicit super-admin, same-club owner/accountant or beneficiary checks, not the legacy `_staff_salary_authorised` helper's global club_admin grant. Any request snapshot payload also stays private or behind an equally strict boundary; a public pending request may expose only safe summary metadata under narrow RLS.

- [x] Write failing public-seam test: actual checkout after approved5M creates pending200k, not a payable or approved cost; base source/amount unchanged.
- [x] Under the month mutex, derive cumulative eligible net from the frozen policy; subtract base and approved linked runs. Reuse an identical pending revision; supersede a stale pending revision without changing its payload; generate one new positive candidate when needed.
- [x] Add local attendance checkout/closed-insert observer and request RLS/explicit ACL. Observer shares month lock order and locks the known month before discovering a potentially uncommitted base. Freeze/checkout overlap is preserved in Task2 qualification; portable runner now proves two simultaneous checkout calls return checked_out/no_open_shift and create exactly one pending200k.
- [x] Owner approval rechecks scope/current fingerprint under lock, rejects superseded requests, and inserts exactly one `staff_salary_runs` child using `adjusts_id`. Child belongs to the same club/staff/period and carries the approved request/source proof. Retain base uniqueness; enforce parent/child invariants.
- [x] Use existing `mark_staff_salary_paid` for child payment: pending request has no payable run; approved child200k has its own idempotent receipt. Native accountant/cashier approval denial, foreign-admin payment/report denial and post-lock accountant revocation pass; duplicate approval returns the same child.
- [x] Prove existing Finance cost5M while pending,5.2M after approval, and no additional cost after payment. Real freeze/checkout, two-approval and two-accountant-payment connections overlap with observed database waits.
- [x] Implement/test rollback HOLD for new adjustment writers and observer, retaining compatible source/read/payment data and indexes. Backend commit `06c0184d7a07a0579f4a47384802e78a32dc735e`; this backend commit alone is not product delivery.

## Task3 — Accountant/employee trace and confirmation

**Files:** `src/lib/featureFlags.ts`, `src/lib/staffSalary/types.ts`, `src/hooks/staffSalary/useStaffSalary.ts`, new focused `useSalaryAdjustments.ts`/tests and `StaffSalaryAdjustments.tsx`/tests; `src/pages/StaffSalaryChot.tsx`/tests; `src/hooks/staff/useStaffSalary.ts`/tests; `StaffSalaryScreen.tsx`/tests. Read smallest UI skill set before edits.

**Interfaces:** default-OFF `staffSalaryAdjustments` flag, scoped read-only source/request hook and owner approval action. Existing mark-paid confirmation accepts a server-verified child run ID/amount using the same payment writer; no amount argument. Salary row adds nullable `adjustsId` and snapshot availability; v1 report/self-payslip readers expose those additive fields.

- [x] RED tests for5000000 base +200000 pending, owner-only approval and separate approved-child payment confirmation, original frozen source drawer, legacy unknown, stale response/session/club and failed reads. New modules initially failed import until implemented; existing reader/headcount/self linkage and audited lifecycle/owner cases have behavioral RED→GREEN evidence.
- [x] Accept duplicate staff only with unique IDs and a valid same-staff base link; totals include approved children once and headcount counts unique people. Render child as supplement and pending request as awaiting approval. Feature OFF hides new actions while retaining compatible approved-child reads.
- [x] Employee sees original5M and linked supplement with independent pending/approved/recorded status and frozen-source reference; no bank/employee-ack claim. Additive self-reader migration generated by CLI `20261126162754_staff_salary_supplement_self_reader_v1.sql`; exact original/final source guard and deleted-self check retained. Pending self metadata stays distinct from approved payslips.
- [x] GREEN128 focused tests,1 existing optional skip across9 suites; actual tsc-b and Vite build PASS with4096MB Node heap (initial2048MB run OOM; no pass claimed for that run). No package update. Final source/commit binding follows below; do not use the base HEAD as the Task3 commit.

## Task4 — One real workflow and release evidence

**Files:** isolated native/HTTP browser harness and private evidence; `.github/workflows/staff-ft-payment-db.yml`, `staff-self-payslips-db.yml`/confirmation tests as needed; this plan ledger; own Codex handoff only in vault.

- [x] ActualUI/API fixture:25 closed+one actual API check-in; real accountant UI freeze5M/submit, owner UI approve, accountant UI pay5M; actual employee checkout API; pending200k; accountant cannot approve/pay pending; owner UI approves; accountant confirms/records200k; already-open employee sees both linked receipts, total5.2M, originals unchanged. Private proof `task4-ui-verification.json` and five-width screenshots; local synthetic auth is explicit.
- [ ] Observe real concurrent requests, stale revision, revocation/cross-club, lost response/replay, original frozen rate after configuration change, legacy evidence unknown, Finance totals and compatible rollback. Keep failed receipts and do not replay constructors on paid fixtures.
- [x] Inspect320/375/414/768/desktop without overflow; actual role/label confirmation controls and read-only Tab→Enter→Space source evidence at all five widths pass. Keyboard verification sent0writers and preserved both paid rows. Synthetic local auth is explicit; hosted/fullE05 and production gates are separate.
- [ ] Independent final read-only review; exact commit/inventory/function/source/test hashes; push existing draft only when coherent. Inspect current CI; expired capture failures remain failures before tests. Keep default flag OFF and stop at the controlled release gate.

## Execution Ledger

- Ruling: execute inline with the existing solo-writer authorization and owner-confirmed business rule; no extra routine plan/agent-choice approval. Production gate is unchanged.
- Post915 verification: portable `l02Payment.adjustment.concurrent.sh` + dedicated TEST fixture now runs from the existing payment CI entrypoint. Actual separate PostgreSQL processes/PIDs show PgSleep/Lock overlap for two checkouts→one pending200k, two approvals→one child and two accountants→one effective200k payment. Base5M JSON/private source unchanged, totalpaid5.2M; receipt `portable-supplement-race-verification.json`. Actor1692 TEST fixture is paid and must never be reconstructed/replayed. Local distro has no mounted Windows drive or jq; preflight failures occurred before seed, retained logs; files were copied to a new local temp workspace and assertions use available Python3 stdlib, with no installation/dependency update.
- Post915 keyboard/source binding: `task4-keyboard-verification.json` captures runtime hashes before its read-only run; exact current runtime matches915/post-run full-journey binding. Ten flagOFFscreens prove source buttons reachable withTab, expand withEnter and collapse withSpace;0writers, original paid rows unchanged. This is a new read-only proof, not a replay of the money constructor.
- Task3/4 local journey: native self pending200k→linked approved/paid child PASS,128 focused tests/1optionalSKIP, tsc-b/build PASS. Actual active employee update samples846ms pending and966ms recorded; these are two fixture observations, not fullE05/performance qualification. Ten flag-OFF screenshots (accountant/employee at320/375/414/768/1280) retain linked read/source compatibility without overflow; source proof distinguishes original25completed+1pending at freeze from child26completed and recorded200k versus full-period5.2M. No hostedAuth/full parent-route or production claim.
- Task3 review: independent P1 found held approval preflight could send a writer after unmount. Behavioral RED→GREEN adds mounted guards to new approval and existing payment preflight, with writer0 after unmount. P2 owner+globalclub_admin mapping now uses actual per-club owner_id, preserving only owned-club owner role. Independent final review PASS; no finding remains in this reviewed slice. Pending backend concurrency/portableCI/focus checks below still remain.
- Binding provenance: full journey ran while base HEAD was06c0184d7 with Task3 dirty. `task4-source-binding.json` records exact current runtime/migration hashes after the flow, explicitly labelled post-run capture; do not mislabel it a pre-run capture. Final commit/inventory binding is required before push. Never replay the paid UI fixture constructor for a source binding.
- Task2 backend verification: final candidate `780d6af5fbe19641996be162057cf91ef94cf9fb9049c04d549072673e3aafd6`, rollback `b090cbcc95a3029883e2cb3dd49dd814b2a848bad3a7e9c8e0445f1c328aab82`; fresh Task1-only install/reapply plus9 native regressions PASS. Private receipts: `task2-fresh-secure-verification.json`, `task2-concurrency.json`, `task2-revocation-verification.json`, `task2-lifecycle-verification.json`. Latest source-read/child-policy P2 RED→GREEN: deleted staff cannot read new private evidence or child rows; owner retains audit access. Independent read-only fix/binding review PASS. Concurrency receipts precede only the self-reader/policy fix; exact final lifecycle and fresh native qualification follow it. No claim of final-byte fresh concurrency replay.
- Task2 rulings: requests stay private; lock known FT month before discovering a potentially uncommitted frozen base; derive gross and net deltas separately from frozen policy; child payment checks scoped authority before and after waiting, including paid-receipt replay. Restrict legacy report when it would otherwise expose children to a foreign global administrator. Rollback holds new requests/approvals and observer, retaining approved read/payment compatibility. Pending net-zero/negative or gross-negative correction workflows are outside this positive supplement slice; no negative payment is generated.
- Remaining Task4/program verification: broader recovery/attack matrix (including child-specific response loss), hostedAuth/full parent-route and fullE05 performance. Source workflow applies Task2, four transactional regressions, self-reader integration and now the portable supplementary concurrency runner. On UI915f24d80, exact current source/confirmation CI passed; remote DB runs45863369365/45863369426 fail before candidate/test execution because capture44484017071 has no downloadable artifact. No production activation is authorized.
- Source investigation: current checkout alone does not generate200k because open days count before freeze; external reproduction preserved under `l02-ft-adjustment-20261126/open-shift-verification.json`.
- Source design: approved supplement uses existing `adjusts_id` and salary/payment/Finance stream. A separate pending request is not money or an approved cost. Cost if wrong: duplicate/missing wage recognition, so native Finance and rollback tests are required before delivery.
- Ruling: split the backend into additive Task1/Task2 migrations rather than append to a committed Task1 migration. This preserves the workspace rule against editing historical migrations; all pieces remain pending and unapproved for production.
- Ruling: independent audit found a P1 privacy expansion in the first local Task1 candidate: legacy global club_admin SELECT on public salary rows exposed the new attendance snapshot. Reject that public-column design; use immutable private storage and scoped/self RPCs. Preserve the RED direct-SELECT receipt and add a foreign-club denial regression. Legacy salary-row RLS overbreadth remains a separately recorded existing issue, not permission to expose new source data.
- Task1 verification: candidate847710d7cb924a4458caaeb34797edf6be810f9bc8f087cbf508ea5117d547a5, rollback6a54b16f1f6c124706b9658af11109090c9411fa25661f089f1675869a4ee4d3; independent P1 fix verification PASS. Private evidence `l02-ft-adjustment-20261126/task1-verification.json`, `task1-lifecycle.json`, `freeze-checkout-verification.json`. This is a backend subtask; pending requests, owner approval, compatible child readers and actual UI delivery remain open.
