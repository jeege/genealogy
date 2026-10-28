import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function member(overrides = {}) {
  return {
    id: 1,
    name: "刘一",
    generation: 1,
    sibling_order: null,
    father_id: null,
    father_name: null,
    gender: "男",
    official_position: null,
    is_alive: true,
    spouses: [],
    remarks: null,
    birthday: null,
    death_date: null,
    residence_place: null,
    updated_at: "2026-10-26T00:00:00Z",
    ...overrides,
  };
}

test("浏览器 API 客户端同源请求 /api，并保持认证错误可读", async () => {
  const client = loadTypeScript("src/lib/api/client.ts");
  const originalFetch = globalThis.fetch;
  try {
    const calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({ user: { id: 1, username: "张三" } });
    };
    // 用户名不限制字符：这里直接用中文用户名验证请求体字段名。
    const user = await client.login("张三", "password123");
    assert.equal(user.username, "张三");
    assert.equal(calls[0].url, "/api/auth/login");
    assert.equal(calls[0].init.credentials, "same-origin");
    assert.deepEqual(JSON.parse(calls[0].init.body), { username: "张三", password: "password123" });

    globalThis.fetch = async () => jsonResponse({ error: "用户名或密码错误" }, 401);
    await assert.rejects(client.login("张三", "bad"), /用户名或密码错误/);

    globalThis.fetch = async () => jsonResponse({ error: "请先登录" }, 401);
    assert.equal(await client.getSession(), null);

    globalThis.fetch = async () => { throw new Error("offline"); };
    await assert.rejects(client.logout(), /无法连接服务器/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("数据接口 401 会跳转登录页，认证接口不会", async () => {
  const client = loadTypeScript("src/lib/api/client.ts");
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const redirects = [];
  try {
    globalThis.window = { location: { assign: (url) => redirects.push(url) } };
    globalThis.fetch = async () => jsonResponse({ error: "登录已过期" }, 401);
    await assert.rejects(client.apiRequest("/family-members"), /登录已过期/);
    assert.deepEqual(redirects, ["/auth/login"]);

    await assert.rejects(client.apiRequest("/auth/session"), /登录已过期/);
    assert.equal(redirects.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("族谱数据层映射分页、CRUD、导入与统计接口", async () => {
  const calls = [];
  const family = loadTypeScript("src/lib/api/family.ts", {
    "./client": {
      apiRequest: async (path, init = {}) => {
        calls.push({ path, init });
        if (path.startsWith("/family-members?")) {
          return { data: [member()], count: 1, page: 1, page_size: 50 };
        }
        if (path === "/family-members/select") {
          return { data: [{ id: 1, name: "刘一", generation: 1 }] };
        }
        if (path === "/family-members/timeline") {
          return { data: [{ id: 1, name: "刘一", birthday: null, death_date: null, generation: 1 }] };
        }
        if (path === "/family-members/biography") {
          return { data: [{ ...member(), remarks: "生平" }] };
        }
        if (path === "/family-members/all") {
          return { data: [member()] };
        }
        if (path === "/statistics") {
          return { data: { totalMembers: 1, genderStats: [], generationStats: [], statusStats: [], ageStats: [], commonNames: [] } };
        }
        if (path === "/family-members/import/preview") {
          return { fathers: [{ source: "existing", id: 3 }] };
        }
        if (path === "/family-members/import") {
          return { success: true, count: 2 };
        }
        if (path.match(/^\/family-members\/\d+$/)) {
          return { data: member() };
        }
        return { data: member() };
      },
    },
  });

  const list = await family.fetchFamilyMembers(2, 50, "刘 一");
  assert.equal(list.error, null);
  assert.equal(list.count, 1);
  const listURL = new URL(calls[0].path, "http://app.test");
  assert.equal(listURL.pathname, "/family-members");
  assert.equal(listURL.searchParams.get("page"), "2");
  assert.equal(listURL.searchParams.get("page_size"), "50");
  assert.equal(listURL.searchParams.get("search"), "刘 一");

  assert.equal((await family.createFamilyMember({ name: "刘一", is_alive: true })).success, true);
  assert.equal(calls[1].path, "/family-members");
  assert.equal(calls[1].init.method, "POST");

  assert.equal((await family.updateFamilyMember({ id: 7, name: "刘二" })).success, true);
  assert.equal(calls[2].path, "/family-members/7");
  assert.equal(calls[2].init.method, "PUT");
  assert.deepEqual(JSON.parse(calls[2].init.body), { name: "刘二" });

  assert.equal((await family.deleteFamilyMembers([1, 2])).success, true);
  assert.deepEqual(JSON.parse(calls[3].init.body), { ids: [1, 2] });

  assert.equal((await family.fetchAllMembersForSelect()).data.length, 1);
  assert.equal((await family.fetchMemberById(1)).id, 1);
  assert.equal((await family.fetchAllFamilyMembers()).data.length, 1);
  assert.equal((await family.fetchMembersForTimeline()).data.length, 1);
  assert.equal((await family.fetchMembersWithBiography()).data[0].remarks, "生平");
  assert.equal((await family.fetchFamilyStatistics()).data.totalMembers, 1);

  const preview = await family.previewFamilyMembersImport([{ name: "子", generation: 2, father_name: "父" }]);
  assert.deepEqual(preview.fathers, [{ source: "existing", id: 3 }]);
  assert.deepEqual(JSON.parse(calls.at(-1).init.body), { members: [{ name: "子", generation: 2, father_name: "父" }] });

  const imported = await family.batchCreateFamilyMembers([{ name: "子" }]);
  assert.deepEqual(imported, { success: true, count: 2, error: null });
});

test("数据层把后端错误转换为页面可展示的结果", async () => {
  const family = loadTypeScript("src/lib/api/family.ts", {
    "./client": {
      apiRequest: async (path) => {
        if (path === "/statistics") throw new Error("统计失败");
        throw new Error("请求失败");
      },
    },
  });
  assert.deepEqual(await family.fetchFamilyMembers(), { data: [], count: 0, error: "请求失败" });
  assert.deepEqual(await family.fetchFamilyStatistics(), { data: null, error: "统计失败" });
  assert.deepEqual(await family.previewFamilyMembersImport([{ name: "甲" }]), { fathers: [], error: "请求失败" });
  assert.deepEqual(await family.batchCreateFamilyMembers([{ name: "甲" }]), { success: false, count: 0, error: "请求失败" });
  assert.equal(await family.fetchMemberById(1), null);
});

test("GEDCOM 导出下载使用服务端文件名并处理错误", async () => {
  const family = loadTypeScript("src/lib/api/family.ts", {
    "./client": { apiRequest: async () => ({}) },
  });
  const originalFetch = globalThis.fetch;
  const originalDocument = globalThis.document;
  const originalURL = globalThis.URL;
  const clicks = [];
  try {
    globalThis.document = {
      createElement: () => ({ click: () => clicks.push("click"), remove() {} }),
      body: { appendChild() {} },
    };
    const created = [];
    globalThis.URL = Object.assign(
      (input) => new originalURL(input),
      { createObjectURL: (blob) => { created.push(blob); return "blob:1"; }, revokeObjectURL() {} },
    );

    globalThis.fetch = async () => new Response("0 HEAD\n0 TRLR\n", {
      status: 200,
      headers: {
        "content-type": "text/vnd.familysearch.gedcom; charset=utf-8",
        "content-disposition": `attachment; filename="genealogy.ged"; filename*=UTF-8''${encodeURIComponent("刘家族-20261026.ged")}`,
      },
    });
    const result = await family.exportGEDCOM();
    assert.equal(result.error, null);
    assert.equal(clicks.length, 1);
    assert.equal(created.length, 1);

    globalThis.fetch = async () => jsonResponse({ error: "族谱为空，没有可导出的成员" }, 400);
    assert.deepEqual(await family.exportGEDCOM(), { error: "族谱为空，没有可导出的成员" });

    globalThis.fetch = async () => { throw new Error("offline"); };
    assert.match((await family.exportGEDCOM()).error, /导出失败/);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.URL = originalURL;
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

test("GEDCOM 预览与导入映射后端响应与错误", async () => {
  const calls = [];
  const family = loadTypeScript("src/lib/api/family.ts", {
    "./client": {
      apiRequest: async (path, init = {}) => {
        calls.push({ path, init });
        if (path.endsWith("/preview")) {
          return { preview: { members: 2, families: 1, encoding: "UTF-8", version: "5.5.1", warnings: [] } };
        }
        if (path.endsWith("/import")) {
          return { result: { members: 2, families: 1, warnings: ["提示"] } };
        }
        return {};
      },
    },
  });

  const preview = await family.previewGEDCOMImport("0 HEAD");
  assert.equal(preview.error, null);
  assert.equal(preview.preview.members, 2);
  assert.deepEqual(JSON.parse(calls[0].init.body), { content: "0 HEAD" });

  const imported = await family.importGEDCOM("0 HEAD", true);
  assert.equal(imported.result.members, 2);
  assert.deepEqual(JSON.parse(calls[1].init.body), { content: "0 HEAD", replace: true });

  const failing = loadTypeScript("src/lib/api/family.ts", {
    "./client": { apiRequest: async () => { throw new Error("解析失败"); } },
  });
  assert.deepEqual(await failing.previewGEDCOMImport("x"), { preview: null, error: "解析失败" });
  assert.deepEqual(await failing.importGEDCOM("x"), { result: null, error: "解析失败" });
});
