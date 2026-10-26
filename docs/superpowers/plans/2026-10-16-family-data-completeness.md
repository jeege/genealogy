> **历史文档**：本方案描述的是已被替换的 Supabase 后端。当前实现为 Go + PostgreSQL，见 [`docs/backend.md`](../../backend.md)。

# 千人以上族谱数据完整性实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 修复 Issue #6 的千人查询截断及无效 3D 连线，并覆盖同源查询。

**Architecture:** 共用按实际返回条数推进、精确总数校验的分页器。各 Server Action 保留现有字段与业务排序，所有分组统计基于完整数据；3D 与巡游共用有效父子连线生成函数。

**Tech Stack:** Next.js、React、TypeScript、Supabase JS、Node test、已有 TypeScript 转译测试工具。

**Spec:** `docs/superpowers/specs/2026-10-16-family-data-completeness.md`

## Global Constraints

- 中文文案和新增注释；不新增运行时依赖，不修改数据库，不写入真实族谱数据。
- 不修改用户已有 `.vscode/settings.json`；不推送、不发布、不关闭远程 Issue。
- 1400、5000 人结果全部返回，统计总数与各分类汇总正确；1000 整页边界和服务端上限小于请求页大小均正确。
- 分页错误和不完整响应不可当成空家谱或部分成功；父亲选择、时间轴有可见错误。
- 跨页父子关系保留；缺失父节点、自引用不会传入 3D 力导向连线或巡游路径。

---

### Task 1: 完整分页读取及所有调用方集成

**Files:**
- Create: `lib/supabase/fetch-all-rows.ts`, `app/family-tree/member-queries.ts`, `tests/family-data.test.mjs`, `tests/helpers/load-typescript.mjs`
- Modify: `app/family-tree/actions.ts`, `app/family-tree/graph/actions.ts`, `app/family-tree/statistics/actions.ts`, `app/family-tree/biography-book/actions.ts`, `app/family-tree/family-members-table.tsx`, `app/family-tree/timeline/page.tsx`, `tests/member-import.test.mjs`, `package.json`

**Interfaces:**
- Consumes: Supabase 查询响应 `{ data: T[] | null; count: number | null; error: { message: string } | null }`。
- Produces: `fetchAllRows<T extends { id: number }>(fetchPage: (from: number, to: number) => PromiseLike<RowPage<T>>): Promise<{ data: T[]; error: string | null }>`，固定每页 500。
- Produces: `fetchMemberNamesByIds(supabase: SupabaseClient, ids: number[]): Promise<{ data: { id: number; name: string }[]; error: string | null }>`，100 个唯一 ID 一批，每批完整分页。
- 修改 `fetchAllMembersForSelect`、`fetchMembersForTimeline` 返回 `{ data, error }`；同步更新全部调用方。
- `tests/helpers/load-typescript.mjs` 导出 `loadTypeScript(relativePath, mocks = {})`，提取现有测试中相同的转译加载代码，现有导入测试为新增生产依赖提供真实工具模块。

- [x] **Step 1: 建立可重复的失败测试。** 用模拟 PostgREST 实现 `.select(..., {count})`、`.order`、`.range`、`.in`、`.not`、`.neq`，必须实际执行过滤、复合排序、范围与最大返回数，返回筛选后总数。调用真实 Server Action，而非仅测试 mock。至少包含以下行为断言：

```js
const result = await graphActions.fetchAllFamilyMembers();
assert.equal(result.error, null);
assert.equal(result.data.length, 1400);
assert.equal(new Set(result.data.map(m => m.id)).size, 1400);
const statistics = await statisticsActions.fetchFamilyStatistics();
assert.equal(statistics.data.totalMembers, 1400);
assert.equal(statistics.data.genderStats.reduce((n, item) => n + item.value, 0), 1400);
```

覆盖 0、1000、1400、5000 条；返回上限 37（小于 500）；后续分页错误、网络异常、缺失 count、提前空页、重复 ID、count 改变；全量父亲选项、时间轴；超过 1000 条生平及不带生平的跨页父亲。业务排序字段相同的数据仍须稳定完整。失败时断言没有成功部分数据。运行 `node --test tests/family-data.test.mjs` 并记录原始截断失败。

- [x] **Step 2: 实现分页器及姓名查询。** 核心循环按如下规则实现，完整类型与分支放入对应文件：

```ts
let expectedCount: number | null = null;
const rows: T[] = [];
const seen = new Set<number>();
// 每次都重新创建查询；禁止对已执行的可变 builder 重用。
const page = await fetchPage(rows.length, rows.length + 499);
// error 或 count 非非负整数、data 为 null：返回 data: [] 与中文错误。
// 首次记录 count；后续 count 不同、重复 ID、提前空页、累计超出 count：失败。
// 对合法页追加行；累计等于 expectedCount 时返回成功，否则继续请求。
```

