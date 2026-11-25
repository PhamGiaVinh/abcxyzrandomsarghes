# Unified finance implementation ledger

Owner-approved specification: TC0–TC6 in this conversation, 25 November 2026. This ledger supplements that specification; it does not replace or reduce acceptance requirements.

## Locked decisions

- One workplace named Tài chính & Đối soát, with Overview, Receipts/Payments, Payroll, Reconciliation.
- Owner configures per-obligation and daily delegated limits per person/club. Unconfigured means owner approval required. Prevent self-approval and concurrent quota overspend on the server.
- Common overhead stays at club level. Event allocation requires source evidence.
- Both recognition-period performance and actual cash movement must be reported. Preserve historical snapshots and version the change of accounting basis.
- Keep legacy combined unpaid payroll vouchers pending reconciliation; never generate duplicate individual obligations.
- Saved wages and paid documents are immutable; corrections append adjustments. A new period never erases debt.
- No paid infrastructure, automated bank transfers, or statutory tax engine. Existing Gemini Free Tier may explain authorized facts, with explicit quota exhaustion.

## Delivery order and evidence

- [ ] TC0: inspect live catalog, deployed source, flags, rights and every source-to-report mapping. Record plan/E-case definition mapping before evidence reuse.
- [ ] TC1: shared club/date context, canonical routes, four work areas, compatible legacy URLs, truthful cost breakdown, responsive runtime verification.
  - In progress: four navigation destinations, payroll/report/expense deep links, removal of demo-report shortcut, preservation of PT and club-expense fields from canonical RPC.
  - Source discovery: migration 310 explicitly says payrollNet INCLUDES ptWagePaid. PT must be labeled as a subtotal, never added again.
  - Still owed: canonical route migration, shared scope across modules, full live/reponsive verification. Navigation changes alone do not complete TC1.
- [ ] TC2: check-in/work/rest → reviewed wage revision → approval → partial/full settlement → payslip → both reports. Reuse existing FT/PT writers; add server capability only after current schema inspection.
- [ ] TC3: suppliers, expense approval, reimbursement, recurring drafts, installments, source accounts and prepayment schedules. Link event/series/attachments through actual mutation paths.
- [ ] TC4: drawer/bank reconciliation, prize/escrow liabilities, close races, historical cutover balances and audited late adjustments.
- [ ] TC5: source-backed Intelligence; upcoming obligations first, versioned out-of-sample forecasts second. Never train on facts unavailable when a prediction was issued.
- [ ] TC6: complete cross-department journey, performance qualification, independent critical audit, controlled release and authenticated desktop/mobile verification.

## Mandatory invariants and fixtures

- Wage 5M earned November, paid 2M + 3M December: November cost 5M once; December cash 5M; outstanding 5M → 3M → 0. Two distinct requests must not overspend the same obligation.
- Lost response after commit: recover original document. Stale approved revision: reject and require adjustment review.
- Rent 30M prepaid for three months: cash 30M when paid, period cost 10M each month; deposits separate.
- Inventory purchase is not another COGS charge. Consumed-food refund does not restore inventory; actual return and complimentary consumption have their own evidence.
- Cashier entry followed by bank confirmation and duplicate webhook: one financial event, reconciled evidence.
- Payout versus drawer close on two real connections: no omitted payment or payment outside a valid shift.
- Cross-club IDs, revoked roles, export and subscriptions: server denies unauthorized access. Late client responses never restore previous club data.
- Recurring draft per template/period is unique. Installments do not bypass obligation limits. Concurrent approvals cannot exceed remaining daily quota.
- Closed snapshots remain unchanged after correction. Interrupted backfills resume without duplication while new data arrives.
- Historical outcome entered day 12 is unavailable to a prediction issued day 10, even if the event occurred day 1.

## Performance and release

Financial workload: 12 months, 100,000 documents, 20 concurrent operators, 30 minutes, isolated environment. UI acknowledgement p95 ≤200ms; server-confirmed ordinary actions ≤2s; ready for next valid action after server acknowledgement ≤200ms; cross-screen refresh ≤5s; monthly report ≤5s. Include failed/incomplete samples. No production capacity claim from this fixture.

Verify widths 320/375/414/768/1280. No overlap, lost controls or page-wide horizontal scrolling. Final journey covers opening shift/drawer, check-in, tournament entries, F&B, wages, expense approval/payment, prize payout, reconciliation, closing and owner Intelligence.

Pin frontend/schema/RPC/Edge/flags/configuration and evidence validity. Encrypted backup plus isolated restore before critical apply; exact release gate and postchecks remain required. No completion claim until every mandatory test and verified-web requirement passes.
