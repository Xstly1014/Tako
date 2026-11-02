import test from "node:test";
import assert from "node:assert/strict";
import { Session, type Transport, type Vault } from "../src/auth/session.ts";
import { ApiError } from "../src/api/client.ts";
const account = {
  id: "11111111-1111-4111-8111-111111111111",
  nickname: "测试读者",
};
const token = "tako_app_" + "a".repeat(64);
const response = {
  account,
  access_token: token,
  token_type: "Bearer",
  expires_in: 604800,
};
function vault(initial: string | null = null) {
  let value = initial;
  return {
    get: async () => value,
    set: async (v: string) => {
      value = v;
    },
    remove: async () => {
      value = null;
    },
    value: () => value,
  };
}
const transport = (
  fn: (path: string, options?: Parameters<Transport>[1]) => Promise<unknown>,
) => fn as Transport;
test("冷启动校验安全存储，网络故障保留凭据且不假装已登录", async () => {
  const v = vault(token);
  let offline = true;
  const s = new Session(
    v,
    transport(async () => {
      if (offline) throw new ApiError("network");
      return account;
    }),
  );
  await s.restore();
  assert.equal(s.snapshot().phase, "offline");
  assert.equal(s.snapshot().account, null);
  assert.equal(v.value(), token);
  offline = false;
  await s.restore();
  assert.equal(s.snapshot().phase, "ready");
  assert.deepEqual(s.snapshot().account, account);
});
test("明确 401 清除凭据；服务端 503 不清空有效登录", async () => {
  const v = vault(token);
  let status = 503;
  const s = new Session(
    v,
    transport(async () => {
      throw new ApiError("service_unavailable", "", status);
    }),
  );
  await s.restore();
  assert.equal(v.value(), token);
  status = 401;
  await s.restore();
  assert.equal(v.value(), null);
  assert.equal(s.snapshot().phase, "guest");
  assert.equal(s.snapshot().busy, false);
});
test("注册丢响应不会自动重试；密码原样传递且不写入 vault", async () => {
  const v = vault();
  let calls = 0;
  const s = new Session(
    v,
    transport(async (_path, options) => {
      calls++;
      assert.deepEqual(options?.body, {
        email: "a@example.test",
        password: " password ",
      });
      throw new ApiError("network");
    }),
  );
  await s.restore();
  await assert.rejects(s.signIn("register", " a@example.test ", " password "));
  assert.equal(calls, 1);
  assert.equal(v.value(), null);
});
test("安全存储失败不宣称登录成功，并尝试撤销新会话", async () => {
  let revoked = false;
  const v: Vault = {
    get: async () => null,
    set: async () => {
      throw Error("storage");
    },
    remove: async () => {},
  };
  const s = new Session(
    v,
    transport(async (path) => {
      if (path.endsWith("logout")) {
        revoked = true;
        return;
      }
      return response;
    }),
  );
  await s.restore();
  await assert.rejects(
    s.signIn("login", "a@example.test", "password"),
    (e: unknown) => e instanceof ApiError && e.code === "storage",
  );
  assert.equal(revoked, true);
  assert.equal(s.snapshot().phase, "guest");
});
test("退出失败保留当前账号；重试成功才清空凭据", async () => {
  const v = vault(token);
  let fail = true;
  const s = new Session(
    v,
    transport(async (path) => {
      if (path === "/me") return account;
      if (fail) throw new ApiError("network");
    }),
  );
  await s.restore();
  await assert.rejects(s.logout());
  assert.equal(s.snapshot().phase, "ready");
  assert.equal(v.value(), token);
  fail = false;
  await s.logout();
  assert.equal(v.value(), null);
  assert.equal(s.snapshot().phase, "guest");
});
test("退出与账号切换后，旧账号的迟到响应不可写入新账号视图", async () => {
  const v = vault(token);
  let finish: (v: unknown) => void = () => {};
  const s = new Session(
    v,
    transport(async (path) => {
      if (path === "/me") return account;
      if (path === "/slow")
        return new Promise((resolve) => {
          finish = resolve;
        });
      if (path.includes("login"))
        return {
          ...response,
          account: { ...account, id: "22222222-2222-4222-8222-222222222222" },
        };
    }),
  );
  await s.restore();
  const pending = s.authorized("/slow");
  const rejected = assert.rejects(
    pending,
    (e: unknown) => e instanceof ApiError && e.code === "stale_session",
  );
  await s.logout();
  await s.signIn("login", "b@example.test", "password");
  finish({ private: "old-account" });
  await rejected;
  assert.notEqual(s.snapshot().account?.id, account.id);
});
test("注销不落盘密码，持久化令牌可用于下一次冷启动", async () => {
  const v = vault();
  const t = transport(async (path) => (path === "/me" ? account : response));
  const s = new Session(v, t);
  await s.restore();
  await s.signIn("login", "a@example.test", "password");
  assert.equal(v.value(), token);
  const restored = new Session(v, t);
  await restored.restore();
  assert.equal(restored.snapshot().account?.id, account.id);
});

