"""Read-only, opt-in diagnostics; never a latency qualification certificate."""
import json
import os
import pathlib
import re
import subprocess
import threading
import time


def kernel_snapshot():
    # These are the generator's host/cgroup, not the database container.
    files = {
        "cpuPressure": "/proc/pressure/cpu",
        "ioPressure": "/proc/pressure/io",
        "memoryPressure": "/proc/pressure/memory",
        "cpuStat": "/sys/fs/cgroup/cpu.stat",
        "cgroupCpuPressure": "/sys/fs/cgroup/cpu.pressure",
        "cgroupIoPressure": "/sys/fs/cgroup/io.pressure",
        "ioStat": "/sys/fs/cgroup/io.stat",
    }
    values = {}
    for name, filename in files.items():
        try:
            value = pathlib.Path(filename).read_text()
            values[name] = value[:16384]
        except OSError:
            values[name] = None
    return {"epochSeconds": time.time(), "scope": "generator-host-not-database-container", "values": values}


def start_writer_observer(root):
    database = os.environ.get("PGDATABASE", "")
    if (os.environ.get("PGHOST") != "127.0.0.1" or os.environ.get("PGPORT") != "54322"
            or not re.fullmatch(r"vinpoker_hud_test_pair_[a-z0-9_]+", database)):
        raise RuntimeError("writer_wait_disposable_scope_required")
    env = writer_observer_env("vinpoker_hud_writer_observer")
    env.update(PGCONNECT_TIMEOUT="3", PGOPTIONS="-c statement_timeout=1000")
    guard = "SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();"
    marker = subprocess.run(["psql", "-w", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", guard],
                            capture_output=True, text=True, check=True, env=env, timeout=5).stdout.strip()
    if marker != "vinpoker-hud-writer-control-disposable":
        raise RuntimeError("writer_wait_disposable_marker_required")
    output = (root / "writer-waits.jsonl").open("w")
    sampler = subprocess.Popen(["psql", "-w", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"],
                               stdin=subprocess.PIPE, stdout=output, stderr=subprocess.DEVNULL,
                               text=True, env=env)
    # No query text, actor identifiers or credentials enter the evidence.
    query = """SELECT jsonb_build_object('epochSeconds',extract(epoch FROM clock_timestamp()),
      'backends',coalesce(jsonb_agg(jsonb_build_object('pid',pid,'state',state,
      'waitType',wait_event_type,'waitEvent',wait_event)),'[]')) FROM pg_stat_activity
      WHERE datname=current_database() AND application_name='vinpoker_hud_writer_probe';
      \\watch 0.05
    """
    sampler.stdin.write(query)
    sampler.stdin.close()
    # Bound observer lifetime only. This does not cancel or time-limit pgbench.
    timer = threading.Timer(30, sampler.terminate)
    timer.daemon = True
    timer.start()
    deadline = time.monotonic() + 2
    ready = False
    while time.monotonic() < deadline and sampler.poll() is None:
        try:
            ready = any(line.startswith("{") and isinstance(json.loads(line).get("backends"), list)
                        for line in (root / "writer-waits.jsonl").read_text().splitlines())
        except (OSError, ValueError):
            ready = False
        if ready:
            break
        time.sleep(.01)
    return {"process": sampler, "output": output, "timer": timer, "ready": ready,
            "before": kernel_snapshot()}


def writer_observer_env(application_name):
    # libpq service/hostaddr overrides must not redirect the checked target.
    env = {key: value for key, value in os.environ.items()
           if key not in ("PGHOSTADDR", "PGSERVICE", "PGSERVICEFILE", "PGSYSCONFDIR")}
    env["PGAPPNAME"] = application_name
    return env


def finish_writer_observer(observer, root):
    after = kernel_snapshot()
    sampler = observer["process"]
    exited_before_stop = sampler.poll() is not None
    observer["timer"].cancel()
    if sampler.poll() is None:
        sampler.terminate()
    forced_stop = False
    try:
        sampler.wait(timeout=1)
    except subprocess.TimeoutExpired:
        forced_stop = True
        sampler.kill()
        sampler.wait()
    observer["output"].close()
    path = root / "writer-waits.jsonl"
    rows = []
    parse_failures = 0
    oversized = path.stat().st_size > 1048576
    if not oversized:
        for line in path.read_text().splitlines():
            if line.startswith("{"):
                try:
                    rows.append(json.loads(line))
                except ValueError:
                    parse_failures += 1
    backend_samples = sum(bool(row.get("backends")) for row in rows)
    return {"kind": "INSTRUMENTED_WRITER_WAITS_NOT_QUALIFICATION", "intervalMs": 50,
            "maxObserverSeconds": 30, "samplingCanPerturbLatency": True,
            "oversized": oversized, "truncated": len(rows) > 600,
            "ready": observer["ready"], "exitCode": sampler.returncode, "forcedStop": forced_stop,
            "parseFailures": parse_failures, "sampleCount": len(rows),
            "backendSampleCount": backend_samples,
            "exitedBeforeStop": exited_before_stop,
            "available": observer["ready"] and backend_samples > 0 and not oversized and not exited_before_stop and not forced_stop and not parse_failures,
            "samples": rows[:600], "before": observer["before"],
            "after": after, "backendScope": "reserved-pgbench-application-in-owned-database"}
