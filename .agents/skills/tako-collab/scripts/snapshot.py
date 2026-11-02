"""Read Git metadata for parallel development; never modify source or publish."""
import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


def snapshot(repo, peer_refs, fetch=False):
    def git(*args):
        result = subprocess.run(["git", *args], cwd=repo, capture_output=True, timeout=45)
        if result.returncode:
            raise RuntimeError("git_operation_failed")
        return result.stdout.decode("utf-8", errors="replace").strip("\r\n")

    def paths(*args):
        return sorted(set(filter(None, git(*args).split("\0"))))

    git("rev-parse", "--show-toplevel")
    head = git("rev-parse", "HEAD")
    before = git("for-each-ref", "--format=%(refname:short) %(objectname)", "refs/remotes/origin/")
    fresh = "local_refs_only"
    if fetch:
        try:
            git("fetch", "origin", "--prune")
            fresh = "fetched"
        except (RuntimeError, subprocess.TimeoutExpired):
            fresh = "fetch_failed"
    after = git("for-each-ref", "--format=%(refname:short) %(objectname)", "refs/remotes/origin/")
    remote_refs = dict(line.split(" ", 1) for line in after.splitlines() if line)
    working = paths("diff", "--name-only", "--no-renames", "-z", "HEAD", "--")
    untracked = paths("ls-files", "--others", "--exclude-standard", "-z")
    peers = []
    for ref in peer_refs:
        if not ref or ref.startswith("-"):
            raise RuntimeError("invalid_peer_ref")
        try:
            peer = git("rev-parse", "--verify", ref + "^{commit}")
            base = git("merge-base", head, peer)
        except RuntimeError:
            peers.append({"ref": ref, "status": "unknown_ref_or_unrelated_history"})
            continue
        incoming = paths("diff", "--name-only", "--no-renames", "-z", base, peer, "--")
        local = paths("diff", "--name-only", "--no-renames", "-z", base, head, "--")
        progress = [p for p in paths("ls-tree", "-r", "--name-only", "-z", peer, "--", "docs/handoff")
                    if p.endswith("-progress.md") or p.endswith("/parallel-ci-results.md")]
        peers.append({"ref": ref, "status": "observed", "head": peer, "merge_base": base,
                      "incoming_files": incoming, "local_committed_files": local,
                      "overlap_candidates": sorted(set(incoming) & set(local + working + untracked)),
                      "progress_files_at_ref": progress})
    return {"observed_at_utc": datetime.now(timezone.utc).isoformat(),
            "branch": git("branch", "--show-current"), "head": head, "freshness": fresh,
            "remote_refs_changed": before != after, "remote_refs": remote_refs,
            "working_files": working, "untracked_files": untracked,
            "unmerged_files": paths("diff", "--name-only", "--diff-filter=U", "-z", "--"),
            "peers": peers, "limits": ["peer_unpushed_work_not_observed", "claims_and_semantic_conflicts_require_review"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--peer-ref", action="append", required=True)
    parser.add_argument("--fetch", action="store_true")
    args = parser.parse_args()
    # scripts -> skill -> skills -> .agents -> repository
    repo = Path(__file__).resolve().parents[4]
    try:
        result = snapshot(repo, args.peer_ref, args.fetch)
        print(json.dumps(result, ensure_ascii=True, indent=2))
        return 1 if result["freshness"] == "fetch_failed" or any(p["status"] != "observed" for p in result["peers"]) else 0
    except Exception:
        # Never echo raw Git/network errors: they may contain credentials or URLs.
        print(json.dumps({"error": "snapshot_failed_no_source_changed"}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
