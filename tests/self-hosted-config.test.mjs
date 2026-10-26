import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateSecrets, validateSiteUrl, writeConfiguration } from "../scripts/setup-self-hosted.mjs";

function parseEnv(content) {
  return Object.fromEntries(content.split("\n").filter((line) => line && !line.startsWith("#")).map((line) => {
    const position = line.indexOf("=");
    return [line.slice(0, position), JSON.parse(line.slice(position + 1))];
  }));
}

test("生成的数据库口令随机且适合放入连接串", () => {
  const first = generateSecrets();
  const second = generateSecrets();
  assert.match(first.postgresPassword, /^[a-f0-9]{64}$/);
  assert.notEqual(first.postgresPassword, second.postgresPassword);
  assert.match(first.adminPassword, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(first.adminPassword, second.adminPassword);
});

test("站点地址拒绝数据库串、凭据、路径与查询参数", () => {
  for (const url of [undefined, "", "postgres://db:5432/postgres", "ftp://example.com", "https://user:pass@example.com", "https://example.com/path", "https://example.com/?secret=a", "https://example.com/#hash"]) {
    assert.throws(() => validateSiteUrl(url));
  }
  assert.equal(validateSiteUrl("http://localhost:3000/"), "http://localhost:3000");
  assert.equal(validateSiteUrl("https://族谱.example"), "https://xn--9fv776f.example");
});

test("配置包含 DATABASE_URL 与初始管理员，权限 0600 且拒绝覆盖", async () => {
  const directory = await mkdtemp(join(tmpdir(), "genealogy-config-"));
  const output = join(directory, ".env.self-hosted");
  try {
    const result = await writeConfiguration({
      siteUrl: "http://localhost:3000",
      surname: "刘",
      adminEmail: "admin@example.com",
      output,
    });
    assert.equal(result.output, output);
    assert.equal((await stat(output)).mode & 0o777, 0o600);
    const original = await readFile(output, "utf8");
    const env = parseEnv(original);
    assert.equal(env.SITE_URL, "http://localhost:3000");
    assert.equal(env.POSTGRES_DB, "genealogy");
    assert.equal(env.DATABASE_URL, `postgres://genealogy:${env.POSTGRES_PASSWORD}@db:5432/genealogy?sslmode=disable`);
    assert.equal(env.ALLOW_SIGNUP, "false");
    assert.equal(env.ADMIN_EMAIL, "admin@example.com");
    assert.equal(env.ADMIN_PASSWORD, result.adminPassword);
    assert.ok([...result.adminPassword].length >= 8);
    assert.equal(env.SESSION_TTL, "720h");
    assert.equal(env.COOKIE_SECURE, "auto");
    assert.equal(env.FAMILY_SURNAME, "刘");
    assert.equal(env.APP_PORT, "3000");
    assert.equal(env.GENEALOGY_IMAGE, "ghcr.io/jeege/genealogy:latest");
        assert.equal(env.SUPABASE_INTERNAL_URL, undefined);
    assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, undefined);
    assert.equal(env.ANON_KEY, undefined);
    await assert.rejects(writeConfiguration({ siteUrl: "http://localhost:3000", output }), { code: "EEXIST" });
    assert.equal(await readFile(output, "utf8"), original);
    await assert.rejects(writeConfiguration({ siteUrl: "postgres://localhost", output: join(directory, "b") }));
    await assert.rejects(writeConfiguration({ siteUrl: "http://localhost:3000", adminEmail: "bad-email", output: join(directory, "c") }), /邮箱/);
    await assert.rejects(writeConfiguration({ siteUrl: "http://localhost:3000", adminEmail: "a@b.c", adminPassword: "short", output: join(directory, "d") }), /密码/);
    await assert.rejects(writeConfiguration({ siteUrl: "http://localhost:3000", surname: '刘"\n', output: join(directory, "e") }), /姓氏/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("未提供管理员邮箱时不写入管理员密码", async () => {
  const directory = await mkdtemp(join(tmpdir(), "genealogy-config-"));
  const output = join(directory, ".env.self-hosted");
  try {
    const result = await writeConfiguration({ siteUrl: "https://genealogy.example", output });
    const env = parseEnv(await readFile(output, "utf8"));
    assert.equal(env.ADMIN_EMAIL, "");
    assert.equal(env.ADMIN_PASSWORD, "");
    assert.equal(result.adminPassword, "");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
