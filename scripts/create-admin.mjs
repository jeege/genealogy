import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { emitKeypressEvents } from 'node:readline';

export async function createAdmin({ email, password, url, key, request = fetch }) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email ?? '')) throw new Error('请提供有效邮箱');
  if (typeof password !== 'string' || password.length < 12) throw new Error('密码至少需要 12 个字符');
  let endpoint;
  try { endpoint = new URL(url); } catch { throw new Error('缺少有效 NEXT_PUBLIC_SUPABASE_URL'); }
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('Supabase 必须使用无凭据的 HTTP(S) API 地址');
  if (!key) throw new Error('缺少 SERVICE_ROLE_KEY（绝不能使用浏览器公开密钥）');
  const response = await request(`${endpoint.href.replace(/\/$/, '')}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
    signal: AbortSignal.timeout(15000),
  });
  // 不回显服务响应，避免意外记录服务端令牌、用户元数据或口令。
  if (!response.ok) throw new Error(`创建账号失败（HTTP ${response.status}），请检查配置、邮箱是否重复及 Auth 服务日志`);
}

async function readPassword(prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('非交互环境请通过 ADMIN_PASSWORD 环境变量提供密码');
  process.stdout.write(prompt);
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolvePassword, reject) => {
    let password = '';
    const finish = (error) => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener('keypress', onKey);
      process.stdout.write('\n');
      error ? reject(error) : resolvePassword(password);
    };
    const onKey = (value, key = {}) => {
      if (key.ctrl && key.name === 'c') return finish(new Error('已取消'));
      if (key.name === 'return' || key.name === 'enter') return finish();
      if (key.name === 'backspace') password = Array.from(password).slice(0, -1).join('');
      else if (value && !key.ctrl && !key.meta && !/[\r\n\u0000-\u001f\u007f]/.test(value)) password += value;
    };
    process.stdin.on('keypress', onKey);
  });
}

async function main() {
  const email = process.argv[2];
  if (!email || process.argv.length !== 3) throw new Error('用法：node --env-file=.env.self-hosted scripts/create-admin.mjs <email>');
  const password = process.env.ADMIN_PASSWORD ?? await readPassword('密码（至少 12 字符，不回显）：');
  if (!process.env.ADMIN_PASSWORD && password !== await readPassword('再次输入密码：')) throw new Error('两次密码不一致');
  await createAdmin({ email, password, url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SERVICE_ROLE_KEY });
  console.log('账号已创建并确认邮箱。该用户可登录并管理本部署共享的族谱。');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    // 网络异常可能带请求上下文，统一输出有限消息。
    console.error(error instanceof TypeError ? '无法连接 Auth API，请检查地址和服务状态' : error.message);
    process.exitCode = 1;
  });
}
