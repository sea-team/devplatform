'use strict';

/**
 * 重置管理员 / 普通账号密码（账号体系 v0.4.0）。
 *
 * 用法：
 *   node scripts/reset-admin-password.js                       # 重置 admin，自动生成新密码
 *   node scripts/reset-admin-password.js alice                # 重置指定账号
 *   node scripts/reset-admin-password.js admin -p 'MyNewPass'  # 指定新密码
 *   node scripts/reset-admin-password.js --api http://10.0.0.246:9000 admin
 *   node scripts/reset-admin-password.js --offline admin       # 强制离线改 state.json（需先停平台）
 *   devplatform.exe reset-admin [账号]                         # 单文件版，在线不停机重置
 *
 * 平台正在运行时会自动走本机 CLI 通道（回环 + x-dp-cli 请求头），内存态与 state.json 同步；
 * 离线模式直接改 state.json 并吊销该账号会话，改完重启平台即可生效。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const out = { username: '', password: '', api: '', token: '', offline: false, help: false };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--offline') out.offline = true;
    else if (a === '--api') out.api = argv[++i] || '';
    else if (a === '--token') out.token = argv[++i] || '';
    else if (a === '-p' || a === '--password') out.password = argv[++i] || '';
    else if (!a.startsWith('-')) positional.push(a);
  }
  out.username = positional[0] || 'admin';
  return out;
}

function help() {
  console.log([
    '重置 DevPlatform 账号密码',
    '  node scripts/reset-admin-password.js [账号] [选项]',
    '',
    '  账号              默认 admin',
    '  -p, --password    指定新密码（至少 8 位）；不指定则自动生成',
    '  --api <url>       重置远端实例（需该机 ADMIN_TOKEN，或本机回环 CLI 通道）',
    '  --token <token>   显式提供 ADMIN_TOKEN',
    '  --offline         强制离线改本地 state.json（平台运行时请勿使用）',
    '  -h, --help        显示本帮助',
    '',
    '  单文件版：devplatform.exe reset-admin [账号]',
    '  初始密码文件：data/initial-admin.txt（首次启动生成，权限 600）',
  ].join('\n'));
}

function stateFile() {
  const candidates = [
    process.env.DP_STATE_FILE,
    process.env.DATA_DIR ? path.join(process.env.DATA_DIR, 'state.json') : '',
    process.env.DP_ROOT ? path.join(process.env.DP_ROOT, 'data', 'state.json') : '',
    path.join(ROOT, 'platform', 'data', 'state.json'),
    path.join(ROOT, 'platform', 'dist', 'data', 'state.json'),
    path.join(ROOT, 'dist', 'data', 'state.json'),
  ].filter(Boolean);
  for (const file of candidates) {
    try { if (fs.statSync(file).isFile()) return file; } catch { /* 继续找 */ }
  }
  return candidates.find((f) => f.includes('platform')) || candidates[0];
}

function dotEnvValue(key) {
  for (const file of [path.join(ROOT, '.env'), path.join(ROOT, 'platform', 'dist', '.env'), path.join(ROOT, 'dist', '.env')]) {
    try {
      const line = fs.readFileSync(file, 'utf8').split(/\r?\n/).find((l) => l.trim().startsWith(`${key}=`));
      if (line) return line.trim().slice(key.length + 1).replace(/^["']|["']$/g, '');
    } catch { /* 文件不存在 */ }
  }
  return '';
}

async function online(pathname, body, headers) {
  const res = await fetch(pathname, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) {
    const err = new Error(json.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return json.data;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { help(); return; }

  const port = Number(process.env.PORT || dotEnvValue('PORT') || 9000);
  const localBase = `http://127.0.0.1:${port}`;
  const explicitApi = args.api.replace(/\/$/, '');
  const token = args.token || process.env.ADMIN_TOKEN || dotEnvValue('ADMIN_TOKEN');
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;

  // 显式 --api：只走远程接口，失败不回退（避免误改本机 state.json）。
  if (explicitApi) {
    const isLoopback = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(explicitApi);
    const result = await online(`${explicitApi}/api/auth/reset-password`,
      { username: args.username, password: args.password || undefined },
      isLoopback ? { ...headers, 'x-dp-cli': '1' } : headers);
    console.log(`✔ 已重置 ${result.username} 的密码（在线生效，旧会话已失效）\n新密码：${result.password}`);
    return;
  }

  // 默认：先探活本机平台；在线则走 CLI 通道，避免运行中的内存态覆盖离线写入。
  let onlineLocal = false;
  try { const r = await fetch(`${localBase}/api/health`, { signal: AbortSignal.timeout(1200) }); onlineLocal = r.ok; }
  catch { onlineLocal = false; }

  if (onlineLocal && !args.offline) {
    try {
      const result = await online(`${localBase}/api/auth/reset-password`,
        { username: args.username, password: args.password || undefined },
        { ...headers, 'x-dp-cli': '1' });
      console.log(`✔ 已重置 ${result.username} 的密码（在线生效，旧会话已失效）\n新密码：${result.password}`);
      return;
    } catch (e) {
      throw new Error(`平台正在运行但在线重置失败（${e.message}）。请先停止平台再用 --offline，或配置 ADMIN_TOKEN 后重试`);
    }
  }

  // 离线：直接改 state.json（权限 600），并吊销该账号的所有会话。
  const file = stateFile();
  if (!fs.existsSync(file)) {
    throw new Error(`找不到 state.json：${file}。请用 DATA_DIR / DP_ROOT 指定数据目录，或改用 --api 在线重置`);
  }
  process.env.DATA_DIR = path.dirname(file);
  const auth = require(path.join(ROOT, 'platform', 'src', 'auth.js'));
  const result = auth.resetPassword(args.username, args.password);
  console.log(`✔ 已重置 ${result.username} 的密码（离线写入 ${file}）\n新密码：${result.password}`);
  console.log('   该账号的所有会话已失效；平台若在运行，请重启后再登录。');
}

main().catch((e) => {
  console.error('✖ 重置失败：', e.message || e);
  process.exitCode = 1;
});
