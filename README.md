# pure-genealogy 族谱管理系统

<p align="center">
  <img alt="pure-genealogy Tree" src="app/demo.gif" width="800">
</p>

<p align="center">
  一个基于 Next.js 16、Go 与 PostgreSQL 构建的现代化、全中文家族族谱管理系统。
</p>

## ✨ 项目亮点

- **单一二进制**: 前端静态导出后通过 `go:embed` 嵌入 Go，构建产物就是一个可执行文件。
- **自有认证**: 邮箱 + 密码登录，bcrypt 密码散列，数据库只保存随机会话令牌的散列，不依赖 Supabase Auth。
- **直连 PostgreSQL**: 只需配置 `DATABASE_URL` 连接字符串；启动时自动执行内嵌迁移。
- **深度中文化**: UI 文案、日期格式、元数据及字辈统计均针对中文语境定制。
- **多维可视化 (v2.0)**:
  - **2D 族谱图**: 世代标尺、松柏绿渐变色、配偶直显、“金线溯源”和“金扇繁衍”双向高亮，支持高清导出。
  - **3D 关系网**: 沉浸式力导向图与自动巡游。
  - **家族统计**: 世代增长、性别、年龄、字辈频率等仪表盘。
  - **历史时间轴**: 直观展示生卒年分布。
- **沉浸式体验**: “Living Book” 详情页、Slate.js 富文本生平、逐字书写动效。
- **部署极简**: 运行镜像只需 PostgreSQL；容器内只有一个 Go 进程。

## 🛠️ 技术栈

