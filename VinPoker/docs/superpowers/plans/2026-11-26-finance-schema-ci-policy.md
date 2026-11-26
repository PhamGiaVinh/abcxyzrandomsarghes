# Proposed finance CI routing — inactive until reviewed base merge

This is a separate policy proposal. It does not apply a database migration, activate a feature, authorize a production release, or mark any failed run successful.

## Problem and bounded alternative

Required run `45743719017` selected `pre03` for the new finance package. It stopped because the old pre-Cashier-03 artifact is no longer downloadable. The original historical upgrade remains unproved. A recent schema capture cannot establish that historical upgrade.

For exactly the reviewed new package, the proposal selects the existing **current-schema Cashier compatibility suite**, while retaining the separately verified native finance proof. It removes or relaxes none of that suite's operational assertions or pass thresholds. This is a different declared scope of proof, requiring owner approval of the policy before activation.

The package has exactly 41 changed paths: four added SQL files, one catalog update and 36 source/test/workflow inputs. The manifest records every hash, including catalog preimage and postimage. An extra dependency, auth helper, runtime script, document or other path invalidates this exception. Altered SQL, partial sets, renames, executable/symlink files, malformed API pages and historical migration changes retain the existing fail-closed routing.

The complete product inventory is pinned as well: 7,641 committed entries under `VinPoker/` and `.github/`, including file modes and blob identities. This catches dependencies changed in BASE and inherited unchanged by the product PR. Only the eight explicitly listed policy/harness files are excluded; the product PR must still preserve them from its trusted base. A later product baseline needs fresh evidence rather than silently reusing this receipt.

Required policy run `45747897108` failed on a stale HUD interaction selector: it clicked the nameplate, which now toggles Chip/BB, instead of the separate avatar button which opens HUD. Existing React interaction tests distinguish those controls. The E2E now resolves the avatar's accessible name from the actual player's rendered nameplate. It retains actual anonymous API/history/replay/withdrawal requests and every timing/data assertion. This corrected harness file is the eighth explicit exclusion and is independently fenced against product-PR changes. The failed run and its diagnostics remain preserved; the next required run must prove the corrected path.

## Trust boundary

- The workflow continues to execute the selector from its pinned base commit, never a PR-supplied selector.
- The finance policy and fixed-checksum receipt are read from that same base.
- The product head must preserve policy, receipt, selector, guard tests, corrected E2E harness and the existing required workflow byte-for-byte.
- API file pages must agree with the complete committed Git-tree diff. Only regular tracked blobs qualify.
- The proposed policy must first pass independent review and required checks, then receive exact owner approval and merge through the protected release path. An unprotected branch or a PR's own added policy is not activation evidence.
- The only workflow change fetches an immutable Git object needed by the tests if absent. It does not execute that candidate's scripts or override schema mode.

## Existing evidence and its limits

Native run `45743719060`, source `e231ba934bbbc7e0608499dc05bb306f1f51f544`, completed successfully. It installed the four exact SQL inputs into an empty PostgreSQL17 database restored from the approved current schema-only capture, then exercised actual client/hooks/SDK/PostgREST recovery. Coverage is 19 fresh browser cases and one completed case explicitly reused from a failed producer after source/SQL equality and artifact checks. The failed producer remains FAILED.

This evidence establishes the bounded finance source/client behavior. It does not establish historical03/11 upgrade, hosted authentication, the whole parent workbench, all operational modules on the new finance installation, approval/delegation policy, production capacity or production readiness. Those remaining applicable release and TC0–TC6 gates are unchanged. Current compatibility plus native finance qualification must not be reported as a full integrated release rehearsal.

## Required verification before activating this proposal

1. Reproduce old selection of `pre03` for the exact package; retain that failure.
2. Prove the proposed complete41-path package selects `current` only with trusted base policy and receipt.
3. Reject individual SQL changes/omissions, unknown or historical SQL, catalog drift, modified trusted files, modified native inputs, extra dependency/auth/runtime changes, renamed paths, unusual file modes, missing or forged base receipts and incomplete/duplicate/capped API pages.
   Reject dependency/auth/runtime changes inherited identically by both base and head as well.
4. Preserve existing qualified-package admission and historical/secret/money/refund guards with affected regression checks.
5. Review the final PR independently. Required checks remain mandatory; there is no admin merge, skipped suite or manufactured pre03 PASS.
6. Request the exact policy approval only after the diff and evidence are concrete. After approval, verify protected-base merge, rebase the matching product package, and follow its new required run to terminal. No blind rerun of the previous failed run.

## Rollback

Before activation, abandon/revert this proposal. After activation, a normal reviewed revert removes only the new finance admission branch/policy and restores `pre03` routing for that package. Existing receipts, SQL, production data, feature flags and historical CI results are untouched. No safety hook or branch protection is removed.

Git-tree unit fixtures use `write-tree --missing-ok` only to assemble metadata in a partial local clone. They do not execute that opaque inherited application tree. Every SQL/runtime/proof blob needed by the actual selector must still be readable and match its checksum. CI explicitly obtains the immutable source commit before loading the tests. This fixture option is never used by the production selector or schema harness.

Other independently shippable packages retain their own gates. This proposal does not require a UI-only package to wait for the finance source package, or claim that the full financial plan is complete.
