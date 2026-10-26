# pure-genealogy 族谱项目 - AI 编码指南

## 项目概述

这是一个基于 **Next.js 16 (App Router)** + **Go + PostgreSQL** 的家族族谱管理应用，前端使用 TypeScript。
项目已进行**全面中文化**（zh-CN），包括 UI 文案、日期格式及元数据。Go 后端不再依赖 Supabase。

## 技术栈

- **框架**: Next.js 16 (App Router, 静态导出 `output: export`)
- **后端**: Go 1.24（标准库 HTTP + pgx）
- **数据库/认证**: PostgreSQL + 自建邮箱密码认证（服务端会话 Cookie）
- **UI**: shadcn/ui (new-york 风格) + Tailwind CSS
- **可视化**: 
    - `@xyflow/react` (React Flow) 用于 2D 族谱图
    - `react-force-graph-3d` 用于 3D 族谱图
    - `recharts` 用于统计仪表盘
- **富文本**: `slate`, `slate-react`, `slate-history` 用于生平事迹编辑
- **主题**: next-themes 支持明暗模式

## 关键架构模式

### 静态前端与 API 使用规范

前端没有 Server Component 数据获取，也没有 Server Actions / Route Handlers / Middleware。
所有页面都是 Client Component，直接访问同源 Go API。

| 场景 | 使用文件 | 说明 |
|------|----------|------|
| 认证请求 | `lib/api/client.ts` | `apiRequest()`，同源 `/api/*`，401 自动跳登录页 |
| 族谱数据 | `lib/api/family.ts` | 列表、CRUD、导入、统计、时间轴 |
| 运行时候选 | `GET /api/config` | `RuntimeConfigProvider` 读取 `familySurname` |
| 页面鉴权 | `backend/internal/api/static.go` | 返回 `/` 与 `/family-tree/*` HTML 前校验会话 |

```typescript
"use client";
import { fetchAllFamilyMembers } from "@/lib/api/family";

const { data, error } = await fetchAllFamilyMembers();
```

- 不要新增 `app/api/**/route.ts`、`middleware.ts` 或 `"use server"` 文件，静态导出不支持。
- 页面里不要写 `export const dynamic` / `generateMetadata` 等需要服务端的导出。
- 数据获取放在 `useEffect` 中，并提供加载与错误状态。

### 页面鉴权规则

由 Go 静态处理器实现，而不是 Next.js：
- 公开：`/auth/*`、`/api/*`、`/_next/static/*`、`/images/*`、`/api/health`、`/api/config`
- 受保护：`/` 与 `/family-tree/*` 的 HTML；未登录 302 到 `/auth/login/`
- `.txt` RSC 骨架与静态资源不含数据，允许匿名加载
- 会话 Cookie 名称: `genealogy_session`（HttpOnly、SameSite=Lax）
- 链接统一使用带尾斜杠的静态路径，如 `/auth/login/`、`/family-tree/graph/`

### 认证流程

- Go API 使用 bcrypt 散列密码，数据库只保存随机会话令牌的 SHA-256 散列。
- 登录成功后跳转 `/family-tree/graph/`；注册成功即创建会话。
- 认证页面位于 `app/auth/`；密码重置通过 SMTP 邮件或 API 日志中的一次性链接完成。
- **登录体验优化**:
    - 采用水墨山水背景（`login-bg.jpg`）及毛玻璃效果，增强家族文化氛围。
    - 登录按钮集成 `Loader2` 加载动画，提供明确的交互反馈。

### 数据刷新

静态站点没有服务端缓存，也没有 `revalidatePath`。写操作成功后调用数据层回调：

```tsx
// 列表页：FamilyMembersLoader 提供 onRefresh，FamilyMembersTable 在增删改/导入后调用
const [version, setVersion] = useState(0);
const refresh = () => setVersion((v) => v + 1);
useEffect(() => { /* 重新拉取 */ }, [page, search, version]);
```

其他页面在进入时重新请求，或由用户手动刷新页面。不要引入 SWR/React Query 等新依赖。

## 核心功能模块

### 族谱管理 (`app/family-tree/`)
- **成员列表**: 分页展示家族成员，支持搜索。已针对移动端优化，工具栏支持自动换行，表格支持横向滚动。
- **添加/编辑**: 
    - 包含成员基本信息、父母关系（`father_id`）、配偶、生日（`birthday`）、居住地（`residence_place`）等。
    - **生平事迹**: 使用富文本编辑器（Slate.js）替代原备注字段，支持加粗、斜体、下划线，最大 500 字。
    - **弹窗优化**: 采用固定头部/底部 + 滚动内容区域的设计，防止内容过长溢出；点击遮罩不关闭以防数据丢失。
