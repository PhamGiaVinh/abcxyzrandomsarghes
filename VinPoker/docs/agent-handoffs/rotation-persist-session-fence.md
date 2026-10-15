# Rotation persistence session fence87

Status: source candidate; production unchanged. Branch codex/swing-persist-session-fence.

Closing sessionA and reopening its physical table previously allowed a planner
snapshot of assignmentA to insert a new prediction. Existing execute/lock fences
do not make that stored prediction correct. The PG17 regression first proves a
current-session prediction works, then rejects the stale snapshot.

Candidate87 preserves the persist signature, service-only ACL and existing diff
semantics. Physical/session locks fence lifecycle changes; schedule locks precede
assignment locks. Validation derives the current canonical session from server
data. Invalid tables are excluded from both incoming rows and supersede scope,
so a mixed valid/invalid batch preserves other predictions. The response includes
rejected_table_ids. PR1564 was merged into this candidate branch without changing
its worktree. Edge now reports commit rejections per table and excludes them from
announce/lock; malformed receipts stop announcements. Absent new fields remain
compatible with the old DB. The emergency replanner also stops on rejection.

Verification performed locally on restored reviewed schema SHA256
d23cfa75a7381453ba0d6216346f6460c816a3b1525ef5d47984c3a995ddc56a,
PG17 loopback55441, database vinpoker_ops_checkin:

- Baseline RED: stale_rotation_prediction_committed, after positive control.
- Candidate GREEN: current session, mixed invalid table, NULL assignment,
  cross-club scope, malformed payload, preserved prediction identity/version,
  canonical close/reopen stale rejection.
- Both close→persist and persist→close overlap: observer confirms real lock wait;
  both transactions finish with correct outcome, no deadlock observed.
- Node syntax and git diff whitespace checks pass.

The overlap test deliberately commits only isolated fixtures. Its namespace and
receipt keys are unique per execution. It does not send network notifications;
the restored sandbox has no net extension. No production mutation occurred.

Remaining before release: required CI; independent critical review; malicious
duplicate/NULL-session cases; lock overlap against pending close79/81;
exact catalog/dependency/recovery/rollback manifest and
protected apply. Existing old assignment-less set-diff fixtures need canonical
session/assignment identities if reused against87. Do not weaken87 to satisfy
legacy fixture shapes. Prediction cancellation when persist commits BEFORE close
belongs to close79/81; do not claim this package independently solves that path.

No frontend deployment or Auto activation is included. Daybreak remains OFF.
Rollback requires captured prior function and worker containment, preserving
audit and never resurrecting released reservations. Recheck migration87 collision
before merge/apply; current ledger has only70–77 in the new range.
