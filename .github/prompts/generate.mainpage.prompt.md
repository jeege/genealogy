---
description: 生成一个展示family_members表数据的页面.
---

## 页面功能
* 通过 Server Action 调用 Go API 从 family_members 表获取数据.
* 使用表格(table组件)展示所有数据, 显示成员的姓名、辈分、排行、父亲ID等信息(尽可能把所有字段展示出来).
* 提供搜索功能以按姓名查找成员.
* 支持分页显示数据, 每页显示50条记录.
* 页面标题为"族谱成员列表".
* 表格顶部提供新增、删除按钮.
   * 新增按钮点击后弹出一个表单, 允许输入成员的各项信息并提交保存到数据库.
   * 删除按钮允许批量删除选中的成员记录.

## 技术要求
* 使用 `lib/api/server.ts` 的 `apiRequest()` 或页面 Server Action 获取数据。
* 优先使用components/ui下的组件，如果没有首选shadcn/ui的组件.
* 页面路径为/family-tree.