test("安全存储尚未完成删除时不能开始另一次登录", async () => {
  const v = vault(token);
  let finish = () => {};
  const remove = v.remove;
  v.remove = () =>
    new Promise<void>((resolve) => {
      finish = () => {
        void remove().then(resolve);
      };
    });
  const s = new Session(
    v,
    transport(async (path) => (path === "/me" ? account : undefined)),
  );
  await s.restore();
  const logout = s.logout();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(s.snapshot().busy, true);
  await assert.rejects(
    s.signIn("login", "b@example.test", "password"),
    (e: unknown) => e instanceof ApiError && e.code === "session_busy",
  );
  finish();
  await logout;
  assert.equal(s.snapshot().busy, false);
});

test("旧注销响应迟到，不能清除已重新登录的新账号", async () => {
  const v = vault(token);
  let endLogout = () => {},
    denyPrivate = (_: unknown) => {};
  const nextToken = "tako_app_" + "b".repeat(64);
  const s = new Session(
    v,
    transport(async (path) => {
      if (path === "/me") return account;
      if (path === "/private")
        return new Promise((_, reject) => {
          denyPrivate = reject;
        });
      if (path.endsWith("logout"))
        return new Promise<void>((resolve) => {
          endLogout = resolve;
        });
      return {
        ...response,
        access_token: nextToken,
        account: { ...account, id: "22222222-2222-4222-8222-222222222222" },
      };
    }),
  );
  await s.restore();
  const old = s.authorized("/private");
  const invalidated = assert.rejects(old);
  const logout = s.logout();
  denyPrivate(new ApiError("authentication_required", "", 401));
  await invalidated;
  await s.signIn("login", "b@example.test", "password");
  endLogout();
  await logout;
  assert.equal(v.value(), nextToken);
  assert.equal(s.snapshot().phase, "ready");
  assert.notEqual(s.snapshot().account?.id, account.id);
});


// C1-A: persistent vault model; native SecureStore behavior is a separate gate.
function secureItem(initial: string | null = null) {
  let value = initial;
  const state = { failSet: false, failRemove: false };
  return { state, raw: () => value,
    get: async () => value,
    set: async (next: string) => { if (state.failSet) throw new Error("injected_storage"); value = next; },
    remove: async () => { if (state.failRemove) throw new Error("injected_storage"); value = null; },
  };
}
const accessModule = await import("../src/drafts/access.ts");
const makeSecureVault = accessModule.createDraftSessionVault;
const networkDown = transport(async () => { throw new ApiError("network"); });

