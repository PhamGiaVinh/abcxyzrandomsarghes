# Legacy failing dealer scheduler retirement

Target: orlesggcjamwuknxwcpk; exact migration 20270128000341.
Owner's continuing completion/release authorization applies; retain required CI,
independent critical review and fresh encrypted backup with actual isolated restore.
Do not apply source directly before those gates.

Observed 2026-11-12 14:00–15:00 UTC: twelve SQLSTATE 42704 cron failures,
missing app.settings.service_role_key. Job22 command MD5:
e55b52aa6ceb03f6f276bfd19e1f3769. It fails before sending HTTP.
Repairing credentials would activate legacy forced-break and Telegram paths.
The canonical process-swing does not force-release overdue dealers; its overlap
does not prove every legacy alert has an equivalent replacement.

340 was merged but NEVER APPLIED: its managed cron-history busy-query timed out
in read-only production preflight at10s. Live ledger340/341 absent. Archive340
unchanged (SHA2566f85ccfec0db32a76662d7db961a1adac0dd61cf660091e5cad781b3a29db4bf),
replace its apply allowlist entry with341, preserve provenance; no ledger repair.
341 observes only current pg_stat_activity backends, rejecting any same-actor/
database cron worker or pg_cron client in every state, including idle/NULL;
only launcher/currentpreflight excluded. Unrelated busy cron may safely block.
Upstream pg_cron1.6.8 registers worker backend_type as pg_cron, while its process
name is pg_cron worker. The actual backgroundworker test distinguishes these;
the guard matches backend_type=pg_cron, not the process name.
Production read-only EXPLAIN of the predicate took0.527ms, not a capacity proof.
No managed-table index or role changes; lock1s/statement10s unchanged.

Only set job22 active=false via cron.alter_job. Preserve its row, command, schedule,
history, all other jobs and all source dealer/money/payroll data. No Edge deployment.
Preflight must confirm the exact job metadata, missing credential and no running
invocation, plus migration version/name collision check. Apply once, no blind retry.
The busy check is observational: a scheduler can start after the check. The known
command still lacks its required setting and fails before HTTP; do not claim a
general atomic scheduler drain. Stop if credential state changes.

Postcheck: ledger341 and no340 receipt, exact command hash and inactive22, unchanged other cron rows,
no new22 executions across three original five-minute boundaries; job30/51 remain
successful. Read-only website smoke; no dealer, chip or notification writes.

Rollback: do not restore the whole database. If retirement itself causes a confirmed
regression, review the preserved preimage and exact metadata/hash/inactive state,
ensure no running22, then use cron.alter_job(22,active:=true) in a bounded transaction.
This deliberately restores the known failing schedule; it does not repair
authentication. Keep the341 receipt/audit and add a new versioned migration for any
durable rollback. Never change credentials or invoke the legacy Edge as rollback.

Fixture: real isolated PG17/pg_cron, launcher disabled while exact command is active,
no pg_net extension installed. Tests never invoke the production endpoint.
Only enable isolated launching after22 is inactive; cross a real five-minute
boundary while a separate SELECT-only sentinel runs. Busy guards use real active/
idle pg_cron-named clients and a real pg_cron backgroundworker; stale history is
deliberately ignored and postgres has no SELECT on history. The backgroundworker
test activates22 only inside an uncommitted transaction that rolls back; scheduler
always sees committed22inactive while its launcher is enabled. No atomicdrain proof.
