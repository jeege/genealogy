# pure-genealogy 族谱项目 - AI 编码指南

## 项目概述

基于 **Next.js 16 (App Router, 静态导出)** + **Go 1.24 + PostgreSQL** 的家族族谱管理应用，
前端使用 TypeScript，后端不再依赖 Supabase。

## 技术栈

- **前端**: Next.js 16（`output: "export"`）、React 19、TypeScript
- **后端**: Go `net/http` + `pgx` + `go:embed`，位于 `backend/`
- **数据库/认证**: PostgreSQL + 自建邮箱密码认证（HttpOnly 会话 Cookie）
- **UI**: shadcn/ui (new-york) + Tailwind CSS + lucide-react
- **可视化**: @xyflow/react、react-force-graph-3d、recharts
- **主题**: next-themes 明暗模式

## 静态前端规范（必读）

前端没有 Server Component 数据获取，也没有 Server Actions / Route Handlers / Middleware。
所有页面都是 Client Component，直接访问同源 Go API。

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

- 新增 `app/api/**/route.ts`、`middleware.ts` 或 `"use server"` 文件；
- 在页面里使用 `export const dynamic`、`generateMetadata` 等需要服务端的导出；
- 在浏览器代码中读取 `DATABASE_URL` 或任何服务端密钥；
- 使用 `next/image` 的优化器（已设为 `unoptimized`）。

## 页面开发模式

参考 `app/family-tree/`：
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

- 公开：`/auth/*`、`/api/*`、`/_next/static/*`、`/images/*`、`/api/health`、`/api/config`
- 受保护：`/` 与 `/family-tree/*` 的 HTML，未登录 302 到 `/auth/login/`
- `.txt` RSC 骨架与静态资源不含数据，允许匿名加载
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
npm run dev          # Next.js 开发服务器，/api 代理到 Go
npm test             # Node + Go 测试
npx tsc --noEmit     # 类型检查
npm run build        # 静态导出并复制到 backend/internal/web/dist
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
