> **历史文档**：本方案描述的是已被替换的 Supabase 后端。当前实现为 Go + PostgreSQL，见 [`docs/backend.md`](../../backend.md)。

# Docker 部署 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 发布可在启动时配置 Supabase 的多架构镜像，并提供独立持久化的本地 Supabase Compose 方案。

**Architecture:** Next.js standalone 应用镜像配合运行时公开配置。自托管采用 PostgreSQL + GoTrue + PostgREST + 网关独立容器，应用使用内部 API 地址访问而浏览器使用外部地址。

**Tech Stack:** Next.js 16、Node 22、Docker Compose、Apple container、Supabase Auth、PostgreSQL、PostgREST。

**Spec:** docs/superpowers/specs/2026-10-16-docker-deployment.md

## Global Constraints

- 使用中文文档与新注释；不修改既有族谱业务逻辑与真实数据。
- 镜像目标 `docker.io/onehacker/pure-genealogy`，支持 `linux/amd64` 与 `linux/arm64`。
- 配置在容器启动时传入，浏览器仅收到 URL、公开 key、姓氏；内部地址、service_role、数据库口令不可公开。
- 不在镜像内运行 Docker daemon，不把数据库写进应用层；自托管数据库使用持久化卷。
- 默认关闭公开注册，anon 无族谱权限，authenticated 共享族谱读写。
- 用户已授权推送 Docker Hub，不要求二次发布确认；不推送 Git 分支。

### Task 1: 通用应用镜像与运行时配置

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `compose.yml`, `docker/entrypoint.mjs`, `lib/runtime-config.ts`, `components/runtime-config-provider.tsx`, `app/api/health/route.ts`, `tests/runtime-config.test.mjs`。
- Modify: `next.config.ts`, `lib/utils.ts`, `lib/supabase/client.ts`, `lib/supabase/server.ts`, `lib/supabase/proxy.ts`, `lib/supabase/middleware.ts`, `proxy.ts`, `app/layout.tsx`, 所有 FAMILY_SURNAME 调用方, `.env.example`。

**Interfaces:**
- Consumes: `.env.local` 原变量、现有 Supabase SSR cookie 行为。
- Produces: `PublicRuntimeConfig = { supabaseUrl: string; supabasePublishableKey: string; familySurname: string }`；`getPublicRuntimeConfig()` 从动态 env 读取；`getServerSupabaseConfig()` 额外含 `internalUrl?: string`；客户端公开配置 context 和同步读取接口；`/api/health` 返回 `{status:'ok'}`。
- Compose服务名 `app`，端口 `${APP_PORT:-3000}:3000`，镜像 `${GENEALOGY_IMAGE:-onehacker/pure-genealogy:latest}`，容器内 `PORT=3000`、`HOSTNAME=0.0.0.0`。Task 2复用这个配置接口。

- [x] 写实际行为测试并验证失败：运行时 A→B 切换不是构建值；带 `</script>` 的姓氏序列化不会执行脚本；内部地址不进入公开对象；缺少 URL/key 与非 HTTP(S) URL拒绝；服务角色 key拒绝作为公开 key。
```js
assert.equal(getPublicRuntimeConfig({ NEXT_PUBLIC_SUPABASE_URL: 'https://a.example', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', NEXT_PUBLIC_FAMILY_SURNAME: '张' }).familySurname, '张');
```
- [x] 实现配置、动态根布局/context，改造客户端事件中的 createClient 与所有姓氏调用方。关闭 cacheComponents，根布局 `export const dynamic = 'force-dynamic'`，动态 metadata 从请求配置读取。通过公共 URL衍生固定 cookie/storageKey 或服务端 fetch 地址重写保证 cookie一致，不把内部hostname当身份。
- [x] 实现多阶段 standalone Dockerfile 与 entrypoint 校验；entrypoint 使用 Node spawn 转发 SIGTERM/SIGINT（或通过shell exec在验证之后启动Node）；`npm ci` 后 `npm run build` 不依赖真实 Supabase 配置。非root uid1001，健康检查用Node fetch。
```dockerfile
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
EXPOSE 3000
```
- [x] 实现 `compose.yml` 外部模式和环境模板；允许 `SUPABASE_INTERNAL_URL` 空值；build context 不含任何 .env内容。
- [x] 执行 `npm test`、`npx tsc --noEmit --incremental false` 与无真实配置 `npm run build`，确认既有61项测试通过，提交代码并报告。镜像端到端由controller统一运行。

