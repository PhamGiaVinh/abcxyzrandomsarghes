# Cashier lookup protected release preparation

G2 source candidate, based on qualified PR1560 d364815b35e16c265cf4905c92761f4818c32dfb.
Owned branch codex/cashier-lookup-release-contract. Production unchanged.

The protected runner previously had no selectable cashier-lookup-player target.
This change registers it as critical, manual-only, JWT verified, with an exact
receipt environment, required Deno tests and live relation/helper contracts.
The workflow boolean defaults false. Existing protected environment, main SHA
reachability, quality, contract probes, import/secret scanning and receipts remain.
Missing receipt holds frontend release; it is not treated as a deployed baseline.

Fresh live read confirms cashier_club_ids(uuid), argument _user_id, currently has
PUBLIC/anon/authenticated/service execution and definition MD5
1312fa57f2103eb3d72cd5e2d0fa4518. The new contract requires effective anon denial,
so it intentionally fails until reviewed migration85 (PR1562) is applied. Keep
authenticated/service access and exact signature, no extra overloads. Do not
relax this probe to deploy against the old authority helper.

Local checks:
-51 runner/planning/source-quality/live-probe unit and integration checks PASS.
-Deno frozen check and actual SDK contract test7 steps PASS.
-Actual target import graph, test existence and JWT posture inventory PASS.
-Workflow YAML parses; new input default false confirmed.
-Existing control-plane validator and git diff whitespace PASS.

Independent read-only review found no actionable issue in the four-file delta.
Reviewer verified manual selection, protected environment/receipt path, no missing
receipt bootstrap bypass, and exact helper signature/ACL. It did not rerun tests.

Release prerequisites remain: required CI; exact candidate SHA; migration85 and
other G2 compatibility dependencies; reviewed protected release with rollback
artifact and actual authenticated canary. No DB migration, Edge deployment,
environment configuration, grant or feature flag was changed by this preparation.
Do not call source qualification production completion.
