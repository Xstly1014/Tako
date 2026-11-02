"""Operational guardrails: never silently replace an existing/missing test database."""
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import local_restart as restart


class RestartTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.config = self.folder / ".env"
        self.config.write_text("APP_VERSION=local\nTEST_DATASET_ID=example\n", encoding="utf-8")
        (self.folder / "init-test.sql").write_text("-- identity", encoding="utf-8")
        for target, value in (("CONFIG", self.config), ("DIRECTORY", self.folder)):
            mock = patch.object(restart, target, value)
            mock.start()
            self.addCleanup(mock.stop)

    def test_missing_volume_never_initializes_or_builds(self):
        with patch.object(restart, "run", return_value=b"linux\n") as run, \
                patch.object(restart, "exists", return_value=False):
            with self.assertRaisesRegex(RuntimeError, "database_volume_missing"):
                restart.start()
            self.assertEqual(run.call_count, 1)  # only Docker engine check

    def test_missing_config_preserves_database(self):
        self.config.unlink()
        with patch.object(restart, "run", return_value=b"linux\n") as run:
            with self.assertRaisesRegex(RuntimeError, "configuration_missing"):
                restart.start()
            self.assertEqual(run.call_count, 1)

    def test_database_identity_mismatch_rejects_before_migration(self):
        result = type("Result", (), {"returncode": 0, "stdout": b"test\tother-namespace\n"})()
        with patch.object(restart.subprocess, "run", return_value=result):
            with self.assertRaisesRegex(RuntimeError, "identity_or_credentials_mismatch"):
                restart.verify_database({"TEST_DATASET_ID": "expected"})


if __name__ == "__main__":
    unittest.main()
