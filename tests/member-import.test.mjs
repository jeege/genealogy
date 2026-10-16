import assert from "node:assert/strict";
import { test } from "node:test";
import XLSX from "xlsx";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

const helpers = loadTypeScript("app/family-tree/member-import.ts");
const pager = loadTypeScript("lib/supabase/fetch-all-rows.ts");
const queries = loadTypeScript("app/family-tree/member-queries.ts", { "@/lib/supabase/fetch-all-rows": pager });

function setup(existing = [], options = {}) {
  let rows = existing.map((member) => ({ ...member }));
  let nextId = Math.max(0, ...rows.map((member) => member.id)) + 1;
  const inserts = [];
  const revalidations = [];
  const ranges = [];
  const supabase = {
    from(table) {
      assert.equal(table, "family_members");
      let operation = "read";
      let payload;
      let filter;
      let range;
      const query = {
        select() { return query; },
        in(field, values) { filter = { field, values }; return query; },
        order() { return query; },
        range(from, to) { range = [from, to]; ranges.push(range); return query; },
        insert(value) { operation = "insert"; payload = value; return query; },
        delete() { operation = "delete"; return query; },
        then(resolve, reject) {
          return Promise.resolve().then(() => {
            if (operation === "read") {
              if (options.queryError) return { data: null, error: { message: "查询失败" } };
              const found = rows.filter((member) => filter.values.includes(member[filter.field]));
              const data = range ? found.slice(range[0], range[1] + 1) : found;
              return { data: data.slice(0, options.queryLimit ?? data.length), error: null, count: found.length };
            }
            if (operation === "delete") {
              if (options.rollbackError) return { data: null, error: { message: "撤销失败" } };
              if (options.rollbackDenied) return { data: [], error: null };
              const deleted = rows.filter((member) => filter.values.includes(member.id));
              rows = rows.filter((member) => !filter.values.includes(member.id));
              return { data: deleted, error: null };
            }
            inserts.push(payload);
            if (options.failInsert === inserts.length) return { data: null, error: { message: "保存失败" } };
            for (const member of payload) {
              if (member.father_id !== null) {
                assert.ok(rows.some((father) => father.id === member.father_id), "父亲必须已保存且 ID 有效");
              }
              assert.equal(Object.hasOwn(member, "father_name"), false);
            }
            const added = payload.map((member) => ({ ...member, id: nextId++ }));
            rows.push(...added);
            return { data: added.slice().reverse().slice(0, options.returnLimit ?? added.length), error: null };
          }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  const actions = loadTypeScript("app/family-tree/actions.ts", {
    "@/lib/supabase/server": { createClient: async () => supabase },
    "next/cache": { revalidatePath: (...args) => revalidations.push(args) },
    "./member-import": helpers,
    "@/lib/supabase/fetch-all-rows": pager,
    "./member-queries": queries,
  });
  return { actions, inserts, revalidations, ranges, rows: () => rows };
}

for (const format of ["xlsx", "csv"]) {
  test(`${format} 模板解析后按姓名、世代建立关联，清理空白并兼容父亲表头`, async () => {
    const worksheet = XLSX.utils.json_to_sheet([
      { " 姓名 ": " 刘子 ", 世代: "20", 父亲: " 刘父 " },
      { " 姓名 ": " 刘父 ", 世代: "19", 父亲: "" },
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "成员导入模板");
    const contents = XLSX.write(workbook, { type: "buffer", bookType: format });
    const parsed = XLSX.read(contents, { type: "buffer" });
    const members = helpers.parseImportRows(XLSX.utils.sheet_to_json(parsed.Sheets[parsed.SheetNames[0]]));
    const db = setup();

    const preview = await db.actions.previewFamilyMembersImport(members);
    assert.deepEqual(preview, { fathers: [{ source: "import", index: 1 }, null], error: null });
    assert.equal(db.inserts.length, 0);
    const result = await db.actions.batchCreateFamilyMembers(members);
    assert.equal(result.success, true);
    const father = db.rows().find((member) => member.name === "刘父");
    assert.equal(db.rows().find((member) => member.name === "刘子").father_id, father.id);
  });
}

test("已有父亲重名时按子女的上一世代选择正确 ID", async () => {
  const db = setup([
    { id: 11, name: "刘父", generation: 19 },
    { id: 12, name: "刘父", generation: 18 },
    { id: 13, name: "刘父", generation: null },
    { id: 14, name: "刘父", generation: 20 },
  ]);
  const result = await db.actions.batchCreateFamilyMembers([
    { name: " 刘子 ", generation: 20, father_name: " 刘父 " },
  ]);
  assert.deepEqual(result, { success: true, count: 1, error: null });
  assert.equal(db.rows().find((member) => member.name === "刘子").father_id, 11);
  assert.deepEqual(db.revalidations, [["/family-tree", "layout"]]);
});

test("同批次多代乱序、跨世代重名及倒序返回 ID 均建立正确关系", async () => {
  const db = setup([{ id: 9, name: "刘始祖", generation: 1 }]);
  const members = [
    { name: "刘后辈", generation: 4, father_name: "刘同名" },
    { name: "刘支子", generation: 3, father_name: "刘支父" },
    { name: "刘同名", generation: 3, father_name: "刘同名" },
    { name: "刘同名", generation: 2, father_name: "刘始祖" },
    { name: "刘支父", generation: 2, father_name: "刘始祖" },
  ];
  const result = await db.actions.batchCreateFamilyMembers(members);
  assert.deepEqual(result, { success: true, count: 5, error: null });
  for (const member of members) {
    const saved = db.rows().find((row) => row.name === member.name && row.generation === member.generation);
    const father = db.rows().find((row) => row.id === saved.father_id);
    assert.equal(father.name, member.father_name);
    assert.equal(father.generation, member.generation - 1);
  }
});

test("分页查询父亲，正确匹配第二页的候选人", async () => {
  const existing = Array.from({ length: 201 }, (_, index) => ({ id: index + 1, name: "刘父", generation: index + 1 }));
  const db = setup(existing);
  const result = await db.actions.batchCreateFamilyMembers([{ name: "刘子", generation: 202, father_name: "刘父" }]);
  assert.equal(result.success, true);
  assert.equal(db.rows().at(-1).father_id, 201);
  assert.deepEqual(db.ranges, [[0, 199], [200, 399]]);
});

for (const [label, existing, members, message] of [
  ["父亲不存在", [], [{ name: "刘子", generation: 20, father_name: "刘父" }], /未找到/],
  ["仅有其他世代的同名父亲", [{ id: 1, name: "刘父", generation: 18 }], [{ name: "刘子", generation: 20, father_name: "刘父" }], /未找到/],
  ["数据库存在同名同世代父亲", [{ id: 1, name: "刘父", generation: 19 }, { id: 2, name: "刘父", generation: 19 }], [{ name: "刘子", generation: 20, father_name: "刘父" }], /无法唯一匹配/],
  ["模板存在同名同世代父亲", [], [{ name: "刘父", generation: 19 }, { name: "刘父", generation: 19 }, { name: "刘子", generation: 20, father_name: "刘父" }], /无法唯一匹配/],
  ["数据库和模板同时出现同名同世代父亲", [{ id: 1, name: "刘父", generation: 19 }], [{ name: "刘父", generation: 19 }, { name: "刘子", generation: 20, father_name: "刘父" }], /无法唯一匹配/],
  ["有父亲但缺少成员世代", [], [{ name: "刘子", father_name: "刘父" }], /成员世代必须/],
  ["第一世填写父亲", [], [{ name: "刘子", generation: 1, father_name: "刘父" }], /成员世代必须/],
  ["自我引用", [], [{ name: "刘父", generation: 19, father_name: "刘父" }], /未找到/],
  ["空导入", [], [], /没有有效/],
]) {
  test(`${label}时预览及导入均报错，不保存任何记录`, async () => {
    const db = setup(existing);
    const preview = await db.actions.previewFamilyMembersImport(members);
    assert.match(preview.error, message);
    const result = await db.actions.batchCreateFamilyMembers(members);
    assert.equal(result.success, false);
    assert.equal(result.count, 0);
    assert.match(result.error, message);
    assert.equal(db.inserts.length, 0);
  });
}

test("模板拒绝无效世代和空姓名，不把错误转为无父亲成员", () => {
  for (const generation of ["未知", 0, -1, 1.5, Infinity, 2147483648]) {
    assert.throws(() => helpers.parseImportRows([{ 姓名: "刘子", 世代: generation }]), /世代必须/);
  }
  assert.throws(() => helpers.parseImportRows([{ 姓名: "  ", 世代: 20 }]), /缺少姓名/);
});

test("父亲为空时允许缺省世代，保留其他成员字段", async () => {
  const db = setup();
  const members = helpers.parseImportRows([{
    姓名: "刘某", 父亲姓名: " ", 性别: "女", 是否在世: "否", 排行: 2,
    配偶: "张某", 备注: "生平", 官职: "无", 生日: "1990-01-01", 居住地: "某地",
  }]);
  assert.equal((await db.actions.batchCreateFamilyMembers(members)).success, true);
  assert.deepEqual(db.rows()[0], {
    id: 1, name: "刘某", generation: null, sibling_order: 2, father_id: null,
    gender: "女", is_alive: false, spouse: "张某", remarks: "生平", official_position: "无",
    birthday: "1990-01-01", residence_place: "某地",
  });
});

test("父亲查询失败时停止导入", async () => {
  const db = setup([], { queryError: true });
  const result = await db.actions.batchCreateFamilyMembers([{ name: "刘子", generation: 20, father_name: "刘父" }]);
  assert.equal(result.success, false);
  assert.match(result.error, /查询父亲信息失败/);
  assert.equal(db.inserts.length, 0);
});

test("预览后数据发生变化时，提交重新验证父亲关联", async () => {
  const db = setup([{ id: 1, name: "刘父", generation: 19 }]);
  const members = [{ name: "刘子", generation: 20, father_name: "刘父" }];
  assert.equal((await db.actions.previewFamilyMembersImport(members)).error, null);
  db.rows().push({ id: 2, name: "刘父", generation: 19 });
  assert.match((await db.actions.batchCreateFamilyMembers(members)).error, /无法唯一匹配/);
  assert.equal(db.inserts.length, 0);
});

test("后续世代保存失败时撤销本次新增成员，保留已有成员", async () => {
  const existing = [{ id: 8, name: "刘始祖", generation: 1 }];
  const db = setup(existing, { failInsert: 3 });
  const result = await db.actions.batchCreateFamilyMembers([
    { name: "刘祖", generation: 2, father_name: "刘始祖" },
    { name: "刘父", generation: 3, father_name: "刘祖" },
    { name: "刘子", generation: 4, father_name: "刘父" },
  ]);
  assert.deepEqual(result, { success: false, count: 0, error: "保存失败" });
  assert.deepEqual(db.rows(), existing);
});

test("无法撤销已保存成员时准确报告剩余条数", async () => {
  const db = setup([], { failInsert: 2, rollbackError: true });
  const result = await db.actions.batchCreateFamilyMembers([
    { name: "刘父", generation: 19 }, { name: "刘子", generation: 20, father_name: "刘父" },
  ]);
  assert.equal(result.success, false);
  assert.equal(result.count, 1);
  assert.match(result.error, /仍有 1 条/);
});

test("超过单批上限的同代成员全部保存，子女引用正确父亲 ID", async () => {
  const db = setup();
  const fathers = Array.from({ length: 205 }, (_, index) => ({ name: `刘父${index}`, generation: 19 }));
  const result = await db.actions.batchCreateFamilyMembers([
    { name: "刘子", generation: 20, father_name: "刘父204" }, ...fathers,
  ]);
  assert.equal(result.count, 206);
  assert.deepEqual(db.inserts.map((batch) => batch.length), [200, 5, 1]);
  assert.equal(db.rows().find((member) => member.name === "刘子").father_id, db.rows().find((member) => member.name === "刘父204").id);
});

test("数据库查询条数上限小于分页大小时仍检查全部候选人", async () => {
  const db = setup([
    { id: 1, name: "刘父", generation: 19 }, { id: 2, name: "刘父", generation: 19 },
  ], { queryLimit: 1 });
  const result = await db.actions.batchCreateFamilyMembers([{ name: "刘子", generation: 20, father_name: "刘父" }]);
  assert.equal(result.success, false);
  assert.match(result.error, /无法唯一匹配/);
  assert.equal(db.inserts.length, 0);
});

test("删除策略未授权且未报错时，也报告无法撤销的成员", async () => {
  const db = setup([], { failInsert: 2, rollbackDenied: true });
  const result = await db.actions.batchCreateFamilyMembers([
    { name: "刘父", generation: 19 }, { name: "刘子", generation: 20, father_name: "刘父" },
  ]);
  assert.equal(result.success, false);
  assert.equal(result.count, 1);
  assert.match(result.error, /仍有 1 条/);
});

test("插入返回的 ID 不完整时，报告未取得 ID 而无法撤销的成员", async () => {
  const db = setup([], { returnLimit: 1 });
  const result = await db.actions.batchCreateFamilyMembers([
    { name: "刘甲", generation: 19 }, { name: "刘乙", generation: 19 },
  ]);
  assert.equal(result.success, false);
  assert.equal(result.count, 1);
  assert.equal(db.rows().length, 1);
  assert.match(result.error, /未能取得全部新成员 ID/);
});
