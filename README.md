# pure-genealogy 族谱管理系统

<p align="center">
  <img alt="pure-genealogy Tree" src="docs/demo.gif" width="800">
</p>

<p align="center">
  一个基于 React + Vite、Go 与 PostgreSQL 构建的现代化、全中文家族族谱管理系统。
</p>

## ✨ 项目亮点

- **单一二进制**: 前端是纯 React SPA，构建后通过 `go:embed` 嵌入 Go，产物就是一个可执行文件。
- **自有认证**: 用户名 + 密码登录（用户名不限制字符，中文亦可），bcrypt 密码散列，数据库只保存随机会话令牌的散列，不依赖 Supabase Auth。
- **直连 PostgreSQL**: 只需配置 `DATABASE_URL` 连接字符串；启动时自动执行内嵌迁移。
- **深度中文化**: UI 文案、日期格式、元数据及字辈统计均针对中文语境定制。
- **多维可视化 (v2.0)**:
  - **2D 族谱图**: 世代标尺、松柏绿渐变色、配偶直显、“金线溯源”和“金扇繁衍”双向高亮，支持高清导出。
  - **3D 关系网**: 沉浸式力导向图与自动巡游。
  - **家族统计**: 世代增长、性别、年龄、字辈频率等仪表盘。
  - **历史时间轴**: 直观展示生卒年分布。
- **配偶关系**: 支持一夫多妻历史数据，可登记多段婚姻、状态（已婚/离异/丧偶）与结婚、离异日期，关系图与详情页直接展示。
- **公历/农历切换**: 页面默认以农历展示日期，顶栏一键切换日期展示与输入历法，支持闰月（如闰二月）；数据库始终存公历 ISO 日期，统计与 GEDCOM 导出不受影响。
  日期选择器为统一的日历弹层，格子内「公历数字 + 农历日/节日」双行展示，公历农历共用同一套交互。
