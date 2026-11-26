# Staff FT closed shifts and approved supplements

Owner decision in the active VBacker Goal0–6 chat, 2026-11-26:

> Chốt 25 ca xong = 5 triệu; ca mở chờ tính và duyệt điều chỉnh sau checkout (khuyến nghị, khớp plan).

This extends L02/L05 within the full acceptance plan. It does not authorize production apply, deployment, flag activation or merge. Original obligations remain binding; this spec does not close the full program.

## Required behavior

For a TEST FT configured at5,200,000/month and26 standard days,25 completed attendance days plus one open day must preview/freeze/approve a5,000,000 base. The open attendance remains visible as pending source evidence. A real checkout of the open day produces a newly computed5,200,000 at the frozen rate/policy and a200,000 adjustment request awaiting owner approval. It must not change the base amount, original attendance/rate snapshot, signature or payment receipt.

The base remains payable for exactly5,000,000. A pending supplement is not payable and not an approved wage cost. Only the club owner/super-admin approval turns a verified current request into a separate200,000 payable linked to the original run. The existing payment intent/RPC records that payable, with its own method/reference/receipt. Accountant and employee can trace both records and statuses. Cash recording, bank reconciliation and employee acknowledgement remain separate.

Legacy runs without contemporaneous source snapshots remain explicitly unverified; never manufacture historical proof from today's rates/attendance. Existing paid/locked rows are never backfilled/recomputed. PT daily/month rules and prior receipts retain their behavior.

## Existing contracts to preserve

- `floor_private.staff_salary_period_lock_v1(uuid,integer,integer)` is the month mutex used by freeze/payment/approval. Recheck authority after waiting.
- `staff_salary_runs.adjusts_id` already expresses a correction link. Existing Finance reads locked/paid FT runs as wage cost and separates PT daily receipts. Approved supplements should enter that existing stream once.
- Current active-run uniqueness also applies to correction rows; replace it with equivalent base-run uniqueness plus explicit parent/tenant/approved-request invariants before inserting supplements. Do not merely drop uniqueness.
- `mark_staff_salary_paid(uuid,text,text)` remains the sole FT payment recorder. No client amount, no second payment ledger.
- Current report rejects duplicate staff rows. New code must accept only independently verified base/supplement relationships, retain unique run IDs and exact totals, and continue rejecting unrelated duplicates.

## Explicit limits and release constraints

This is prospective source correction. It does not invent a negative wage recovery policy or edit a past policy because a rate changes. Additional closed work is valued using the base run's frozen policy. Source changes which cannot be reconciled safely must fail closed and surface for review.

Feature UI defaults OFF. New app readers must safely display already-approved supplements even if new adjustment actions are disabled. Once supplements exist, rollback must preserve compatible readers and the existing approved payment records; disable new adjustment mutations instead of reverting to a frontend that rejects valid parent/child rows. Never restore the old uniqueness index over live supplement rows or delete their audit history.

Required proof: actual checkout→request→owner approval→existing payment writer→accountant and employee; two real DB connections; idempotent retries; old request revision; authority revocation/cross-club rejection; frozen rate and saved money preservation; Finance totals before pending/after approval/after payment; compatible rollback;320/375/414/768px and desktop rendering. Hosted/prod gates remain separate.
