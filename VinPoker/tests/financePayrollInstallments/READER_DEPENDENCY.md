# Installment foundation after independent payslip readers

Build-only integration; not a production release or rollout authorization.

The original PR1800/8ba26209 created its own detail/history RPCs. That order would
collide after the independent read release355. The integration branch instead
installs exact355 from4f4097b0 first in the isolated database, then requires both
readers' exact bodies, signatures, defaults, ownership, security and auth-only
ACL before taking the payment-table DDL lock. It never replaces the readers.

Seven existing installment writer/trigger/helper bodies remain byte-equivalent
after newline normalization. Only the duplicate detail CREATE is removed from
the foundation. The superseded recipient CREATE/preflight files are removed
from this integration branch; frozen8ba26209 retains their historical source.
New clean/fault clones prove that missing, changed, privileged, default-drifted
or overloaded readers refuse the foundation before any plan/column/index change.

The functional integration workflow still exercises actual legacy full pay,
5M frozen earnings with2M+3M installments, retained-intent resolution, concurrent
writers, authorization, lifecycle and operator/recipient browser reads. New
reader dependencies require new integration evidence. Original111-test and
performance results remain attached to their original SHAs and are not rewritten.

The old report/detail load workflow receives the same prerequisite install so
it remains runnable, but stays deliberate-label-only. No old PASS load or cold
diagnostic is dispatched again for this integration. This change does not claim
new workload capacity or UI latency. The independently running standalone read
load has a different source/role/workload and keeps its own evidence.

No payment source-account policy, delegated spending limit, frozen recognition,
monthly FT/staff lifecycle, legacy shared-voucher cutover or hosted acceptance
is delivered by this dependency repair. Rollout remains OFF; those mandatory
TC2–TC6 requirements remain open. Reader release approval does not authorize
installment writers. Any later apply needs its own exact review, native proof,
fresh encrypted backup/isolated restore and owner gate.
