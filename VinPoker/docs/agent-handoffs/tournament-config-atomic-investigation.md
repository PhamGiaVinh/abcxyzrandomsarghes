# Tournament config partial-write and authority investigation

Legacy atomic config writes NOT FIXED. Source-only migration86 repairs the separate
direct-table tenant write boundary. No live apply or frontend/Edge/flag mutation.

## Reproductions

Actual `useCreateTournament` / `useUpdateTournament` executed in the existing
React Query provider seam with transport/storage fixtures:

1. Tournament INSERT commits, old selected physical-table link DELETE commits,
   new link INSERT fails: caller receives failure but new tournament remains.
2. Link DELETE returns an error: hook ignores it and can report success after
   adding a second link for that physical table.
3. Tournament settings UPDATE commits and old links DELETE commits; later link
   INSERT failure leaves changed settings and missing links.

The mock respects actual eq(tournament_id) / in(table_id) predicates. This is
source-seam execution evidence, not production FK/trigger or network fault proof.
The three diagnostic tests PASS when these defects remain reproducible; they are
not repair acceptance gates and must not be reported as fixed.

## Verified live metadata, no record writes

- tournament_tables RLS enabled; authenticated INSERT/UPDATE/DELETE grants true.
- Live insert WITH CHECK true; update/delete USING true. Thus the RLS enable bit
  alone does not establish tenant authorization.
- Original 20260702000001 source policies instead scope via tournament.club_id,
  is_club_dealer_control(auth.uid(),club_id) or actual super-admin. Do not replay
  that historical migration or assume it matches live policy semantics.
- Current relation also carries game_table_id + exact table_session_id composite
  constraints, mode/revision, active/broken/closed state and Voice/projection
  triggers. A legacy table_id link is not an operational session assignment.
- Unique live link key is tournament_id/table_name, not the old unique(table_id).
  Legacy hook inserts omit table_name (defaults empty): multiple selected physical
  tables conflict within the new tournament. Disposable PG17 reproduces that
  constraint/default conflict; full captured-schema runtime remains required.
- Both live table triggers are AFTER triggers, not a BEFORE name-filling seam.

`tableWriteScope.disposable.sql` first reproduces cross-tenant writes using
live-shaped RLS and synthetic rows, then applies actual86 and tests owner/assigned
Dealer Control, outsider/admin/missing actor/anon/service, reparenting, foreign and
contradictory physical IDs, mismatched sessions and unchanged public reads. It omits
real lifecycle triggers and does not prove all live rows are writable in the old
state; those guards are not actor authorization. Browser roles intentionally have
no private table_sessions SELECT in the fixture: the caller-bound definer predicate
can verify identity without granting that data to browsers.

## Source-only tenant repair86

Restores existing historical Dealer Control/owner or actual super-admin authority.
Three policies use a single caller-bound predicate with explicit physical/session/
tournament linkage checks. No arbitrary subject user parameter. Public SELECT and
service BYPASSRLS path remain unchanged; no new write privilege is granted. Strict
live-policy precondition rejects unknown/additional write policies. The small new
helper is not a canonical mutation RPC: it does NOT provide CAS, a current-session
generation/epoch check, pending-move/hand closure guards or atomic config receipts.
Those remain required in the operational writers and following atomic repair.
Do not claim this package completes lifecycle hardening.
The predicate lives in existing non-exposed floor_private, not the public API.
Fixture policy execution passes without granting browsers schema USAGE or direct
private-session SELECT; only policy-bound function execution is required.

Migration86 is a newly generated/reserved file, not historical policy replay.
Normalized LF SHA256:
`01b495928a662277f4f0def15114f8376838a7c24c29db42be0e4585c4cb3740`.
Independent review caught a missing session.club_id equality; the predicate now
checks session/physical/tournament/club together. Live club_id is NOT NULL; the
fixture additionally relaxes that constraint to test fail-closed unknown identity,
not to claim null-club sessions currently exist in production.
Requires catalog hash pin, independent review, exact CI, captured-schema integration,
verified recovery point, existing protected apply gate and postchecks before release.
No automatic rollback to the confirmed broad authenticated/true policies; prefer a
reviewed forward compatibility correction preserving cross-tenant denial.

## Required repair contract, not yet implemented

- Replace multi-request configuration writes with a transactional server intent,
  exact actor/club checks and stable receipt identity. Do not emulate rollback by
  deleting a newly created tournament or swallowing subsequent errors.
- Do not delete/recreate an existing tournament-table UUID simply to edit settings;
  preserve seats, hand/session references, mode epoch and pending work.
- Selected physical tables cannot silently be stolen from another session/tour.
  Reuse canonical Floor lifecycle operations; reconcile legacy Swing configuration
  fields with those operations before defining the new RPC.
- Audit all direct table writers, then restore server-enforced tenant boundaries
  without disabling canonical owner/Floor/Dealer paths. Existing inventory shows
  the browser direct-write seam concentrated in useTournaments; Edge and SQL
  callers still require explicit classification.
- Keep optional blind setup/draft decision separate: this finding does not justify
  forcing blinds or changing registration, chips, payroll or swing/rest policy.
- Real captured-schema runtime, actor/tenant, overlap, response-loss receipt and
  rollback proof required before rollout. Existing release/storage/recovery gates
  still apply. No production test record deletion to address artifact quotas.
