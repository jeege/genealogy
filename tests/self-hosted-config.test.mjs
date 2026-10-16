import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtemp, readFile, stat, rm, mkdir, copyFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { writeFile, chmod } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { generateSecrets, writeConfiguration, validatePublicUrl, TOKEN_LIFETIME_SECONDS } from '../scripts/setup-self-hosted.mjs';
import { createAdmin } from '../scripts/create-admin.mjs';

test('自托管密钥随机独立，HS256 JWT 可验签并有明确期限', () => {
  const first = generateSecrets();
  const second = generateSecrets();
  assert.notEqual(first.jwtSecret, second.jwtSecret);
  for (const key of ['postgresPassword', 'authDbPassword', 'restDbPassword', 'anonKey', 'serviceRoleKey']) assert.notEqual(first[key], second[key]);
  assert.ok(Buffer.from(first.jwtSecret, 'hex').length >= 32);
  assert.equal(new Set([first.postgresPassword, first.authDbPassword, first.restDbPassword]).size, 3);
  for (const [key, role] of [['anonKey', 'anon'], ['serviceRoleKey', 'service_role']]) {
    const [header, payload, signature] = first[key].split('.');
    assert.equal(JSON.parse(Buffer.from(header, 'base64url')).alg, 'HS256');
    assert.equal(signature, createHmac('sha256', first.jwtSecret).update(`${header}.${payload}`).digest('base64url'));
    const claims = JSON.parse(Buffer.from(payload, 'base64url'));
    assert.equal(claims.role, role);
    assert.equal(claims.exp - claims.iat, TOKEN_LIFETIME_SECONDS);
  }
});

