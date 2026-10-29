# 后端设计与 API

## 概览

后端位于 `backend/`，使用 Go 1.24、标准库 `net/http` 与 `pgx` 直接访问 PostgreSQL。
它取代了原先的 Supabase PostgREST 与 GoTrue：

| 原实现 | 现实现 |
| --- | --- |
| Supabase PostgREST 查询 | Go `internal/store` 中的 SQL |
| Supabase Auth 邮箱密码 | Go `internal/auth` + bcrypt + 服务端会话（用户名登录） |
| RLS 授权 | Go 认证中间件（所有登录用户共享一份族谱） |
| Supabase 行数上限分页 | 单次查询返回完整结果 |
| Supabase 邮件与找回密码 | 已移除；忘记密码由管理员用 `user set-password` 重置 |

前端是 React + Vite 的纯客户端 SPA，构建时输出 `dist/` 并复制到
`backend/internal/web/dist`，通过 `//go:embed` 嵌入 Go 二进制。浏览器与 Go 同源，
认证与数据请求直接访问 `/api/*`；Go 在返回族谱 HTML 前校验会话，静态资源公开。
数据库连接串不会进入浏览器。

## 运行时配置

| 变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `DATABASE_URL` | 是 | — | `postgres://user:pass@host:5432/db?sslmode=...`；也支持 `postgresql://` |
| `FAMILY_SURNAME` | 否 | `刘` | 运行时姓氏，由 `GET /api/config` 提供给前端 |
| `API_HOST` | 否 | `127.0.0.1` | 监听地址；容器内使用 `0.0.0.0` |
| `API_PORT` | 否 | `8080` | 监听端口；Compose 默认映射到宿主机 3000 |
| `APP_ORIGIN` | 否 | — | 站点源地址；设置后校验写请求的 `Origin`，多个用逗号分隔（如 `http://localhost:3000,http://127.0.0.1:3000`） |
| `SESSION_TTL` | 否 | `720h` | 会话有效期，1h 至 8760h |
| `BCRYPT_COST` | 否 | `12` | 4–15；测试可使用 4 |
| `ALLOW_SIGNUP` | 否 | `true` | `false` 时关闭公开注册 |
| `AUTO_MIGRATE` | 否 | `true` | 启动时执行内嵌迁移 |
| `COOKIE_SECURE` | 否 | `auto` | `auto` / `true` / `false`；auto 读取 TLS 或 `X-Forwarded-Proto` |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | 否 | — | 首次启动且无账号时创建初始管理员，必须成对设置；用户名不限制字符 |
| `LOG_LEVEL` | 否 | `info` | `debug` / `info` / `warn` / `error` |

生产环境建议：

- `DATABASE_URL` 使用 `sslmode=require` 或 `verify-full`；
- 设置 `APP_ORIGIN` 为真实 HTTPS 地址；
- 关闭 `ALLOW_SIGNUP`，通过 `ADMIN_*` 或 CLI 创建账号。

## 认证与会话

1. 注册或登录时，Go API 生成 32 字节随机令牌，浏览器收到 HttpOnly 的
   `genealogy_session` Cookie。
2. 数据库 `sessions` 表只保存令牌的 SHA-256 散列；会话默认 30 天过期。
3. Go 静态处理器在返回 `/` 与 `/family-tree/*` 的 HTML 前校验会话；未登录跳转 `/auth/login/`。`/assets/*`、`/images/*` 与带扩展名的静态资源无需登录。
4. 前端数据请求遇到 `401` 时由 `lib/api/client.ts` 跳转登录页。
5. 退出登录删除服务端会话并清除 Cookie。
用户名为唯一登录标识，**不限制字符集**：中文、空格、符号、邮箱样式均可，
仅拒绝空、超长（>256 字节）与控制字符。比较时统一去首尾空白并转小写，
因此「张三」与「 张三 」是同一账号。数据库中 `lower(username)` 有唯一索引。