- **前端**: [Next.js 16](https://nextjs.org/)（App Router、静态导出）、React 19、TypeScript
- **后端**: Go 1.24（标准库 `net/http`、[pgx](https://github.com/jackc/pgx)、`go:embed`）
- **数据库**: PostgreSQL 17（可连接任意兼容 PostgreSQL 的托管数据库）
- **认证**: 自建邮箱密码认证 + HttpOnly 服务端会话 Cookie
- **UI**: shadcn/ui、Tailwind CSS、Lucide React
- **可视化**: `@xyflow/react`、`react-force-graph-3d`、`recharts`
- **富文本**: Slate.js

## 🏗️ 架构

```text
浏览器
  │ 同源请求
  ▼
Go 单一二进制 (默认 :8080)
  ├─ /_next/static/*、/images/*     ← go:embed 的前端静态资源
  ├─ /、/family-tree/*              ← 校验会话后再返回 HTML
  └─ /api/*                         ← 认证、成员、导入、统计
                                       │
                                       ▼
                              PostgreSQL (DATABASE_URL)
```

- 前端 `next build` 输出 `out/`，由 `scripts/copy-web.mjs` 复制到
  `backend/internal/web/dist/`，再通过 `//go:embed` 打进二进制。
- 浏览器与后端同源，认证 Cookie 直接生效，不需要反向代理或 Next.js 服务端。
- 数据库连接串、会话散列与管理员口令只存在于 Go 进程。

## 🚀 本地开发

### 1. 环境要求

- Node.js 22+
- Go 1.24+
- PostgreSQL 17（或任意可连接的 PostgreSQL 实例）

### 2. 安装依赖

```bash
npm install
```

### 3. 准备数据库

创建数据库和用户，例如：

```sql
CREATE USER genealogy WITH PASSWORD 'change-me';
CREATE DATABASE genealogy OWNER genealogy;
```

Go 启动时会自动创建 `users`、`sessions`、`password_reset_tokens`、
`family_members` 与 `schema_migrations` 表，无需手工执行 SQL。

### 4. 配置环境变量

复制 `.env.example` 为 `.env.local`：

```env
DATABASE_URL=postgres://genealogy:change-me@127.0.0.1:5432/genealogy?sslmode=disable
API_PORT=8080
DEV_API_PROXY_TARGET=http://127.0.0.1:8080
APP_ORIGIN=http://localhost:3000
PUBLIC_BASE_URL=http://localhost:3000
FAMILY_SURNAME=刘
ALLOW_SIGNUP=true
```

> `DATABASE_URL` 只提供给 Go，不会进入浏览器。生产环境请使用强密码，
> 托管数据库通常需要 `sslmode=require`。`npm run dev:api` 会自动读取
> `.env` 与 `.env.local`；直接 `go run` 时请先导出这些变量。

### 5. 启动

```bash
# 终端 1：Go API（127.0.0.1:8080）
npm run dev:api

# 终端 2：Next.js 开发服务器（localhost:3000，/api 自动代理到 Go）
npm run dev
```

首次使用可以：

- 在 `/auth/sign-up` 注册第一个账号（`ALLOW_SIGNUP=true` 时）；或
- 启动 Go 前设置 `ADMIN_EMAIL` / `ADMIN_PASSWORD`，由后端自动创建初始管理员；或
- 使用 CLI 创建账号：

```bash
cd backend
ADMIN_PASSWORD='your-password' go run ./cmd/server user create --email you@example.com
```

## 📦 构建单一二进制

```bash
npm run build          # 静态导出并复制到 backend/internal/web/dist
npm run build:binary   # 在前者基础上执行 go build，产出 ./pure-genealogy
```

产物 `./pure-genealogy` 自带页面与 API，直接运行即可：

```bash
DATABASE_URL='postgres://genealogy:change-me@127.0.0.1:5432/genealogy?sslmode=disable' \
APP_ORIGIN='http://localhost:8080' \
FAMILY_SURNAME='刘' \
ALLOW_SIGNUP=true \
./pure-genealogy serve
```

打开 <http://localhost:8080>。CLI 子命令：

```bash
./pure-genealogy migrate               # 只执行迁移
./pure-genealogy user create --email you@example.com
./pure-genealogy healthcheck           # 查看 /api/health
```

## 🐳 Docker / NAS 部署

### 一键本地栈（推荐）

```bash
node scripts/setup-self-hosted.mjs \
  --site-url http://localhost:3000 \
  --admin-email you@example.com
```

脚本生成权限为 `0600` 的 `.env.self-hosted`，并打印一次性初始管理员密码。然后：

```bash
docker compose --env-file .env.self-hosted up -d --build
```

Compose 启动 PostgreSQL 与应用容器；应用容器内只有一个 Go 进程，宿主机
`3000` 映射到容器 `8080`。

### 使用已有 PostgreSQL

```bash
docker run -d --name pure-genealogy -p 3000:8080 \
  -e DATABASE_URL='postgres://user:pass@db.example.com:5432/genealogy?sslmode=require' \
  -e APP_ORIGIN='https://genealogy.example.com' \
  -e PUBLIC_BASE_URL='https://genealogy.example.com' \
  -e FAMILY_SURNAME='刘' \
  -e ALLOW_SIGNUP=false \
  -e ADMIN_EMAIL='you@example.com' \
  -e ADMIN_PASSWORD='change-me-please' \
  ghcr.io/jeege/genealogy:latest
```

镜像发布在 GHCR：`ghcr.io/jeege/genealogy`。推送到 `main` 或打 `v*` 标签会由
GitHub Actions 自动构建 `linux/amd64`/`linux/arm64` 双架构镜像，也可在 Actions
页面手动触发。

HTTPS、SMTP、备份恢复、从 Supabase 迁移等完整说明见
**[Docker 部署文档](docs/docker-deployment.md)**。

## 🗄️ 从 Supabase 迁移

- `family_members` 表结构与旧版本兼容；迁移使用 `CREATE TABLE IF NOT EXISTS`，不会删除已有族谱数据。
- Supabase Auth 用户与会话无法直接复用。迁移后需要重新创建账号，或使用 `user create` 命令。
- 旧 Supabase 的 RLS 策略不再使用；迁移会关闭 `family_members` 的 RLS（需要数据库角色拥有该表）。
- 建议先备份数据库，验证数据量后再切换 `DATABASE_URL`。

## 📂 项目结构

```text
/
├── app/                    # Next.js App Router（静态导出）
│   ├── auth/               # 登录、注册、找回密码
│   └── family-tree/        # 成员管理、2D/3D 图、统计、时间轴、生平册
├── backend/                # Go 后端（二进制入口与全部服务）
│   ├── cmd/server/         # serve / migrate / user / healthcheck
│   └── internal/
│       ├── api/            # 路由、中间件、页面鉴权
│       ├── web/            # go:embed 静态资源与文件服务
│       ├── auth/ store/ family/ database/ mailer/ config/
│       └── web/dist/       # 构建时复制进来的静态页面（不提交）
├── components/             # React 组件
├── lib/api/                # 浏览器 API 客户端与共享类型
├── scripts/                # 静态复制、本地启动、配置生成、镜像发布
└── tests/                  # Node 测试；Go 测试位于 backend/internal
```

## 🧪 测试

```bash
npm test          # Node 测试 + Go 测试
npm run test:web  # 仅 Node 测试
npm run test:go   # 仅 Go 测试
npx tsc --noEmit  # TypeScript 类型检查
npm run build     # 静态导出并复制到 Go
```

Go 测试覆盖配置校验、密码与会话、导入解析、统计、HTTP/页面鉴权与静态文件服务。
Node 测试覆盖 API 客户端、数据层、导入解析、运行时配置与自托管配置生成。

## 📚 文档

- [后端设计与 API](docs/backend.md)
- [GHCR 镜像与 GitHub Actions](docs/docker-deployment.md#从-ghcr-拉取镜像)
- [Docker 部署与运维](docs/docker-deployment.md)
- [Go 后端说明](backend/README.md)

## 📄 许可证

本项目采用 [MIT](LICENSE) 许可证。