- **详情展示 (Living Book)**: 
    - `MemberDetailDialog` 采用 **3D 翻书/画卷** 的交互设计。
    - **内容分层**: 分为“基本信息”正面和“生平事迹”背面，支持平滑的 3D 旋转切换。
    - **视觉美化**: 采用纸张质感背景（`#fdfbf7` / `stone-900`）、衬线字体（`font-serif`）及装饰性边框。
    - **动效**: 生平事迹内容支持**逐字书写/毛笔扫过**（Brush Reveal）的动效，增强代入感。
    - **响应式**: 适配 PC（书卷比例）与移动端（全屏卡片），且完美支持明暗模式切换。
- **通用组件**: `RichTextViewer` 支持 `animate` 属性，用于触发逐字显示的艺术效果。

### 族谱可视化 (`app/family-tree/graph/`)
- 基于 `@xyflow/react` 实现。
- 自动生成树形结构图，展示成员关系。
- **视觉层级与信息密度升级 (v2.0)**:
    - **世代标尺 (Generation Axis)**: 画布左侧自动生成水墨风格的“第X世”标尺，随画布缩放，清晰指引辈分层级。
    - **配偶直显 (Spouse Display)**: 节点卡片直接展示配偶姓名（如“配: 王氏”），支持长文本截断，提升信息密度。
    - **同色系渐变染色**: 
        - 全族统一使用象征生命力的**松柏绿**色调，避免性别色（红/蓝）混淆。
        - 采用**纵向亮度梯度**：父辈色深沉稳，子辈色浅明亮，形成“瀑布式”的代际层次感。
    - **双向高亮溯源**: 选中节点时，触发“金线溯源”（向上追溯祖先）与“金扇繁衍”（向下点亮子孙），非相关节点自动变暗，聚焦家族脉络。
- **节点交互优化**:
    - **顶部横条**: 颜色与边框（性别/高亮状态）完全同步，强化视觉语义。
    - **防误触**: 全局禁用连线拖拽，移除末级节点的连接点，防止误操作。
    - **UI 细节**: 优化展开/折叠按钮的遮挡问题，增强鼠标悬浮交互反馈。
- **移动端优化**: 采用全宽透明工具栏，搜索框居左，操作按钮居右。在窄屏下按钮自动隐藏文字仅保留图标，防止 UI 重叠。
- **图片导出**: HTML5 Canvas 多层合成（背景+水印+节点），输出高质量 JPEG。
- 详情弹窗复用 `MemberDetailDialog`。

### 3D 族谱可视化 (`app/family-tree/graph-3d/`)
- 基于 `react-force-graph-3d` 实现。
- 提供三维视角的力导向图，支持全屏、搜索定位、节点点击详情等功能。
- **自动巡游 (Auto Tour)**:
    - **路径规划**: 基于 BFS 算法自动计算任意两名族人之间的最短关系路径。
    - **沉浸式体验**: 自动移动相机跟随路径巡游，支持暂停、继续及进度追踪。
    - **UI 交互**: 提供专用的巡游配置弹窗与悬浮控制台。
- **移动端优化**: 页面头部标题与切换按钮在移动端垂直堆叠显示。
- 使用 `three-spritetext` 渲染清晰的文字标签。
- 详情弹窗复用 `MemberDetailDialog`.

### 统计与分析 (`app/family-tree/statistics/`)
- 基于 `recharts` 实现的家族数据仪表盘。
- **可视化统计**:
    - **数据概览**: 总人数、男性比例、在世人数、世代总数。
    - **性别/状态比例**: 饼图展示家族成员性别分布及在世与已故比例。
    - **世代分布**: 柱状图展示每一世代的成员增长趋势。
    - **年龄分布**: 柱状图展示在世成员的年龄段分布（基于生日数据）。
    - **字辈趋势**: 自动统计姓名中第二个字（通常为字辈）的出现频率。

### GEDCOM 导入导出 (`backend/internal/gedcom/`)
- 解析 GEDCOM 5.5.1 子集：`INDI`、`FAM`、`NAME`/`SEX`/`BIRT`/`DEAT`/`NOTE`/`OCCU`/`RESI`，
  扩展标签 `_GENC`/`_SIBO`/`_SPO`/`_ALIV`。
