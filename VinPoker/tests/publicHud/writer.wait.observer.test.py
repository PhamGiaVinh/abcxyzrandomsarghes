import pathlib
import tempfile
import unittest
from unittest.mock import Mock, patch

scope = {"__name__": "writer_wait_observer"}
exec(compile(pathlib.Path(__file__).with_name("writer.wait.observer.py").read_text(),
             "writer.wait.observer.py", "exec"), scope)


class ObserverSafety(unittest.TestCase):
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