- **成员照片**: 每位成员可挂多张照片，原图原样保留（不重编码、保留 EXIF），自动生成缩略图；
  存储路径可通过 `PHOTO_STORAGE_DIR` 配置。详情页用 [PhotoSwipe](https://photoswipe.com) 灯箱预览，
  支持双指缩放、滑动切换与键盘导航。
- **GEDCOM 互通**: 支持 GEDCOM 5.5.1 导入导出，可与主流族谱软件交换数据；内置族谱软件常见的 GBK 文件自动识别。
- **沉浸式体验**: “Living Book” 详情页、Slate.js 富文本生平、逐字书写动效。
- **部署极简**: 运行镜像只需 PostgreSQL；容器内只有一个 Go 进程。

## 🛠️ 技术栈

- **前端**: React 19 + [Vite](https://vite.dev/) + [React Router](https://reactrouter.com/)，TypeScript（无 SSR、无服务端运行时）
- **后端**: Go 1.24（标准库 `net/http`、[pgx](https://github.com/jackc/pgx)、`go:embed`）
- **数据库**: PostgreSQL 17（可连接任意兼容 PostgreSQL 的托管数据库）
- **认证**: 自建用户名密码认证 + HttpOnly 服务端会话 Cookie
- **UI**: shadcn/ui、Tailwind CSS、Lucide React
- **可视化**: `@xyflow/react`、`react-force-graph-3d`、`recharts`
- **日期选择**: `react-day-picker`（shadcn Date Picker）+ 基于 `Intl` 的农历换算
- **图片灯箱**: `photoswipe`（按需加载）
- **图片处理**: `golang.org/x/image`（缩略图缩放与 EXIF 格式解码）
- **富文本**: Slate.js

## 🏗️ 架构

```text
浏览器
  │ 同源请求
  ▼
Go 单一二进制 (默认 :8080)
  ├─ /assets/*、/images/*     ← go:embed 的前端静态资源
  ├─ /、/family-tree/*              ← 校验会话后再返回 HTML
  ├─ /api/photos/*                  ← 照片原图/缩略图（需登录）
  └─ /api/*                         ← 认证、成员、导入、统计
                                       │
                                       ▼
                              PostgreSQL (DATABASE_URL)
```

- 前端 `vite build` 输出 `dist/`，由 `scripts/copy-web.mjs` 复制到
  `backend/internal/web/dist/`，再通过 `//go:embed` 打进二进制。
- 纯客户端渲染：Go 返回同一个 `index.html`，由 React Router 处理所有页面路径。
- 浏览器与后端同源，认证 Cookie 直接生效，不需要反向代理或 Node 服务端。
- 数据库连接串、会话散列与管理员口令只存在于 Go 进程。
- 照片二进制落在磁盘（`PHOTO_STORAGE_DIR`），数据库只记录相对路径与尺寸。

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
APP_ORIGIN=http://localhost:3000,http://127.0.0.1:3000
FAMILY_SURNAME=刘
ALLOW_SIGNUP=true
# 照片存储目录（相对路径基于 backend/ 工作目录）
PHOTO_STORAGE_DIR=data/photos
```

> `DATABASE_URL` 只提供给 Go，不会进入浏览器。生产环境请使用强密码，
> 托管数据库通常需要 `sslmode=require`。`npm run dev:api` 会自动读取
> `.env` 与 `.env.local`；直接 `go run` 时请先导出这些变量。
>
> 照片相关变量均为可选：`PHOTO_STORAGE_DIR`（默认 `data/photos`）、
> `PHOTO_MAX_BYTES`（默认 10 MB）、`PHOTO_THUMBNAIL_MAX_EDGE`（默认 480）。

### 5. 启动

```bash
# 终端 1：Go API（127.0.0.1:8080）
npm run dev:api

# 终端 2：Vite 开发服务器（localhost:3000，/api 自动代理到 Go）
npm run dev
```

首次使用可以：

- 在 `/auth/sign-up` 注册第一个账号（`ALLOW_SIGNUP=true` 时）；或
- 启动 Go 前设置 `ADMIN_USERNAME` / `ADMIN_PASSWORD`，由后端自动创建初始管理员；或
- 使用 CLI 创建账号：

```bash
cd backend
ADMIN_PASSWORD='your-password' go run ./cmd/server user create --username 管理员
```

## 📦 构建单一二进制

```bash
npm run build          # 类型检查 + vite build，并复制到 backend/internal/web/dist
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
./pure-genealogy user create --username 管理员
./pure-genealogy healthcheck           # 查看 /api/health
```

## 🔄 GEDCOM 导入导出

成员列表工具栏提供「导入 GEDCOM」与「导出 GEDCOM」，可与 Ancestry、Gramps、
MyHeritage 及国内族谱工具交换数据。

- **导入**：上传 `.ged`/`.txt`，先预览成员数、家庭数、可解析父亲数量、重复姓名与
  未映射标签；可追加导入，也可勾选「先清空现有族谱」后重建。整份文件在单个事务内写入。
- **编码**：自动识别 UTF-8 与 GBK/GB18030（国内族谱软件常见导出编码）。
- **日期**：保留 `ABT 1850`、`BEF 12 MAR 1900` 等原始文本（存 `birth_date_raw`/
  `death_date_raw`），同时解析出可用的 `YYYY-MM-DD` 供统计与时间轴使用。
- **关系**：由 `FAM` 的 `HUSB`/`CHIL` 推导父子关系、世代与排行；`HUSB`/`WIFE` 与 `MARR`/`DIV` 导入为婚姻记录。
- **配偶**：成员弹窗内可增删多段婚姻、设置状态与结婚/离异日期；列表、关系图与详情页显示配偶摘要，配偶关系只由婚姻记录表达。
- **导出**：UTF-8 + CRLF 的 GEDCOM 5.5.1，文件名如 `刘家族-20261026.ged`，
  富文本生平转为纯文本 `NOTE`，并用 `_GENC`/`_SIBO`/`_ALIV` 扩展标签保证往返保真。

命令行也可以直接上传原始文件：

```bash
curl -b cookies.txt -H 'Content-Type: text/plain' \
  --data-binary @family.ged http://127.0.0.1:8080/api/family-members/gedcom/preview
```

完整标签映射与已知限制见 [后端文档的 GEDCOM 章节](docs/backend.md#gedcom-导入导出)。

## 🖼️ 成员照片

每位成员可以挂多张照片。**原图不做任何重编码**（保留 EXIF 与原始字节），
同时按最长边生成缩略图：编辑弹窗与详情页的网格只加载缩略图，点开灯箱时才取原图。

- **上传**：在「编辑成员」弹窗的「照片」分区上传，支持一次选择多张；
  新增成员需先保存再传图（照片不随表单提交）。
- **预览**：详情页用 [PhotoSwipe](https://photoswipe.com) 灯箱，支持双指缩放、
  双击放大、左右滑动切换、方向键与 Esc 逐层关闭（先关灯箱，再关详情弹窗）。
- **格式**：JPEG / PNG / GIF / WebP；单张默认上限 10 MB，
  像素上限 8000 万（防止解压炸弹）。
- **存储**：`<PHOTO_STORAGE_DIR>/<成员ID>/<随机文件名>`，数据库只记录相对路径与尺寸，
  更换存储位置或反向代理前缀都不需要改数据。

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PHOTO_STORAGE_DIR` | `data/photos` | 照片根目录；容器内固定为 `/data/photos` |
| `PHOTO_MAX_BYTES` | `10485760` | 单张大小上限（64 KB ~ 50 MB） |
| `PHOTO_THUMBNAIL_MAX_EDGE` | `480` | 缩略图最长边（64 ~ 2048） |

> 照片存在磁盘而非数据库，**备份时需同时备份该目录**（Docker 部署对应 `photo-data` 卷）。
> 删除成员会连带清理其照片文件。

## 🐳 Docker / NAS 部署

### 一键本地栈（推荐）

```bash
node scripts/setup-self-hosted.mjs \
  --site-url http://localhost:3000 \
  --admin-username 管理员
```

脚本生成权限为 `0600` 的 `.env.self-hosted`，并打印一次性初始管理员密码。然后：

```bash
docker compose --env-file .env.self-hosted up -d --build
```

Compose 启动 PostgreSQL 与应用容器；应用容器内只有一个 Go 进程，宿主机
`3000` 映射到容器 `8080`。数据通过两个命名卷持久化：`db-data`（数据库）与
`photo-data`（成员照片）。

### 使用已有 PostgreSQL

```bash
docker run -d --name pure-genealogy -p 3000:8080 \
  -v genealogy-photos:/data/photos \
  -e DATABASE_URL='postgres://user:pass@db.example.com:5432/genealogy?sslmode=require' \
  -e APP_ORIGIN='https://genealogy.example.com' \
  -e FAMILY_SURNAME='刘' \
  -e ALLOW_SIGNUP=false \
  -e ADMIN_USERNAME='管理员' \
  -e ADMIN_PASSWORD='change-me-please' \
  ghcr.io/jeege/genealogy:latest
```

> 照片存放在容器内 `/data/photos`，**务必挂载卷**，否则重建容器会丢失照片
> （`docker compose` 已自动创建 `photo-data` 卷）。

镜像发布在 GHCR：`ghcr.io/jeege/genealogy`。推送到 `main` 或打 `v*` 标签会由
GitHub Actions 自动构建 `linux/amd64`/`linux/arm64` 双架构镜像，也可在 Actions
页面手动触发。

HTTPS、备份恢复、从 Supabase 迁移等完整说明见
**[Docker 部署文档](docs/docker-deployment.md)**。

## 🗄️ 从 Supabase 迁移

- `family_members` 表结构与旧版本兼容；迁移使用 `CREATE TABLE IF NOT EXISTS`，不会删除已有族谱数据。
- Supabase Auth 用户与会话无法直接复用。迁移后需要重新创建账号，或使用 `user create` 命令。
- 旧 Supabase 的 RLS 策略不再使用；迁移会关闭 `family_members` 的 RLS（需要数据库角色拥有该表）。
- 建议先备份数据库，验证数据量后再切换 `DATABASE_URL`。

## 📂 项目结构

```text
/
├── src/                    # 纯 React 前端
│   ├── app.tsx             # React Router 路由表与页面外壳
│   ├── pages/auth/         # 登录与注册
│   └── pages/family-tree/  # 成员管理、配偶关系、照片、2D/3D 图、统计、时间轴、生平册
├── backend/                # Go 后端（二进制入口与全部服务）
│   ├── cmd/server/         # serve / migrate / user / healthcheck
│   └── internal/
│       ├── api/            # 路由、中间件、页面鉴权
│       ├── photo/          # 照片落盘、缩略图生成与清理
│       ├── web/            # go:embed 静态资源与文件服务
│       ├── auth/ store/ family/ gedcom/ database/ config/
│       └── web/dist/       # 构建时复制进来的静态页面（不提交）
├── src/components/         # React 组件
├── src/lib/api/            # API 客户端与共享类型
├── scripts/                # 静态复制、本地启动、配置生成、镜像发布
└── tests/                  # Node 测试；Go 测试位于 backend/internal
```

## 🧪 测试

```bash
npm test          # Node 测试 + Go 测试
npm run test:web  # 仅 Node 测试
npm run test:go   # 仅 Go 测试
npx tsc --noEmit  # TypeScript 类型检查
npm run build     # 类型检查 + Vite 构建并复制到 Go
```

Go 测试覆盖配置校验、密码与会话、导入解析、统计、HTTP/页面鉴权、静态文件服务，
以及照片存储（原图逐字节保留、缩略图尺寸、格式校验、路径穿越防护）。

Node 测试覆盖 API 客户端、数据层、导入解析、运行时配置与自托管配置生成，
以及前端的农历换算、日期选择器与照片灯箱的行为约束（缩放配置、焦点交接、
Esc 逐层关闭、样式引入方式等）。

## 📚 文档

- [后端设计与 API](docs/backend.md)
- [GHCR 镜像与 GitHub Actions](docs/docker-deployment.md#从-ghcr-拉取镜像)
- [Docker 部署与运维](docs/docker-deployment.md)
- [Go 后端说明](backend/README.md)

## 📄 许可证

本项目采用 [MIT](LICENSE) 许可证。
