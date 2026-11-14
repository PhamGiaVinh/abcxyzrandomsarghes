"""Bounded prepared-command round-trip timing. Diagnostic only, never qualification."""
import ctypes
import ctypes.util
import json
import os
import re
import sys
import time

COMMANDS = (
    ("begin", "BEGIN"),
    ("request_role", "SET LOCAL request.jwt.claim.role='service_role'"),
    ("database_role", "SET LOCAL ROLE service_role"),
    ("source_hand", "SELECT public.fixture_complete_scale_hand_v1('10000000-0000-4000-8000-000000000001',2000000001)"),
    ("commit", "COMMIT"),
)


def validate_scope(env):
    project = re.fullmatch(r"hud-scale-([a-z0-9]+)-([a-z0-9]+)", env.get("PUBLIC_HUD_STACK_PROJECT", ""))
    if (not project or env.get("PGDATABASE") != "vinpoker_hud_test_pair_" + "_".join(project.groups())
            or env.get("PGHOST") != "127.0.0.1" or env.get("PGPORT") != "54322"
            or env.get("PGUSER") != "postgres" or env.get("PUBLIC_HUD_WRITER_WAIT_DIAGNOSTIC") != "1"):
        raise RuntimeError("writer_phase_disposable_scope_required")


def measure(execute, commands, count):
    if commands not in (COMMANDS, (("self_test", "SELECT pg_sleep(0.01)"),)) or count not in (3, 220):
        raise RuntimeError("writer_phase_fixed_workload_required")
    rows = []
    for transaction in range(1, count + 1):
        started = time.perf_counter_ns()
        phases = {}
        for name, _ in commands:
            before = time.perf_counter_ns()
            execute(name)
            phases[name] = (time.perf_counter_ns() - before) / 1e6
        elapsed = (time.perf_counter_ns() - started) / 1e6
        rows.append(dict(transaction=transaction, warmup=transaction <= 20,
                         endEpochSeconds=time.time(), elapsedMs=elapsed, phasesMs=phases,
                         unassignedClientMs=elapsed - sum(phases.values())))
    return dict(kind="PREPARED_COMMAND_ROUND_TRIP_DIAGNOSTIC", qualification=False,
                limits="Separate instrumented transactions; includes network/client scheduling, not server-only SQL time or pgbench qualification",
                rows=rows)


class Connection:
    def __init__(self):
        lib = ctypes.util.find_library("pq")
        if not lib:
            raise RuntimeError("writer_phase_libpq_unavailable")
        self.pq = ctypes.CDLL(lib)
        signatures = {
            "PQconnectdb": ([ctypes.c_char_p], ctypes.c_void_p),
            "PQstatus": ([ctypes.c_void_p], ctypes.c_int),
            "PQexec": ([ctypes.c_void_p, ctypes.c_char_p], ctypes.c_void_p),
            "PQprepare": ([ctypes.c_void_p, ctypes.c_char_p, ctypes.c_char_p, ctypes.c_int, ctypes.c_void_p], ctypes.c_void_p),
            "PQexecPrepared": ([ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_int], ctypes.c_void_p),
            "PQresultStatus": ([ctypes.c_void_p], ctypes.c_int),
            "PQgetvalue": ([ctypes.c_void_p, ctypes.c_int, ctypes.c_int], ctypes.c_char_p),
            "PQntuples": ([ctypes.c_void_p], ctypes.c_int),
            "PQclear": ([ctypes.c_void_p], None),
            "PQfinish": ([ctypes.c_void_p], None),
        }
        for name, (args, result) in signatures.items():
            function = getattr(self.pq, name)
            function.argtypes, function.restype = args, result
        # Fixed options; libpq uses already-validated host/database environment.
        database = os.environ['PGDATABASE']
        self.connection = self.pq.PQconnectdb(("host=127.0.0.1 port=54322 user=postgres dbname=" + database +
            " application_name=vinpoker_hud_phase_probe connect_timeout=5 options='-c statement_timeout=30000'").encode())
        if not self.connection or self.pq.PQstatus(self.connection) != 0:
            self.close()
            raise RuntimeError("writer_phase_connection_failed")

    def result(self, result, value=False):
        try:
            if not result or self.pq.PQresultStatus(result) not in (1, 2):
                raise RuntimeError("writer_phase_command_failed")
            if value:
                if self.pq.PQntuples(result) != 1:
                    raise RuntimeError("writer_phase_guard_failed")
                return self.pq.PQgetvalue(result, 0, 0).decode()
        finally:
            if result:
                self.pq.PQclear(result)

    def guard(self):
        actual = self.result(self.pq.PQexec(self.connection, b"SELECT current_database()"), True)
        if actual != os.environ['PGDATABASE']:
            raise RuntimeError("writer_phase_database_required")
        marker = self.result(self.pq.PQexec(self.connection, b"SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database()"), True)
        if marker != "vinpoker-hud-writer-control-disposable":
            raise RuntimeError("writer_phase_marker_required")
        settings = self.result(self.pq.PQexec(self.connection, b"SELECT current_setting('fsync')||'/'||current_setting('full_page_writes')||'/'||current_setting('synchronous_commit')"), True)
        if settings != "on/on/on":
            raise RuntimeError("writer_phase_durability_required")

    def prepare(self, commands):
        for name, query in commands:
            self.result(self.pq.PQprepare(self.connection, name.encode(), query.encode(), 0, None))

    def execute(self, name):
        self.result(self.pq.PQexecPrepared(self.connection, name.encode(), 0, None, None, None, 0))

    def close(self):
        if getattr(self, "connection", None):
            self.pq.PQfinish(self.connection)
            self.connection = None


if __name__ == "__main__":
    try:
        validate_scope(os.environ)
        if sys.argv[1:] not in ([], ["--self-test"]):
            raise RuntimeError("writer_phase_arguments_required")
        self_test = sys.argv[1:] == ["--self-test"]
        commands = (("self_test", "SELECT pg_sleep(0.01)"),) if self_test else COMMANDS
        connection = Connection()
        try:
            connection.guard()
            connection.prepare(commands)
            report = measure(connection.execute, commands, 3 if self_test else 220)
        finally:
            connection.close()
        print(json.dumps(report))
    except Exception:
        # Do not echo libpq messages, SQL, credentials or connection strings.
        sys.exit("writer_phase_diagnostic_failed")
