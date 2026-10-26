import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnvFiles, parseEnv } from "../scripts/run-backend.mjs";

test("解析 dotenv 注释、引号与布尔文本", () => {
  assert.deepEqual(parseEnv(`
# 注释
DATABASE_URL="postgres://user:pass@localhost:5432/db?sslmode=disable"
FAMILY_SURNAME='刘'
ALLOW_SIGNUP=true
INVALID-KEY=ignored
EMPTY=
`), {
    DATABASE_URL: "postgres://user:pass@localhost:5432/db?sslmode=disable",
    FAMILY_SURNAME: "刘",
    ALLOW_SIGNUP: "true",
    EMPTY: "",
  });
});

test("加载 .env 与 .env.local，后者覆盖前者且进程环境优先", async () => {
  const directory = await mkdtemp(join(tmpdir(), "genealogy-env-"));
  try {
    await writeFile(join(directory, ".env"), "A=base\nB=base\nC=base\n");
    await writeFile(join(directory, ".env.local"), "B=local\nC=local\nD=local\n");
    const env = { C: "process" };
    await loadEnvFiles(directory, env);
    assert.deepEqual(env, { A: "base", B: "local", C: "process", D: "local" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