本系统**没有忘记密码功能**：不存在 SMTP 与重置令牌。忘记密码时由管理员执行
`user set-password` 重置，该命令会撤销目标用户的全部会话。

密码使用 bcrypt（默认 cost 12）散列，长度 8 个字符以上且不超过 bcrypt 的 72 字节上限。
登录不存在的用户时也会执行一次 bcrypt，降低账号枚举的时序差异。

## HTTP API

所有响应为 JSON（204 除外），错误格式为 `{"error":"中文提示"}`。
除健康检查和认证接口外，所有接口需要有效会话 Cookie。

### 健康检查

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/health` | 数据库可用时 `200 {"status":"ok","database":"ok"}`，否则 `503` |
| `GET` | `/api/config` | 返回 `{"familySurname":"刘"}`，供静态前端读取运行时姓氏 |

### 认证

| 方法 | 路径 | 请求体 | 说明 |
| --- | --- | --- | --- |
| `POST` | `/api/auth/signup` | `{username,password}` | 创建账号并登录；受 `ALLOW_SIGNUP` 控制 |
| `POST` | `/api/auth/login` | `{username,password}` | 登录并设置会话 Cookie |
| `POST` | `/api/auth/logout` | — | 撤销当前会话并清除 Cookie |
| `GET` | `/api/auth/session` | — | 返回 `{user}`；未登录 `401` |
| `POST` | `/api/auth/password/change` | `{current_password,new_password}` | 修改当前用户密码 |

### 族谱成员

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/family-members?page=1&page_size=50&search=刘` | 分页列表，`page_size` 最大 200 |
| `GET` | `/api/family-members/all` | 全部成员（2D/3D 图） |
| `GET` | `/api/family-members/select` | 父亲下拉候选 |
| `GET` | `/api/family-members/timeline` | 时间轴字段 |
| `GET` | `/api/family-members/biography` | 有实质生平内容的成员 |
| `GET` | `/api/family-members/{id}` | 单个成员（含父亲姓名与配偶摘要） |
| `GET` | `/api/family-members/{id}/marriages` | 某成员的全部婚姻（含状态与日期） |
| `POST` | `/api/marriages` | 新增配偶关系 |
| `PUT` | `/api/marriages/{id}` | 更新配偶关系（状态、结婚/离异日期） |
| `DELETE` | `/api/marriages/{id}` | 解除配偶关系 |
| `POST` | `/api/family-members` | 新增 |
| `PUT` | `/api/family-members/{id}` | 更新（全量字段） |
| `DELETE` | `/api/family-members` | 请求体 `{ids:[...]}`，最多 1000 条 |
| `POST` | `/api/family-members/import/preview` | 请求体 `{members:[...]}`，校验并返回父亲匹配 |
| `POST` | `/api/family-members/import` | 请求体 `{members:[...]}`，事务内批量导入 |
| `GET` | `/api/family-members/gedcom` | 导出 GEDCOM 5.5.1 文件（`attachment`） |
| `POST` | `/api/family-members/gedcom/preview` | 预览 GEDCOM 规模、告警与未映射标签 |
| `POST` | `/api/family-members/gedcom/import` | 事务内导入 GEDCOM，可 `replace` |
| `GET` | `/api/family-members/{id}/photos` | 某成员的照片列表（含 `url`/`thumbnail_url`） |
| `POST` | `/api/family-members/{id}/photos` | 上传照片（`multipart/form-data`，字段 `photos` 可多值） |
| `PUT` | `/api/photos/{photoID}` | 修改照片说明 `{caption}` |
| `DELETE` | `/api/photos/{photoID}` | 删除照片（同时清理磁盘文件） |
| `GET` | `/api/photos/{memberID}/{file}` | 照片原图/缩略图二进制，需登录 |
| `GET` | `/api/statistics` | 统计仪表盘数据 |

