#!/usr/bin/env node
'use strict';
/**
 * 为「本机单文件程序 devplatform.exe」生成 platform/dist/.env。
 *
 * 背景：exe 的默认集成服务地址是容器内部服务名（gitea:3000 / openlist:5244），
 * 在本机直跑时无法解析；且 dist/ 是全新目录，没有 GITEA_TOKEN / OPENLIST_TOKEN。
 * 本脚本从已部署服务器读取 .env，把服务地址与 Token 同步成本机可直连的配置。
 *
 * 用法（在 devplatform/ 根目录执行）：
 *   node scripts/sync-integrations.js                       自动选 data/state.json 里的服务器
 *   node scripts/sync-integrations.js --from 10.0.0.246    指定服务器
 *   node scripts/sync-integrations.js --local              只生成本机 localhost 模板（不连服务器）
 *   node scripts/sync-integrations.js --check              查看当前配置状态（不显示任何值）
 *   node scripts/sync-integrations.js --probe              探测当前配置的三个服务是否可达
 *
 * 凭据只写入本地 dist/.env（权限 600，已被 .gitignore 排除），不会打印、不会提交。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const STATE_FILE = path.join(ROOT, 'data', 'state.json');
const ENV_FILE = path.join(ROOT, 'platform', 'dist', '.env');
const REMOTE_ENV = '/data/platform/.env';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const valueOf = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : '';
};

function parseEnv(text) {
  const out = {};
  for (const raw of String(text || '').split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const m = raw.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

function readLocalEnv() {
  return fs.existsSync(ENV_FILE) ? parseEnv(fs.readFileSync(ENV_FILE, 'utf8')) : {};
}

function showConfig(title) {
  const cfg = readLocalEnv();
  console.log(`=== ${title} ===`);
  console.log('文件:', ENV_FILE, fs.existsSync(ENV_FILE) ? '(存在)' : '(不存在)');
  for (const key of ['GITEA_URL', 'OPENLIST_URL', 'CODE_SERVER_URL']) {
    console.log(`  ${key} = ${cfg[key] || '(未设置)'}`);
  }
  for (const key of ['GITEA_TOKEN', 'OPENLIST_TOKEN', 'ADMIN_TOKEN']) {
    console.log(`  ${key} = ${cfg[key] ? '已设置（已隐藏）' : '(空)'}`);
  }
  return cfg;
}

// 远端 .env 里若写的是 127.0.0.1 / localhost，从本机访问时要换成服务器 IP。
function rehost(url, host) {
  if (!url) return '';
  try {
    const u = new URL(url);
    if (['127.0.0.1', 'localhost', '0.0.0.0', '::1'].includes(u.hostname)) u.hostname = host;
    return u.toString().replace(/\/+$/, '');
  } catch {
    return url.replace(/\/+$/, '');
  }
}

async function probe(cfg) {
  const items = [
    ['Gitea', `${cfg.GITEA_URL}/api/v1/version`, {}],
    ['OpenList', `${cfg.OPENLIST_URL}/api/public/settings`, { Authorization: cfg.OPENLIST_TOKEN || '' }],
    ['code-server', `${cfg.CODE_SERVER_URL}/healthz`, {}],
  ];
  for (const [name, url, headers] of items) {
    if (!url || url.startsWith('undefined')) { console.log(`  ${name}: 未配置地址`); continue; }
    try {
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(6000) });
      console.log(`  ${name}: HTTP ${r.status} (${url})`);
    } catch (e) {
      console.log(`  ${name}: 连接失败 - ${e.message}`);
    }
  }
}

function writeEnv(lines) {
  fs.mkdirSync(path.dirname(ENV_FILE), { recursive: true });
  fs.writeFileSync(ENV_FILE, lines.join('\n') + '\n', { encoding: 'utf8', mode: 0o600 });
  try { fs.chmodSync(ENV_FILE, 0o600); } catch { /* Windows 下忽略 */ }
}

