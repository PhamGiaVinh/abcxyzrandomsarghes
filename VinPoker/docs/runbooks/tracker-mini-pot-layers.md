# Tracker mini-table pot layers — prepared, not released

The full table already has main and aggregated side chip groups. The public
mini table previously received only total committed chips. This follow-up adds
server-projected matched layers and renders the first layer beside the sum of
the remaining layers, with three gold/red/purple stacks per group. The visible
labels contain amounts only. A missing side group occupies no space.

## Contract and compatibility

- Migration352 adds only the stored hand's `bigBlindAnteOnly` value to the
  existing service-only projection source. Exact preimage MD5 is
  `6269d9fc1b2737f30b56a4bcdb42fb79`, postimage
  `8fa555adb0cb5f8c34a65d9ca5750893`. Existing authority, lease/deferred fences,
  public card masks, source vector and function metadata remain unchanged.
- The existing projector uses the canonical display pot engine on the server.
  Ante is dead main-pot money only when the hand's stored rule says so. Missing
  rule metadata with ante actions retains the aggregate instead of guessing.
  Unmatched wagers are excluded from matched layers; this is not a refund write.
- Completed hands retain their saved ending stacks and pot. An unavailable layer
  computation must not erase those saved values. No chips or outcomes are written.
- Old frontend ignores the additive fields. New frontend accepts aggregate-only
  publications. No per-table extra fetch is introduced. New normal source events
  publish new layers; deployment does not dirty every tournament or rewrite data.

## Verification

- Unit/render tests: publicSpectatorReducer and SpectatorMiniTable cover multiple
  sides, main-only,600-chip BB ante, missing rule and saved completed stacks.
- `miniPotLayers.native.mjs` runs actual352 on the owned empty PG17 test cluster,
  creates the existing600/500-chip Finish fixtures in one rolled-back transaction,
  calls the real source function and server reducer, checks lease/deferred fences,
  and exercises the separately guarded forward rollback. Its old schema fixture
  models only the compact queue lookup; it is not a full hosted publisher test.
  Supply `TRACKER_TEST_PSQL` and `TRACKER_TEST_PROJECTION_PREIMAGE` (the exact
  read-only function definition captured above), then run:

  ```powershell
  node --experimental-transform-types tests/publicHud/miniPotLayers.native.mjs
  ```

- Existing viewer preview `?view=tables&pots=split` displays50BB plus15BB. Browser
  tests check320/375/390/414/1440px, six stacks, three colors and no overflow.

## Production gate and rollback

This package is **not part of the approved350/351 activation-only run**. Finish
and verify that run first. Before release, require current preimages, checks,
fresh restore-verified backup and owner approval for the exact352/projector/
frontend revisions. Do not deploy a seventh Edge under the six-consumer approval.
Apply352, deploy and verify the new `public-spectator-projector-v2` version and
frontend through protected workflows, then check a designated public TEST table
with actual side pots and compare saved chip totals. The projector's existing
internal authorization and gateway JWT configuration must be preserved.

Rollback uses a reviewed forward migration based on
`tests/publicHud/miniPotLayers.rollback.sql`, pinned to the postimage above. It
removes only the added field, restores the original hash and preserves metadata.
Retain aggregate-only frontend compatibility. No whole-DB restore, hand rewrite,
receipt deletion or351 rule rollback is needed for this read-only presentation.
