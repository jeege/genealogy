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
    spouse: null,
    remarks: null,
    birthday: null,
    death_date: null,
    residence_place: null,
    updated_at: "2026-10-26T00:00:00Z",
    ...overrides,
  };
}

test("浏览器 API 客户端同源请求 /api，并保持认证错误可读", async () => {
  const client = loadTypeScript("lib/api/client.ts");
  const originalFetch = globalThis.fetch;
  try {
    const calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({ user: { id: 1, email: "a@example.com" } });
    };
    const user = await client.login("a@example.com", "password123");
    assert.equal(user.email, "a@example.com");
    assert.equal(calls[0].url, "/api/auth/login");
    assert.equal(calls[0].init.credentials, "same-origin");
    assert.deepEqual(JSON.parse(calls[0].init.body), { email: "a@example.com", password: "password123" });

    globalThis.fetch = async () => jsonResponse({ error: "邮箱或密码错误" }, 401);
    await assert.rejects(client.login("a@example.com", "bad"), /邮箱或密码错误/);

    globalThis.fetch = async () => jsonResponse({ error: "请先登录" }, 401);
    assert.equal(await client.getSession(), null);

    globalThis.fetch = async () => { throw new Error("offline"); };
    await assert.rejects(client.logout(), /无法连接服务器/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("数据接口 401 会跳转登录页，认证接口不会", async () => {
  const client = loadTypeScript("lib/api/client.ts");
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const redirects = [];
  try {
    globalThis.window = { location: { assign: (url) => redirects.push(url) } };
    globalThis.fetch = async () => jsonResponse({ error: "登录已过期" }, 401);
    await assert.rejects(client.apiRequest("/family-members"), /登录已过期/);
    assert.deepEqual(redirects, ["/auth/login/"]);

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
  const family = loadTypeScript("lib/api/family.ts", {
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
  const family = loadTypeScript("lib/api/family.ts", {
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