function localTemplate() {
  return [
    '# DevPlatform 本机单文件程序配置（本文件不会提交 Git）',
    '# 集成服务默认指向本机端口，需自行启动；修改后必须【完全重启】devplatform.exe。',
    '# 复用已部署服务器上的服务：node scripts/sync-integrations.js --from <host>',
    'PORT=9000',
    'GITEA_URL=http://localhost:3002',
    'GITEA_TOKEN=',
    'OPENLIST_URL=http://localhost:5244',
    'OPENLIST_TOKEN=',
    'OPENLIST_USER=admin',
    'CODE_SERVER_URL=http://localhost:8080',
    '# ADMIN_TOKEN：控制台 / API 访问令牌。留空＝所有 /api/* 无鉴权（仅限可信本机 / 内网，',
    '#   且 /api/servers/:id/exec 降级为只读白名单）；对局域网 / 公网暴露时必须设置。',
    "# 启用：填强随机值 → 完全重启 exe → 每台浏览器执行 localStorage.setItem('dp_token', '<同一令牌>')。",
    '# 详细风险与步骤见 .env.example、README §5 / §40 与控制台「环境配置 → 鉴权说明」。',
    '# ADMIN_TOKEN=',
    '# BUILD_EXECUTOR=local',
  ];
}

async function syncFrom(host) {
  const { sshExec } = require(path.join(ROOT, 'platform', 'src', 'integrations.js'));
  let servers = [];
  try { servers = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')).servers || []; } catch {
    throw new Error(`无法读取 ${STATE_FILE}，请先在控制台登记目标服务器`);
  }
  const server = host ? servers.find((s) => s.host === host) : servers[0];
  if (!server) throw new Error(host ? `state.json 中找不到服务器 ${host}` : 'state.json 中没有服务器记录');

  console.log(`读取 ${server.host}:${REMOTE_ENV} ...`);
  const { stdout } = await sshExec(server, `cat ${REMOTE_ENV}`, 15000);
  const remote = parseEnv(stdout);
  if (!remote.GITEA_TOKEN && !remote.OPENLIST_TOKEN) {
    throw new Error('远端 .env 中没有 GITEA_TOKEN / OPENLIST_TOKEN，请先执行 scripts/setup-integrations.sh');
  }

  const lines = [
    '# DevPlatform 本机单文件程序配置（由 scripts/sync-integrations.js 生成，勿提交 Git）',
    `# 集成服务复用 ${server.host} 上已部署的组件；换环境请重跑本脚本。`,
    '# 修改后必须【完全重启】devplatform.exe（reload 只重启业务进程，不重读 .env）。',
    'PORT=9000',
    `GITEA_URL=${rehost(remote.GITEA_URL || `http://${server.host}:3002`, server.host)}`,
    `GITEA_TOKEN=${remote.GITEA_TOKEN || ''}`,
    `OPENLIST_URL=${rehost(remote.OPENLIST_URL || `http://${server.host}:5244`, server.host)}`,
    `OPENLIST_TOKEN=${remote.OPENLIST_TOKEN || ''}`,
    `OPENLIST_USER=${remote.OPENLIST_USER || 'admin'}`,
    `CODE_SERVER_URL=${rehost(remote.CODE_SERVER_URL || `http://${server.host}:8080`, server.host)}`,
    `# ADMIN_TOKEN=`,
    `NO_PROXY=${server.host},localhost,127.0.0.1`,
  ];
  writeEnv(lines);
  console.log('已写入:', ENV_FILE, '(Token 值不打印)');
  console.log('同步键:', ['GITEA_URL', 'GITEA_TOKEN', 'OPENLIST_URL', 'OPENLIST_TOKEN', 'CODE_SERVER_URL'].join(', '));
  return readLocalEnv();
}

(async () => {
  if (flag('--check')) { showConfig('当前本机配置'); return; }
  if (flag('--probe')) { await probe(readLocalEnv()); return; }
  let cfg;
  if (flag('--local')) {
    writeEnv(localTemplate());
    console.log('已写入本机模板:', ENV_FILE, '(Token 留空，需自行填写)');
    cfg = readLocalEnv();
  } else {
    cfg = await syncFrom(valueOf('--from') || '');
  }
  console.log('=== 连通性预检（Node 直连，不经过系统代理）===');
  await probe(cfg);
  console.log('=== 下一步：完全重启 devplatform.exe ===');
})().catch((e) => { console.error('失败:', e.message); process.exit(1); });
