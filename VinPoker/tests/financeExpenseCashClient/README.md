# Expense Cashier client qualification

This addon keeps backend `aca9e00c2fe9a3b0cc1a028bd70c40c4ba48a1e8` and its three SQL inputs byte-pinned. It adds browser evidence for the actual expense entry, expense summary hook and Cashier cashflow component. It does not repeat the backend lock-race qualification.

The workflow restores the approved schema-only capture into an empty PostgreSQL 17 database, verifies backend producer `45736731928`, then installs the unchanged SQL. Only synthetic club/cashier/accountant records are created. PostgREST 13 receives ordinary authenticated JWTs generated in memory. Only auth/bootstrap modules are aliased; business RPCs, the Supabase SDK, client recovery code, expense hook, CSS and report component are real. Browser traffic is limited to the owned loopback Vite server. No hosted sessions, service keys or production writes are used.

At each width 320/375/414/768/1280:

- A real committed payment loses its acknowledgement; one atomic embedded read resolves the same cost/receipt/movement without another POST.
- A committed payment also loses its lookup response. Reload retains the exact journal. Explicit resend uses the identical complete payload and produces no additional fact.
- The explicitly selected till closes before submission. The server refuses; an authorized single-snapshot read proves closed till plus absent matching receipt and legacy cost. Only then can the local request be released, and the operator must select the next open till for a new request.
- Cashier membership is removed after commit but before acknowledgement. The RLS-hidden lookup must remain unresolved through reload, retaining the journal. Membership restoration permits GET-only recovery.
- The actual expense summary shows one cost of 1M; the actual cashflow report shows 1M sourced from the till; recorded till cash is 9M from 10M. No second cost is created by reporting cash out.
- Reload after resolution sends no payment. Screenshots, overflow checks and page errors are recorded.

An accountant-only actor must not see a usable till-spending form. Client presentation is enabled only in the owned fixture; the product flag remains OFF.

Limits: synthetic auth bootstrap is not hosted GoTrue authentication. This fixture is not the whole finance parent workbench, all funding methods, approval/delegation policy, historical-data conversion, hosted TEST acceptance, or capacity qualification. Required main CI, controlled adoption/rollback, production approval and canonical web verification remain separate gates.
