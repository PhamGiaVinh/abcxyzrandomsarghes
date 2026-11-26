# Legacy free TEST finance repair — reviewed correction; final live approval required

Owner confirmed on 24 November that the two registrations in Center Point's
`TEST — Felt UAT (compact)` were free test data. Read-only SQL observed:

- Club `22222222-2222-2222-2222-222222222222`.
- Tour `5a51bec5-4da0-4dd9-861a-cc4e7678478c`, live, start time NULL.
- Exactly two confirmed registrations created 24 July at
  `18:43:49.723826+07` and `18:43:50.71677+07`.
- Each has buy-in 1000000, total-pay 0, price snapshot NULL.
- No canonical Cashier movements/refund requests for those registrations.
- 31 hands, first hand 3 July. Preserve the full hand/action/player history.

The report's existing classifier correctly rejects inconsistent receipt amounts.
The missing-date guard consequently blocks every period: an undated receipt cannot
be assigned to a month. Changing a date alone would leave the price defect.

## Narrow correction

Change only the two registration `buy_in` values to 0. Keep total-pay 0,
price snapshot NULL, start time NULL, statuses, chip/entry records and hand history.
This records the owner's free-fixture classification without inventing a paid
receipt, fee allocation, refund or event date. Existing legacy zero-price rules
then yield unavailable buys 0, rake 0, service fee 0 and collected 0.

This is a privileged production data correction, not a generic backfill or schema
migration. No frontend release or Edge/flag change is needed for this correction.

## Evidence already available

`tests/cashier/freeTestFinanceRepair.native.mjs` runs on a new loopback PostgreSQL
17 database named `finance_free_test_component`, port 6543. It loads the repository
receipt classifier, actual paid-registration guard and exact report date guard.
It verifies the old error, corrected zero revenue, no invented date, full history
fingerprints, private backup/ACL, rollback, repeat/drift rejection, a real second
connection holding a writer lock, and malicious triggers that change history,
set a NULL price, or create a payment during apply/rollback.

**This is component evidence with reduced tables. It does not qualify the current
production schema, private classifier or complete finance-summary RPC.**

## Required before live GO

1. Authenticated Supabase CLI read-only access now works. Browser control still times out; no repair has been applied.
2. Run `preflight_free_felt_test_finance_20261124.sql` read-only. Record the exact
   two registration IDs, full-row preimage fingerprint, current trigger/function
   fingerprints, actual platform-fixed-fee and cashier-paid-at values. Stop if
   they differ from the narrow fixture assumptions. Check other payment sources
   and already-closed reports for these two registrations before changing them.
3. Capture current sanitized schema and restore it into an owned isolated DB.
   Recreate the exact target rows and enough authorized finance fixtures to test
   the real `floor_private.tour_revenue_live_source_v1` and
   `get_club_finance_summary_v2`. Compare selected-month report and old closes
   before/after; unrelated amounts must stay identical. Exercise active triggers
   without disabling them. Keep the existing historical PASS/FAIL evidence.
4. Independent review of the exact final scripts and qualification evidence.
5. Fresh encrypted pre-apply backup and verified isolated restore, with recovery
   point and rollback recorded under the controlled DB runbook.
6. Owner approves the exact reviewed script/hash, pinned IDs/preimage and live
   project `orlesggcjamwuknxwcpk`. Confirmation that data was free authorizes
   preparation; it is not the final reviewed apply approval.

## Controlled execution after GO

Use the existing protected operator path, as postgres, without removing hooks,
disabling triggers or changing migration history. Operator sets:

```sql
SET vinpoker.free_test_repair_ack='PREPARE_FREE_FELT_2_REGISTRATIONS_20261124';
-- Populate from approved read-only preflight; never guess this value.
SET vinpoker.free_test_expected_preimage_md5='<approved exact fingerprint>';
```

Execute the entire repair file atomically. It uses NOWAIT table locks to exclude
concurrent registration/payment/refund writers; those tables are locked briefly
for the transaction. This is a material operational constraint, so choose a quiet
TEST-only window. A lock conflict aborts; do not silently retry. Any failed guard
rolls back the correction and backup table together. A committed repair rejects
repeat application.

It stores both full registration preimages/postimages and hand/action/player
fingerprints in a postgres-only RLS table, never in logs or the vault. Existing
full preimages are preserved. Schema-migration history must remain unchanged.

## Live verification and rollback

- Private classifier: two valid free registrations, unavailable buys 0, all money 0.
- Full finance RPC: selected November period loads, old closes and unrelated sums
  unchanged. Check the actual owner report on desktop and mobile on the canonical
  web host; capture revision and visible result.
- Registrations: only buy-in and normal updated-at trigger effects changed.
- Tour date and 31 hands plus all child players/actions: fingerprints unchanged.
- No new payment/refund rows, notifications or other unintended trigger effects.
  Inspect actual current triggers in the isolated qualification first.

If correction needs reversal, separately approve the rollback file. It restores
only original buy-in from the private backup, refuses intervening row/payment/
history changes, and retains the backup with a rollback timestamp. It will restore
the original report error too. Never delete the tournament or its hand history.

## Qualification update — 24 November

Official CLI 2.101.0 `db query --linked` succeeded in read-only transactions on
the confirmed project. Exact IDs and whole-row UTC preimage are pinned in
`free-felt-test-finance-20261124-manifest.json`. Both rows have zero platform fee,
NULL cashier-paid-at, and no movement/refund/legacy-settlement/voucher-transfer.

The schema-only clone's file hash and 23 current live function definitions are
bound to that manifest. `freeTestFinanceRepair.currentSchema.native.mjs` verifies
those hashes, runs the actual private classifier and finance-v2 on loopback with
the captured registration rows, reproduces the original failure, verifies zero
revenue and an unchanged 123000 VND control expense, then rolls back. Current
registration UPDATE triggers remain enabled for the correction and rollback;
replica mode is used only when seeding the isolated fixture. It checks the exact
registration preimage hash and unchanged tournament record. This is SQL runtime
evidence with a simulated authenticated owner context, not browser/HTTP UAT or
universal parity for unrelated schema objects.

An immutable legacy close snapshot exists for this TEST tour. It already has
unavailableBuys 2, NULL event day and NULL revenue; snapshot JSON MD5 is
`c7529734fd3d37d87541a2ec6ca97f16`. The correction preserves that historical
snapshot. Historical close export remains unavailable; this package repairs the
live aggregate report and does not rewrite a past close to appear valid.

Existing encrypted backup run **45395561876** completed SUCCESS, including isolated
restore, matching table counts and database-owner/effective-ACL parity. Snapshot
recovery point: `2026-11-24T12:40:43.550654Z`. Metadata-only restore artifact
14922825006; no plaintext database data downloaded. Recheck freshness and target
preimages immediately before any apply; do not silently substitute an expired
recovery point. This receipt does not certify recovery of hosted Vault keys.

Final live approval is still required for this exact repair package. After GO,
preserve the live report limits above and verify server results and the actual
owner web view before claiming the finance-report capability complete.
