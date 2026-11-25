# PT installment vertical slice — TC2 implementation contract

This is a subordinate implementation contract for the accepted TC0–TC6 finance goal. It does not complete or replace TC2, FT/staff wages, approval limits, source accounts, accrual reporting, final performance qualification or web acceptance.

## Source facts and evidence

Approved schema capture45651278424, main c9dba242, SHA256f81104251d6c79fdae537e0ca2faa7afa2ddc186eafadcb3bd4781276478b7d8. Source inspected directly and independently reviewed; no production wage rows inspected or changed.

- `finalize_part_time_payroll_statement` freezes the amount, earning segments and statement hash in `dealer_payroll_statements`, lines and `dealer_pt_wage_settlements`.
- `dealer_pt_wage_payments_statement_uq` allows one payment per non-null statement. `pt_wage_payment_id` and settlement `payment_id` are singular links.
- `pay_finalized_part_time_payroll_statement` pays the whole immutable settlement and immediately marks it paid. Repeating it returns one prior payment, not a remaining balance.
- `pay_part_time_balance` rejects a pending finalized settlement. `_pt_wage_balance` reserves the full covered interval while that settlement remains finalized.
- Settlement and statement triggers freeze source amounts/hashes. Ordinary void/replacement must not remain available after an installment.
- The current finance summary sums actual nonvoided PT payment rows by `paid_at`; it is cash basis. No second expense, generic payment row or summed parent cash event may be created for the same PT payout.
- Existing payment authorization is owner, linked cashier or super-admin; accountant membership alone is not payment permission. Preserve policy → dealer → statement → settlement lock order and recheck permission after waiting.

## Locked result

One owner-finalized November statement is 5,000,000 VND. Its source amount, hash, earning intervals and approved revision stay unchanged after all actions.

| Action | New canonical cash | Cumulative cash | Outstanding |
|---|---:|---:|---:|
| Finalize earnings | 0 | 0 | 5,000,000 |
| Record first installment | 2,000,000 | 2,000,000 | 3,000,000 |
| Retry the first request | 0 | 2,000,000 | 3,000,000 |
| Record remainder | 3,000,000 | 5,000,000 | 0 |

November recognized cost must eventually be 5M once, December actual cash 5M, using separately named/versioned reporting bases. Passing payment tests alone does not prove that accounting requirement.

## Execution steps and gates

1. **Establish the actual old behavior first.** `tests/financePayrollInstallments/baseline.pg17.sql` restores real public schema, seeds one PT dealer with five distinct closed 20-hour November attendances at50,000 VND/hour, calls the real finalizer and existing full-payment RPC, and verifies immutable5M, one5M payment and paid state. Roll back all TEST data. This proves the starting capability; do not call it an installment PASS.
2. **Design the smallest safe extension from that evidence.** A bare drop of the unique statement-payment index is forbidden. Any extension must preserve legacy one-payment protection, provide a server-locked remaining-amount budget and immutable request receipts, and explicitly protect full-pay/direct-balance/void/finalize paths. Record exact schema/index/function preimages before preparing a new migration. Do not alter migration354 or the frozen release packages.
3. **Introduce only one cash-event source.** Reuse the established PT payment ledger where safe. Each installment needs its own actual amount/date/method/reference; any singular statement link must be interpreted explicitly by the new API. Do not create an additional full5M cash row after2M+3M. Allocate display minutes without double counting the approved interval.
4. **Keep authority on the server.** The request supplies statement ID, expected immutable statement hash, requested amount and idempotency key. Server verifies club, actor, approved source/state, request identity and remaining amount under the existing lock order. Same-key different payload fails; two different requests cannot overspend. A lost response is recovered from its immutable receipt. Default-OFF rollout, no migration or feature activation without the exact release gate.
5. **Prove all competing writers.** Test two independent payment connections; installment versus existing full payment, direct balance payment, void/replacement and a new finalization. Preserve the full earning interval while money remains due. Old paid receipts replay correctly; legacy combined unpaid FT vouchers remain untouched pending reconciliation.
6. **Connect actual reporting and operators.** New statement detail displays approved total, individual payments, paid total and remaining balance. Reports must consume exactly those canonical cash events, distinguish current debt from selected-period costs, and implement recognition separately from cash basis without rewriting closed reports. Payment-source account integration and authoritative disbursement permissions must be completed before user-visible payment activation.
7. **Release only a working capability.** Actual PostgreSQL/HTTP proof, independent critical review, source/catalog/required CI, fresh encrypted backup plus isolated restore, exact owner approval and live TEST desktop/mobile verification remain mandatory. Never report source-only, simulated dates or one reader proof as complete finance operation.

