import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

const runtime = loadTypeScript("lib/runtime-config.ts");

test("公开配置只包含姓氏，并按调用读取构建环境", () => {
  assert.equal(runtime.getPublicRuntimeConfig({ FAMILY_SURNAME: "张" }).familySurname, "张");
  assert.equal(runtime.getPublicRuntimeConfig({ NEXT_PUBLIC_FAMILY_SURNAME: "赵" }).familySurname, "赵");
  assert.deepEqual(runtime.getPublicRuntimeConfig({}), { familySurname: "刘" });
  const config = runtime.getPublicRuntimeConfig({
    FAMILY_SURNAME: "李",
    DATABASE_URL: "postgres://secret",
    NEXT_PUBLIC_FAMILY_SURNAME: "王",
  });
  assert.deepEqual(Object.keys(config), ["familySurname"]);
  assert.equal(config.familySurname, "李");
});
