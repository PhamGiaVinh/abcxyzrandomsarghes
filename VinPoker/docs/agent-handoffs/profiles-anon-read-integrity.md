# P0 anonymous profile column containment

Source candidate only. Target: `orlesggcjamwuknxwcpk`; no live apply yet.

## Evidence and contract

- Read-only live catalog: profiles RLS enabled, SELECT policy PUBLIC/true;
  anon has table SELECT, so historical private-column omissions are ineffective.
- Synthetic PostgreSQL 17 reproduces private-column reads, tests actual migration
  twice, anonymous private/wildcard denial, both public page projections, safe
  security_invoker view, authenticated access unchanged, and future columns denied.
- Marketplace already displays `verification_status` publicly. Preserve that badge
  column, not `verified_by_club_id`, `verified_at` or notification identifiers.
- PlayerProfile no longer requests phone before login. Existing authenticated
  phone access is unchanged; this package does not redefine logged-in privacy policy.
- No user values, money formulas, rows, ledger, RLS policies or writes changed.

## Exact scope and rollout

New migration `20270128000084_profiles_anon_public_projection_v1.sql`, generated
with CLI then reserved after source worktree collision and live ledger checks.
Normalized LF SHA256:
`4db92b6d27a80bc13ad1bc2c37404b3ba61f0387fe170f47c53e8ccb3c491059`.
Historical migrations 13–28 remain untouched. Catalog adds only this hash-pinned
entry to the existing owner-gated allowlist; no guard implementation changes.

Before release: independent review, exact main/SHA, fresh verified recovery point,
catalog and live role/column/grant preconditions, protected release path. Do not
bypass the unresolved GitHub private-environment approval gate. Need authenticated
and anonymous real-browser checks on the canonical alias after DB/frontend rollout.
Ship the backward-compatible PlayerProfile reader before restricting the DB ACL:
it works against both old and new grants and does not activate server authority.
Then apply the reviewed DB containment. This expand/contract preparation avoids an
old-frontend anonymous profile outage. Marketplace and public identity/leaderboard/
feed/signup projections remain allowed. Do not call containment live before DB apply.

## Recovery and postchecks

Do not automatically restore anonymous table SELECT: that reopens the confirmed
exposure. Prefer a reviewed forward compatibility fix while keeping private columns
denied. If broader restore is truly required, use the verified pre-apply recovery
point under the existing runbook, assessing intervening writes first.

Postcheck effective anon privileges for every actual profiles column: exactly the
13 migration-listed public columns; phone/bank/internal fields and wildcard denied.
Confirm authenticated grants, profile row counts, RLS policies and write ACLs are
unchanged. Confirm the new ledger receipt and actual object state independently.
Test `/marketplace`, `/player/<TEST-user-id>` anonymously and authenticated, then
logout/reload. No new feature flag or Edge deployment is needed for this package.
