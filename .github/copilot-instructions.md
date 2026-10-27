# pure-genealogy 族谱项目 - AI 编码指南

## 项目概述

基于 **React 19 + Vite** + **Go 1.24 + PostgreSQL** 的家族族谱管理应用。
前端是纯客户端 SPA（React Router 7），没有 SSR 或 Node 服务端。

## 技术栈

- **前端**: React 19、Vite 6、React Router 7、TypeScript
- **后端**: Go `net/http` + `pgx` + `go:embed`，位于 `backend/`
- **数据库/认证**: PostgreSQL + 自建邮箱密码认证（HttpOnly 会话 Cookie）
- **UI**: shadcn/ui (new-york) + Tailwind CSS + lucide-react
- **可视化**: @xyflow/react、react-force-graph-3d、recharts
- **主题**: next-themes 明暗模式

## 静态前端规范（必读）

前端没有 SSR、Server Component、Server Actions、Route Handler 或 Middleware。
所有页面都是普通 React 组件，直接访问同源 Go API。

| 场景 | 文件 | 说明 |
| --- | --- | --- |
| 认证 | `lib/api/client.ts` | `apiRequest()`，同源 `/api/*`，401 自动跳登录页 |
| 族谱数据 | `lib/api/family.ts` | 列表、CRUD、导入、统计、时间轴 |
| 运行时配置 | `GET /api/config` | `RuntimeConfigProvider` 读取 `familySurname` |
| 页面鉴权 | `backend/internal/api/static.go` | 返回 `/` 与 `/family-tree/*` HTML 前校验会话 |

```tsx
"use client";
import { fetchAllFamilyMembers } from "@/lib/api/family";

const { data, error } = await fetchAllFamilyMembers();
```

禁止事项：

- 引入 SSR/Node 运行时依赖（Next.js、Express 等），Go 已提供接口与静态托管；
- 在客户端代码中读取 `DATABASE_URL` 或任何服务端密钥；
- 新增会破坏 `vite build` 的浏览器外 API（如 `fs`、`node:` 前缀）。

## 页面开发模式

参考 `src/pages/family-tree/`：
- `page.tsx` - Client Component，使用 `useSearchParams` 处理 URL 参数
- `useEffect` 中调用 `lib/api/family.ts` 获取数据
- 必须有加载中、错误、空数据三种状态
- 写操作成功后刷新本地数据或列表

### 返回格式

`lib/api/family.ts` 统一返回：

```typescript
{ data: T[]; count: number; error: string | null }
{ success: boolean; error: string | null }
```

## 路由与鉴权

- 公开：`/auth/*`、`/api/*`、`/assets/*`、`/images/*`、`/api/health`、`/api/config`
- 受保护：`/` 与 `/family-tree/*` 的 HTML，未登录 302 到 `/auth/login/`
- `/assets/*`、`/images/*` 与带扩展名的静态资源不做鉴权
- 会话 Cookie：`genealogy_session`（HttpOnly、SameSite=Lax）
- 站内链接统一带尾斜杠：`/auth/login/`、`/family-tree/graph/`

## 数据库 Schema

迁移文件位于 `backend/internal/database/migrations/`，启动时自动执行。

### family_members 表
```sql
id, name, generation, sibling_order, father_id, gender,
official_position, is_alive, spouse, remarks, birthday, death_date,
residence_place, updated_at
```
- `father_id` 自引用实现树形结构
- `gender` 限制为 '男' 或 '女'
- `remarks` 存储 Slate JSON 字符串
- 完整定义以 Go 迁移文件为准

### 认证表
`users`、`sessions`、`password_reset_tokens`、`schema_migrations`。

### 配偶关系

- `marriages` 表连接两位成员，支持多段婚姻与 `married`/`divorced`/`widowed` 状态。
- API：`GET /api/family-members/{id}/marriages`、`POST /api/marriages`、
  `PUT|DELETE /api/marriages/{id}`。
- 新增/更新成员可传 `spouse_ids`；**不传表示不改变婚姻**，空数组表示解除全部。
- 前端：`src/pages/family-tree/spouse-editor.tsx`；成员查询会附带 `spouses` 摘要。
- `family_members.spouse` 是配偶备注文本，不是结构化配偶。

### GEDCOM

- 实现位于 `backend/internal/gedcom/`（解析、日期、导入映射、导出）。
- API：`GET /api/family-members/gedcom`、`POST .../gedcom/preview`、`POST .../gedcom/import`。
- 前端：`app/family-tree/gedcom-import-dialog.tsx`、`lib/api/family.ts` 的
  `exportGEDCOM` / `previewGEDCOMImport` / `importGEDCOM`。
- 原始日期文本存 `birth_date_raw` / `death_date_raw`；不要把它们当 ISO 日期处理。

## 组件规范

### 路径别名
```typescript
@/components/ui  → shadcn 组件
@/lib/utils      → cn() 函数
@/lib/api        → 浏览器 API 客户端与类型
```

### UI 模式
- 使用 `cn()` 合并 className
- 弹窗使用 shadcn Dialog
- 表格使用 shadcn Table + 手动分页
- 图标统一使用 lucide-react

## 构建与开发命令

```bash
npm run dev:api      # Go API (127.0.0.1:8080)
npm run dev          # Vite 开发服务器，/api 代理到 Go
npm test             # Node + Go 测试
npx tsc --noEmit     # 类型检查
npm run build        # 类型检查 + Vite 构建并复制到 backend/internal/web/dist
npm run build:binary # 再执行 go build，产出 ./pure-genealogy
npm run db:migrate   # 只执行数据库迁移
```

## 环境变量

本地开发 `.env.local`：
```
DATABASE_URL=postgres://genealogy:change-me@127.0.0.1:5432/genealogy?sslmode=disable
API_PORT=8080
DEV_API_PROXY_TARGET=http://127.0.0.1:8080
APP_ORIGIN=http://localhost:3000
PUBLIC_BASE_URL=http://localhost:3000
FAMILY_SURNAME=刘
ALLOW_SIGNUP=true
```

`DATABASE_URL` 只提供给 Go；浏览器只通过 `/api/config` 拿到姓氏。

## 相关指令文件

- `.github/instructions/react-flow.instructions-backup.md` - React Flow 详细用法
- `.github/instructions/react-force-graph.instructions.md` - 3D 图用法
- `docs/backend.md` - 后端配置与完整 API
- `docs/docker-deployment.md` - 部署与运维
