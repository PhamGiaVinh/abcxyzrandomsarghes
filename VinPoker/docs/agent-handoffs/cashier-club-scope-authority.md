# P0 Cashier scope subject boundary

Candidate only; no live apply, frontend/Edge deployment or flag change.
Target: `orlesggcjamwuknxwcpk`.

Live read-only catalog confirmed `cashier_club_ids(uuid)` is SECURITY DEFINER,
PUBLIC/anon executable and derives scope from arbitrary input rather than the
request actor. Definition MD5: `1312fa57f2103eb3d72cd5e2d0fa4518`.
This proves a scope metadata boundary defect, not a money-write escalation.

## Repair

Forward85 preserves the exact subject club UNION, function signature, STABLE
semantics and existing self/owner/admin behavior. Browser users must query self;
actual super-admin may query another subject. Trusted service-role Edge callers
retain lookup after authenticating the human actor. Reject null subject and absent
or unknown authority. Search path empty; dependencies schema-qualified. PUBLIC/anon
EXECUTE removed; authenticated/service_role retained. No auth from user_metadata.

New file created by CLI then reserved after source worktree/live ledger collision
checks. Normalized LF SHA256:
`bdf62cc23d4335fe11e93de5bb20f4fc967057425d90b44fdc63552cea413a2b`.
Strict old-definition precondition; do not replay once applied or change a receipt.

## Evidence and release conditions

Actual PostgreSQL17 disposable fixture imports exact old source, reproduces anon
and authenticated cross-subject scope, applies actual85, then checks anonymous
denial, self cashier/owner, genuine empty scope, super-admin, missing actor, unknown
admin authority, trusted service, null subject and nested SECURITY DEFINER caller.
Fixture auth helpers are local identity adapters, not real signed-token/HTTP proof.
All fixture rows/roles roll back. No real user scopes queried in live diagnostics.

Live dependent call sites (metadata): get_dealer_availability_requests,
get_dealer_swing_health, review_availability_request use v_uid; sepay worklist uses
v_actor. Source clients pass actual current user. Preserve existing Edge verified
actor paths in cashier-lookup-player and staking-mark-busted; do not revoke service.

Before production: independent review, current exact CI/catalog, fresh verified
recovery point, exact function/grant preflight, protected apply gate. No bypass of
private-repo environment or artifact-storage failures. Postcheck ledger AND new
definition/grants, own-club browser paths, service Edge and nested RPC behavior.
No frontend feature flag needed. Do not auto-restore the vulnerable old PUBLIC
function; prefer reviewed forward compatibility repair. Any whole DB recovery
requires assessment of writes after the recovery point under the existing runbook.
