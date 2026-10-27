import { randomBytes } from 'node:crypto';
import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// 生成只含随机十六进制字符的口令，可直接放入 PostgreSQL 连接串。
export function generateSecrets() {
  return {
    postgresPassword: randomBytes(32).toString('hex'),
    adminPassword: randomBytes(18).toString('base64url'),
  };
}

export function validateSiteUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('站点地址必须是有效的 HTTP(S) 公网或局域网地址'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('站点地址必须是无路径、查询参数、凭据的 HTTP(S) 地址');
  }
  // 保证生成值可安全用于 Compose dotenv。
  if (!/^[a-zA-Z0-9.:/[\]-]+$/.test(url.origin)) throw new Error('站点地址含不支持的字符');
  return url.origin;
}

// 用户名不限制字符集：中文、空格、符号、邮箱样式都允许；
// 仅拒绝空、超长、控制字符，以及会破坏 dotenv/Compose 解析的字符。
function validateUsername(value) {
  const username = (value ?? '').trim();
  if (!username) throw new Error('管理员用户名不能为空');
  if (Buffer.byteLength(username) > 256) throw new Error('管理员用户名过长');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(username)) throw new Error('管理员用户名不能包含控制字符');
  return username;
}

function validatePassword(value) {
  if (typeof value !== 'string' || [...value].length < 8 || Buffer.byteLength(value) > 72) {
    throw new Error('管理员密码至少 8 个字符且不超过 72 个字节');
  }
  return value;
}

export async function writeConfiguration({
  siteUrl,
  surname = '刘',
  adminUsername = '',
  adminPassword = '',
  output = resolve('.env.self-hosted'),
}) {
  siteUrl = validateSiteUrl(siteUrl);
  if (!surname.trim() || /[\r\n"'\\$`]/.test(surname)) throw new Error('姓氏不能为空或包含换行、引号及变量符号');

  const secrets = generateSecrets();
  const username = adminUsername ? validateUsername(adminUsername) : '';
  const password = username
    ? (adminPassword ? validatePassword(adminPassword) : validatePassword(secrets.adminPassword))
    : '';
  const databaseURL = `postgres://genealogy:${secrets.postgresPassword}@db:5432/genealogy?sslmode=disable`;

  const values = {
    COMPOSE_PROJECT_NAME: 'pure-genealogy',
    GENEALOGY_IMAGE: 'ghcr.io/jeege/genealogy:latest',
    SITE_URL: siteUrl,
    APP_PORT: '3000',
    BIND_ADDRESS: '0.0.0.0',
    POSTGRES_DB: 'genealogy',
    POSTGRES_USER: 'genealogy',
    POSTGRES_PASSWORD: secrets.postgresPassword,
    DATABASE_URL: databaseURL,
    FAMILY_SURNAME: surname,
    SESSION_TTL: '720h',
    COOKIE_SECURE: 'auto',
    // 单部署共享一份族谱；默认关闭公开注册，首账号由 ADMIN_* 引导创建。
    ALLOW_SIGNUP: 'false',
    ADMIN_USERNAME: username,
    ADMIN_PASSWORD: password,
    LOG_LEVEL: 'info',
  };
  const content = '# 自动生成；含数据库与初始管理员凭据。请离线备份，勿提交或公开。\n' +
    '# 启动命令：docker compose --env-file .env.self-hosted up -d --build\n' +
    Object.entries(values).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n';
  // wx 防止检查与写入之间的竞争覆盖，mode 防止其他本机用户读取新配置。
  const file = await open(output, 'wx', 0o600);
  try { await file.writeFile(content); } finally { await file.close(); }
  return { output, adminPassword: password };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('用法：node scripts/setup-self-hosted.mjs --site-url http://localhost:3000 [--surname 刘] [--admin-username 用户名] [--admin-password 密码]');
    return;
  }
  const options = {};
  const names = {
    '--site-url': 'siteUrl', '--surname': 'surname',
    '--admin-username': 'adminUsername', '--admin-password': 'adminPassword',
  };
  for (let i = 0; i < args.length; i += 2) {
    if (!names[args[i]] || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('参数错误，请使用 --help');
    options[names[args[i]]] = args[i + 1];
  }
  const result = await writeConfiguration(options);
  console.log(`已生成 ${result.output}（权限 0600）。`);
  if (result.adminPassword) {
    console.log(`初始管理员密码：${result.adminPassword}（仅显示一次，请妥善保存）`);
  }
  console.log('启动：docker compose --env-file .env.self-hosted up -d --build');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.code === 'EEXIST' ? '配置文件已存在，拒绝覆盖。请保留现有密钥。' : error.message);
    process.exitCode = 1;
  });
}
