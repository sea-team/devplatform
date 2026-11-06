'use strict';

/**
 * 平台自身的远程部署 / 运维 CLI（零第三方依赖）。
 *
 *   node scripts/remote.js probe  <host>                     探测目标机环境
 *   node scripts/remote.js deploy <host> [目标目录]          打包上传并启动平台
 *   node scripts/remote.js status <host>                    采集服务器状态
 *   node scripts/remote.js exec   <host> "<命令>"            执行任意远程命令（需谨慎）
 *   node scripts/remote.js script <host> <本地脚本>          上传并执行 Bash 脚本（自动转 LF）
 *   node scripts/remote.js stop   <host>                    停止远端平台服务
 *
 * 凭据只从平台本地 data/state.json 读取，不出现在命令行、日志或打包文件中。
 * 部署时会自动选择运行时：宿主机 Node >= 20 → systemd/nohup；否则 → Docker 容器
 * （优先复用目标机已有的 node 镜像，避免依赖 Docker Hub 可达性）。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const STATE_FILE = process.env.STATE_FILE || path.join(ROOT, 'data', 'state.json');
const { sshExec, sftpPut, collectStatus } = require(path.join(ROOT, 'platform', 'src', 'integrations.js'));

const SERVICE_NAME = 'devplatform';

function loadServer(host) {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { throw new Error(`无法读取平台状态文件：${STATE_FILE}`); }
  const server = (raw.servers || []).find((s) => s.host === host);
  if (!server) throw new Error(`平台中未登记主机 ${host}，请先在「服务器」页添加`);
  return server;
}

async function run(server, command, timeout = 60000, label = '') {
  if (label) console.log(`\n▶ ${label}`);
  const result = await sshExec(server, command, timeout);
  if (result.stdout) console.log(result.stdout.trim());
  if (result.stderr) console.log(`[stderr] ${result.stderr.trim()}`);
  return result;
}

async function runStrict(server, command, timeout = 60000, label = '') {
  const result = await run(server, command, timeout, label);
  if (result.code !== 0) throw new Error(`${label || '远程命令'}失败（exit=${result.code}）：${result.stderr || result.stdout}`);
  return result;
}

/**
 * Git Bash / MSYS 会把以 / 开头的参数自动转换成本地 Windows 路径
 * （例如 /data/platform → J:/Program Files/.../data/platform）。
 * 这里做识别与还原，并推荐用 DEPLOY_DIR 环境变量传入目标目录。
 */
function normalizeTarget(raw) {
  const value = process.env.DEPLOY_DIR || raw || '/data/platform';
  if (/^[A-Za-z]:[\\/]/.test(value) || /\s/.test(value)) {
    throw new Error(`目标目录被本机 shell 转义成了 "${value}"。请在 Git Bash 下使用 MSYS_NO_PATHCONV=1，或改用 DEPLOY_DIR=/data/platform 传入。`);
  }
  if (!/^\/[A-Za-z0-9_./-]+$/.test(value)) {
    throw new Error(`目标目录格式不合法：${value}（需为绝对路径，且只含字母、数字、_ . / -）`);
  }
  return value.replace(/\/+$/, '') || '/data/platform';
}

/* ------------------------------- 环境探测 -------------------------------- */