- 导入时由父亲链推导世代，同一 `FAM` 内 `CHIL` 顺序作为排行。
- 日期原始文本保留在 `birth_date_raw`/`death_date_raw`，同时解析 ISO 日期。
- 自动识别 UTF-8 与 GB18030；API 见 `GET /api/family-members/gedcom` 等。
- 前端入口：`app/family-tree/gedcom-import-dialog.tsx` 与列表工具栏「导出 GEDCOM」。

### 生平册 (`app/family-tree/biography-book/`)
- 将所有填写生平事迹的族人编制成一本可翻阅的电子书籍。
- **封面设计**: 深棕色古籍风格 + 纹理装饰 + 书脊效果，显示收录人数。
- **3D 翻页动效**: 
    - 使用 `requestAnimationFrame` + CSS `rotateY` 实现真实翻书效果。
    - 翻页过程可见页面背面纹理，动态阴影增强立体感。
- **成员页面**: 
    - 头部：姓名、世代、行号、性别、在世状态 Badge。
    - 基本信息网格：父亲、配偶、生辰、卒年、居住地。
    - 生平事迹：富文本渲染，强制深色文字适配暗色主题。
- **全屏功能**: 右上角全屏按钮，支持 `F` 键快捷键切换。
- **人物搜索**: 
    - 右上角搜索按钮，支持 `Ctrl+F` / `Cmd+F` 快捷键。
    - 实时姓名筛选，点击结果直接跳转到对应页面。
- **交互控制**: 
    - ← → 方向键 / 侧边按钮翻页。
    - 底部页码圆点可点击跳转。
- **移动端优化**: 
    - 桌面端使用书籍两侧的大按钮。
    - 移动端使用书籍内部的小型半透明悬浮按钮。
- **主题兼容**: 成员页面使用浅色纸张背景，文字强制深色确保可读性。

## 响应式与移动端规范

### 导航栏 (`components/mobile-nav.tsx`)
- 移动端使用 `MobileNav`（下拉菜单）替代桌面端水平导航。
- `AuthButton` 在移动端会自动调整为垂直布局，并对过长的邮箱地址进行截断处理。

### 布局工具类使用
- 优先使用 Tailwind 的响应式前缀（如 `md:flex`, `lg:row`）。
- 按钮组在移动端应使用 `flex-wrap` 以防溢出。
- 对于复杂的工具栏（如 Graph 页面），使用 `pointer-events-none` 配合内部元素的 `pointer-events-auto`，确保 UI 控件不会阻碍底层画布的交互。
- 移动端按钮应尽量移除文字说明 (`hidden sm:inline`) 仅保留图标，以节省空间。

## 数据库 Schema

迁移位于 `backend/internal/database/migrations/`，启动时自动执行。

### 认证表
- `users`：邮箱（小写唯一）、bcrypt 密码散列；
- `sessions`：会话令牌 SHA-256、过期时间；
- `password_reset_tokens`：一次性重置令牌、使用时间；
- `schema_migrations`：已执行迁移版本。

### family_members 表（族谱核心表）
```sql
id, name, generation, sibling_order, father_id, gender, 
official_position, is_alive, spouse, remarks, birthday, death_date,
birth_date_raw, death_date_raw, residence_place, updated_at
```
- `father_id` 自引用实现树形结构
- `gender` 限制为 '男' 或 '女'
- `remarks` 存储生平事迹 (Slate JSON string)
- `birthday` 类型为 `date`
- `residence_place` 类型为 `text`
- `birth_date_raw` / `death_date_raw` 保存 GEDCOM 原始日期文本（如 `ABT 1850`）

## 开发命令

```bash
npm run dev:api    # 启动 Go API (127.0.0.1:8080)
npm run dev        # 启动 Next.js 开发服务器，/api 代理到 Go
npm test           # Node + Go 测试
npm run build      # 静态导出并复制到 backend/internal/web/dist
npm run build:binary # 再执行 go build，产出 ./pure-genealogy
npm run db:migrate # 只执行数据库迁移
```

## 组件规范

### 路径别名
```typescript
@/components  → components/
@/lib         → lib/
@/lib/api     → 同源 API 客户端与数据层
@/components/ui → shadcn 组件
@/components/rich-text → 富文本编辑器组件
```

### UI 组件使用
- 使用 `cn()` 函数合并 className: `cn("base-class", className)`
- shadcn 组件位于 `components/ui/`
- 图标使用 `lucide-react`

### 数据刷新
项目不再使用 Supabase Realtime，也没有服务端数据层。写操作完成后由页面重新请求 Go API。

## 环境变量

本地开发 `.env.local`（Go API 与 Next.js 分进程运行）:
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