# Optional expense attribution — default OFF

Depends on exact guarded expense writer354 from PR1798. This branch does not
change that SQL, source authorizer, approval policy, cash funding, payment state
or accounting basis. New input remains disabled by default until guarded DB and
frontend are released and owner UAT is accepted.

The form can keep a cost at club level or explicitly select one tournament or
series in the same club. Target discovery is limited/searchable and rejects
wrong-club/duplicate/malformed packets. Parent readiness blocks submission during
loading, failed reads or before a verified choice: disabled HTML controls alone
are not validation. Unknown-outcome journals retain target and HTTPS evidence
URL; remount locks the draft and retry sends the identical server intent.
Historical unsafe evidence URLs are displayed for review, never opened. Existing
source/detail routes are used for source links. This stores a link, not proof
that a document is genuine or payment has happened.

Native qualifier uses captured original schema plus ONLY354 on an empty
loopback database. Actual form and hooks talk through Supabase/PostgREST. At five
widths, a real attributed INSERT commits then loses its ACK; reload restores the
same evidence/target, retry returns the same document; series and common costs
flow into the actual expense report. Explicit foreign references must be denied
without writes. Synthetic URLs are never fetched. No hosted login, production
writes, capacity, approval, funding or full TC3 completion claim is made.

The older skipped native test requires an old workstation runtime and remains
historical; this new browser/API qualifier is a separate current runtime, not an
attempt to mark that test as passed. Preserve all previous PASS/FAIL artifacts.