成员可空字段使用 `null`；日期格式为 `YYYY-MM-DD`。
更新时 `father_id: null` 表示清空父亲。后端会校验父亲存在、禁止自引用，
并用递归查询阻止父子关系成环。

### 成员照片

一位成员可以挂多张照片，**原图保留原样**（不重编码，保留 EXIF），同时生成缩略图：

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `PHOTO_STORAGE_DIR` | `data/photos` | 照片根目录；容器内为 `/data/photos` |
| `PHOTO_MAX_BYTES` | `10485760`（10 MB） | 单张大小上限，允许 64 KB ~ 50 MB |
| `PHOTO_THUMBNAIL_MAX_EDGE` | `480` | 缩略图最长边像素，允许 64 ~ 2048 |

- 磁盘布局：`<根目录>/<成员ID>/<随机token>.<ext>` 与 `.thumb.<ext>`；
  文件名用随机 token，不复用原始文件名，避免路径穿越与重名覆盖。
- 数据库 `member_photos` 只存**相对路径**，URL 由 API 按前缀拼出，
  换存储位置或反代前缀不需要刷库。
- 缩略图按最长边等比缩放（CatmullRom），JPEG/PNG 保持原格式，
  GIF/WebP 转 JPEG 并铺白底；带透明通道的图不会变黑。
- 不支持格式、像素过多（> 8000 万）、超出大小上限都会返回 400 且不留残文件。
- 批量上传中途失败会回滚已入库的记录与文件；删除成员时其照片文件一并清理。
- 上传走 `multipart/form-data`，前端不复用 JSON 客户端（那会固定 Content-Type）。
- 前端预览用 **PhotoSwipe**（`photoswipe` 5.x）灯箱：自带手势缩放、滑动切换、
  键盘导航；**动态导入**（`import("photoswipe/lightbox")` + CSS 按需加载），
  只有首次点开大图才加载约 60KB 核心库，不计入首屏包体。
  PhotoSwipe 5 不自带标题，通过 `uiRegister` 注册 `photo-caption` 元素显示照片说明。

### 配偶关系

配偶关系只存放在 `marriages` 表；成员上不再有自由文本的配偶字段
（`family_members.spouse` 已在迁移 `005_drop_member_spouse.sql` 中删除）：

| 字段 | 说明 |
| --- | --- |
| `husband_id` / `wife_id` | 两位成员的 ID；`wife_id` 可为空，表示只知配偶姓名 |
| `status` | `married` / `divorced` / `widowed` |
| `married_on` / `divorced_on` | 日期（`YYYY-MM-DD`） |
| `married_on_raw` / `divorced_on_raw` | GEDCOM 原始日期文本（如 `ABT 1955`） |
| `note` | 备注 |

- 一位成员可以有多段婚姻；同一对成员之间最多一段记录（唯一索引）。
- 成员列表与关系图通过批量查询附带 `spouses` 摘要，不产生 N+1。
- 新增/更新成员时可传 `spouse_ids`：不传表示不改变现有关系，传空数组表示解除全部配偶。
- 删除成员会级联删除其婚姻记录（`ON DELETE CASCADE`）。
- 删除仍被子女引用的成员仍会返回 `409`，需要先处理父子关系。

### 批量导入

- 父亲按「姓名 + 上一世代」匹配，可来自数据库已有成员或同一导入文件。
- 同一键存在多个候选时拒绝导入，并给出具体行号。
- 按世代从父到子写入；每批 200 条；整个过程在单个数据库事务中完成，失败自动回滚。
- 空 Slate 文档（如 `[{"children":[{"text":"  "}]}]`）不计为生平内容。

## GEDCOM 导入导出

支持 GEDCOM 5.5.1 子集，可与主流族谱软件（Ancestry、Gramps、MyHeritage、
国内族谱工具）交换数据。

### 支持的标签