## Test fixture and file boundaries

- `tests/financePayrollInstallments/baseline.pg17.sql`: real captured-schema current full-pay behavior; synthetic data only and outer rollback.
- `.github/workflows/finance-pt-installments.yml`: exact capture provenance and checksum; empty isolated PostgreSQL only; no production credentials or apply job.
- Product migration/API/UI files are chosen only after the baseline result and existing mutation guards are inspected. Do not invent a reusable money platform or reduce this contract to a UI amount field.

## Chosen extension after source audit

These are NEW objects/fields to implement, not claims that they exist in production. Do not replace this design with a second aggregate cash ledger.

1. Add nullable `installment_request_id uuid` to `dealer_pt_wage_payments`. Keep the existing `(dealer_id,idempotency_key)` uniqueness. Replace the statement unique index with the same legacy protection restricted to `installment_request_id IS NULL`; add unique `(club_id,installment_request_id)` for non-null installment IDs. This change is permitted only together with the independent server budget guard described below. Historical rows remain null/unchanged.
2. Add a default-OFF, club-allowlisted release configuration and immutable `finance_pt_installment_plans_v1` keyed by the existing statement ID. An owner/super-admin explicitly approves adoption against the expected statement hash. Require an untouched payable PT statement, exact statement/settlement dealer/CLB/amount/coverage binding, no payment rows or singular payment links, and a nonempty audit reason. Reject self-approval through the dealer's linked user. A repeated request must match its original intent.
3. New operator endpoints: `approve_pt_statement_installments_v1(statement_id,expected_hash,request_id,reason)`, `record_pt_statement_installment_v1(statement_id,expected_hash,amount,method,reference,request_id,note)`, and an authorized detail reader. Public mutations follow the existing policy/dealer/statement/settlement locks and recheck the actor after waiting. Existing linked cashiers may record only an already owner-approved plan; accountant membership alone is not payment permission.
4. A payment insert trigger must independently acquire that same lock order, reload the canonical statement/settlement/plan, and enforce remaining budget, request identity, source binding and full coverage. Every competing legacy writer must be protected; passing an amount check only inside the new RPC is insufficient. Canonical payment rows are2M and3M, never2M+3M+an aggregate5M row.
5. Under those locks, allocate `minutes_paid` as `floor(minutes_reserved*cumulative_paid/approved_amount)-floor(minutes_reserved*previous_paid/approved_amount)`, using exact numeric arithmetic. The final installment receives the remainder. These are allocated settlement minutes, not separate attendances; original rate segments/coverage stay immutable.
6. Keep the settlement finalized and full interval reserved after2M. Only after the sum reaches5M may it become paid and singular links point to the last payment. Those links are compatibility markers, never a total-paid calculation. Audit every relevant reader and use the payment list/sum in the new detail and remaining-debt report.
7. Patch the existing full-payment RPC to reject adopted installment plans after authorization and before its paid/link fast path. No adopted plan may fall back to old full-payment/direct-payment/void behavior when the new flag is OFF. Ordinary void/replacement after any installment is forbidden; payment-void transitions for installment rows are forbidden until a complete reversal workflow exists. An owner may void an adopted but wholly unpaid plan only through the authorized source lifecycle.
8. Recover exact original request receipts before the “already fully paid”/feature-disabled checks. Return the original installment amount and the current authoritative total/remaining in separately named fields. Changed amount, statement, method, reference, note or actor conflicts. Feature OFF blocks new mutations while allowing authorized receipt recovery and preserving all adopted-plan guards.
9. Before activation, complete source-account/disbursement integration, all singular-link consumers, employee payslip visibility and separately versioned recognition/cash reports. Source/API success alone must not expose a half-integrated payment flow. FT/staff and legacy shared unpaid vouchers remain explicitly outside this PT implementation slice and inside the full goal.

Baseline evidence: exact b40e607f run45661393978 PASS on the captured schema, using real finalizer/full-payment RPCs as `authenticated`. Private storage was inspected only after `RESET ROLE`; no grants or policies were widened. First809 run45660570747 failed because the fixture tried reading the private statement table as an operator; that proof defect was fixed rather than weakening permissions. The original5M statement remains exact except its expected singular paid link; one5M payment and exact retry are proven. This is full-only baseline evidence, not installment support.

## Implemented foundation and remaining acceptance

