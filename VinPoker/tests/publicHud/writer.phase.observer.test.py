import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location('phase', pathlib.Path(__file__).with_name('writer.phase.observer.py'))
phase = importlib.util.module_from_spec(spec)
spec.loader.exec_module(phase)


class PhaseTest(unittest.TestCase):
    def test_scope(self):
        valid = dict(PUBLIC_HUD_STACK_PROJECT='hud-scale-123-1', PGDATABASE='vinpoker_hud_test_pair_123_1',
                     PGHOST='127.0.0.1', PGPORT='54322', PGUSER='postgres', PUBLIC_HUD_WRITER_WAIT_DIAGNOSTIC='1')
        phase.validate_scope(valid)
        for field in valid:
            with self.assertRaises(RuntimeError):
                phase.validate_scope({**valid, field: 'wrong'})

    def test_fixed_command_order_and_bounded_rows(self):
        seen = []
        result = phase.measure(seen.append, phase.COMMANDS, 220)
        self.assertFalse(result['qualification'])
        self.assertEqual(len(result['rows']), 220)
        self.assertEqual(sum(not row['warmup'] for row in result['rows']), 200)
        self.assertEqual(seen, [name for name, _ in phase.COMMANDS] * 220)
        for row in result['rows']:
            self.assertGreaterEqual(row['elapsedMs'], sum(row['phasesMs'].values()))
            self.assertGreaterEqual(row['unassignedClientMs'], 0)
        self.assertNotIn('SELECT', str(result))

    def test_reject_arbitrary_workload(self):
        for commands, count in [(phase.COMMANDS, 221), ((('unsafe', 'SELECT secret'),), 220)]:
            with self.assertRaises(RuntimeError):
                phase.measure(lambda _: None, commands, count)

    def test_command_failure_is_not_success(self):
        def fail(_):
            raise RuntimeError('test failure')
        with self.assertRaises(RuntimeError):
            phase.measure(fail, phase.COMMANDS, 220)


if __name__ == '__main__':
    unittest.main()
