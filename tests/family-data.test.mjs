import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

function members(size) {
  // 刻意打乱 ID，所有业务排序字段相同，只有最后的 ID 可以稳定排序。
  return Array.from({ length: size }, (_, i) => ({
    id: size - i, name: "刘同名", generation: 2, sibling_order: 1,
    father_id: null, gender: i % 3 === 0 ? null : i % 2 ? "男" : "女",
    is_alive: true, birthday: "2000-01-01", death_date: null,
    remarks: "生平", spouse: null, official_position: null, residence_place: null,
  }));
}

function setup(rows, options = {}) {
  const calls = [];
  const supabase = {
    from(table) {
      assert.equal(table, "family_members");
      const filters = [], orders = [];
      let columns, countMode, range;
      let executed = false;
      const query = {
        select(value, config) { columns = value; countMode = config?.count; return query; },
        order(field, config) { orders.push([field, config?.ascending !== false]); return query; },
        range(from, to) { range = [from, to]; return query; },
        in(field, values) { filters.push(row => values.includes(row[field])); query.ids = values; return query; },
        not(field, operator, value) { assert.equal(operator, "is"); filters.push(row => row[field] !== value); return query; },
        neq(field, value) { filters.push(row => row[field] !== value); return query; },
        ilike(field, value) { filters.push(row => row[field].includes(value.slice(1, -1))); return query; },
        then(resolve, reject) {
          return Promise.resolve().then(() => {
            assert.equal(executed, false, "每一页必须创建新 builder");
            executed = true;
            const call = { columns, countMode, range, orders, ids: query.ids };
            calls.push(call);
            let found = rows.filter(row => filters.every(filter => filter(row)));
            found = found.slice().sort((a, b) => {
              for (const [field, ascending] of orders) {
                if (a[field] === b[field]) continue;
                const delta = a[field] == null ? 1 : b[field] == null ? -1 : a[field] < b[field] ? -1 : 1;
                return ascending ? delta : -delta;
              }
              // 无唯一排序时模拟数据库合法但不同的并列行顺序。
              return calls.length % 2 ? a.id - b.id : b.id - a.id;
            });
            const count = found.length;
            let data = (range ? found.slice(range[0], range[1] + 1) : found).slice(0, options.limit ?? 1000);
            if (columns !== "*") data = data.map(row => Object.fromEntries(columns.split(",").map(key => [key.trim(), row[key.trim()]])));
            const response = { data, count: countMode === "exact" ? count : null, error: null };
            return options.respond ? options.respond(response, call, calls.length) : response;
          }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  const pager = loadTypeScript("lib/supabase/fetch-all-rows.ts");
  const names = loadTypeScript("app/family-tree/member-queries.ts", { "@/lib/supabase/fetch-all-rows": pager });
  const mocks = {
    "@/lib/supabase/server": { createClient: async () => supabase },
    "@/lib/supabase/fetch-all-rows": pager,
    "../member-queries": names, "./member-queries": names,
    "./member-import": loadTypeScript("app/family-tree/member-import.ts"),
    "next/cache": { revalidatePath() {} },
  };
  return {
    calls, supabase, pager, names,
    graph: loadTypeScript("app/family-tree/graph/actions.ts", mocks),
    statistics: loadTypeScript("app/family-tree/statistics/actions.ts", mocks),
    actions: loadTypeScript("app/family-tree/actions.ts", mocks),
    biography: loadTypeScript("app/family-tree/biography-book/actions.ts", mocks),
  };
}

for (const size of [0, 1000, 1400, 5000]) {
  test(`${size} 人的图谱、全部统计、父亲选项和时间轴完整且稳定`, async () => {
    const db = setup(members(size));
    const graph = await db.graph.fetchAllFamilyMembers();
    assert.equal(graph.error, null);
    assert.equal(graph.data.length, size);
    assert.equal(new Set(graph.data.map(row => row.id)).size, size);
    assert.deepEqual(graph.data.map(row => row.id), Array.from({ length: size }, (_, i) => i + 1));
    const statistics = await db.statistics.fetchFamilyStatistics();
    assert.equal(statistics.error, null);
    assert.equal(statistics.data.totalMembers, size);
    for (const key of ["genderStats", "generationStats", "statusStats", "ageStats"]) {
      assert.equal(statistics.data[key].reduce((n, item) => n + item.value, 0), size);
    }
    assert.equal(statistics.data.commonNames.reduce((n, item) => n + item.count, 0), size);
    for (const fetch of [db.actions.fetchAllMembersForSelect, db.actions.fetchMembersForTimeline]) {
      const result = await fetch();
      assert.equal(result.error, null);
      assert.equal(result.data.length, size);
      assert.deepEqual(result.data.map(row => row.id), graph.data.map(row => row.id));
    }
    assert.ok(db.calls.every(call => call.countMode === "exact"));
    assert.ok(db.calls.every(call => call.orders.at(-1)[0] === "id"));
    assert.ok(db.calls.every(call => call.range[1] - call.range[0] === 499));
  });
}

test("服务端上限 37 时按实际返回数量推进", async () => {
  const db = setup(members(1400), { limit: 37 });
  const result = await db.graph.fetchAllFamilyMembers();
  assert.equal(result.error, null);
  assert.equal(result.data.length, 1400);
  assert.deepEqual(db.calls.slice(0, 3).map(call => call.range), [[0, 499], [37, 536], [74, 573]]);
});

for (const [label, modify] of [
  ["后续数据库错误", response => ({ ...response, data: null, error: { message: "数据库失败" } })],
  ["后续网络异常", () => { throw new Error("网络中断"); }],
  ["缺失 count", response => ({ ...response, count: null })],
  ["非法 count", response => ({ ...response, count: -1 })],
  ["小数 count", response => ({ ...response, count: 1.5 })],
  ["无限 count", response => ({ ...response, count: Infinity })],
  ["提前空页", response => ({ ...response, data: [] })],
  ["data 为 null", response => ({ ...response, data: null })],
  ["重复 ID", response => ({ ...response, data: [{ ...response.data[0], id: 1 }, ...response.data.slice(1)] })],
  ["count 改变", response => ({ ...response, count: response.count + 1 })],
]) {
  test(`${label} 不得泄漏部分数据，所有全量 Action 显式失败`, async () => {
    for (const action of ["graph", "statistics", "select", "timeline", "biography"]) {
      const db = setup(members(1400), { respond: (response, call, index) => index === 2 ? modify(response) : response });
      const result = await ({ graph: db.graph.fetchAllFamilyMembers, statistics: db.statistics.fetchFamilyStatistics,
        select: db.actions.fetchAllMembersForSelect, timeline: db.actions.fetchMembersForTimeline,
        biography: db.biography.fetchMembersWithBiography })[action]();
      assert.ok(result.error, action);
      assert.deepEqual(result.data, action === "statistics" ? null : [], action);
    }
  });
}

test("累计超出 count 或页内重复 ID 时分页器失败", async () => {
  const { pager } = setup([]);
  for (const page of [
    { data: [{ id: 1 }, { id: 2 }], count: 1, error: null },
    { data: [{ id: 1 }, { id: 1 }], count: 2, error: null },
  ]) {
    const result = await pager.fetchAllRows(async () => page);
    assert.deepEqual(result.data, []);
    assert.ok(result.error);
  }
});

test("超过千条生平完整返回，空生平被过滤，跨页无生平父亲可解析", async () => {
  const rows = members(1400);
  rows.forEach(row => { row.father_id = row.id + 2000; });
  rows.push(...members(1400).map(row => ({ ...row, id: row.id + 2000, name: `父亲${row.id}`, remarks: null })));
  rows.push({ ...rows[0], id: 9999, remarks: '[{"children":[{"text":"  "}]}]' }, { ...rows[0], id: 9998, remarks: "" });
  const db = setup(rows, { limit: 37 });
  const result = await db.biography.fetchMembersWithBiography();
  assert.equal(result.error, null);
  assert.equal(result.data.length, 1400);
  assert.ok(result.data.every(row => row.father_name === `父亲${row.id}`));
  const names = db.calls.filter(call => call.ids);
  assert.ok(names.every(call => call.ids.length <= 100 && new Set(call.ids).size === call.ids.length));
  assert.ok(names.every(call => call.orders.at(-1)[0] === "id" && call.countMode === "exact"));
});

test("姓名工具去重、分批并完整分页，空 ID 不请求数据库", async () => {
  const db = setup(members(251), { limit: 37 });
  assert.deepEqual(await db.names.fetchMemberNamesByIds(db.supabase, []), { data: [], error: null });
  assert.equal(db.calls.length, 0);
  const result = await db.names.fetchMemberNamesByIds(db.supabase, [...members(251).map(row => row.id), 1, 2]);
  assert.equal(result.error, null);
  assert.equal(result.data.length, 251);
  assert.equal(new Set(result.data.map(row => row.id)).size, 251);
  assert.deepEqual([...new Set(db.calls.map(call => call.ids))].map(ids => ids.length), [100, 100, 51]);
});

for (const action of ["list", "biography"]) {
  test(`${action} 父亲姓名查询失败向上传递，不伪装成未记录`, async () => {
    const rows = members(50).map(row => ({ ...row, father_id: row.id }));
    const db = setup(rows, { respond: (response, call) => call.ids ? { ...response, data: null, error: { message: "父亲姓名失败" } } : response });
    const result = await (action === "list" ? db.actions.fetchFamilyMembers() : db.biography.fetchMembersWithBiography());
    assert.match(result.error, /父亲姓名失败/);
    assert.deepEqual(result.data, []);
  });
}

test("列表排序以 ID 结尾且所有跨页父亲姓名可用", async () => {
  const rows = members(1400).map(row => ({ ...row, father_id: row.id }));
  const db = setup(rows, {
    respond: (response, call) => call.ids ? { ...response, data: response.data.slice(0, 37) } : response,
  });
  const result = await db.actions.fetchFamilyMembers(1, 1000);
  assert.equal(result.error, null);
  assert.equal(result.data.length, 1000);
  assert.ok(result.data.every(row => row.father_name === "刘同名"));
  assert.ok(db.calls.some(call => call.ids && call.range[0] === 37));
  assert.equal(db.calls[0].orders.at(-1)[0], "id");
});

function walk(node) {
  if (!node || typeof node !== "object") return [];
  return [node, ...[node.props?.children].flat(Infinity).flatMap(walk)];
}

// 用可控 hooks 驱动真实组件的弹窗生命周期，不依赖 DOM 或新增测试库。
function parentDialogHarness() {
  const states = [], effects = [], pending = [];
  let cursor, effectCursor;
  const react = {
    useState(initial) {
      const slot = cursor++;
      if (!(slot in states)) states[slot] = initial;
      return [states[slot], value => { states[slot] = typeof value === "function" ? value(states[slot]) : value; }];
    },
    useTransition: () => [false, callback => callback()],
    useEffect(callback, dependencies) {
      const slot = effectCursor++;
      if (!effects[slot] || dependencies.some((value, index) => value !== effects[slot].dependencies[index])) {
        effects[slot]?.cleanup?.();
        effects[slot] = { dependencies, callback };
        pending.push(slot);
      }
    },
  };
  const requests = [];
  const mocks = {
    react,
    "next/navigation": { useRouter: () => ({}), useSearchParams: () => new URLSearchParams() },
    "./actions": {
      fetchAllMembersForSelect: () => new Promise((resolve, reject) => requests.push({ resolve, reject })),
    },
    "@/lib/utils": { cn: (...values) => values.filter(Boolean).join(" ") },
  };
  for (const [module, exports] of [
    ["@/components/ui/table", "Table TableBody TableCell TableHead TableHeader TableRow"],
    ["@/components/ui/button", "Button"], ["@/components/ui/input", "Input"],
    ["@/components/ui/checkbox", "Checkbox"], ["@/components/ui/label", "Label"],
    ["@/components/ui/dialog", "Dialog DialogContent DialogDescription DialogFooter DialogHeader DialogTitle"],
    ["@/components/ui/select", "Select SelectContent SelectItem SelectTrigger SelectValue"],
    ["lucide-react", "Plus Trash2 Search ChevronLeft ChevronRight Loader2"],
    ["./import-members-dialog", "ImportMembersDialog"], ["./father-combobox", "FatherCombobox"],
    ["@/components/rich-text/editor", "RichTextEditor"], ["@/components/rich-text/viewer", "RichTextViewer"],
  ]) mocks[module] = Object.fromEntries(exports.split(" ").map(name => [name, name]));
  const { FamilyMembersTable } = loadTypeScript("app/family-tree/family-members-table.tsx", mocks);
  const render = () => {
    cursor = 0; effectCursor = 0;
    const tree = FamilyMembersTable({ initialData: [], totalCount: 0, currentPage: 1, pageSize: 50, searchQuery: "" });
    for (const slot of pending.splice(0)) effects[slot].cleanup = effects[slot].callback();
    return walk(tree);
  };
  return {
    requests, render,
    open: () => { render().find(node => node.type === "Button" && [node.props.children].flat().includes("新增")).props.onClick(); render(); },
    close: () => { render().find(node => node.type === "Dialog").props.onOpenChange(false); render(); },
  };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

for (const mode of ["error", "reject"]) {
  test(`父亲下拉 ${mode} 显示错误、清空并禁用；重新打开可重试`, async () => {
    const ui = parentDialogHarness();
    ui.open();
    assert.equal(ui.requests.length, 1);
    if (mode === "error") ui.requests[0].resolve({ data: [{ id: 1, name: "不可显示" }], error: "分页失败" });
    else ui.requests[0].reject(new Error("网络失败"));
    await settle();
    let view = ui.render();
    assert.ok(view.find(node => node.props?.role === "alert"));
    let combobox = view.find(node => node.type === "FatherCombobox");
    assert.equal(combobox.props.disabled, true);
    assert.deepEqual(combobox.props.options, []);
    ui.close(); ui.open();
    assert.equal(ui.requests.length, 2);
    const options = [{ id: 2, name: "重试成功", generation: 1 }];
    ui.requests[1].resolve({ data: options, error: null });
    await settle();
    view = ui.render();
    combobox = view.find(node => node.type === "FatherCombobox");
    assert.equal(combobox.props.disabled, false);
    assert.deepEqual(combobox.props.options, options);
    assert.equal(view.some(node => node.props?.role === "alert"), false);
  });
}

test("父亲下拉关闭重开后旧响应不能覆盖新弹窗", async () => {
  const ui = parentDialogHarness();
  ui.open(); ui.close(); ui.open();
  const options = [{ id: 2, name: "新请求", generation: 1 }];
  ui.requests[1].resolve({ data: options, error: null });
  await settle();
  ui.requests[0].resolve({ data: [], error: "旧请求失败" });
  await settle();
  const view = ui.render();
  const combobox = view.find(node => node.type === "FatherCombobox");
  assert.deepEqual(combobox.props.options, options);
  assert.equal(combobox.props.isLoading, false);
  assert.equal(combobox.props.disabled, false);
});

test("时间轴 Wrapper 呈现显式失败提示，成功时传入完整数据", async () => {
  for (const error of ["分页失败", null]) {
    const data = [{ id: 1, name: "刘某" }];
    const { default: TimelinePage } = loadTypeScript("app/family-tree/timeline/page.tsx", {
      "../actions": { fetchMembersForTimeline: async () => ({ data, error }) },
      "./timeline-client": { TimelineClient: "TimelineClient" },
    });
    const wrapper = walk(TimelinePage()).find(node => typeof node.type === "function");
    const result = await wrapper.type();
    if (error) {
      assert.equal(result.props.role, "alert");
      assert.ok(result.props.children.includes(error));
    } else {
      assert.equal(result.type, "TimelineClient");
      assert.deepEqual(result.props.initialData, data);
    }
  }
});

test("姓名查询后续批次失败丢弃前批结果", async () => {
  const db = setup(members(201), {
    respond: (response, call, index) => index === 2 ? { data: null, count: null, error: { message: "后批失败" } } : response,
  });
  const result = await db.names.fetchMemberNamesByIds(db.supabase, members(201).map(row => row.id));
  assert.deepEqual(result.data, []);
  assert.match(result.error, /后批失败/);
});
