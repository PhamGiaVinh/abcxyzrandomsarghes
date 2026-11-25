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

Status: audit and old-behavior baseline complete; new installment endpoints/guards, recognition basis, operator UI and production release incomplete.
