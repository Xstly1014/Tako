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
