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

- Independent creation across tabs and historical multiple escrow accounts still
  need a server uniqueness/selection policy. Stable intent IDs deduplicate retries
  of the SAME create; they do not mean one account per CLB.
- Already submitted Storage uploads may finish; no automatic object deletion.
- QR contents are manually supplied, not proof the encoded destination matches
  typed account details or a verified bank statement.
- Receiving escrow accounts are not outgoing payroll/expense source accounts.
  Drawer linking, approval/delegated limits, recognition and bank reconciliation
  remain mandatory TC2–TC6 work.

This changes financial routing configuration and stays owner-gated despite no DB
migration. No source test, screenshot or CI job implies production acceptance.

## Create recovery extension

Before a first INSERT, the authenticated actor/CLB editor durably saves an exact
UUID and payload in sessionStorage. No access token is saved. Unknown outcomes
keep that identity. On remount/recheck only that exact scoped ID is read; an
empty read restores the same draft with fields locked and an explicit retry.
Retry INSERT reuses the primary key. A23505 response is recovered only after
reading and comparing that ID, CLB, type and every requested field; no upsert or
overwrite. Corrupt/unavailable storage and mismatched receipts fail closed.
An independently created request in another tab can still create another row;
this extension does not invent a one-active-account rule or repair old duplicates.

The affected real-browser qualifier now also executes a committed INSERT whose
response is replaced by503, reloads the component with one stale empty read,
retries into an actual primary-key conflict, and recovers the original row.
All five widths assert identical POST payload/ID, exactly one database row,
cleared journal, visible controls and no horizontal overflow. This is isolated
configuration proof, not canonical hosted authentication or outgoing financing.
