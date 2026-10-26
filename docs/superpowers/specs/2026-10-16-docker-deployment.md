> **历史文档**：本方案描述的是已被替换的 Supabase 后端。当前实现为 Go + PostgreSQL，见 [`docs/backend.md`](../../backend.md)。

# Docker 与 Supabase 自托管部署设计

## 目标与范围

解决 #5、#11 的部署门槛，参考但不直接合入尚未合并的 PR #8。发布 `docker.io/onehacker/pure-genealogy` 通用应用镜像，支持 Linux amd64 和 arm64。Mac 本次优先使用 Apple container 1.1.0 构建、运行及推送，Docker/Compose 用户使用同一 OCI 镜像。

## 架构

1. 外部模式：单个 Next.js standalone 应用容器，连接云端或已有自托管 Supabase。
2. 自托管模式：Compose 一起启动应用、PostgreSQL、Supabase Auth (GoTrue)、PostgREST、API 网关。这是满足当前应用所需的精简 Supabase 服务组合；不宣称包含 Studio、Storage、Realtime、Edge Functions。完整官方 Supabase 栈亦可作为外部模式接入。
3. 不把数据库/守护进程嵌进应用镜像，也不在镜像内启动 Docker daemon。数据库用独立持久化卷，应用替换不改变数据；当前项目是一个部署共享一份族谱，所有授权用户可编辑。

## 运行时配置

同一镜像通过启动环境设置 `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`、`NEXT_PUBLIC_FAMILY_SURNAME`。不通过 build-arg 固化，不扫描替换构建产物。支持旧 anon key，绝不将 service_role 或数据库口令发送到浏览器。新增可选 `SUPABASE_INTERNAL_URL` 仅用于服务端网络，SSR 与浏览器必须共享同一身份 cookie 名称。URL 必须是 HTTP(S) API 地址，不是数据库连接串。

Next.js 使用动态根布局和显式公开配置传递，关闭 cacheComponents 并说明为动态部署配置作出的取舍；保留现有页面 Suspense。运行时公开配置只含 URL、公开 key、姓氏，内联 JSON 必须防止 script 注入。客户端 surname 使用 Context，服务端在请求内读取，不使用构建时模块常量。登录预填充密码不进入镜像。

## 镜像与发布

多阶段 Node 22 Debian slim，npm ci 使用现有锁文件；standalone 运行，非 root，监听 0.0.0.0:3000，健康路由 `/api/health` 无鉴权且不依赖外部 Supabase 可达性。缺失/非法必需配置在启动时报错，避免容器健康但不能使用。Docker context 排除 `.env*`、git、node_modules、测试产物、工作记录等，不复制用户真实配置。使用版本标签与 latest。只有完成真实镜像验证后推送，用户已明确授权此仓库发布，无需二次确认；凭证通过 CLI 登录，不进入代码或聊天。

## 自托管安全与运维

使用固定版本的官方服务镜像，初始化角色、auth schema、family_members 表、RLS 和索引。anon 无族谱读写，authenticated 可读写，默认关闭公开注册，提供创建首位用户的命令。随机生成密码/JWT secret/anon/service role token，配置文件权限 0600，避免覆盖已有配置。服务端密钥不打印到日志。仅应用/API 网关发布端口，Postgres 不暴露主机端口。提供备份、恢复、升级、SMTP及公网地址说明。不执行已有数据库迁移或真实账号写入。

## 验收

- 单元测试覆盖运行时选择、浏览器公开配置、内部地址与cookie一致性、配置校验及生成文件防覆盖。
- 同一个镜像以两套运行时配置启动，浏览器看到不同姓氏与 API 地址，静态包不含真实凭证。
- 实际运行自托管组件：创建测试用户、登录、SSR会话、成员增查改删、匿名拒绝访问、重启持久化。
- Compose 配置解析、61项原测试、类型检查、生产构建；实际 amd64/arm64镜像启动验证。
- Docker Hub 推送成功并从远程 manifest 验证两个架构与标签。若登录缺失，完成所有本地工作后仅报告发布阻塞。

## 依据

- https://supabase.com/docs/guides/self-hosting/docker
- https://nextjs.org/docs/app/guides/self-hosting
- https://github.com/apple/container/blob/main/docs/command-reference.md
- https://github.com/yunfengsa/pure-genealogy/issues/5
- https://github.com/yunfengsa/pure-genealogy/issues/11

## 实施发现与调整

首轮真实构建的 `npm audit --omit=dev` 发现 Next.js 16.1.1 存量严重漏洞，官方已提供修复（https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4）。发布前固定Next.js 16.4.2，并更新范围内可兼容修复的运行依赖；不执行 `npm audit fix --force`，不替换Excel导入库。残余第三方问题必须如实记录。
Apple container 1.1.0 对 `/tmp` 符号链接路径构建上下文存在已知问题（https://github.com/apple/container/issues/2037）；构建脚本先解析 `pwd -P` 再使用物理绝对路径，并以真实构建验证。


## 实际验收记录

- 74/74测试、TypeScript、无真实Supabase配置的Linux amd64/arm64生产构建通过。
- Docker Compose配置解析通过。本次Mac使用Apple container运行同等服务配置（测试器将Compose服务DNS名映射为容器IP），没有运行Docker daemon；因此不把本机验收表述为执行过`docker compose up`。
- 全新数据库初始化、GoTrue70项迁移、15项真实API集成通过：账号创建/登录/刷新、认证成员增查改删、父子关系、匿名拒绝、注册默认关闭。
- 管理脚本真实创建测试账号成功，数据库重启后数据保留；Chrome实际登录、SSR身份、成员表单增删、2D/3D和统计通过。
- 同一镜像两套配置分别显示不同姓氏/API；amd64外部模式未设置内部URL也能查询，arm64内部URL模式与浏览器会话一致。两架构实际运行，非root uid1001、无.env。
- 修复实际环境发现：Postgres卷根目录lost+found、Nginx长JWT map哈希、上游重复CORS、Docker误加载Vercel Analytics、UTC/浏览器时区导致的hydration差异。最终成员列表和3D页面console无error/warn。
- Next.js固定16.4.2，兼容运行依赖修复后生产audit仅剩原xlsx高危告警（npm无修复）。未替换Excel库，详见部署文档。SMTP/OAuth没有实发测试；默认管理员创建流程不依赖邮件。
- Task1、Task2定点审查与最强模型整体审查均Approved；主工作区原业务数据未改。

## 发布结果

- 已使用本机 Apple container 推送到 [Docker Hub](https://hub.docker.com/r/onehacker/pure-genealogy/tags)：`2026.10.16`、`latest`。
- 远程注册表原始 OCI manifest 与 Docker Hub tags API 双重验证：两个标签均含 `linux/amd64` 和 `linux/arm64`。
- 两个标签及本地已测试镜像的 OCI index digest 一致：`sha256:fe6901436b63e64cd79635e104cccbbd6ee34156e238fc47a3a746d73f434c94`。
- 42个交付文件已同步当前主工作区；Git分支未推送。测试容器/卷/网络/临时密钥已清理，原开发服务保持可用。