test("草稿授权：旧原始令牌必须联网确认，首次/未确认会话不获得离线私稿权限", async () => {
  const item = secureItem(token), v = makeSecureVault(item);
  const offline = new Session(v, networkDown);
  await offline.restore();
  assert.equal(offline.snapshot().drafts.phase, "locked");
  const online = new Session(v, transport(async () => account));
  await online.restore();
  assert.equal(online.snapshot().drafts.phase, "confirmation");
  const notConfirmed = new Session(makeSecureVault(item), networkDown);
  await notConfirmed.restore();
  assert.equal(notConfirmed.snapshot().drafts.owner, null);
  await online.confirmDraftAccess();
  const reopened = new Session(makeSecureVault(item), networkDown);
  await reopened.restore();
  assert.equal(reopened.snapshot().phase, "offline");
  assert.equal(reopened.snapshot().account, null);
  assert.deepEqual(reopened.snapshot().drafts, { phase: "offline", owner: account.id });
  await assert.rejects(reopened.authorized("/drafts"));
});

test("草稿授权：503 保留同会话离线权利，契约/环境错误不自动解锁", async () => {
  const item = secureItem(token), v = makeSecureVault(item);
  const online = new Session(v, transport(async () => account));
  await online.restore(); await online.confirmDraftAccess();
  for (const error of [new ApiError("service_unavailable", "", 503), new ApiError("contract"), new ApiError("environment")]) {
    const s = new Session(makeSecureVault(item), transport(async () => { throw error; }));
    await s.restore();
    assert.equal(s.snapshot().drafts.phase, error.status === 503 ? "offline" : "locked");
  }
});

test("草稿授权：401 且令牌删除失败，预先落盘的锁定阻止断网重启解锁", async () => {
  const item = secureItem(token), v = makeSecureVault(item);
  const online = new Session(v, transport(async () => account));
  await online.restore(); await online.confirmDraftAccess();
  item.state.failRemove = true;
  const denied = new Session(makeSecureVault(item), transport(async () => { throw new ApiError("authentication_required", "", 401); }));
  await denied.restore();
  assert.equal((denied.snapshot().error as ApiError).code, "storage");
  assert.equal(denied.snapshot().drafts.owner, null);
  assert.equal(denied.snapshot().phase, "guest");
  const reopened = new Session(makeSecureVault(item), networkDown);
  await reopened.restore();
  assert.equal(reopened.snapshot().drafts.phase, "locked");
});

test("草稿授权：退出先持久化锁；网络失败保留登录，断网重开不能读稿", async () => {
  const item = secureItem(token), v = makeSecureVault(item);
  let logoutCalls = 0;
  const s = new Session(v, transport(async (path) => {
    if (path === "/me") return account;
    logoutCalls++; throw new ApiError("network");
  }));
  await s.restore(); await s.confirmDraftAccess();
  await assert.rejects(s.logout());
  assert.equal(logoutCalls, 1);
  assert.equal(s.snapshot().phase, "ready");
  assert.equal(s.snapshot().drafts.owner, null);
  const reopened = new Session(makeSecureVault(item), networkDown);
  await reopened.restore();
  assert.equal(reopened.snapshot().drafts.owner, null);
  await s.restore();
  assert.equal(s.snapshot().drafts.phase, "confirmation");
  await s.confirmDraftAccess();
  assert.equal(s.snapshot().drafts.phase, "online");
});

test("草稿授权：锁定写失败不发送注销、不宣称成功；当前进程先拒绝私稿", async () => {
  const item = secureItem(token), v = makeSecureVault(item);
  let calls = 0;
  const s = new Session(v, transport(async (path) => {
    if (path === "/me") return account;
    calls++;
  }));
  await s.restore(); await s.confirmDraftAccess();
  item.state.failSet = true;
  await assert.rejects(s.logout());
  assert.equal(calls, 0);
  assert.equal(s.snapshot().drafts.owner, null);
  assert.equal(s.snapshot().phase, "ready");
});

test("草稿授权：注销成功但删除失败会明确报错，不能被会话代次变更吞掉", async () => {
  const item = secureItem(token), v = makeSecureVault(item);
  const s = new Session(v, transport(async (path) => path === "/me" ? account : undefined));
  await s.restore(); await s.confirmDraftAccess();
  item.state.failRemove = true;
  await assert.rejects(s.logout(), (e: unknown) => e instanceof ApiError && e.code === "storage");
  assert.equal(s.snapshot().phase, "guest");
  const reopened = new Session(makeSecureVault(item), networkDown);
  await reopened.restore();
  assert.equal(reopened.snapshot().drafts.owner, null);
});