| 内容 | 标签 |
| --- | --- |
| 个人记录 | `INDI`、`NAME`（`GIVN`/`SURN`） |
| 性别 | `SEX`（M/F） |
| 生卒 | `BIRT`/`DEAT` 的 `DATE`、`PLAC` |
| 世系关系 | `FAM` 的 `HUSB`/`WIFE`/`CHIL`、`FAMC` |
| 婚姻 | `MARR`/`DIV` 的 `DATE`，映射为 `marriages` 记录 |
| 其他档案 | `OCCU`（官职）、`RESI`（居住地）、`NOTE`（生平） |
| 本系统扩展 | `_GENC`（世代）、`_SIBO`（排行）、`_ALIV`（在世）；旧版 `_SPO`（配偶文本）仅被识别并忽略 |

### 导入行为

- 世代由父亲链推导；无法确定时留空，导入后按根节点深度补全。
- 排行取同一 `FAM` 内 `CHIL` 的顺序。
- 父亲不在文件中时按无父成员写入，并在预览中给出告警。
- `NOTE` 支持共享备注指针（`@N1@`）。
- 日期原始文本（如 `ABT 1850`、`BEF 12 MAR 1900`）保存在 `birth_date_raw` /
  `death_date_raw`，可精确导回；同时尽力解析出 `YYYY-MM-DD` 供统计与时间轴使用。
- 姓名支持标准 `名 /姓/` 与国内常见的 `姓/名/` 两种写法。
- 编码：JSON 请求体按 UTF-8；直接上传原始内容时后端自动识别 UTF-8 与 GB18030（GBK）。
- 整份文件在单个事务中写入；`replace: true` 会先清空族谱，失败则整体回滚。

### 导出行为

- 每个有子女的成员生成一个 `FAM` 记录；父亲不在导出集合内的成员不写 `FAMC`，
  避免产生悬空指针。
- 富文本生平（Slate JSON）导出为纯文本 `NOTE`，每段一行。
- 行尾使用 CRLF，编码 UTF-8。
- 文件名形如 `刘家族-20261026.ged`；`Content-Disposition` 同时提供 ASCII 回退名。

### 命令行

```bash
# 导出（需要先登录取得会话 Cookie）
curl -b cookies.txt -o family.ged http://127.0.0.1:8080/api/family-members/gedcom

# 预览与导入原始文件（自动识别编码）
curl -b cookies.txt -H 'Content-Type: text/plain' \
  --data-binary @family.ged http://127.0.0.1:8080/api/family-members/gedcom/preview
curl -b cookies.txt -H 'Content-Type: text/plain' \
  --data-binary @family.ged http://127.0.0.1:8080/api/family-members/gedcom/import
```

### 已知限制

- 配偶关系以 `HUSB`/`WIFE` 二元建模，不支持 GEDCOM 中同一家庭的多配偶并列写法。
- 忽略 `SOUR`、`OBJE`（多媒体）、`ADDR` 结构化地址、LDS 与自定义事件。
- 不支持事件级来源与引文。

## 公历与农历

前端提供「公历 / 农历」展示与输入切换，**后端与数据库格式不变**：

- 接口与表结构始终使用公历 `YYYY-MM-DD`（`birthday`、`death_date`，以及
  GEDCOM 原始日期列 `birth_date_raw` / `death_date_raw`）。
- 农历换算完全在前端完成，基于浏览器的 `Intl` 中国历法数据，不新增依赖、不改库。
- 支持闰月（如 2023 年闰二月），非法农历日期（小月三十、不存在的闰月）会被拒绝并提示。
- 统计、时间轴刻度、GEDCOM 导出仍按公历处理，避免历法差异写入数据。

## 数据库

迁移文件位于 `backend/internal/database/migrations/`，编译进二进制，启动时自动执行：

- `users`：用户名（`lower(username)` 唯一，不限制字符集）、bcrypt 散列；
- `sessions`：会话令牌散列、过期时间；
- `family_members`：与旧 Supabase 结构兼容，新增 `birth_date_raw`/`death_date_raw`
  保存 GEDCOM 原始日期文本；
