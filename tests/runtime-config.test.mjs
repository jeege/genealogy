import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

const runtime = loadTypeScript("src/lib/runtime-config.ts");

test("构建期只提供姓氏兜底，兼容两种环境变量名", () => {
  assert.equal(runtime.getPublicRuntimeConfig({ VITE_FAMILY_SURNAME: "张" }).familySurname, "张");
  assert.equal(runtime.getPublicRuntimeConfig({ FAMILY_SURNAME: "李" }).familySurname, "李");
  assert.deepEqual(runtime.getPublicRuntimeConfig({}), { familySurname: "刘" });
  // 返回对象只含姓氏，不泄漏其他构建变量。
  const config = runtime.getPublicRuntimeConfig({
    VITE_FAMILY_SURNAME: "王",
    DATABASE_URL: "postgres://secret",
  });
  assert.deepEqual(Object.keys(config), ["familySurname"]);
  assert.equal(config.familySurname, "王");
});