const PROBE_COMMAND = [
  'echo "===OS==="; (cat /etc/os-release 2>/dev/null | head -4) || uname -a',
  'echo "===KERNEL==="; uname -srm; echo "init=$(cat /proc/1/comm 2>/dev/null)"',
  'echo "===NODE==="; command -v node || echo "NO_NODE"; node -v 2>/dev/null || true; npm -v 2>/dev/null || true; echo "node_path=$(command -v node)"',
  'echo "===DOCKER==="; docker --version 2>/dev/null || echo "NO_DOCKER"; docker compose version 2>/dev/null || docker-compose version 2>/dev/null || true',
  'echo "===TOOLS==="; for c in git tar curl python3 systemctl; do printf "%s=%s\\n" "$c" "$(command -v $c || echo missing)"; done',
  'echo "===DIR==="; ls -ld /data 2>/dev/null || echo "NO_DATA"; ls -la /data/platform 2>/dev/null | head -25 || echo "NO_PLATFORM_DIR"',
  'echo "===DISK==="; df -h /data / 2>/dev/null | sort -u',
  'echo "===MEM==="; free -m | head -2',
  'echo "===PORTS==="; (ss -lntp 2>/dev/null || netstat -lntp 2>/dev/null) | grep -E ":(9000|3000|8080|5244|5245)[[:space:]]" || echo "9000/3000/8080/5244 均空闲"',
  'echo "===NET==="; curl -s --max-time 8 -o /dev/null -w "npmjs=%{http_code}\\n" https://registry.npmjs.org/ 2>/dev/null || echo "npmjs=unreachable"',
  'echo "===FIREWALL==="; (systemctl is-active firewalld 2>/dev/null || echo "firewalld=inactive"); (command -v ufw >/dev/null && ufw status | head -3 || echo "ufw=none")',
].join('; ');

async function cmdProbe(host) {
  const server = loadServer(host);
  console.log(`目标：${server.username}@${server.host}:${server.port || 22}`);
  await run(server, PROBE_COMMAND, 90000, '探测系统环境');
  try {
    const status = await collectStatus(server);
    console.log('\n▶ 平台状态采集（结构化）');
    console.log(JSON.stringify(status, null, 2));
  } catch (e) {
    console.log(`状态采集失败：${e.message}`);
  }
}

/* --------------------------- tar.gz 打包（零依赖） ------------------------- */

const EXCLUDE_DIRS = new Set(['node_modules', 'data', '.git', 'workspace', 'dist', '.workbuddy']);
const EXCLUDE_FILES = new Set(['.env', 'state.json', 'state.json.tmp']);

function collectFiles() {
  const files = [];
  const walk = (absDir, relDir) => {
    for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
      if (EXCLUDE_DIRS.has(entry.name) || EXCLUDE_FILES.has(entry.name)) continue;
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      const abs = path.join(absDir, entry.name);
      if (entry.isDirectory()) walk(abs, rel);
      else if (entry.isFile()) files.push({ name: `devplatform/${rel}`, data: fs.readFileSync(abs) });
    }
  };
  walk(ROOT, '');
  return files;
}

function writeOctal(buf, value, offset, length) {
  buf.write(value.toString(8).padStart(length - 1, '0') + '\0', offset, length, 'ascii');
}

function tarHeader(name, size, mtime) {
  const b = Buffer.alloc(512);
  b.write(name.slice(0, 100), 0, 100, 'utf8');
  writeOctal(b, 0o644, 100, 8);
  writeOctal(b, 0, 108, 8);
  writeOctal(b, 0, 116, 8);
  writeOctal(b, size, 124, 12);
  writeOctal(b, mtime, 136, 12);
  b.fill(0x20, 148, 156);
  b.write('0', 156, 1, 'ascii');
  b.write('ustar\0', 257, 6, 'ascii');
  b.write('00', 263, 2, 'ascii');
  const sum = b.reduce((acc, byte) => acc + byte, 0);
  b.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  return b;
}

function buildArchive(outFile) {
  const files = collectFiles();
  const chunks = [];
  const mtime = Math.floor(Date.now() / 1000);
  for (const file of files) {
    chunks.push(tarHeader(file.name, file.data.length, mtime));
    chunks.push(file.data);
    const padding = (512 - (file.data.length % 512)) % 512;
    if (padding) chunks.push(Buffer.alloc(padding));
  }
  chunks.push(Buffer.alloc(1024));
  fs.writeFileSync(outFile, zlib.gzipSync(Buffer.concat(chunks), { level: 9 }));
  return files.length;
}

/* --------------------------- 宿主机 Node 运行方式 -------------------------- */