### Task 2: 精简自托管 Supabase、运维与发布工具

**Files:**
- Create: `compose.self-hosted.yml`, `docker/self-hosted/*`, `scripts/setup-self-hosted.mjs`, `scripts/create-admin.mjs`, `scripts/publish-image.sh`, `tests/self-hosted-config.test.mjs`, `docs/docker-deployment.md`, `.github/workflows/docker-image.yml`。
- Modify: `.gitignore`, `README.md`, `.env.example`（仅需要时）, `package.json`, `package-lock.json`, `components/tutorial/fetch-data-steps.tsx`。

**Interfaces:**
- Consumes: Task 1镜像、运行时env接口、`/api/health`。
- Produces: `node scripts/setup-self-hosted.mjs --site-url http://localhost:3000 --supabase-url http://localhost:8000` 创建根 `.env.self-hosted`（拒绝覆盖）；`docker compose --env-file .env.self-hosted -f compose.self-hosted.yml up -d` 启动所有服务；`node --env-file=.env.self-hosted scripts/create-admin.mjs <email>` 交互读取密码（非TTY可通过 ADMIN_PASSWORD环境变量），调用Auth admin API，绝不打印token/password。

- [x] 先修复实际构建发现的存量运行依赖风险：`npm install --save-exact next@16.4.2 --no-audit --no-fund`，并用 `npm update lodash lodash-es nanoid postcss preact source-map-js ws --no-audit --no-fund` 更新兼容范围内的运行依赖。不要升级无关直接依赖或运行audit fix --force；保留xlsx并如实报告其无npm修复的存量告警。锁文件更新后立即通知controller开始双架构构建。修正教程客户端示例为useEffect内调用createClient。
- [x] 实现安全配置生成测试：随机secret/token可验签、不同运行生成不同值、输出权限0600、已有文件拒绝覆盖、无效公网URL拒绝。
```js
assert.notEqual(generateSecrets().jwtSecret, generateSecrets().jwtSecret);
```
- [x] 实现固定版本的 `postgres:17-alpine`、`supabase/gotrue:v2.196.0`、`postgrest/postgrest:v14.17`、`nginx:1.28-alpine` 或官方Kong网关的精简组合。复用官方 Auth schema/roles 模型（GoTrue启动时迁移auth）；PSQL脚本安全传入role密码，不把shell字符串当SQL。PostgREST authenticator为NOINHERIT且只可切换anon/authenticated/service_role；auth admin拥有auth schema；表schema与README现有family_members一致。`auth.uid()`可从JWT读取sub。RLS policy限定authenticated；不新增多租户。
- [x] 网关统一 `/auth/v1/`、`/rest/v1/`，保留浏览器Authorization token，缺省使用公开anon token；配置apikey校验、CORS与OPTIONS。仅网关和app暴露端口，db named volume；所有服务healthcheck和依赖正确。
- [x] 写配置生成及admin创建脚本。`JWT_SECRET`用32字节以上随机；anon/service_role生成HS256 JWT，期限明确。默认`DISABLE_SIGNUP=true`；SMTP可选，文档解释未配置SMTP时不能邮件找回；首次用户通过管理脚本创建并确认邮箱。
- [x] 写中文部署文档：两种模式的复制即用命令、初始化SQL（外部模式）、首次账号、URL/internal URL差异、端口/公网HTTPS/回调、参数、持久化、pg_dump备份/psql恢复、升级不down -v、Apple container多架构build/push与Docker buildx命令；精简服务边界和完整官方栈链接。
- [x] 发布脚本默认仅build，显式`--push`才发布；用户本次controller将用已授权推送。脚本支持container/buildx，两个platform，版本tag和latest。Apple container的context先通过pwd -P解析物理路径，避免/tmp路径bug；若controller验证仍有问题，按实测结果修正。GitHub workflow仅手动或版本tag，Docker Hub secrets `DOCKERHUB_USERNAME`、`DOCKERHUB_TOKEN`，仓库目标onehacker/pure-genealogy，无真实secret。
- [x] 执行测试、Compose静态校验（CLI由controller提供），提交报告。真实服务集成由controller执行并回传缺陷修复。
