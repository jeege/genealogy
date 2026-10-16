import { randomBytes, createHmac } from 'node:crypto';
import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// API 密钥十年有效；轮换 JWT_SECRET 时需要同步替换两种密钥，并让用户重新登录。
export const TOKEN_LIFETIME_SECONDS = 10 * 365 * 24 * 60 * 60;

export function signToken(role, secret, now = Math.floor(Date.now() / 1000)) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const payload = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ role, iss: 'supabase', iat: now, exp: now + TOKEN_LIFETIME_SECONDS })}`;
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
}

export function generateSecrets() {
  const jwtSecret = randomBytes(48).toString('hex');
  return {
    jwtSecret,
    postgresPassword: randomBytes(32).toString('hex'),
    authDbPassword: randomBytes(32).toString('hex'),
    restDbPassword: randomBytes(32).toString('hex'),
    anonKey: signToken('anon', jwtSecret),
    serviceRoleKey: signToken('service_role', jwtSecret),
  };
}

export function validatePublicUrl(value, name) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${name} 必须是有效 HTTP(S) 公网或局域网访问地址`); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error(`${name} 必须是无路径、查询参数、凭据的 HTTP(S) 地址`);
  }
  // 保证生成值可安全用于 Compose dotenv 与 Nginx 配置。
  if (!/^[a-zA-Z0-9.:/[\]-]+$/.test(url.origin)) throw new Error(`${name} 含不支持的字符`);
  return url.origin;
}

export async function writeConfiguration({ siteUrl, supabaseUrl, surname = '刘', output = resolve('.env.self-hosted') }) {
  siteUrl = validatePublicUrl(siteUrl, '--site-url');
  supabaseUrl = validatePublicUrl(supabaseUrl, '--supabase-url');
  if (!surname.trim() || /[\r\n"'\\$`]/.test(surname)) throw new Error('姓氏不能为空或包含换行、引号及变量符号');
  const secrets = generateSecrets();
  const values = {
    COMPOSE_PROJECT_NAME: 'pure-genealogy',
    GENEALOGY_IMAGE: 'onehacker/pure-genealogy:latest',
    APP_PORT: '3000',
    API_PORT: '8000',
    SITE_URL: siteUrl,
    NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: secrets.anonKey,
    NEXT_PUBLIC_FAMILY_SURNAME: surname,
    SUPABASE_INTERNAL_URL: 'http://gateway:8000',
    POSTGRES_PASSWORD: secrets.postgresPassword,
    AUTH_DB_PASSWORD: secrets.authDbPassword,
    REST_DB_PASSWORD: secrets.restDbPassword,
    JWT_SECRET: secrets.jwtSecret,
    ANON_KEY: secrets.anonKey,
    SERVICE_ROLE_KEY: secrets.serviceRoleKey,
    DISABLE_SIGNUP: 'true',
    SMTP_HOST: '', SMTP_PORT: '587', SMTP_USER: '', SMTP_PASS: '',
    SMTP_ADMIN_EMAIL: '', SMTP_SENDER_NAME: '族谱',
    // recovery 使用应用的 token_hash 回调；不依赖浏览器解析 URL fragment。
    MAILER_TEMPLATES_RECOVERY: '',
  };
  const content = '# 自动生成；含服务端密钥。请离线备份，勿提交或公开。\n# API 密钥有效期十年；公网部署前请配置 HTTPS 与正确域名。\n' +
    Object.entries(values).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n';
  // wx 防止检查与写入之间的竞争覆盖，mode 防止其他本机用户读取新配置。
  const file = await open(output, 'wx', 0o600);
  try { await file.writeFile(content); } finally { await file.close(); }
  return output;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('用法：node scripts/setup-self-hosted.mjs --site-url http://localhost:3000 --supabase-url http://localhost:8000 [--surname 刘]');
    return;
  }
  const options = {};
  const names = { '--site-url': 'siteUrl', '--supabase-url': 'supabaseUrl', '--surname': 'surname' };
  for (let i = 0; i < args.length; i += 2) {
    if (!names[args[i]] || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('参数错误，请使用 --help');
    options[names[args[i]]] = args[i + 1];
  }
  const output = await writeConfiguration(options);
  console.log(`已生成 ${output}（权限 0600）。请按 docs/docker-deployment.md 启动服务。`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.code === 'EEXIST' ? '配置文件已存在，拒绝覆盖。请保留现有密钥。' : error.message);
    process.exitCode = 1;
  });
}