function unitFile(nodeBin, target) {
  return [
    '[Unit]', 'Description=DevPlatform Unified Console',
    'After=network-online.target', 'Wants=network-online.target', '',
    '[Service]', 'Type=simple', `WorkingDirectory=${target}/platform`,
    'Environment=PORT=9000', `Environment=DATA_DIR=${target}/data`,
    `Environment=WORKSPACE_DIR=${target}/workspace`,
    'Environment=GITEA_URL=http://localhost:3002',
    'Environment=OPENLIST_URL=http://localhost:5244',
    'Environment=CODE_SERVER_URL=http://localhost:8080',
    `ExecStart=${nodeBin} ${target}/platform/src/server.js`,
    'Restart=always', 'RestartSec=5',
    `StandardOutput=append:${target}/data/server.log`,
    `StandardError=append:${target}/data/server.log`, '',
    '[Install]', 'WantedBy=multi-user.target', '',
  ].join('\n');
}

async function startOnHost(server, target, nodeBin) {
  const install = await run(server, `cd ${target}/platform && npm install --omit=dev --no-audit --no-fund 2>&1 | tail -20`, 300000, '安装平台依赖');
  if (install.code !== 0) console.log('⚠ 依赖安装未完全成功，平台仍可零依赖运行（SSH/代理能力关闭）。');

  const init = (await run(server, 'cat /proc/1/comm', 15000)).stdout.trim();
  if (init === 'systemd') {
    const unitLocal = path.join(os.tmpdir(), 'devplatform.service');
    fs.writeFileSync(unitLocal, unitFile(nodeBin, target), 'utf8');
    await sftpPut(server, unitLocal, `/etc/systemd/system/${SERVICE_NAME}.service`);
    await run(server, `systemctl daemon-reload && systemctl enable ${SERVICE_NAME} >/dev/null 2>&1; systemctl restart ${SERVICE_NAME} && sleep 2 && systemctl is-active ${SERVICE_NAME}`, 90000, '注册并启动 systemd 服务');
  } else {
    await run(server, `pkill -f "${target}/platform/src/server.js" 2>/dev/null || true; cd ${target}/platform && PORT=9000 DATA_DIR=${target}/data WORKSPACE_DIR=${target}/workspace nohup ${nodeBin} src/server.js >> ${target}/data/server.log 2>&1 & sleep 2; echo "PID=$(pgrep -f '${target}/platform/src/server.js' | head -1)"`, 60000, '以 nohup 后台启动');
  }
}

/* ----------------------------- Docker 容器运行方式 ------------------------- */

async function pickNodeImage(server) {
  const result = await run(server, 'docker images --format "{{.Repository}}:{{.Tag}}" | grep -E "^node:" | sort | head -30', 30000, '查找目标机已有的 Node 镜像');
  const images = result.stdout.split('\n').map((s) => s.trim()).filter((s) => s && !s.includes('<none>'));
  const preferred = images.find((i) => /^node:(2[0-9]|22)/.test(i)) || images[0];
  if (preferred) {
    console.log(`✔ 复用已有镜像：${preferred}（无需访问 Docker Hub）`);
    return preferred;
  }
  const pull = await run(server, 'docker pull node:20-alpine', 300000, '拉取 node:20-alpine');
  if (pull.code !== 0) throw new Error('目标机无 Node 运行时，且无法拉取 Node 镜像（Docker Hub 不可达）。请先配置镜像加速器或安装 Node >= 20');
  return 'node:20-alpine';
}

