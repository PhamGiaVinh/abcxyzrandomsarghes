# Tracker Cát khói — coordinated350/351 release

Status: qualification in progress; **not production approved or applied**.

## Immutable application package

- Consumer/source revision: `3c6e2080a0afd2f611693ff13b280d368df886a3`, Draft PR1779.
- Supabase production project: `orlesggcjamwuknxwcpk`.
- Vercel team: `team_tjxaiA2Z3ZwHSQUMnMs4F5yE` (`davinci-s-projects`).
- Frontend project: `prj_wLBZF7nG5O2bffM9Qu1v2rgMuMwk` (`vinpoker`).
- Public target: `https://vinpoker.vercel.app`.
- `target-source` is another project: its green check does not qualify this frontend.

| Phase | Migration | Normalized SHA256 |
| --- | --- | --- |
| Dormant schema and atomic writer | `20270128000350_tracker_bb_ante_atomic_v1` | `40facc8f4e09daa07a36ab7d07a3f99433d84c6d40de15d70e58f280632f83c1` |
| Settlement, public reader, correction and final activation | `20270128000351_tracker_bb_ante_settlement_v1` | `54821b77d5033cf64d7244653954d0a43793281276626cab77939f478ce363bd` |

Deploy all six Edge consumers from the pinned revision, retaining each function's
existing authentication/JWT configuration:

1. `tournament-live-update`
2. `tournament-live-resettle`
3. `tournament-live-resettle-commit`
4. `tournament-historical-settlement`
5. `tournament-historical-settlement-worker`
6. `tournament-historical-settlement-dispatcher`

The additional three history consumers import changed shared code even though
their own entrypoint files have no diff.

## Business invariant

Only hands created after351 use BB ante. Their frozen level is SB/BB/BB; the BB's
available stack pays the blind first, then the remaining ante. The visible order
is SB blind, BB ante, BB blind. All three posts and their receipt commit once.
Ante contributes to the main pot without raising the live wager or refundable
unmatched bet. Existing hands retain their stored rule.

For100/200, two live wagers of200 plus200 ante yield600, with zero refund. A BB
starting300 pays200 blind and100 ante. Validating or replaying that hand must not
reinterpret the100 ante as an unmatched wager.

## Release order and stop conditions

1. Finish PR checks, anonymous preview/mobile replay checks, and required local
   engine/native acceptance. Keep the critical PR in draft until the final gate.
2. Qualify `.github/workflows/tracker-bb-ante-protected-apply.yml`, the protected
   owner-only dispatch using the reviewed runner. Verify
   source checks, required-reviewer environment, exact revisions and credentials
   through the existing controlled DB/Edge runbooks. No generic `db push`.
3. Obtain one owner approval covering these exact SQL sources, six Edge consumers,
   frontend revision, new-cohort activation and the rollback below. This document
   and the runner do not themselves grant approval.
4. During a controlled pause in new hand creation, run the existing encrypted
   backup plus isolated restore verification. Require current production owner
   and effective ACL parity and a restore receipt less than one hour old.
5. Re-read production function preimages and ACLs. The runner pins the four
   definitions observed on production2026-11-24, including the PL/pgSQL plan-cache
   wrapper on the public reader. If production
   differs, **stop** and inspect it; do not loosen hashes or assume local parity.
6. Apply350 with the exact atomic ledger wrapper. Verify the receipt, function
   metadata, private table RLS, authenticated-only writer and both enabled guards.
   New hands still use the old rule at this point.
7. Deploy and verify all six Edge consumers; deploy the pinned frontend to the
   verified `vinpoker` project. Verify actual hostname revision and a working TEST
   page. Record deployment ID, source revision and deployed Edge versions in the
   protected job's consumer receipt. A boolean assertion alone is not evidence.
   The workflow first reads Edge versions and Vercel project/alias access before
   any DB apply. It uses pinned CLI2.101.0, preserves JWT settings, and records
   existing central deployment receipts for registered components. Other consumer
   versions are retained in the exact run's metadata artifact.
8. Apply351 only after that consumer receipt is complete. It checks the exact350
   receipt, installs all settlement consumers, and activates the snapshot rule
   last within its transaction. Verify exact ledger, function hashes and unchanged
   metadata. A lost acknowledgement stops execution: classify the receipt first;
   never blindly retry or proceed to another phase.
9. On the designated TEST table only, run approved write acceptance: frozen ante,
   forced posts,16 deals/sounds at eight seats, queued actions, JJ then AQ reveal,
   correct recipient, empty center after payout, replay and public history.
   Check production with a fresh anonymous browser. Real iPhone Safari audio and
   owner UAT remain separate requirements from desktop emulation.

## Rollback

Keep all readers, writers, validators, guards and receipts required by hands that
already started under the new rule. Stop creation of new hands while diagnosing.
To stop applying the rule to later hands, use a reviewed **new forward migration**
to restore only `floor_private.snapshot_tracker_hand_blinds()` from its saved
definition and verified hash in `floor_private.tracker_bb_ante_originals351`.
This stop-new-cohort action belongs in the exact final owner approval scope.

Never reset a stored `tracker_big_blind_ante_only` value, rewrite historical ante,
delete receipts, downgrade active new-rule consumers, or restore the whole DB over
real play. Continue processing already-started new-rule hands with their frozen
rule. Verify both cohorts and chip conservation after rollback.

## Current evidence and limits

- Native PG17 application-schema clone:600-chip Finish,500-chip short-BB Finish,
  split/side-pot/refund cases, atomic duplicate/concurrency, leased history,
  correction and stop-new-cohort rollback tested separately.
- Production read-only preflight: ledger ends at349, new rule column absent;
  record-hand/correction/snapshot/payout-helper preimages match. Public reader
  is the plan-cache wrapper installed by20261104002200: preimage
  `eae66e8c287d78489e8facea7303f7b9`, expected postimage
  `f72e77c775b7b195dad149284f542533`. Four relevant function ACLs were reproduced
  in the disposable fixture; this does not prove all database ACLs match.
- Current production function versions: update80, resettle10, resettle-commit18,
  historical26, worker21, dispatcher17. First four verify JWT; last two use their
  existing internal handler authorization with gateway JWT verification off.
- Exact release wrapper: actual350/351 atomic receipts, preserved metadata,
  private-object checks; actual correction Edge preview/commit/stale retry and
  conserved stacks. Run from `VinPoker/`, with the guarded local fixture and
  `TRACKER_TEST_PSQL` / `TRACKER_TEST_SCHEMA` configured:

  ```powershell
  node --experimental-transform-types scripts/ops/tracker-bb-ante-release.native.mjs
  ```
- Native fixtures model Auth/HTTP and use an admin SQL transport. Their schema-only
  export is **not** production owner/effective-ACL parity or hosted Edge proof.
- Fresh restore-verified backup, final owner GO, production release, live write
  acceptance and real Safari audio remain outstanding. The protected release
  orchestrator and its tests must pass before that GO is requested.
