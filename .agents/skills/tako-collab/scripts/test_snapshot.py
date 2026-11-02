"""Behavior checks in disposable repositories; never touches the Tako Git state."""
import json
import subprocess
import tempfile
import unittest
import sys
import shutil
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from snapshot import snapshot


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="tako-collab-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.repo = self.root / "work"
        self.repo.mkdir()
        self.git("init", "-b", "main")
        self.identity(self.repo)
        (self.repo / "shared.txt").write_text("base", encoding="utf-8")
        self.commit("base")

    def git(self, *args, repo=None):
        return subprocess.run(["git", *args], cwd=repo or self.repo, capture_output=True,
                              check=True).stdout.decode().strip()

    def identity(self, repo):
        self.git("config", "user.name", "Collaboration Test", repo=repo)
        self.git("config", "user.email", "collab-test@localhost", repo=repo)

    def commit(self, title, repo=None):
        self.git("add", ".", repo=repo)
        self.git("commit", "-m", title, repo=repo)

    def test_common_ancestor_and_dirty_overlap_without_mutation(self):
        self.git("checkout", "-b", "peer")
        (self.repo / "peer-only.txt").write_text("peer", encoding="utf-8")
        (self.repo / "shared.txt").write_text("peer update", encoding="utf-8")
        self.commit("peer")
        self.git("checkout", "main")
        (self.repo / "own-only.txt").write_text("own", encoding="utf-8")
        self.commit("own")
        (self.repo / "shared.txt").write_text("uncommitted", encoding="utf-8")
        (self.repo / "peer-only.txt").write_text("untracked collision", encoding="utf-8")
        before = (self.git("rev-parse", "HEAD"), self.git("status", "--porcelain"))
        result = snapshot(self.repo, ["peer"])
        peer = result["peers"][0]
        self.assertEqual(peer["incoming_files"], ["peer-only.txt", "shared.txt"])
        self.assertEqual(peer["local_committed_files"], ["own-only.txt"])
        self.assertEqual(peer["overlap_candidates"], ["peer-only.txt", "shared.txt"])
        self.assertEqual(before, (self.git("rev-parse", "HEAD"), self.git("status", "--porcelain")))
        self.assertEqual((self.repo / "shared.txt").read_text(), "uncommitted")
        self.assertEqual(result["freshness"], "local_refs_only")

    def test_fetch_updates_refs_without_merging_or_changing_head(self):
        remote = self.root / "remote.git"
        self.git("init", "--bare", str(remote))
        self.git("remote", "add", "origin", str(remote))
        self.git("push", "origin", "main")
        other = self.root / "peer"
        self.git("clone", "--branch", "main", str(remote), str(other))
        self.identity(other)
        (other / "new.txt").write_text("new work", encoding="utf-8")
        self.commit("new", repo=other)
        self.git("push", "origin", "main", repo=other)
        head = self.git("rev-parse", "HEAD")
        result = snapshot(self.repo, ["origin/main"], fetch=True)
        self.assertEqual(result["freshness"], "fetched")
        self.assertTrue(result["remote_refs_changed"])
        self.assertEqual(result["peers"][0]["incoming_files"], ["new.txt"])
        self.assertEqual(self.git("rev-parse", "HEAD"), head)
        self.assertFalse((self.repo / "new.txt").exists())

    def test_failed_fetch_and_unknown_ref_are_explicit(self):
        result = snapshot(self.repo, ["missing-peer"], fetch=True)
        self.assertEqual(result["freshness"], "fetch_failed")
        self.assertEqual(result["peers"][0]["status"], "unknown_ref_or_unrelated_history")
        self.assertNotIn("fatal:", json.dumps(result))

    def test_option_like_ref_is_rejected(self):
        with self.assertRaises(RuntimeError):
            snapshot(self.repo, ["--help"])

    def test_cli_root_resolution_failure_status_and_ignored_content(self):
        scripts = self.repo / ".agents/skills/tako-collab/scripts"
        scripts.mkdir(parents=True)
        shutil.copyfile(Path(__file__).with_name("snapshot.py"), scripts / "snapshot.py")
        (self.repo / ".gitignore").write_text(".env\n", encoding="utf-8")
        (self.repo / ".env").write_text("PRIVATE_CONTENT_MUST_NOT_BE_PRINTED", encoding="utf-8")
        result = subprocess.run([sys.executable, str(scripts / "snapshot.py"), "--peer-ref", "missing"],
                                cwd=self.root, capture_output=True)
        self.assertEqual(result.returncode, 1)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["head"], self.git("rev-parse", "HEAD"))
        self.assertNotIn(".env", payload["untracked_files"])
        self.assertNotIn(b"PRIVATE_CONTENT_MUST_NOT_BE_PRINTED", result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
