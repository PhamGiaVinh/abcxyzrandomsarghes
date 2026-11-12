# Legacy failing dealer scheduler retirement

Target: orlesggcjamwuknxwcpk; exact migration 20270128000340.
Owner's continuing completion/release authorization applies; retain required CI,
independent critical review and fresh encrypted backup with actual isolated restore.
Do not apply source directly before those gates.

Observed 2026-11-12 14:00–15:00 UTC: twelve SQLSTATE 42704 cron failures,
missing app.settings.service_role_key. Job22 command MD5:
e55b52aa6ceb03f6f276bfd19e1f3769. It fails before sending HTTP.
Repairing credentials would activate legacy forced-break and Telegram paths.
The canonical process-swing does not force-release overdue dealers; its overlap
does not prove every legacy alert has an equivalent replacement.

Only set job22 active=false via cron.alter_job. Preserve its row, command, schedule,
history, all other jobs and all source dealer/money/payroll data. No Edge deployment.
Preflight must confirm the exact job metadata, missing credential and no running
invocation, plus migration version/name collision check. Apply once, no blind retry.
The busy check is observational: a scheduler can start after the check. The known
command still lacks its required setting and fails before HTTP; do not claim a
general atomic scheduler drain. Stop if credential state changes.

Postcheck: ledger340, exact command hash and inactive22, unchanged other cron rows,
no new22 executions across three original five-minute boundaries; job30/51 remain
successful. Read-only website smoke; no dealer, chip or notification writes.

Rollback: do not restore the whole database. If retirement itself causes a confirmed
regression, review the preserved preimage and exact metadata/hash/inactive state,
ensure no running22, then use cron.alter_job(22,active:=true) in a bounded transaction.
This deliberately restores the known failing schedule; it does not repair
authentication. Keep the340 receipt/audit and add a new versioned migration for any
durable rollback. Never change credentials or invoke the legacy Edge as rollback.

Fixture: real isolated PG17/pg_cron, launcher disabled while exact command is active,
no pg_net extension installed. Tests never invoke the production endpoint.
Only enable isolated launching after22 is inactive; cross a real five-minute
boundary while a separate SELECT-only sentinel runs. Busy guard tests use explicit
synthetic run metadata; this is not proof of atomic drain during a real launch.
