"""No network, no credentials: verify that backup namespaces cannot escape the owned prefix."""
import unittest
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent))
from oss_backup import object_prefix


class BackupNamespace(unittest.TestCase):
    def test_default_is_compatible(self):
        self.assertEqual(object_prefix({}), "tako-backups/")

    def test_environment_prefixes(self):
        for prefix in ("tako-backups/production/", "tako-backups/test/", "tako-backups/production/archive/"):
            self.assertEqual(object_prefix({"OSS_BACKUP_PREFIX": prefix}), prefix)

    def test_escape_and_other_objects_rejected(self):
        for prefix in ("", "other-bucket/", "../tako-backups/", "tako-backups/../", "tako-backups//", "tako-backups/production", "tako-backups/production/?key=x"):
            with self.assertRaises(RuntimeError):
                object_prefix({"OSS_BACKUP_PREFIX": prefix})


if __name__ == "__main__":
    unittest.main()
