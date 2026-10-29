"""Linux-only retention safety tests, no network or real backup deletion."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from daily_backup import prune


class RetentionSafety(unittest.TestCase):
    def test_only_aged_owned_filenames_are_removed(self):
        now = datetime.now(timezone.utc)
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            backups = root / "backups"
            backups.mkdir()
            old = backups / ((now-timedelta(days=31)).strftime("%Y%m%dT%H%M%SZ")+"-00000001.tako.enc")
            fresh = backups / (now.strftime("%Y%m%dT%H%M%SZ")+"-00000002.tako.enc")
            unrelated = backups / "keep-me.tako.enc"
            outside = root / "outside.txt"
            for path in (old, fresh, unrelated, outside):
                path.write_bytes(b"test fixture only")
            link = backups / ((now-timedelta(days=31)).strftime("%Y%m%dT%H%M%SZ")+"-00000003.tako.enc")
            link.symlink_to(outside)
            prune(backups, now-timedelta(days=30))
            self.assertFalse(old.exists())
            for path in (fresh, unrelated, outside, link):
                self.assertTrue(path.exists())


if __name__ == "__main__":
    unittest.main()
