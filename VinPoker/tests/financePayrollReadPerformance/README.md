# Isolated read qualification

This workload qualifies only payslip and monthly-report RPC reads: 100000
synthetic operating documents across12months,20 distinct accountant identities,
pool10,7200 requests scheduled over30minutes. Reportp95<=5000ms and statement
p95<=2000ms; any error, missing/incomplete sample, changed financial fact or
incorrect amount fails. It does not qualify UI latency, mixed writes, hosted Auth,
production capacity or TC6.

The long workflow runs only on the deliberate PR label
`qualify-pt-read-performance`, for a head in the same repository. Ordinary pushes
do not start another run. Do not toggle that label to repeat a passed run. Reuse
valid evidence after checking its exact schema, SQL, fixture and workload
dependencies; request a new qualification only if an affected dependency changes.

The first intended run is45678868387 ondf21aff0. Later automatically triggered
duplicates were cancelled after diagnosing GitHub's whole-PR path comparison.
Preserve all those run records; cancellation is not a PASS. Do not dispatch or
label another run merely because observation of the first is delayed.

Download only `pt-read-performance-sanitized`. It contains synthetic sample
timings/aggregate facts, never JWTs, private payloads or recovery backups.
