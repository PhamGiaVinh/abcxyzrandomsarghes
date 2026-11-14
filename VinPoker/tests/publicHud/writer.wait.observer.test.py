import pathlib
import tempfile
import unittest
from unittest.mock import Mock, patch

scope = {"__name__": "writer_wait_observer"}
exec(compile(pathlib.Path(__file__).with_name("writer.wait.observer.py").read_text(),
             "writer.wait.observer.py", "exec"), scope)


class ObserverSafety(unittest.TestCase):
    def test_stop_drains_pending_frame_without_busy_polling(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            path = root / "container-ring.txt"
            process = Mock(returncode=0)
            process.poll.return_value = None
            second_tick = scope["threading"].Event()
            timers = []
            calls = []
            def deliver(tick):
                calls.append(tick)
                body = "BEGIN " + tick + "cpu.stat\n" + "".join(name + " 0\n" for name in
                    ("usage_usec", "user_usec", "system_usec", "nr_periods", "nr_throttled", "throttled_usec"))
                body += "".join(name + "\n" + "".join(kind + " avg10=0.00 avg60=0.00 avg300=0.00 total=0\n"
                    for kind in ("some", "full")) for name in ("cpu.pressure", "io.pressure")) + "END\n"
                if len(calls) == 1:
                    path.write_text(body)
                else:
                    previous = path.read_text()
                    path.write_text(previous + "BEGIN " + tick)
                    timer = scope["threading"].Timer(.1, lambda: path.write_text(previous + body))
                    timers.append(timer)
                    timer.start()
                    second_tick.set()
            process.stdin.write.side_effect = deliver
            parser = scope["parse_container_ring"]
            with patch.dict(scope, {"database_container_target": lambda: "supabase_db_hud-scale-1-1"}), patch.object(scope["subprocess"], "Popen", return_value=process), patch.dict(scope, {"parse_container_ring": Mock(wraps=parser)}) as patched:
                ring = scope["start_container_ring"](root)
                try:
                    self.assertTrue(second_tick.wait(timeout=1))
                    result = scope["finish_container_ring"](ring, root)
                    self.assertTrue(result["available"])
                    self.assertEqual(len(result["samples"]), 2)
                    self.assertLess(patched["parse_container_ring"].call_count, 40,
                                    "Stop must not cause tight polling while a pending frame drains")
                finally:
                    ring["stop"].set()
                    ring["thread"].join(timeout=3)
                    for timer in timers:
                        timer.join(timeout=1)

    def test_during_arm_parser_accepts_only_fixed_numeric_counters_and_complete_samples(self):
        sample = "BEGIN 123.456\ncpu.stat\nusage_usec 9\nuser_usec 6\nsystem_usec 3\nnr_periods 0\nnr_throttled 0\nthrottled_usec 0\ncpu.pressure\nsome avg10=0.00 avg60=0.00 avg300=0.00 total=10\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=9\nio.pressure\nsome avg10=0.00 avg60=0.00 avg300=0.00 total=21\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=20\nEND\n"
        rows, invalid = scope["parse_container_ring"](sample)
        self.assertEqual(invalid, 0)
        self.assertEqual(rows[0]["epochSeconds"], 123.456)
        rows, invalid = scope["parse_container_ring"](sample.replace("usage_usec 9", "private_secret token"))
        self.assertGreater(invalid, 0)
        self.assertNotIn("private_secret", str(rows))
        self.assertGreater(scope["parse_container_ring"](sample.replace("END\n", ""))[1], 0)
        rows, invalid = scope["parse_container_ring"](sample * 151)
        self.assertEqual(len(rows), 150)
        self.assertEqual(invalid, 1)
        for malformed in (sample.replace("user_usec 6\n", ""), sample.replace("usage_usec 9", "usage_usec 9\nusage_usec 10"), sample.replace("cpu.stat\n", "cpu.stat\ncpu.stat\n")):
            self.assertGreater(scope["parse_container_ring"](malformed)[1], 0)
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            (root / "container-ring.txt").write_text(sample)
            ring = {"process": Mock(returncode=0), "output": Mock(), "stop": Mock(),
                    "thread": Mock(), "errors": [], "readyBeforeArm": False}
            ring["thread"].is_alive.return_value = False
            result = scope["finish_container_ring"](ring, root)
            self.assertEqual(len(result["samples"]), 1)
            self.assertFalse(result["available"], "Late-only samples must not imply a during-arm observation")
            self.assertEqual(result["missingReceipts"], 1)
            ring["receipts"] = {123.456: 123.460}
            ring["readyBeforeArm"] = True
            result = scope["finish_container_ring"](ring, root)
            self.assertTrue(result["available"])
            self.assertAlmostEqual(result["samples"][0]["dispatchToReceiptMs"], 4)
            ring["receipts"] = {123.456: 123.450}
            self.assertFalse(scope["finish_container_ring"](ring, root)["available"])

    def test_during_arm_reader_stops_feed_and_drains_process(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            (root / "container-ring.txt").write_text("")
            process = Mock(returncode=0)
            ring = {"process": process, "output": Mock(), "stop": Mock(), "thread": Mock(), "errors": [], "readyBeforeArm": False}
            ring["thread"].is_alive.return_value = False
            result = scope["finish_container_ring"](ring, root)
            ring["stop"].set.assert_called_once()
            ring["thread"].join.assert_called_once_with(timeout=3)
            process.wait.assert_called_once_with(timeout=3)
            ring["output"].close.assert_called_once()
            self.assertFalse(result["available"])

    def test_during_arm_reader_uses_one_fixed_command_and_closes_stdin(self):
        with tempfile.TemporaryDirectory() as directory:
            process = Mock(returncode=0)
            process.poll.return_value = None
            process.stdin.write.side_effect = lambda tick: (pathlib.Path(directory) / "container-ring.txt").write_text(
                "BEGIN " + tick + "cpu.stat\nusage_usec 1\nuser_usec 1\nsystem_usec 0\nnr_periods 0\nnr_throttled 0\nthrottled_usec 0\ncpu.pressure\nsome avg10=0.00 avg60=0.00 avg300=0.00 total=0\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=0\nio.pressure\nsome avg10=0.00 avg60=0.00 avg300=0.00 total=0\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=0\nEND\n")
            with patch.dict(scope, {"database_container_target": lambda: "supabase_db_hud-scale-1-1"}), patch.object(scope["subprocess"], "Popen", return_value=process) as launch:
                ring = scope["start_container_ring"](pathlib.Path(directory))
                ring["stop"].set()
                ring["thread"].join(timeout=1)
                self.assertFalse(ring["thread"].is_alive())
                self.assertTrue(ring["receipts"])
                process.stdin.close.assert_called_once()
                self.assertEqual(launch.call_count, 1)
                command = launch.call_args.args[0]
                self.assertEqual(command[:6], ["docker", "exec", "-i", "supabase_db_hud-scale-1-1", "sh", "-c"])
                self.assertIn('head -c 1024 "/sys/fs/cgroup/$file"', command[6])
                self.assertNotIn("date ", command[6])
                if process.stdin.write.called:
                    self.assertRegex(process.stdin.write.call_args.args[0], r"^[0-9]+\.[0-9]{9}\n$")
                scope["finish_container_ring"](ring, pathlib.Path(directory))

    def test_container_identity_and_marker_are_checked_before_counter_reads(self):
        env = {"PGHOST": "127.0.0.1", "PGPORT": "54322",
               "PGDATABASE": "vinpoker_hud_test_pair_1_1", "PUBLIC_HUD_STACK_PROJECT": "hud-scale-2-1"}
        with patch.dict(scope["os"].environ, env, clear=True), patch.object(scope["subprocess"], "run") as run:
            with self.assertRaisesRegex(RuntimeError, "scope_required"):
                scope["database_container_snapshot"]()
            run.assert_not_called()
        env["PUBLIC_HUD_STACK_PROJECT"] = "hud-scale-1-1"
        with patch.dict(scope["os"].environ, env, clear=True), patch.object(scope["subprocess"], "run", return_value=Mock(stdout="wrong")) as run:
            with self.assertRaisesRegex(RuntimeError, "marker_required"):
                scope["database_container_snapshot"]()
            self.assertEqual(run.call_count, 1)

    def test_container_output_is_bounded_and_failures_are_explicit(self):
        env = {"PGHOST": "127.0.0.1", "PGPORT": "54322",
               "PGDATABASE": "vinpoker_hud_test_pair_1_1", "PUBLIC_HUD_STACK_PROJECT": "hud-scale-1-1"}
        results = [Mock(stdout="vinpoker-hud-writer-control-disposable"), Mock(stdout="x" * 20000),
                   OSError(), Mock(stdout="io"), Mock(stdout="io"), Mock(stdout="memory")]
        with patch.dict(scope["os"].environ, env, clear=True), patch.object(scope["subprocess"], "run", side_effect=results) as run:
            result = scope["database_container_snapshot"]()
            self.assertFalse(result["available"])
            self.assertEqual(len(result["values"]["cpu.stat"]), 16384)
            self.assertIsNone(result["values"]["cpu.pressure"])
            for call in run.call_args_list[1:]:
                self.assertEqual(call.args[0][:6], ["docker", "exec", "supabase_db_hud-scale-1-1", "head", "-c", "16384"])
                self.assertEqual(call.kwargs["timeout"], 2)

    def test_remote_or_unmarked_scope_cannot_start_sampler(self):
        for env in ({"PGHOST": "production", "PGPORT": "54322", "PGDATABASE": "vinpoker_hud_test_pair_1_1"},
                    {"PGHOST": "127.0.0.1", "PGPORT": "5432", "PGDATABASE": "vinpoker_hud_test_pair_1_1"},
                    {"PGHOST": "127.0.0.1", "PGPORT": "54322", "PGDATABASE": "postgres"}):
            with patch.dict(scope["os"].environ, env, clear=True), patch.object(scope["subprocess"], "Popen") as launch:
                with self.assertRaisesRegex(RuntimeError, "scope_required"):
                    scope["start_writer_observer"](pathlib.Path("unused"))
                launch.assert_not_called()
        env = {"PGHOST": "127.0.0.1", "PGPORT": "54322", "PGDATABASE": "vinpoker_hud_test_pair_1_1"}
        with patch.dict(scope["os"].environ, env, clear=True), patch.object(scope["subprocess"], "run", return_value=Mock(stdout="wrong")) as guard, patch.object(scope["subprocess"], "Popen") as launch:
            with self.assertRaisesRegex(RuntimeError, "marker_required"):
                scope["start_writer_observer"](pathlib.Path("unused"))
            self.assertEqual(guard.call_args.kwargs["timeout"], 5)
            launch.assert_not_called()

    def test_libpq_target_overrides_are_removed(self):
        with patch.dict(scope["os"].environ, {"PGHOST": "127.0.0.1", "PGHOSTADDR": "remote",
                        "PGSERVICE": "remote", "PGSERVICEFILE": "private", "PGSYSCONFDIR": "private"}, clear=True):
            env = scope["writer_observer_env"]("probe")
            self.assertEqual(env, {"PGHOST": "127.0.0.1", "PGAPPNAME": "probe"})

    def test_empty_failed_or_malformed_observation_is_unavailable(self):
        for text, ready, exited in (("", True, False), ('{"backends":[]}\n', True, False), ('{"backends":[]}\n', False, False),
                                    ('{"backends":[]}\n', True, True), ('{broken\n', True, False)):
            with tempfile.TemporaryDirectory() as directory:
                root = pathlib.Path(directory)
                path = root / "writer-waits.jsonl"
                path.write_text(text)
                process = Mock(returncode=-15)
                process.poll.return_value = 1 if exited else None
                observer = {"process": process, "output": Mock(), "timer": Mock(), "ready": ready, "before": {}}
                result = scope["finish_writer_observer"](observer, root)
                self.assertFalse(result["available"])
                if not exited:
                    process.terminate.assert_called_once()


unittest.main()
