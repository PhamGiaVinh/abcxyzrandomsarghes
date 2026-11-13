"""Read-only, opt-in diagnostics; never a latency qualification certificate."""
import json
import os
import pathlib
import re
import subprocess
import threading
import time


def database_container_target():
    project = os.environ.get("PUBLIC_HUD_STACK_PROJECT", "")
    match = re.fullmatch(r"hud-scale-([a-z0-9]+)-([a-z0-9]+)", project)
    database = os.environ.get("PGDATABASE", "")
    if (not match or database != "vinpoker_hud_test_pair_" + "_".join(match.groups())
            or os.environ.get("PGHOST") != "127.0.0.1" or os.environ.get("PGPORT") != "54322"):
        raise RuntimeError("writer_container_disposable_scope_required")
    container = "supabase_db_" + project
    guard = "SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();"
    marker = subprocess.run(["docker", "exec", container, "psql", "-w", "-X", "-qAt",
                             "-U", "supabase_admin", "-d", database, "-c", guard],
                            capture_output=True, text=True, check=True, timeout=5).stdout.strip()
    if marker != "vinpoker-hud-writer-control-disposable":
        raise RuntimeError("writer_container_disposable_marker_required")
    return container


def database_container_snapshot():
    # Fixed read-only cgroup counters, never Docker inspect/env/log output.
    started_at = time.time()
    container = database_container_target()
    values = {}
    for name in ("cpu.stat", "cpu.pressure", "io.pressure", "io.stat", "memory.pressure"):
        try:
            result = subprocess.run(["docker", "exec", container, "head", "-c", "16384",
                                     "/sys/fs/cgroup/" + name], capture_output=True,
                                    text=True, check=True, timeout=2)
            values[name] = result.stdout[:16384]
        except (OSError, subprocess.SubprocessError):
            values[name] = None
    finished_at = time.time()
    return {"epochSeconds": finished_at, "startedEpochSeconds": started_at,
            "durationMs": (finished_at - started_at) * 1000,
            "scope": "owned-database-container-cgroup",
            "available": all(value is not None for value in values.values()), "values": values}


def start_container_ring(root):
    container = database_container_target()
    output = (root / "container-ring.txt").open("w")
    # One persistent owned-container reader. EOF stops it; no background shell,
    # Docker exec per tick, environment/config/log read or business SQL.
    script = """while IFS= read -r tick; do
      printf 'BEGIN %s\\n' "$tick"
      for file in cpu.stat cpu.pressure io.pressure; do
        printf '%s\\n' "$file"
        head -c 1024 "/sys/fs/cgroup/$file" 2>/dev/null
      done
      printf 'END\\n'
    done"""
    process = subprocess.Popen(["docker", "exec", "-i", container, "sh", "-c", script],
                               stdin=subprocess.PIPE, stdout=output, stderr=subprocess.DEVNULL, text=True)
    stop = threading.Event()
    errors = []
    receipts = {}
    def feed():
        deadline = time.monotonic() + 30
        try:
            for _ in range(150):
                if stop.is_set() or time.monotonic() >= deadline:
                    break
                tick = format(time.time(), ".9f")
                process.stdin.write(tick + "\n")
                process.stdin.flush()
                # Acknowledge the complete matching frame before sending another
                # tick. Receipt time is an upper bound on read completion, not
                # the exact kernel sampling time. No queued-tick inference.
                frame_deadline = min(deadline, time.monotonic() + 2)
                complete = False
                while time.monotonic() < frame_deadline:
                    path = root / "container-ring.txt"
                    if path.stat().st_size > 1048576:
                        errors.append("container_frame_oversized")
                        break
                    rows, invalid = parse_container_ring(path.read_text())
                    if rows and not invalid and rows[-1]["epochSeconds"] == float(tick):
                        receipts[float(tick)] = time.time()
                        complete = True
                        break
                    # Drain still sleeps after stop is set; Event.wait would
                    # return immediately and turn this into a busy loop.
                    time.sleep(.01)
                if not complete:
                    if not stop.is_set():
                        errors.append("container_frame_completion_unavailable")
                    break
                if stop.wait(.2):
                    break
        except (OSError, ValueError):
            errors.append("container_reader_unavailable")
        finally:
            process.stdin.close()
    thread = threading.Thread(target=feed, daemon=True)
    thread.start()
    deadline, ready = time.monotonic() + 2, False
    while time.monotonic() < deadline and process.poll() is None:
        try:
            rows, invalid = parse_container_ring((root / "container-ring.txt").read_text())
            ready = bool(rows) and not invalid
        except OSError:
            ready = False
        if ready:
            break
        time.sleep(.01)
    return {"process": process, "output": output, "stop": stop, "thread": thread,
            "errors": errors, "readyBeforeArm": ready, "receipts": receipts}