- `schema_migrations`：已执行版本。

`family_members` 使用 `father_id` 自引用外键（默认 `NO ACTION`）。删除仍有子女的成员会返回
`409`，需要先处理子女关系。

**旧库升级**：`004_username_login.sql` 会把 `users.email` 原地改名为 `username`
（原值保留，因此原本用邮箱登录的账号可继续用同样的字符串登录），重建
`lower(username)` 唯一索引，并删除不再使用的 `password_reset_tokens` 表。

## 静态前端与构建

```bash
npm run build          # tsc --noEmit + vite build，并复制到 backend/internal/web/dist
npm run build:binary   # 再执行 go build，产出仓库根目录的 pure-genealogy
```

生成的单一二进制同时提供页面与 API：

```bash
DATABASE_URL='postgres://...' APP_ORIGIN='http://localhost:8080' ./pure-genealogy serve
```

- 静态资源路径：`/assets/*`（Vite 带哈希产物）长缓存，`/images/*` 等 1 天缓存，`index.html` 不缓存。
- 未匹配的页面路径回退到 `index.html`（SPA history 路由）；缺失的 JS/CSS 仍返回 404。
- 无扩展名目录自动 301 到带 `/` 的地址。
- 未构建前端时二进制仍可启动，`/api/*` 正常，页面返回 404。
- 开发时可使用 `npm run dev:api` + `npm run dev`；Vite 开发服务器通过
  `DEV_API_PROXY_TARGET`（默认 `http://127.0.0.1:8080`）代理 `/api`。

## CLI

```bash
cd backend

# 启动 API
go run ./cmd/server serve

# 只执行迁移
go run ./cmd/server migrate

# 创建账号（密码优先取 ADMIN_PASSWORD，也可从标准输入读取）
ADMIN_PASSWORD='change-me' go run ./cmd/server user create --username 管理员

# 修改密码并撤销该用户旧会话
ADMIN_PASSWORD='change-me' go run ./cmd/server user set-password --username 管理员

# 检查本机 API
API_PORT=8080 go run ./cmd/server healthcheck
```

## 安全说明

- 会话与重置令牌均为不透明随机值，数据库泄露不会直接得到可用令牌。
- Cookie 为 HttpOnly、SameSite=Lax；生产 HTTPS 下请保持 `COOKIE_SECURE=auto` 或 `true`。
- 写请求在设置 `APP_ORIGIN` 时校验 `Origin`，防止跨站写操作；`localhost` 与 `127.0.0.1` 是不同来源，需同时列出或统一访问方式。
- 建议在反向代理层增加登录限速与 TLS 终止；二进制默认只监听 `127.0.0.1`，容器内设置为 `0.0.0.0`。
- 忘记密码由管理员执行 `user set-password` 重置；该操作会撤销目标用户全部会话。
- 本项目是单部署共享一份族谱，所有登录用户权限相同，不是多租户权限模型。

## 测试

```bash
npm run test:go
npx tsc --noEmit
npm run test:web
```

Go 测试位于各包内，覆盖配置校验、认证服务、导入、统计与 HTTP handler。

## 静态资源缓存策略

| 路径 | Cache-Control | 原因 |
| --- | --- | --- |
| `/assets/*` | `public, max-age=31536000, immutable` | Vite 产物文件名带内容哈希 |
| `index.html` | `no-cache` | 每次确认，避免发版后引用旧资源 |
| 其他（图片、字体等） | `public, max-age=86400` | 普通静态资源 |

- 目录请求缺少尾斜杠时返回 `301` 到带 `/` 的地址，避免相对资源路径错位。
- 未知路径返回内嵌 `404.html`，同时保持 HTTP `404` 状态。
- 前端未构建（`dist` 只有占位文件）时，二进制仍可启动，页面返回 404，`/api/*` 正常。
