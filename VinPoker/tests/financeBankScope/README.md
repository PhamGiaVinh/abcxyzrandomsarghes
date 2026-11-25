# Receiving-bank configuration scope repair

This package fixes the existing ClubAdmin receiving-bank widget; it creates no
new finance screen, RLS policy, RPC, source account or production data.

Before the fix, a late CLB-A read could replace CLB-B's form and account ID.
The old update filtered only that ID while sending the new club_id, and read
errors were interpreted as permission to create an empty account. Eight tests
reproduced the old behavior, then passed after actor/session/role/CLB isolation,
failed-read refusal, strict packet/receipt validation and scoped updates.

The bank name and BIN now save together in one PATCH. The actual live catalog
confirmed bank_bin exists. The native test must select a different bank and
verify both persisted fields, not merely resave an unchanged BIN. Existing
accounts cannot be reparented by this widget's update payload.

## Evidence boundary

Unit tests cover late reads, wrong packets, read errors, old save acknowledgements,
session changes, QR compression after switching club, scoped writes and zero-row
updates. Native qualification restores the approved schema into loopback PG17,
uses real PostgREST and RLS, and tests widths320/375/414/768/1280. It delays an
actual A response, saves B, switches to the distinct owner of A and verifies B
cannot be edited, and injects a503 delivery failure. Synthetic auth bootstrap
is not hosted login/UAT. No actual bank transfer or real bank record is used.

Active receiving-bank details are intentionally publicly readable in the current
schema. This patch does not claim to make them private or change authorization.
RLS remains authoritative; adding client filters is not a new privilege boundary.
An already submitted old-scope request may complete on its original resource;
its result must not update/toast/reload the new scope.

## Still open

- Creation after a lost acknowledgement, concurrent creation across tabs, and
  historical multiple escrow accounts need their own server identity/revision
  policy. This patch does not claim idempotent creation or resolve old duplicates.
- Already submitted Storage uploads may finish; no automatic object deletion.
- QR contents are manually supplied, not proof the encoded destination matches
  typed account details or a verified bank statement.
- Receiving escrow accounts are not outgoing payroll/expense source accounts.
  Drawer linking, approval/delegated limits, recognition and bank reconciliation
  remain mandatory TC2–TC6 work.

This changes financial routing configuration and stays owner-gated despite no DB
migration. No source test, screenshot or CI job implies production acceptance.