async function startInContainer(server, target, host) {
  const image = await pickNodeImage(server);

  await runStrict(server,
    `docker run --rm --name dp-npm-install -v ${target}/platform:/app -w /app ${image} npm install --omit=dev --no-audit --no-fund`,
    300000, '在容器内安装依赖（写入挂载卷，持久化）');

  const sshReady = await run(server,
    `docker run --rm -v ${target}/platform:/app -w /app ${image} node -e "try{require.resolve('ssh2');console.log('SSH2_OK')}catch(e){console.log('SSH2_MISSING')}"`,
    60000, '校验容器内的 SSH 能力');
  if (!sshReady.stdout.includes('SSH2_OK')) throw new Error('容器内 ssh2 不可用，服务器管理与自动部署功能将无法使用');

  await run(server, `docker rm -f ${SERVICE_NAME} >/dev/null 2>&1 || true`, 30000);

  // 统一的 .env：存放 Token / 密码 / 服务地址，compose 与平台容器共用同一份。
  // 存在时用 --env-file 注入，改凭据后重新 deploy 即可生效，无需改代码。
  const hasEnvFile = (await run(server, `test -f ${target}/.env && echo yes || echo no`, 15000)).stdout.includes('yes');
  const envArgs = hasEnvFile
    ? [`--env-file ${target}/.env`]
    : [
        `-e GITEA_URL=http://${host}:3002`,
        `-e OPENLIST_URL=http://${host}:5244`,
        `-e CODE_SERVER_URL=http://${host}:8080`,
      ];
  console.log(hasEnvFile ? `✔ 使用 ${target}/.env 注入集成服务凭据` : 'ℹ 未发现 .env，使用默认服务地址（集成服务将显示离线）');

  const dockerRun = [
    'docker run -d', `--name ${SERVICE_NAME}`, '--restart unless-stopped',
    '-p 9000:9000',
    `-v ${target}/platform:/app`,
    `-v ${target}/data:/app/data`,
    `-v ${target}/workspace:/workspace`,
    // 平台通过 docker.sock 直接调 Docker Engine API 做隔离构建，不需要宿主机 docker CLI。
    '-v /var/run/docker.sock:/var/run/docker.sock',
    '-e PORT=9000 -e DATA_DIR=/app/data -e WORKSPACE_DIR=/workspace',
    ...envArgs,
    '-w /app', image, 'node src/server.js',
  ].join(' ');
  await runStrict(server, `${dockerRun} && sleep 2 && docker ps --filter name=${SERVICE_NAME} --format "{{.Names}}|{{.Status}}|{{.Ports}}"`, 120000, '启动平台容器');
}

/* --------------------------------- 部署 ---------------------------------- */

async function bootstrapRemote(host, server) {
  const base = `http://${host}:9000`;
  const payload = {
    name: server.name, host: server.host, port: server.port || 22,
    username: server.username, password: server.password || '',
    privateKey: server.privateKey || '', privateKeyPath: server.privateKeyPath || '',
    passphrase: server.passphrase || '', deployDir: '/data/platform',
  };
  try {
    // 幂等：重复部署时更新同一条记录，避免产生多条相同服务器。
    const existing = await fetch(`${base}/api/servers`, { signal: AbortSignal.timeout(10000) }).then((r) => r.json());
    const same = (existing.data && existing.data.items || []).find((s) => s.host === server.host);
    if (same) payload.id = same.id;

    const created = await fetch(`${base}/api/servers`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(10000),
    }).then((r) => r.json());
    if (!created.ok) throw new Error(created.error);
    const tested = await fetch(`${base}/api/servers/${created.data.id}/test`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: '{}', signal: AbortSignal.timeout(25000),
    }).then((r) => r.json());
    console.log(`\n▶ 远端平台已登记服务器（${same ? '更新' : '新增'}），容器内 SSH 回连：${tested.ok && tested.data.online ? '成功' : '失败'}`);
  } catch (e) {
    console.log(`\n⚠ 远端服务器登记跳过：${e.message}`);
  }
}