test("草稿授权：切换账号及原账号重登均不自动恢复；只确认当前账号", async () => {
  const item = secureItem(), v = makeSecureVault(item);
  let active = account;
  const s = new Session(v, transport(async (path) => {
    if (path === "/me") return active;
    if (path.endsWith("logout")) return;
    return { ...response, account: active };
  }));
  await s.restore();
  await s.signIn("login", "a@example.test", "password"); await s.confirmDraftAccess();
  await s.logout();
  active = { ...account, id: "22222222-2222-4222-8222-222222222222" };
  await s.signIn("login", "b@example.test", "password");
  assert.deepEqual(s.snapshot().drafts, { phase: "confirmation", owner: active.id });
  await s.confirmDraftAccess();
  const reopened = new Session(makeSecureVault(item), networkDown);
  await reopened.restore();
  assert.equal(reopened.snapshot().drafts.owner, active.id);
  await s.logout(); active = account;
  await s.signIn("login", "a@example.test", "password");
  assert.equal(s.snapshot().drafts.phase, "confirmation");
});

test("草稿授权：另一令牌不能复用或确认原绑定，损坏存储也不能退回自动授权", async () => {
  const item = secureItem(token), v = makeSecureVault(item);
  await v.drafts.bind(token, account.id); await v.drafts.confirm(token, account.id);
  const otherToken = "tako_app_" + "b".repeat(64);
  await v.set(otherToken);
  await assert.rejects(v.drafts.read(token));
  await assert.rejects(v.drafts.confirm(otherToken, account.id));
  assert.equal(await v.drafts.read(otherToken), null);
  await item.set('{"format":1,"token":"broken"}');
  const s = new Session(makeSecureVault(item), networkDown);
  await s.restore();
  assert.equal(s.snapshot().drafts.owner, null);
});

test("草稿授权：确认写失败不产生持久许可；迟到确认响应不能越过 401 锁定", async () => {
  const item = secureItem(token), v = makeSecureVault(item);
  let finishConfirm: (value: unknown) => void = () => {};
  let deny: (error: unknown) => void = () => {};
  let deferConfirmation = false;
  const s = new Session(v, transport(async (path) => {
    if (path === "/private") return new Promise((_, reject) => { deny = reject; });
    if (deferConfirmation) return new Promise(resolve => { finishConfirm = resolve; });
    return account;
  }));
  await s.restore();
  item.state.failSet = true;
  await assert.rejects(s.confirmDraftAccess());
  assert.equal(s.snapshot().drafts.owner, null);
  item.state.failSet = false;
  const privateRequest = s.authorized("/private");
  const privateDenied = assert.rejects(privateRequest);
  deferConfirmation = true;
  const confirming = s.confirmDraftAccess();
  const confirmDenied = assert.rejects(confirming);
  deny(new ApiError("authentication_required", "", 401));
  await privateDenied;
  finishConfirm(account);
  await confirmDenied;
  assert.equal(s.snapshot().drafts.owner, null);
  const reopened = new Session(makeSecureVault(item), networkDown);
  await reopened.restore();
  assert.equal(reopened.snapshot().drafts.owner, null);
});


test("草稿授权：注销端点确认 401 时按已失效清理，而非保留在线账号", async () => {
  const item = secureItem(token), v = makeSecureVault(item);
  const s = new Session(v, transport(async (path) => {
    if (path === "/me") return account;
    throw new ApiError("authentication_required", "", 401);
  }));
  await s.restore(); await s.confirmDraftAccess();
  await s.logout();
  assert.equal(s.snapshot().phase, "guest");
  assert.equal(s.snapshot().drafts.owner, null);
  assert.equal(await v.get(), null);
});
