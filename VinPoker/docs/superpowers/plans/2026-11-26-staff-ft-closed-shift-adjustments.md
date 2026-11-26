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
- [ ] Commit only the verified source/test paths and record task evidence in the ledger; do not treat this task alone as product delivery.

## Task2 — Pending revisions and owner-approved linked run

**Files:** a second additive pending migration/rollback, generated with `supabase migration new staff_salary_supplement_requests_v1` when Task2 begins; `tests/staffSalary/l02Payment.adjustment.sql`; `tests/staffSalary/l02Payment.adjustment.concurrent.sh`. Do not edit the Task1 migration after its commit.

**Interfaces:** new `public.staff_salary_adjustment_requests_v1` (base run, immutable source fingerprint/snapshot/positive amount, pending/superseded/approved state, approver/time, unique child run); private `floor_private.refresh_staff_salary_adjustment_v1(uuid) RETURNS jsonb`; owner-only `public.approve_staff_salary_adjustment_v1(uuid) RETURNS jsonb`; scoped/self-safe `public.get_staff_salary_run_source_v1(uuid) RETURNS jsonb`; operator `public.get_staff_salary_adjustments_v1(uuid,integer,integer) RETURNS jsonb`.

New source RPCs must use explicit super-admin, same-club owner/accountant or beneficiary checks, not the legacy `_staff_salary_authorised` helper's global club_admin grant. Any request snapshot payload also stays private or behind an equally strict boundary; a public pending request may expose only safe summary metadata under narrow RLS.

- [ ] Write failing public-seam test: actual checkout after approved5M creates pending200k, not a payable or approved cost; base source/amount unchanged.
- [ ] Under the month mutex, derive cumulative eligible net from the frozen policy; subtract base and approved linked runs. Reuse an identical pending revision; supersede a stale pending revision without changing its payload; generate one new positive candidate when needed.
- [ ] Add local attendance checkout/closed-insert observer and request RLS/explicit ACL. Observer must share month lock order, not acquire attendance rows after locking the month. Test freeze/checkout and two-checkout overlap.
- [ ] Owner approval rechecks scope/current fingerprint under lock, rejects superseded requests, and inserts exactly one `staff_salary_runs` child using `adjusts_id`. Child belongs to the same club/staff/period and carries the approved request/source proof. Retain base uniqueness; enforce parent/child invariants.
- [ ] Use existing `mark_staff_salary_paid` for child payment: pending request has no payable run; approved child200k has its own idempotent receipt. Verify cashier/accountant cannot approve, cross-tenant/refused/revoked requests write zero, and duplicate approval returns the same child.
- [ ] Prove existing Finance cost5M while pending,5.2M after approval, and no additional cost after payment. Run real two-connection races.
- [ ] Implement/test rollback HOLD for new adjustment writers and observer, retaining compatible source/read/payment data and indexes. Commit verified paths; product slice still requires UI/runtime proof.

## Task3 — Accountant/employee trace and confirmation

**Files:** `src/lib/featureFlags.ts`, `src/lib/staffSalary/types.ts`, `src/hooks/staffSalary/useStaffSalary.ts`, new focused `useSalaryAdjustments.ts`/tests and `StaffSalaryAdjustments.tsx`/tests; `src/pages/StaffSalaryChot.tsx`/tests; `src/hooks/staff/useStaffSalary.ts`/tests; `StaffSalaryScreen.tsx`/tests. Read smallest UI skill set before edits.

**Interfaces:** default-OFF `staffSalaryAdjustments` flag, scoped read-only source/request hook and owner approval action. Existing mark-paid confirmation accepts a server-verified child run ID/amount using the same payment writer; no amount argument. Salary row adds nullable `adjustsId` and snapshot availability; v1 report/self-payslip readers expose those additive fields.

- [ ] RED tests for5000000 base +200000 pending, owner-only approval and separate approved-child payment confirmation, original frozen source drawer, legacy unknown, stale response/session/club and failed reads.
- [ ] Accept duplicate staff only with unique IDs and a valid same-staff base link; totals include approved children once and headcount counts unique people. Render child as supplement and pending request as awaiting approval. Feature OFF hides new actions while retaining compatible approved-child reads.
- [ ] Employee sees original5M and linked supplement with independent pending/approved/recorded status and frozen-source reference; no bank/employee-ack claim.
- [ ] GREEN focused hook/components, correct tsc-b and Vite build. Commit verified paths.

## Task4 — One real workflow and release evidence

**Files:** isolated native/HTTP browser harness and private evidence; `.github/workflows/staff-ft-payment-db.yml`, `staff-self-payslips-db.yml`/confirmation tests as needed; this plan ledger; own Codex handoff only in vault.

- [ ] ActualUI/API fixture:25 closed+one open; confirm5M/approve/pay5M; actual employee checkout; pending200k; accountant cannot pay pending; owner approves; accountant confirms/records200k; employee sees both linked receipts, total5.2M, originals unchanged.
- [ ] Observe real concurrent requests, stale revision, revocation/cross-club, lost response/replay, original frozen rate after configuration change, legacy evidence unknown, Finance totals and compatible rollback. Keep failed receipts and do not replay constructors on paid fixtures.
- [ ] Inspect320/375/414/768/desktop with overflow/focus/accessible confirmation checks. Synthetic local auth is explicit; hosted/fullE05 and production gates are separate.
- [ ] Independent final read-only review; exact commit/inventory/function/source/test hashes; push existing draft only when coherent. Inspect current CI; expired capture failures remain failures before tests. Keep default flag OFF and stop at the controlled release gate.

## Execution Ledger

- Ruling: execute inline with the existing solo-writer authorization and owner-confirmed business rule; no extra routine plan/agent-choice approval. Production gate is unchanged.
- Source investigation: current checkout alone does not generate200k because open days count before freeze; external reproduction preserved under `l02-ft-adjustment-20261126/open-shift-verification.json`.
- Source design: approved supplement uses existing `adjusts_id` and salary/payment/Finance stream. A separate pending request is not money or an approved cost. Cost if wrong: duplicate/missing wage recognition, so native Finance and rollback tests are required before delivery.
- Ruling: split the backend into additive Task1/Task2 migrations rather than append to a committed Task1 migration. This preserves the workspace rule against editing historical migrations; all pieces remain pending and unapproved for production.
- Ruling: independent audit found a P1 privacy expansion in the first local Task1 candidate: legacy global club_admin SELECT on public salary rows exposed the new attendance snapshot. Reject that public-column design; use immutable private storage and scoped/self RPCs. Preserve the RED direct-SELECT receipt and add a foreign-club denial regression. Legacy salary-row RLS overbreadth remains a separately recorded existing issue, not permission to expose new source data.
- Task1 verification: candidate847710d7cb924a4458caaeb34797edf6be810f9bc8f087cbf508ea5117d547a5, rollback6a54b16f1f6c124706b9658af11109090c9411fa25661f089f1675869a4ee4d3; independent P1 fix verification PASS. Private evidence `l02-ft-adjustment-20261126/task1-verification.json`, `task1-lifecycle.json`, `freeze-checkout-verification.json`. This is a backend subtask; pending requests, owner approval, compatible child readers and actual UI delivery remain open.
