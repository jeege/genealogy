# Docker 部署与运维

应用镜像：`ghcr.io/jeege/genealogy`，支持 `linux/amd64`、`linux/arm64`。
镜像内只有一个 Go 进程：前端静态页面已通过 `go:embed` 打进二进制，只需要一个外部
PostgreSQL（Compose 会一并启动）。
生产环境建议固定版本标签，`latest` 用于跟随最新发布。

一个部署共享一份族谱，所有已登录用户都可以查看、增删改成员。
这里的“管理员”只是创建账号的运维操作，应用没有不同权限级别或多租户隔离。

## 方式一：Compose 一键本地栈

适用于安装了 Docker 与 Compose v2.20+ 的主机。生成配置的脚本需要 Node.js 22；没有 Node 时也可以手动复制 `.env.example` 并填写。

### 1. 生成配置

```bash
git clone https://github.com/yunfengsa/pure-genealogy.git
cd pure-genealogy
node scripts/setup-self-hosted.mjs \
  --site-url http://localhost:3000 \
  --admin-email you@example.com
```

脚本会生成 `.env.self-hosted`（权限 `0600`），内容包括：

- 随机 PostgreSQL 密码与 `DATABASE_URL`；
- 随机初始管理员密码（同时打印一次）；
- `ALLOW_SIGNUP=false`、`APP_ORIGIN`、会话有效期等。

如不希望脚本生成管理员，可省略 `--admin-email`，启动后使用
`docker compose exec` 创建账号（见下文）。

### 2. 启动

```bash
docker compose --env-file .env.self-hosted up -d --build
```

默认访问 `http://localhost:3000`。

### 3. 常用命令

```bash
# 查看状态与日志
docker compose --env-file .env.self-hosted ps
docker compose --env-file .env.self-hosted logs -f app

# 停止（保留数据库卷）
docker compose --env-file .env.self-hosted down

# 停止并删除数据库（危险）
docker compose --env-file .env.self-hosted down -v
```

## 方式二：连接已有 PostgreSQL

复制 `.env.example` 为 `.env` 并修改：

```dotenv
SITE_URL=https://genealogy.example.com
APP_PORT=3000
POSTGRES_PASSWORD=仅用于本地 db 服务
DATABASE_URL=postgres://user:pass@db.example.com:5432/genealogy?sslmode=require
FAMILY_SURNAME=刘
ALLOW_SIGNUP=false
ADMIN_EMAIL=you@example.com
ADMIN_PASSWORD=change-me-please
```

如果数据库已在别处运行，只需启动应用容器并跳过 Compose 中的 db 依赖：

```bash
docker compose --env-file .env up -d --no-deps app
```

或直接使用 `docker run`：

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

容器内的 Go 进程监听 `0.0.0.0:8080`，只需映射这一个端口。

## 账号管理

### 初始管理员

设置 `ADMIN_EMAIL` 与 `ADMIN_PASSWORD` 后，首次启动且数据库没有账号时会自动创建。
密码至少 8 个字符、最多 72 个字节。创建成功后建议从环境变量中移除密码。

### 使用 CLI 创建或重置

```bash
# 创建账号
docker compose --env-file .env.self-hosted exec \
  -e ADMIN_PASSWORD='change-me-please' app \
  genealogy-server user create --email user@example.com

# 修改密码并撤销该用户旧会话
docker compose --env-file .env.self-hosted exec \
  -e ADMIN_PASSWORD='change-me-please' app \
  genealogy-server user set-password --email user@example.com
```

### 公开注册

`ALLOW_SIGNUP=false` 时注册接口返回 `403`。如需开放注册，将其改为 `true` 后重启容器。
公开注册没有邮件验证，请自行评估风险。

## 数据库迁移

- `AUTO_MIGRATE=true`（默认）时，Go API 启动会执行 `backend/internal/database/migrations/` 中的内嵌迁移。
- 也可手动执行：

```bash
docker compose --env-file .env.self-hosted exec app genealogy-server migrate
```

- 迁移只创建缺失的表与索引，不删除 `family_members` 数据。
- 从旧 Supabase 数据库迁移时，Auth 用户与会话无法复用；需要重建账号。
- 迁移会关闭 `family_members` 的 RLS（要求 `DATABASE_URL` 对应的角色拥有该表）。
  建议迁移前备份。

## HTTPS 与反向代理

应用容器监听 HTTP 8080（宿主机默认映射到 3000），TLS 由反向代理终止。以 Caddy 为例：

```caddyfile
genealogy.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

要点：

- 设置 `SITE_URL=https://genealogy.example.com`；
- 反向代理应传递 `Host`、`X-Forwarded-Proto`、`X-Forwarded-For`；
- `COOKIE_SECURE=auto` 会根据 `X-Forwarded-Proto` 设置 Secure Cookie，也可强制 `true`；
- 应用校验写请求的 `Origin`，因此 `APP_ORIGIN` 必须是浏览器实际访问的源地址。

## SMTP 与密码重置

配置以下变量后，重置密码会发送邮件：

