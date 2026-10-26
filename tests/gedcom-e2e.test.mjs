import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * GEDCOM 端到端测试：构建真实 Go 二进制（内嵌静态前端），连接临时数据库，
 * 走完整 HTTP 流程。没有 PostgreSQL 时跳过，避免在无数据库环境下误报失败。
 */

const SAMPLE = `0 HEAD
1 SOUR pure-genealogy
1 GEDC
2 VERS 5.5.1
2 FORM LINEAGE-LINKED
1 CHAR UTF-8
0 @I1@ INDI
1 NAME 刘/守仁/
1 SEX M
1 BIRT
2 DATE 12 MAR 1900
2 PLAC 山东济南
1 DEAT
2 DATE ABT 1975
1 OCCU 私塾先生
1 NOTE 勤俭持家。
0 @I2@ INDI
1 NAME 刘/建国/
1 SEX M
1 BIRT
2 DATE 1950
0 @I3@ INDI
1 NAME 刘/小明/
1 SEX M
1 BIRT
2 DATE 12 OCT 1978
0 @F1@ FAM
1 HUSB @I1@
1 CHIL @I2@
0 @F2@ FAM
1 HUSB @I2@
1 CHIL @I3@
0 TRLR
`;

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

test("GEDCOM 导入导出端到端", { skip: enabled ? false : "设置 GENEALOGY_E2E=1 与 DATABASE_URL 后运行" }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "genealogy-gedcom-"));
  const binary = join(directory, "genealogy-server");
  const port = await freePort();
  let child;
  let serviceLog = "";
  try {
    execFileSync("go", ["build", "-o", binary, "./cmd/server"], {
      cwd: resolve("backend"),
      env: { ...process.env, CGO_ENABLED: "0" },
      stdio: "pipe",
    });
    child = spawn(binary, ["serve"], {
      env: {
        ...process.env,
        API_HOST: "127.0.0.1",
        API_PORT: String(port),
        APP_ORIGIN: `http://127.0.0.1:${port}`,
        PUBLIC_BASE_URL: `http://127.0.0.1:${port}`,
        FAMILY_SURNAME: "刘",
        ALLOW_SIGNUP: "true",
        BCRYPT_COST: "4",
        LOG_LEVEL: "info",
      },
      stdio: "pipe",
    });
    child.stdout.on("data", (data) => { serviceLog += data; });
    child.stderr.on("data", (data) => { serviceLog += data; });

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
        // 等待启动。
      }
      if (child.exitCode !== null) break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 200));
    }
    assert.ok(started, `Go 服务未能启动：\n${serviceLog}`);

  const base = `http://127.0.0.1:${port}`;
  let cookie = "";
  const call = async (path, init = {}) => {
    const headers = new Headers(init.headers);
    if (cookie) headers.set("cookie", cookie);
    headers.set("origin", `http://127.0.0.1:${port}`);
    const response = await fetch(`${base}${path}`, { ...init, headers });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    return response;
  };

  const signup = await call("/api/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: `e2e-${Date.now()}@example.com`, password: "password123" }),
  });
  assert.equal(signup.status, 201, await signup.text());

  // 预览
  const preview = await call("/api/family-members/gedcom/preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: SAMPLE }),
  });
  assert.equal(preview.status, 200);
  const previewBody = await preview.json();
  assert.equal(previewBody.preview.members, 3);
  assert.equal(previewBody.preview.families, 2);
  assert.equal(previewBody.preview.with_father, 2);

  // 导入
  const imported = await call("/api/family-members/gedcom/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: SAMPLE, replace: false }),
  });
  assert.equal(imported.status, 200);
  assert.equal((await imported.json()).result.members, 3);

  const list = await (await call("/api/family-members?page=1&page_size=50")).json();
  assert.equal(list.count, 3);
  const byName = Object.fromEntries(list.data.map((member) => [member.name, member]));
  assert.equal(byName["刘守仁"].generation, 1);
  assert.equal(byName["刘建国"].generation, 2);
  assert.equal(byName["刘小明"].generation, 3);
  assert.equal(byName["刘建国"].father_name, "刘守仁");
  assert.equal(byName["刘小明"].father_name, "刘建国");
  assert.equal(byName["刘守仁"].birthday, "1900-03-12");
  assert.equal(byName["刘守仁"].birth_date_raw, "12 MAR 1900");
  assert.equal(byName["刘建国"].birth_date_raw, "1950");
  assert.equal(byName["刘建国"].birthday, null);
  assert.equal(byName["刘守仁"].is_alive, false);
  assert.equal(byName["刘守仁"].official_position, "私塾先生");

  // 导出
  const exported = await call("/api/family-members/gedcom");
  assert.equal(exported.status, 200);
  assert.match(exported.headers.get("content-type") ?? "", /gedcom/);
  assert.match(exported.headers.get("content-disposition") ?? "", /attachment/);
  const gedcom = await exported.text();
  assert.match(gedcom, /0 HEAD/);
  assert.match(gedcom, /1 NAME 刘建国/);
  assert.match(gedcom, /0 @F\d+@ FAM/);
  assert.match(gedcom, /\r\n/);

  // 导出的文件可以再次导入（replace 重建）
  const reimport = await call("/api/family-members/gedcom/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: gedcom, replace: true }),
  });
  assert.equal(reimport.status, 200);
  const afterReplace = await (await call("/api/family-members?page=1&page_size=50")).json();
  assert.equal(afterReplace.count, 3);
  const names = afterReplace.data.map((member) => member.name).sort();
  assert.deepEqual(names, ["刘守仁", "刘建国", "刘小明"].sort());

  // 原始 GEDCOM 文件（含 GBK）可直接上传
  const raw = await call("/api/family-members/gedcom/preview", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: SAMPLE,
  });
  assert.equal(raw.status, 200);

  // 非法文件给出中文错误
  const invalid = await call("/api/family-members/gedcom/preview", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "hello",
  });
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error, /层级|记录/);

  // 未登录不能导出
  const anonymous = await fetch(`${base}/api/family-members/gedcom`);
  assert.equal(anonymous.status, 401);

  await writeFile(join(directory, "exported.ged"), gedcom);
  assert.ok((await stat(join(directory, "exported.ged"))).size > 0);
  assert.ok((await readFile(join(directory, "exported.ged"), "utf8")).includes("0 TRLR"));
  } finally {
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      await once(child, "exit").catch(() => {});
    }
    await rm(directory, { recursive: true, force: true });
  }
});
