import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * 配偶关系端到端测试：真实 Go 二进制 + 真实 PostgreSQL 协议。
 * 默认跳过；设置 GENEALOGY_E2E=1 与 DATABASE_URL 后运行。
 * 该测试专门覆盖 SQL 语句本身（单元测试的假仓库无法发现 SQL 错误）。
 */

async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  const closed = once(server, "close");
  server.close();
  await closed;
  return port;
}

function canRun() {
  if (process.env.GENEALOGY_E2E !== "1") return false;
  if (!process.env.DATABASE_URL) return false;
  try {
    execFileSync("go", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const enabled = canRun();

test("配偶关系维护端到端", { skip: enabled ? false : "设置 GENEALOGY_E2E=1 与 DATABASE_URL 后运行" }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "genealogy-spouse-"));
  const binary = join(directory, "genealogy-server");
  const port = await freePort();
  let serverProcess;
  let log = "";

  try {
    execFileSync("go", ["build", "-o", binary, "./cmd/server"], {
      cwd: resolve("backend"),
      env: { ...process.env, CGO_ENABLED: "0" },
      stdio: "pipe",
    });
    serverProcess = spawn(binary, ["serve"], {
      env: {
        ...process.env,
        API_HOST: "127.0.0.1",
        API_PORT: String(port),
        APP_ORIGIN: `http://127.0.0.1:${port}`,
        PUBLIC_BASE_URL: `http://127.0.0.1:${port}`,
        FAMILY_SURNAME: "刘",
        ALLOW_SIGNUP: "true",
        BCRYPT_COST: "4",
        LOG_LEVEL: "error",
      },
      stdio: "pipe",
    });
    serverProcess.stdout.on("data", (data) => { log += data; });
    serverProcess.stderr.on("data", (data) => { log += data; });

    let started = false;
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/health`);
        if (response.ok) {
          started = true;
          break;
        }
      } catch {
        // 等待服务启动。
      }
      if (serverProcess.exitCode !== null) break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 200));
    }
    assert.ok(started, `Go 服务未能启动：\n${log}`);

    const base = `http://127.0.0.1:${port}`;
    let cookie = "";
    const call = async (path, init = {}) => {
      const headers = new Headers(init.headers);
      if (cookie) headers.set("cookie", cookie);
      headers.set("origin", base);
      const response = await fetch(`${base}${path}`, { ...init, headers });
      const setCookie = response.headers.get("set-cookie");
      if (setCookie) cookie = setCookie.split(";")[0];
      return response;
    };
    const json = (body, method = "POST") => ({
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const readJSON = async (response) => {
      const text = await response.text();
      assert.ok(response.status < 500, `服务端错误 ${response.status}: ${text}`);
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`响应不是 JSON（${response.status}）：${text}`);
      }
    };
    const createMember = async (body) => {
      const response = await call("/api/family-members", json(body));
      const payload = await readJSON(response);
      assert.equal(response.status, 201, JSON.stringify(payload));
      return payload.data;
    };

    const signup = await call("/api/auth/signup", json({
      email: `spouse-${Date.now()}@example.com`, password: "password123",
    }));
    assert.equal(signup.status, 201, JSON.stringify(await readJSON(signup)));

    const husband = await createMember({ name: "刘守仁", gender: "男", generation: 1 });
    const wife1 = await createMember({ name: "王秀英", gender: "女", generation: 1 });
    const wife2 = await createMember({ name: "李淑贞", gender: "女", generation: 1 });
    const child = await createMember({ name: "刘建国", gender: "男", generation: 2, father_id: husband.id });

    // 新增婚姻
    const first = await call("/api/marriages", json({
      husband_id: husband.id, wife_id: wife1.id, married_on: "1950-05-01",
    }));
    const firstBody = await readJSON(first);
    assert.equal(first.status, 201, JSON.stringify(firstBody));
    const marriage = firstBody.data;
    assert.equal(marriage.husband_name, "刘守仁");
    assert.equal(marriage.wife_name, "王秀英");

    // 更新为离异（覆盖 UPDATE 语句的参数类型推断）
    const updated = await call(`/api/marriages/${marriage.id}`, json({
      husband_id: husband.id, wife_id: wife1.id, status: "divorced",
      married_on: "1950-05-01", divorced_on: "1978-06-01",
    }, "PUT"));
    const updatedPayload = await readJSON(updated);
    assert.equal(updated.status, 200, JSON.stringify(updatedPayload));
    const updatedBody = updatedPayload.data;
    assert.equal(updatedBody.status, "divorced");
    assert.equal(updatedBody.divorced_on, "1978-06-01");

    // 只改日期应清空原始文本；重复提交相同日期保留
    await call(`/api/marriages/${marriage.id}`, json({
      husband_id: husband.id, wife_id: wife1.id, married_on: "1949-01-01",
    }, "PUT"));
    // 没有单条读取接口时用成员列表验证
    const listAfter = await (await call(`/api/family-members?page=1&page_size=50`)).json();
    const husbandRow = listAfter.data.find((item) => item.id === husband.id);
    assert.equal(husbandRow.spouses.length, 1);
    assert.equal(husbandRow.spouses[0].name, "王秀英");

    // 第二段婚姻
    const second = await call("/api/marriages", json({
      husband_id: husband.id, wife_id: wife2.id, status: "widowed",
    }));
    const secondPayload = await readJSON(second);
    assert.equal(second.status, 201, JSON.stringify(secondPayload));

    // 重复配对应 400
    const duplicate = await call("/api/marriages", json({
      husband_id: husband.id, wife_id: wife1.id,
    }));
    assert.equal(duplicate.status, 400);

    // 自配偶与日期颠倒
    assert.equal((await call("/api/marriages", json({
      husband_id: husband.id, wife_id: husband.id,
    }))).status, 400);
    assert.equal((await call("/api/marriages", json({
      husband_id: husband.id, wife_id: wife2.id,
      married_on: "2010-01-01", divorced_on: "2000-01-01",
    }))).status, 400);

    // 成员列表双向摘要
    const list = await (await call("/api/family-members?page=1&page_size=50")).json();
    const byName = Object.fromEntries(list.data.map((item) => [item.name, item]));
    assert.equal(byName["刘守仁"].spouses.length, 2);
    assert.equal(byName["王秀英"].spouses[0].name, "刘守仁");
    assert.equal(byName["李淑贞"].spouses[0].status, "widowed");

    // 成员更新提交 spouse_ids：替换配偶集合
    const replaced = await call(`/api/family-members/${child.id}`, json({
      name: "刘建国", gender: "男", generation: 2, father_id: husband.id,
      spouse_ids: [wife2.id],
    }, "PUT"));
    const replacedPayload = await readJSON(replaced);
    assert.equal(replaced.status, 200, JSON.stringify(replacedPayload));
    const replacedBody = replacedPayload.data;
    assert.equal(replacedBody.spouses.length, 1);
    assert.equal(replacedBody.spouses[0].name, "李淑贞");

    // 不传 spouse_ids 不应改变婚姻
    const untouched = await call(`/api/family-members/${child.id}`, json({
      name: "刘建国", gender: "男", generation: 2, father_id: husband.id,
    }, "PUT"));
    const untouchedBody = (await readJSON(untouched)).data;
    assert.equal(untouchedBody.spouses.length, 1);

    // GEDCOM 导出应包含 WIFE 与 MARR
    const gedcom = await call("/api/family-members/gedcom");
    assert.equal(gedcom.status, 200);
    const text = await gedcom.text();
    assert.match(text, /1 WIFE @I\d+@/);
    assert.match(text, /1 MARR/);

    // 解除配偶关系应返回 204
    const secondBody = secondPayload;
    const removed = await call(`/api/marriages/${secondBody.data.id}`, { method: "DELETE" });
    assert.equal(removed.status, 204);

    // 删除成员应级联删除其婚姻
    const deleteChild = await call("/api/family-members", json({ ids: [child.id] }, "DELETE"));
    assert.equal(deleteChild.status, 200, JSON.stringify(await readJSON(deleteChild)));
    const listFinal = await (await call("/api/family-members?page=1&page_size=50")).json();
    const wifeRow = listFinal.data.find((item) => item.id === wife2.id);
    assert.equal(wifeRow.spouses.length, 0);
  } finally {
    if (serverProcess && serverProcess.exitCode === null) {
      serverProcess.kill("SIGTERM");
      await once(serverProcess, "exit").catch(() => {});
    }
    await rm(directory, { recursive: true, force: true });
  }
});