test('公开 URL 拒绝数据库串、凭据、路径和注入字符', () => {
  for (const url of [undefined, '', 'postgres://db:5432/postgres', 'ftp://example.com', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com/?secret=a', 'https://example.com/#hash', 'https://exa$mple.com']) {
    assert.throws(() => validatePublicUrl(url, 'URL'));
  }
  assert.equal(validatePublicUrl('http://localhost:3000/', 'URL'), 'http://localhost:3000');
  assert.equal(validatePublicUrl('https://族谱.example', 'URL'), 'https://xn--9fv776f.example');
  assert.equal(validatePublicUrl('http://[::1]:8000', 'URL'), 'http://[::1]:8000');
});

test('配置文件权限 0600，拒绝覆盖，公开 key 与服务端密钥隔离', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'genealogy-config-'));
  const output = join(directory, '.env.self-hosted');
  const options = { siteUrl: 'http://localhost:3000', supabaseUrl: 'http://localhost:8000', output };
  try {
    await writeConfiguration(options);
    assert.equal((await stat(output)).mode & 0o777, 0o600);
    const original = await readFile(output, 'utf8');
    const env = Object.fromEntries(original.split('\n').filter((line) => line && !line.startsWith('#')).map((line) => {
      const position = line.indexOf('=');
      return [line.slice(0, position), JSON.parse(line.slice(position + 1))];
    }));
    assert.equal(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, env.ANON_KEY);
    assert.notEqual(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, env.SERVICE_ROLE_KEY);
    assert.equal(env.DISABLE_SIGNUP, 'true');
    assert.equal(env.SUPABASE_INTERNAL_URL, 'http://gateway:8000');
    await assert.rejects(writeConfiguration(options), { code: 'EEXIST' });
    assert.equal(await readFile(output, 'utf8'), original);
    await assert.rejects(writeConfiguration({ ...options, siteUrl: 'postgres://localhost' }));
    assert.equal(await readFile(output, 'utf8'), original);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('管理脚本只向 Auth admin API 发送服务端密钥与已确认邮箱', async () => {
  let call;
  await createAdmin({ email: 'tester@example.com', password: 'test-password-123', url: 'http://localhost:8000', key: 'private-service-key', request: async (...args) => { call = args; return { ok: true }; } });
  assert.equal(call[0], 'http://localhost:8000/auth/v1/admin/users');
  assert.equal(call[1].headers.Authorization, 'Bearer private-service-key');
  assert.deepEqual(JSON.parse(call[1].body), { email: 'tester@example.com', password: 'test-password-123', email_confirm: true });
  await assert.rejects(createAdmin({ email: 'bad-email', password: 'test-password-123', url: 'http://localhost', key: 'key' }));
  await assert.rejects(createAdmin({ email: 'tester@example.com', password: 'short', url: 'http://localhost', key: 'key' }));
  await assert.rejects(createAdmin({ email: 'tester@example.com', password: 'test-password-123', url: 'http://localhost', key: '' }));
});

test('管理 API 错误不回显服务端响应中的敏感信息', async () => {
  await assert.rejects(createAdmin({ email: 'tester@example.com', password: 'test-password-123', url: 'http://localhost', key: 'private-service-key', request: async () => ({ ok: false, status: 422, text: () => 'private-service-key test-password-123' }) }), (error) => {
    assert.match(error.message, /422/);
    assert.doesNotMatch(error.message, /private-service-key|test-password-123/);
    return true;
  });
});

test('发布脚本默认只构建两个架构，--push 才向 registry 发布', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'genealogy-publish-'));
  const log = join(directory, 'calls.txt');
  try {
    const docker = join(directory, 'docker');
    await writeFile(docker, '#!/bin/sh\nprintf "%s\\n" "$@" >> "$PUBLISH_TEST_LOG"\n');
    await chmod(docker, 0o755);
    const environment = { ...process.env, PATH: `${directory}:${process.env.PATH}`, PUBLISH_TEST_LOG: log, GENEALOGY_REPOSITORY: 'onehacker/pure-genealogy' };
    execFileSync('bash', ['scripts/publish-image.sh', '--engine', 'buildx', '--version', 'test-release'], { env: environment });
    let args = await readFile(log, 'utf8');
    assert.match(args, /linux\/amd64,linux\/arm64/);
    assert.match(args, /\ndocker\.io\/onehacker\/pure-genealogy:test-release\n/);
    assert.match(args, /\ndocker\.io\/onehacker\/pure-genealogy:latest\n/);
    assert.match(args, /type=oci,dest=/);
    assert.doesNotMatch(args, /--push/);
    await writeFile(log, '');
    execFileSync('bash', ['scripts/publish-image.sh', '--engine', 'buildx', '--version', 'test-release', '--push'], { env: environment });
    args = await readFile(log, 'utf8');
    assert.match(args, /--push/);
    assert.match(args, /\ndocker\.io\/onehacker\/pure-genealogy:test-release\n/);
    assert.match(args, /\ndocker\.io\/onehacker\/pure-genealogy:latest\n/);
    assert.doesNotMatch(args, /type=oci/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('container 推送使用完整 registry 引用，补全短名且保留自定义 registry', async () => {
  // container 1.1.0 禁止 /tmp context，使用用户目录中的隔离临时脚本与 CLI stub。
  const directory = await mkdtemp(join(homedir(), '.genealogy-publish-test-'));
  const log = join(directory, 'calls.txt');
  try {
    await mkdir(join(directory, 'scripts'));
    const script = join(directory, 'scripts', 'publish-image.sh');
    await copyFile('scripts/publish-image.sh', script);
    const container = join(directory, 'container');
    await writeFile(container, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$PUBLISH_TEST_LOG"\n');
    await chmod(container, 0o755);
    const cases = [
      [undefined, 'docker.io/onehacker/pure-genealogy'],
      ['myteam/genealogy', 'docker.io/myteam/genealogy'],
      ['docker.io/myteam/genealogy', 'docker.io/myteam/genealogy'],
      ['registry.example.com/myteam/genealogy', 'registry.example.com/myteam/genealogy'],
      ['registry:5000/myteam/genealogy', 'registry:5000/myteam/genealogy'],
      ['localhost/myteam/genealogy', 'localhost/myteam/genealogy'],
    ];
    for (const [input, expected] of cases) {
      await writeFile(log, '');
      const environment = { ...process.env, PATH: `${directory}:${process.env.PATH}`, PUBLISH_TEST_LOG: log };
      delete environment.GENEALOGY_REPOSITORY;
      if (input !== undefined) environment.GENEALOGY_REPOSITORY = input;
      execFileSync('bash', [script, '--engine', 'container', '--version', 'test-release', '--push'], { env: environment });
      const pushes = (await readFile(log, 'utf8')).split('\n').filter(line => line.startsWith('image push '));
      assert.deepEqual(pushes, [`image push ${expected}:test-release`, `image push ${expected}:latest`]);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
