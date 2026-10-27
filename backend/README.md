# Go 后端

族谱系统的 HTTP API、认证、PostgreSQL 访问层，以及内嵌的 React（Vite）静态前端。
构建完成后就是一个可执行文件。完整配置与接口说明见
[`docs/backend.md`](../docs/backend.md)。

## 构建内嵌前端

```bash
# 仓库根目录
npm run build          # Vite 构建并复制到 backend/internal/web/dist
npm run build:binary   # 再执行 go build，产出 ./pure-genealogy
```

`internal/web` 通过 `//go:embed all:dist` 嵌入静态资源；`dist/` 由构建脚本生成，
不提交到仓库。未执行前端构建时，`go build` 仍可成功，页面返回 404，`/api/*` 正常。

## 快速开始

```bash
# 需要一个可连接的 PostgreSQL 数据库
export DATABASE_URL='postgres://genealogy:change-me@127.0.0.1:5432/genealogy?sslmode=disable'
export APP_ORIGIN='http://localhost:3000'
export ALLOW_SIGNUP=true

go run ./cmd/server serve
```

在前端仓库根目录也可以使用 `npm run dev:api`，它会自动读取 `.env` 与 `.env.local`。

API 默认监听 `127.0.0.1:8080`。健康检查：

```bash
curl http://127.0.0.1:8080/api/health
```

首次启动会自动执行内嵌迁移。也可以单独执行：

```bash
go run ./cmd/server migrate
```

## 创建账号

```bash
ADMIN_PASSWORD='change-me-please' go run ./cmd/server user create --username you@example.com
```

## 测试

```bash
go test ./...
```

## 运行单个二进制

```bash
DATABASE_URL='postgres://genealogy:change-me@127.0.0.1:5432/genealogy?sslmode=disable' \
APP_ORIGIN='http://localhost:8080' \
API_HOST=127.0.0.1 API_PORT=8080 \
FAMILY_SURNAME='刘' ALLOW_SIGNUP=true \
./pure-genealogy serve
```

打开 <http://localhost:8080>。

## 目录

```text
cmd/server/                 启动、迁移、账号管理与健康检查
internal/api/               HTTP 路由、中间件、页面鉴权与 handler
internal/web/               go:embed 静态资源与文件服务
internal/auth/              bcrypt、用户名校验与会话
internal/config/            环境变量校验
internal/database/          pgx 连接池与内嵌迁移
internal/domain/            共享数据结构与错误
internal/family/            导入规则与统计（纯函数）
internal/store/             PostgreSQL 持久化
```

## 依赖

- `github.com/jackc/pgx/v5`：PostgreSQL 驱动与连接池
- `golang.org/x/crypto/bcrypt`：密码散列

Go 版本要求见 `go.mod`（1.24）。
