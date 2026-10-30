"""Real API acceptance for synthetic fixtures. Only the dedicated loopback test entry."""
from http.cookiejar import CookieJar
import json
from pathlib import Path
import urllib.request
import urllib.error
import uuid

ROOT = Path(__file__).resolve().parent.parent
BASE = "http://127.0.0.1:3300"


class Client:
    def __init__(self):
        self.cookies = CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookies))

    def call(self, path, method="GET", body=None, want=200):
        raw = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(BASE + "/api" + path, data=raw, method=method)
        if raw is not None:
            request.add_header("Content-Type", "application/json")
            request.add_header("Origin", BASE)
        try:
            response = self.opener.open(request, timeout=20)
        except urllib.error.HTTPError as error:
            response = error
        if response.code != want or response.headers.get("X-Tako-Environment") != "test":
            raise RuntimeError("test_api_response_mismatch")
        data = response.read()
        return json.loads(data) if data else None


def main():
    values = {}
    for line in (ROOT / ".runtime/local-test/.env").read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.startswith("#"):
            name, value = line.split("=", 1)
            values[name] = value
    namespace = uuid.UUID(values["TEST_DATASET_ID"])
    author, operator, reader = Client(), Client(), Client()
    for client, name in ((author, "AUTHOR"), (operator, "OPERATOR"), (reader, "READER")):
        client.call("/auth/login", "POST", {"email": name.lower() + "@tako-test.invalid", "password": values["TEST_" + name + "_PASSWORD"]})
        if not any(cookie.name == "tako_test_session" for cookie in client.cookies):
            raise RuntimeError("test_cookie_not_isolated")
    assert operator.call("/me/access")["operator"]
    assert not author.call("/me/access")["operator"]
    author.call("/ops/curation", want=403)
    work = str(uuid.uuid5(namespace, "work/1"))
    draft = str(uuid.uuid5(namespace, "draft/1/0"))
    previous = reader.call("/works/" + work)
    assert "合成测试内容" in previous["content"]
    before = operator.call("/ops/curation/" + work)
    source = author.call("/drafts/" + draft)
    saved = author.call("/drafts/save", "POST", {"mutation_id": str(uuid.uuid4()), "draft_id": draft, "base_revision": source["revision"], "title": "测试修订：" + source["title"][:170], "content": source["content"] + "\n测试环境真实修订链路验收。"})
    preview = author.call("/publication-previews", "POST", {"mutation_id": str(uuid.uuid4()), "draft_id": draft, "source_revision": saved["revision"], "introduction": previous["introduction"], "tags": previous["tags"], "rights_confirmed": True})
    state = author.call("/my/works/" + work)
    published = author.call("/publications", "POST", {"mutation_id": str(uuid.uuid4()), "preview_id": preview["id"], "expected_version": state["last_version"]})
    assert published["work_id"] == work
    current = reader.call("/works/" + work)
    assert current["version"] == published["version"] and "真实修订链路" in current["content"]
    assert operator.call("/ops/curation/" + work)["work"]["first_published_at"] == before["work"]["first_published_at"]

    def change(action, **extra):
        current_state = author.call("/my/works/" + work)
        return author.call("/my/works/" + work + "/actions", "POST", {"mutation_id": str(uuid.uuid4()), "expected_state_revision": current_state["state_revision"], "action": action, **extra})

    change("set_history", history_open=True)
    reader.call("/works/" + work + "/versions/1")
    change("set_history", history_open=False)
    reader.call("/works/" + work + "/versions/1", want=404)
    task = operator.call("/ops/reviews/" + work + "/versions/" + str(published["version"]))["task"]
    operator.call("/ops/reviews/" + work + "/versions/" + str(published["version"]), "POST", {"mutation_id": str(uuid.uuid4()), "expected_revision": task["revision"], "decision": "restrict_version", "reason": "[合成验收] 检查测试样本的真实处置链路。"})
    reader.call("/works/" + work, want=404)
    case = next(item for item in author.call("/my/moderation")["items"] if item["work_id"] == work and item["version"] == published["version"] and item["state"] == "active")
    author.call("/my/moderation/" + str(case["id"]), "POST", {"mutation_id": str(uuid.uuid4()), "expected_revision": case["revision"], "decision": "appeal", "reason": "[合成验收] 请复核当前测试版本。"})
    detail = operator.call("/ops/moderation/" + str(case["id"]))
    operator.call("/ops/moderation/" + str(case["id"]), "POST", {"mutation_id": str(uuid.uuid4()), "expected_revision": detail["case"]["revision"], "decision": "revoke", "reason": "[合成验收] 处置与纠错验证完成。"})
    reader.call("/works/" + work)
    change("hide")
    reader.call("/works/" + work, want=404)
    change("restore")
    assert not any(item["id"] == work for item in reader.call("/community")["featured"])
    editorial = operator.call("/ops/curation")
    candidate = operator.call("/ops/curation/" + work)
    operator.call("/ops/curation", "POST", {"mutation_id": str(uuid.uuid4()), "expected_revision": editorial["revision"], "slot": 1, "work_id": work, "expected_work_revision": candidate["state_revision"]})
    reader.call("/drafts/" + draft, want=404)
    print("PASS: sandbox seeded accounts use real passwords; fixture draft -> publish -> history -> restrict -> appeal/revoke -> hide/restore -> manual reselect; cross-account isolation.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("Sandbox API acceptance failed. No production origin or credentials were selected.")
        raise SystemExit(1)