def finish_container_ring(ring, root):
    ring["stop"].set()
    ring["thread"].join(timeout=3)
    forced = ring["thread"].is_alive()
    try:
        ring["process"].wait(timeout=3)
    except subprocess.TimeoutExpired:
        forced = True
        ring["process"].kill()
        ring["process"].wait(timeout=3)
    ring["output"].close()
    path = root / "container-ring.txt"
    oversized = path.stat().st_size > 1048576
    captured = "" if oversized else path.read_text()
    samples, invalid = parse_container_ring(captured)
    for sample in samples:
        sample["receivedEpochSeconds"] = ring.get("receipts", {}).get(sample["epochSeconds"])
        sample["dispatchToReceiptMs"] = ((sample["receivedEpochSeconds"] - sample["epochSeconds"]) * 1000
                                         if sample["receivedEpochSeconds"] is not None else None)
    missing_receipts = sum(sample["receivedEpochSeconds"] is None for sample in samples)
    invalid_receipts = sum(sample["receivedEpochSeconds"] is not None
                           and sample["receivedEpochSeconds"] < sample["epochSeconds"] for sample in samples)
    blocks = captured.split("BEGIN ")[1:]
    formats = {"records": len(blocks),
               "numericTimestamp": sum(bool(re.fullmatch(r"[0-9]+\.[0-9]+", block.splitlines()[0]))
                                       for block in blocks if block.splitlines()),
               "closedRecord": sum(block.splitlines()[-1:] == ["END"] for block in blocks)}
    reasons = {"badTimestamp": formats["records"] - formats["numericTimestamp"],
               "incompleteFrame": formats["records"] - formats["closedRecord"],
               "invalidRecordOrFields": invalid}
    return {"intervalMs": 200, "maxSamples": 150, "samples": samples, "invalid": invalid,
            "oversized": oversized, "forcedStop": forced, "exitCode": ring["process"].returncode,
            "formatCounts": formats, "missingReceipts": missing_receipts, "invalidReceipts": invalid_receipts,
            "timestampScope": "host dispatch to observed complete-frame receipt brackets sequential reads",
            "parseReasons": reasons,
            "readyBeforeArm": ring["readyBeforeArm"],
            "available": ring["readyBeforeArm"] and bool(samples) and not invalid and not oversized and not forced
                         and not missing_receipts and not invalid_receipts and not ring["errors"] and ring["process"].returncode == 0,
            "limits": "Sequential fixed-file reads; instrumentation can perturb latency; not qualification"}


def parse_container_ring(text):
    samples = []
    invalid = 0
    for block in text.split("BEGIN ")[1:]:
        lines = block.splitlines()
        if not lines or not re.fullmatch(r"[0-9]+\.[0-9]+", lines[0]) or lines[-1:] != ["END"]:
            invalid += 1
            continue
        values, current = {}, None
        for line in lines[1:-1]:
            if line in ("cpu.stat", "cpu.pressure", "io.pressure"):
                if line in values:
                    invalid += 1
                current = line
                values[current] = []
            elif (current == "cpu.stat" and re.fullmatch(r"(?:usage_usec|user_usec|system_usec|nice_usec|core_sched\.force_idle_usec|nr_periods|nr_throttled|throttled_usec|nr_bursts|burst_usec) [0-9]+", line)
                  or current in ("cpu.pressure", "io.pressure") and re.fullmatch(r"(?:some|full) avg10=[0-9]+\.[0-9]+ avg60=[0-9]+\.[0-9]+ avg300=[0-9]+\.[0-9]+ total=[0-9]+", line)):
                values[current].append(line)
            else:
                invalid += 1
        required_cpu = {"usage_usec", "user_usec", "system_usec", "nr_periods", "nr_throttled", "throttled_usec"}
        cpu_keys = [line.split()[0] for line in values.get("cpu.stat", [])]
        pressures_complete = all(sorted(line.split()[0] for line in values.get(name, [])) == ["full", "some"]
                                 for name in ("cpu.pressure", "io.pressure"))
        if (len(values) != 3 or not required_cpu.issubset(cpu_keys) or len(cpu_keys) != len(set(cpu_keys))
                or not pressures_complete or len(samples) >= 150):
            invalid += 1
            continue
        samples.append({"epochSeconds": float(lines[0]), "values": values})
    return samples, invalid


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
    container_before = database_container_snapshot()
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
    try:
        ring = start_container_ring(root)
    except Exception:
        timer.cancel()
        sampler.terminate()
        try:
            sampler.wait(timeout=1)
        except subprocess.TimeoutExpired:
            sampler.kill()
            sampler.wait()
        output.close()
        raise
    return {"process": sampler, "output": output, "timer": timer, "ready": ready,
            "containerRing": ring,
            "before": kernel_snapshot(), "containerBefore": container_before}


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
    ring = finish_container_ring(observer["containerRing"], root) if "containerRing" in observer else None
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
            "after": after,
            "databaseContainer": {"before": observer.get("containerBefore"),
                                  "during": ring,
                                  "after": database_container_snapshot() if "containerBefore" in observer else None,
                                  "resolution": "before-after sequential snapshots; during ring nominal200ms with pre-arm handshake",
                                  "limits": "Sequential reads; counter resets/restarts must be excluded before interpreting deltas",
                                  "samplingCanPerturbLatency": True},
            "backendScope": "reserved-pgbench-application-in-owned-database"}
