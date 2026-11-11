# Backup response snapshot recheck — candidate migration 339

The scheduled caller can miss a response committed while its observation query
is running, then mark the same request timed out using a later statement. The
new timeout predicate checks absence again in that later statement snapshot.
An already visible response leaves the row pending for the next observation.
A response arriving after the final snapshot can still arrive after timeout.
Existing terminal audit rows are not rewritten.

The full fallback lookup retains all timestamp values, including NULL and
infinities. An exhaustive timestamp predicate permits the existing managed
created index to avoid scanning empty heap pages. It does not force an index,
bound history size, or guarantee faster execution for every heap/index shape.
No managed objects, roles, scheduler, timeout age, Vault, endpoint, enqueue,
dealer business state, money, chips, or payroll are changed.

The existing isolated PG17 workflow tests the actual caller with synthetic
Vault and transport, a non-superuser migration actor with no CREATE on net,
normal/error/history cases and caller denial. `snapshotRace.py` holds a real
advisory barrier during the fallback UPDATE: migration337 records timeout;
339 leaves pending, and its next invocation records success. Both JSON reports
are uploaded. This is not actual HTTP/Telegram delivery evidence.

Release remains owner gated for the exact final SHA and migration339, after
required CI and independent review. Require a fresh encrypted backup and actual
isolated restore; versioned CLI must plan only339 and preserve lock1s/statement10s.
Do not repeat the job30 active=false protocol: real pg_cron canceled the old run
during1626 despite the no-cancel requirement. No scheduler pause is authorized
by this candidate. A lock-budget failure must stop and report without retry.
Postcheck source/owner/ACL/search_path, receipt and unchanged scheduler; observe
scheduled invocations and transport separately. No manual enqueue smoke test.

Rollback preserves source/audit and uses a separately reviewed forward migration
if needed. Do not overwrite old migration files or rewrite receipts. Disabling
an exact affected scheduler job requires explicit scope and must account for
its real cancellation behavior; it is not a read-only rollback.
