# Proposed finance CI routing v2 — inactive until reviewed base merge

This proposal replaces the previously pinned finance source with the exact combined source containing the expense authorization fix. It does not change production, apply SQL, enable a feature, authorize a release or relabel any failed run.

## Problem and exact scope

Historical required run45743719017 selected pre03 and stopped because its pre-Cashier03 artifact was no longer downloadable. A current schema capture cannot establish that historical upgrade. This remains unproved.

Only source c48cdc9bdec22cade6bd9eb0de2424dbde08e8d0, based on main25b0b3d23f62bdad191172d3145fb3d45d0965ea, is proposed for existing current-schema Cashier compatibility tests. The old e231 source lacking the authority fix is no longer the admitted package.

There are44 changed paths:5 added SQL files,1 catalog update and38 runtime/test/workflow inputs. Every path and canonical Git hash is fixed, including catalog preimage/postimage. The complete7645-entry application/CI inventory includes file modes/blob identities and dependencies inherited from BASE. The same8 policy/harness files are excluded; no new exclusion is introduced. The product PR must preserve all trusted guard files byte-for-byte.

Missing/edited/renamed/nonregular SQL, missing authority inputs, extra paths, altered runtime or inherited dependencies, forged receipts, and incomplete/duplicate/capped API pages remain fail closed. Unknown packages retain pre03. Existing current-suite assertions, timing thresholds and required checks are unchanged.

## Actual evidence bound to this source

- Client run45792554430, workflow431098994:20 fresh browser recovery cases across320/375/414/768/1280, no borrowed case. Actual client/SDK/PostgREST/PG17, one expense/receipt/movement and drawer9000000 after1000000 expense. The actual raw verification hash is recorded in the receipt.
- Authority run45792554475, workflow431296054: own-club access, foreign RPC/table denial, grant/revoke, original rows/metadata preserved,4 drift faults and repeat apply refused atomically. Two real HTTP connections are observed blocked in PG before release; one expense1000000, same expense ID, conflicting intent rejected. Uncommitted grant does not authorize; committed revoke denies read/replay/new write while other-club access remains.
- Forward source recovery restores the corrected writer while preserving metadata/policies/expenses/IDs and denial of foreign writes. It is not hosted backup/restore or approval to restore the old vulnerable shortcut.
- Both GitHub producers are successful pull_request runs by PhamGiaVinh, attempt1, at the exact source SHA. Their metadata and downloaded raw artifact hashes were independently regraded before generating this receipt.

These are bounded source/client proofs. They do not prove pre03 upgrade, hosted auth, parent workbench, full TC3, capacity, live catalog/collision/preflight, hosted recovery or production readiness. The old needs_review run45750282073 stays FAILED and its intermittent cause remains unresolved. Later policy run45782027700 passed on its own merge checkout; that is not proof that the old failure was fixed or that this newer proposal passed required CI.

## Trust and activation

The workflow executes the selector and reads policy/receipt from trusted BASE, never HEAD. It verifies complete API metadata against Git trees. The receipt checksum, two producer identities, source SHA, exact44-path scope,6 migration/catalog entries,38 runtime pins and full inventory must agree. Twenty fresh cases and the explicit authority/concurrency/recovery observations are required. The workflow only fetches the immutable source object needed by tests; it does not execute that source's selector.

Before activation: run the affected policy/historical regressions, independent read-only review, required CI on the final proposal and exact owner approval. Merge through the protected path only. Then rebase the matching product source while preserving trusted policy/harness bytes and follow its required compatibility run. Any source, promotion/catalog or dependency change requires new matching evidence; this exception is not a blanket finance allowance.

Active migration promotion, live definition/ACL/RLS/index preflight, exclusion of concurrent DDL, fresh restorable backup, exact recovery/release approval and authenticated web acceptance remain separate requirements. The Supabase connector denied a metadata-only read in this continuation; live preflight is unverified. No alternate credential or tool was used to evade that denial.

## Verification and rollback

The positive new-source regression first returned pre03 under the old v1 guard. Retain RED and final GREEN evidence. Negative cases must reject omitted/edited SQL, historical SQL, catalog drift, modified trusted files/native inputs, extra/inherited dependencies, rename/mode tricks, malformed pages and forged or missing BASE receipts.

Before activation, abandon/revert this proposal. After activation, a normal reviewed revert removes only this admission and returns it to pre03; it does not touch SQL, data, flags, receipts or historical CI. No branch protection, required test or safety hook is removed.

Unit fixtures retain write-tree --missing-ok only for opaque inherited Git metadata in a partial local clone. The real validator reads and hashes every required policy/SQL/runtime blob and refuses missing content. This option is never used by the production selector or schema harness.

The full Goal0–6 scope and other independently releasable packages retain their own acceptance criteria. This proposal is not completion of that program.