```dotenv
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=noreply@example.com
SMTP_PASS=your-smtp-password
SMTP_FROM=noreply@example.com
```

- 端口 465 使用隐式 TLS，其他端口使用 STARTTLS；
- 未配置 SMTP 时，接口仍返回成功，但一次性重置链接会写入 API 日志：

```bash
docker compose --env-file .env.self-hosted logs app | grep '密码重置链接'
```

日志中的链接等同于账号重置权限，请限制日志访问并及时清理。

## 备份与恢复

### 备份

```bash
docker compose --env-file .env.self-hosted exec -T db \
  pg_dump -U genealogy -Fc genealogy > genealogy-$(date +%F).dump
```

### 恢复

```bash
docker compose --env-file .env.self-hosted stop app
docker compose --env-file .env.self-hosted exec -T db \
  pg_restore -U genealogy -d genealogy --clean --if-exists < genealogy-2026-10-26.dump
docker compose --env-file .env.self-hosted start app
```

恢复后旧会话仍然有效，直到过期；如需强制所有用户重新登录，可清空 `sessions` 表。

## 升级

```bash
git pull
docker compose --env-file .env.self-hosted up -d --build
```

Go API 会在启动时自动执行新迁移。建议先备份数据库，并固定镜像版本标签以便回滚。
升级后浏览器可能仍持有旧 Cookie；若遇到异常，清除站点 Cookie 后重新登录。

## 健康检查与排障

```bash
# 容器内健康检查
docker compose --env-file .env.self-hosted exec app genealogy-server healthcheck

# 宿主机访问
curl -fsS http://localhost:3000/api/health
```

常见问题：

| 现象 | 排查 |
| --- | --- |
| 容器反复重启 | `logs app`；确认 `DATABASE_URL` 可连接、数据库已启动 |
| 登录后仍跳回登录页 | 检查 `APP_ORIGIN` 是否为浏览器实际地址；HTTPS 下 `COOKIE_SECURE` |
| 收不到重置邮件 | `logs app`；检查 SMTP；未配置 SMTP 时查日志中的重置链接 |
| 迁移失败 | 确认数据库角色拥有 `public` schema 与 `family_members` 表 |
| 页面显示数据库错误 | 检查 `DATABASE_URL` 的 `sslmode`、网络白名单与连接数 |
| 页面 404 但 API 正常 | 镜像构建时未包含前端，请用仓库 Dockerfile 重新构建 |

## 从 GHCR 拉取镜像

镜像发布在 GitHub Container Registry：`ghcr.io/jeege/genealogy`。

公开仓库的包默认继承仓库可见性；若包被设为私有，需要先登录：

```bash
echo "$GITHUB_TOKEN" | docker login ghcr.io -u <你的 GitHub 用户名> --password-stdin
docker pull ghcr.io/jeege/genealogy:latest
```

可用标签：

| 触发方式 | 生成的标签 |
| --- | --- |
| 推送到 `main` | `main`、`sha-<短提交>`、`latest` |
| 推送 `v1.2.3` 标签 | `1.2.3`、`1.2`、`sha-<短提交>` |
| 手动触发并填写版本 | 该版本号（同时保留分支/sha/latest 中适用的标签） |

## 使用 GitHub Actions 发布镜像

工作流 [`.github/workflows/docker-image.yml`](../.github/workflows/docker-image.yml) 在以下情况运行：

- 推送到 `main`（仅文档类改动会跳过）；
- 推送 `v*` 标签；
- 在 Actions 页面手动运行，可填写自定义版本标签。

流程依次执行 `npm ci`、`npm test`（Node + Go）、`tsc --noEmit`、静态导出与
Go 单二进制构建校验，然后用 Buildx 构建 `linux/amd64` 与 `linux/arm64` 双架构镜像并推送。
构建使用 GitHub Actions 缓存与 `GITHUB_TOKEN`，**无需配置任何仓库密钥**。

仓库设置要点：

1. Settings → Actions → General → Workflow permissions 选择
   “Read and write permissions”，或确认 `packages: write` 生效；
2. 首次推送后到 Packages 页面确认包可见性（公开项目建议设为 Public）；
3. 私有包需要拉取时，使用带 `read:packages` 的 Personal Access Token。

## 本地手动发布

```bash
docker login ghcr.io -u <用户名>   # 或 echo $TOKEN | docker login ghcr.io -u <用户名> --password-stdin

# 仅构建双架构 OCI 归档，不推送
bash scripts/publish-image.sh --engine buildx --version 2026.10.26

# 构建并推送到 ghcr.io/jeege/genealogy
bash scripts/publish-image.sh --engine buildx --version 2026.10.26 --push
```

可用 `GENEALOGY_REPOSITORY` 覆盖目标仓库，例如 `GENEALOGY_REPOSITORY=ghcr.io/其他用户/其他仓库`。
Dockerfile 先执行 `npm run build` 生成静态页面，再复制进 `backend/internal/web/dist`
并 `go build`，最终镜像只包含一个静态链接的 Go 二进制。