The pending-only extension now implements the approval/payment/detail APIs, independent payment-budget and lifecycle guards, legacy full-payment fencing and current-debt report integration. Actual captured-schema PostgreSQL and loopback PostgREST qualification passed on70babfd7/run45667023271, including real blocking-PID adoption/full-pay/void races and cashier revocation while waiting. Original snapshots remain unchanged; the canonical ledger has2M+3M, not an aggregate duplicate. Historical RED runs remain preserved.

Read-side compatibility added later onbed34a45/run45669397106: existing operator status returns canonical paid/remaining/adopted fields rather than inferring cash from the singular final-payment marker. The detail reader permits exact-club accountant read-only access; other readers reuse the existing statement policy, including the exact linked recipient. Mutation permissions remain owner/cashier/super-admin and owner-only plan approval. Native tests prove recipient/accountant read without payment permission, other-dealer refusal and no financial-row changes.

The operator row now displays those authoritative totals and suppresses legacy full payment after adoption. A read-only payslip/payment-history dialog is integrated in the existing row behind `financePtStatementDetails=false`. It validates actor/session/statement/club/dealer/hash/amount, hides failed or stale reads, shows original earnings and each canonical payment, and distinguishes CLB recording from employee receipt or bank reconciliation. Local45 affected tests, scoped lint, build and presentation-fixture browser checks at320/375/414/768/1280 passed. Presentation evidence is not hosted Auth, database-backed browser or production acceptance. The next CI also validates actual HTTP packets with the real client parser and checks application/tooling TypeScript references.

Retained legacy full-payment intents now have a separate read-only scoped resolution/archive flow; native locking/revocation and real operator browser acceptance passed on097020e7/run45689161959. It archives the original request plus explicit nonpayment proof before clearing its active slot, never treating a final installment as the original receipt. The same run verifies employee canonical bank/cash labels; unknown methods are not guessed as cash.

Existing report/detail read workload passed004101ef/run45686554176:100000documents/12months/20accountants/30minutes/7200samples,zeroerrors,reportp95111.815598ms and statementp9520.652896ms,unchanged financial fingerprints. This qualifies only those isolated RPCs. Preserve earlier FAIL45678868387, cancelled duplicates and qualificationFALSE diagnostic45685310319. No production performance/capacity or full TC6 claim. Do not rerun unchanged passed workloads merely because a later UI commit exists.

## Recipient frozen-history entry (new slice, runtime verification pending)

The new pending-only `finance_pt_recipient_history_v1.sql` lists only a linked recipient's exact dealer/club statements. It grants no table access and no payment permission; even club owner/cashier must use their established operator seam. It reuses the existing reviewed detail reader for immutable approved/paid/remaining facts, checks its exact source/owner/ACL/SECDEF/search-path metadata before installation, and returns at most20 rows plus an exact timestamp/UUID keyset cursor. An extra21st row only determines whether another page exists. No client wage calculation or fabricated zero debt is permitted.

In the same `Lương của tôi` screen, `DealerPtStatementHistory` exposes each frozen obligation and its existing read-only detail dialog. It remains reachable when unfinalized balance is0, the accrual endpoint fails for an inactive linked recipient, or that recipient now works full-time. Auth, session, dealer, club, page and retry changes hide old responses. Failed/revoked reads remove the page and selected detail. Full PostgreSQL timestamp precision is retained for order validation. The default-OFF `financePtStatementDetails` gate remains unchanged. There is no new finance menu/screen or disbursement action.

Local regressions reproduced missing3M debt, live-accrual-error/FT-history reachability and the60second poll unmount. The source fixes pass their affected local tests. Native tests cover cloned pagination-only records (not independent earned obligations), actual HTTP tests use a real finalized5M obligation before/after2M and3M, and browser tests target375/1280 including link revocation and inactive/PT-to-FT history. **Those new native/HTTP/browser cases still need an actual passing run before acceptance.** The earlier report/detail workload does not qualify this new list endpoint's load.

Status: foundation and read-side integration are implemented but NOT production-ready. Still required: recipient runtime/load qualification; complete operator installment-write UX; authoritative source accounts/disbursement/delegated limits; separate versioned recognition-period/cash reports (including the November/December fixture); FT/staff and legacy combined vouchers; catalog/version/preimage/index gates, affected performance workload, encrypted backup/isolated restore, exact critical approval, and actual TEST desktop/mobile verification on vinpoker.vercel.app. A useful read-only release must be packaged/qualified independently rather than waiting for future write modules. No TC2 or TC0–TC6 completion claim is made.
