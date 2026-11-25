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

Status: audit complete; baseline runtime pending; installments, recognition basis, operator UI and production release incomplete.