捕获请求拒绝，禁止泄漏已取得部分行。姓名工具先去重 ID，按 100 切分，使用分页器读取 `id, name` 并 `order("id")`。

- [x] **Step 3: 集成所有全量读取。** graph、statistics、父亲选择、timeline、biography 主查询使用分页器；每次 select 指定精确 count，排序尾部追加 id：

```ts
const result = await fetchAllRows<FamilyMemberNode>((from, to) =>
  supabase.from("family_members")
    .select("id, name, generation, sibling_order, father_id, gender, official_position, is_alive, spouse, remarks, birthday, death_date, residence_place", { count: "exact" })
    .order("generation", { ascending: true })
    .order("sibling_order", { ascending: true })
    .order("id", { ascending: true })
    .range(from, to)
);
```

statistics 保持当前统计逻辑，完整加载后才计算。biography 保持空生平过滤，父亲姓名改用共享工具；列表也复用姓名工具并在分页排序末追加 id。任一姓名查询错误须向上返回，不能伪装成父亲未记录。不要改动导入事务/回滚逻辑。

- [x] **Step 4: 显式呈现错误。** 父亲下拉加载 effect 接收 `{data,error}`，失败清空选项、展示中文错误并禁用下拉，捕获请求拒绝，关闭/重开可重试；用取消标记避免旧请求覆盖新弹窗。timeline wrapper 如有 error 返回加载失败提示。错误结果接口在所有调用点同步处理。

```tsx
if (error) {
  return <div role="alert" className="bg-destructive/10 text-destructive p-4 rounded-lg">加载数据失败：{error}</div>;
}
```

- [x] **Step 5: 验证和提交。** 在 package.json 增加 `"test": "node --test tests/*.test.mjs"`，保留 `test:import`。运行 focused tests、`node --test tests/*.test.mjs`、`npx --no-install tsc --noEmit`。记录预存失败。只提交本任务文件，报告 RED/GREEN 和变更列表。

### Task 2: 3D 与巡游连线防御和回归测试

**Files:**
- Create: `app/family-tree/graph/family-links.ts`, `tests/family-links.test.mjs`
- Modify: `app/family-tree/graph-3d/force-graph.tsx`, `app/family-tree/graph-3d/tour-utils.ts`, `app/family-tree/graph/family-tree-graph.tsx`

**Interfaces:**
- Consumes: Task 1 的 `tests/helpers/load-typescript.mjs`；完整成员数组。
- Produces: `getFamilyLinks(members: {id: number; father_id: number | null}[]): {source: number; target: number}[]`。

- [x] **Step 1: 写失败测试并验证。** 测试使用真实辅助函数及巡游函数，覆盖缺失父亲、自引用、正常父子、跨页父子、两个成员引用同一个缺失父亲（不应有虚构巡游路径）、未知起终点、5000 个有效成员。使用已安装的真实 `d3-force-3d` 验证连线端点：

```js
const { forceSimulation, forceLink } = await import("d3-force-3d");
const nodes = members.map(member => ({ ...member }));
const links = getFamilyLinks(members);
const simulation = forceSimulation(nodes, 3).stop();
assert.doesNotThrow(() => simulation.force("link", forceLink(links).id(node => node.id)));
simulation.tick();
simulation.stop();
```

另外验证原始悬空连线会使真实 forceLink 抛错，证明测试覆盖 Issue 的故障方式。大数据测试可只初始化/少量 tick，避免昂贵的完整模拟。

- [x] **Step 2: 实现共享连线规则并接入。**

```ts
export function getFamilyLinks(members: { id: number; father_id: number | null }[]) {
  const ids = new Set(members.map(member => member.id));
  return members.flatMap(member => member.father_id !== null && member.father_id !== member.id && ids.has(member.father_id)
    ? [{ source: member.father_id, target: member.id }] : []);
}
```

force-graph 的现有 useMemo 保留节点克隆，仅将 links 生成替换为该函数，不删除孤立节点。tour-utils 先构建所有真实节点 Map，未知起终点返回 null，再按共享 links 建双向邻接表；BFS 不得经过虚构节点。2D 可见父节点检查改用预计算 Set，保留所有原有布局语义。

- [x] **Step 3: 验证和提交。** 运行 `node --test tests/family-links.test.mjs`、全套 Node 测试、TypeScript 检查。核对组件实际引用共享函数。只提交本任务文件，报告 RED/GREEN。

## 集成验证与交付

- [x] 独立审查每个任务与最终全部差异，修复影响正确性的发现。
- [x] 将本次差异应用到原工作区，保留 `.vscode/settings.json`；执行完整测试与构建。
- [x] 若构建或类型检查遇到已存在失败，记录具体文件/原因并验证本次没有新增；不将环境失败表述成通过。
- [x] 更新本计划勾选状态，最终报告修复范围、验证结果和分页非事务快照的边界。