async function cmdDeploy(host, rawTarget = '/data/platform') {
  const target = normalizeTarget(rawTarget);
  const server = loadServer(host);
  console.log(`目标：${server.username}@${server.host} → ${target}`);

  // 1) 本地打包：排除凭据（data/）、依赖与运行时数据
  const archive = path.join(os.tmpdir(), 'devplatform-deploy.tar.gz');
  const count = buildArchive(archive);
  console.log(`▶ 已打包 ${count} 个文件，${(fs.statSync(archive).size / 1024).toFixed(1)} KB（不含凭据/依赖/运行时数据）`);

  // 2) 上传并解压
  const remoteArchive = '/tmp/devplatform-deploy.tar.gz';
  await sftpPut(server, archive, remoteArchive);
  console.log('▶ 压缩包已上传');
  await runStrict(server,
    `mkdir -p ${target}/data ${target}/workspace && tar -xzf ${remoteArchive} -C ${target} --strip-components=1 && echo "FILES=$(find ${target} -type f | wc -l)" && ls ${target}`,
    60000, '解压到目标目录');

  // 3) 选择运行时
  const runtime = await run(server,
    'echo "===NODE==="; (command -v node && node -v) || echo none; echo "===DOCKER==="; (command -v docker && docker --version) || echo none',
    30000, '探测运行时');
  const nodeMajor = Number((runtime.stdout.match(/v(\d+)\.\d+\.\d+/) || [])[1] || 0);
  const hasDocker = /Docker version/.test(runtime.stdout);

  if (nodeMajor >= 20) {
    const nodeBin = (await run(server, 'command -v node', 15000)).stdout.trim();
    console.log(`✔ 宿主机 Node ${nodeMajor}，使用 systemd/nohup 方式`);
    await startOnHost(server, target, nodeBin);
  } else if (hasDocker) {
    console.log('ℹ 宿主机无 Node >= 20（或 glibc 过旧），使用 Docker 容器方式');
    await startInContainer(server, target, host);
  } else {
    throw new Error('目标机既没有 Node >= 20，也没有 Docker，无法运行平台');
  }

  // 4) 验证 + 收紧状态文件权限
  await run(server, `chmod 600 ${target}/data/state.json 2>/dev/null || true; chmod 600 ${target}/.env 2>/dev/null || true`, 15000);
  const health = await run(server, 'curl -s --max-time 8 http://127.0.0.1:9000/api/health', 30000, '远端健康检查');
  if (!health.stdout.includes('"ok":true')) {
    await run(server, `docker logs --tail 30 ${SERVICE_NAME} 2>&1 | tail -30`, 30000, '容器日志');
    throw new Error('远端健康检查未通过，详见上方容器日志');
  }

  await bootstrapRemote(host, server);

  await run(server, `docker inspect -f '{{.State.Status}}' ${SERVICE_NAME} 2>/dev/null || systemctl is-active ${SERVICE_NAME} 2>/dev/null || echo unknown`, 30000, '服务状态');
  console.log(`\n✔ 部署完成：http://${host}:9000  （代码与数据位于 ${target}）`);
}

async function cmdScript(host, localScript) {
  if (!localScript) throw new Error('用法：remote.js script <host> <本地脚本路径>');
  const server = loadServer(host);
  const absScript = path.resolve(process.cwd(), localScript);
  // Windows 上编辑的脚本可能是 CRLF，Linux bash 会报 \r 错误，统一转 LF。
  const content = fs.readFileSync(absScript, 'utf8').replace(/\r\n/g, '\n');
  const name = `dp_${path.basename(absScript)}`;
  const localTmp = path.join(os.tmpdir(), name);
  const remotePath = `/tmp/${name}`;
  fs.writeFileSync(localTmp, content, { encoding: 'utf8', mode: 0o700 });
  await sftpPut(server, localTmp, remotePath);
  await run(server, `chmod +x ${remotePath} && bash ${remotePath}`, 600000, `执行远程脚本 ${path.basename(absScript)}`);
}

async function cmdStop(host) {
  const server = loadServer(host);
  await run(server,
    `docker rm -f ${SERVICE_NAME} >/dev/null 2>&1 || true; systemctl stop ${SERVICE_NAME} 2>/dev/null || pkill -f '/data/platform/platform/src/server.js' || true; echo stopped`,
    30000, '停止远端平台');
}

async function main() {
  const [action, host, ...rest] = process.argv.slice(2);
  if (!action || !host) {
    console.log('用法: node scripts/remote.js <probe|deploy|status|exec|stop> <host> [参数]');
    process.exit(1);
  }
  switch (action) {
    case 'probe': return cmdProbe(host);
    case 'deploy': return cmdDeploy(host, rest[0] || '/data/platform');
    case 'status': return console.log(JSON.stringify(await collectStatus(loadServer(host)), null, 2));
    case 'exec': return run(loadServer(host), rest.join(' '), 120000);
    case 'script': return cmdScript(host, rest[0]);
    case 'stop': return cmdStop(host);
    default: throw new Error(`未知操作：${action}`);
  }
}

main().catch((e) => { console.error(`✖ ${e.message}`); process.exitCode = 1; });
