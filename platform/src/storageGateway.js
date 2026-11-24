'use strict';

/**
 * 共享网关（v0.4.29 · 阶段 2）：把 rclone 远端以 SMB 共享出去。
 *
 * 两种运行形态：
 *  - Linux/Docker：通过 docker.sock 创建一个专用容器，容器内同时跑
 *    rclone mount（FUSE）+ smbd，445 映射到宿主机；宿主机零安装、零 systemd 改动，
 *    停止/删除容器即可完全回滚。rclone 本身没有 SMB 服务端，Samba 这一环不可省。
 *  - Windows：平台 exe 所在本机需预装 WinFsp（rclone mount 的 Windows 依赖），
 *    用 rclone mount 挂盘符 + net share 共享；同会话可见性如实上报。
 *
 * 权限：所有写操作在 server.js 里 requireAdmin，permissions 又把 /api/rclone 列为全局写路径。
 */
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const iconv = require('iconv-lite');
const { state, update, appRoot } = require('./core');
const docker = require('./dockerApi');
const rclone = require('./rclone');

const DATA_DIR = process.env.DATA_DIR || path.join(appRoot, 'data');
const GATEWAY_DIR = path.join(DATA_DIR, 'gateway');
const IS_WINDOWS = process.platform === 'win32';
const LABEL = 'devplatform.storage-gateway';

function settings() {
  const s = state().storageGateway || {};
  return { ...s, smbPass: s.smbPass ? '******' : '' };
}

function updateSettings(body = {}) {
  const allowed = ['mode', 'smbPort', 'remoteId', 'winDrive', 'shareName', 'smbUser', 'smbPass', 'autoStart'];
  update((s) => {
    const g = s.storageGateway || (s.storageGateway = {});
    for (const key of allowed) {
      if (body[key] === undefined) continue;
      if (key === 'smbPort') {
        const port = Number(body[key]);
        // 445 是 SMB 标准端口（<1024），由 Docker 以 root 发布，不能被 1024 下限误拒。
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SMB 端口须在 1-65535 之间');
        g.smbPort = port;
      } else if (key === 'winDrive') {
        if (!/^[A-Za-z]:$/.test(String(body[key]))) throw new Error('盘符格式须为 Z:');
        g.winDrive = String(body[key]).toUpperCase();
      } else if (key === 'shareName') {
        if (!/^[A-Za-z0-9_-]{1,32}$/.test(String(body[key]))) throw new Error('共享名只允许字母、数字、下划线与连字符');
        g.shareName = String(body[key]);
      } else if (key === 'smbUser') {
        if (!/^[A-Za-z0-9_-]{1,32}$/.test(String(body[key]))) throw new Error('SMB 用户名不合法');
        g.smbUser = String(body[key]);
      } else if (key === 'mode') {
        if (!['auto', 'container', 'windows'].includes(String(body[key]))) throw new Error('模式不支持');
        g.mode = String(body[key]);
      } else {
        g[key] = body[key];
      }
    }
  });
  return settings();
}

function effectiveMode() {
  const mode = String((state().storageGateway || {}).mode || 'auto');
  if (mode === 'container' || mode === 'windows') return mode;
  return IS_WINDOWS ? 'windows' : 'container';
}

function sessionInfo() {
  const name = String(process.env.SESSIONNAME || '').trim();
  const consoleLike = /^console$/i.test(name);
  if (!IS_WINDOWS) return { sessionName: name || '(未设置)', interactive: null, visibleHint: '非 Windows 环境，无本机盘符' };
  return {
    sessionName: name || '(未设置)',
    interactive: consoleLike,
    visibleHint: consoleLike
      ? '平台运行在交互会话，WinFsp 挂载的盘符通常可在「此电脑」看到'
      : '平台似乎运行在服务 / 计划任务 / 非交互会话（SESSIONNAME=' + (name || '空') + '），本机挂载的盘符可能只对平台进程可见；如需在桌面看到，请以当前登录用户双击运行 exe',
  };
}

function winFsp() {
  if (!IS_WINDOWS) return { installed: false, detected: false, hint: '非 Windows' };
  // 主判据：WinFsp.Launcher 服务在运行（net start 输出包含该服务名）。
  // 官方 MSI 检测也是看服务 + 注册表；这里不用 reg.exe（部分受限环境会拦截），
  // 而 net.exe 可用。修复「非标准安装路径时只查 Program Files 会漏检、进而重复安装 1603」的缺陷。
  const byService = winFspServiceRunning();
  const candidates = [
    'C:\\Program Files\\WinFsp\\bin\\launchctl.exe',
    'C:\\Program Files (x86)\\WinFsp\\bin\\launchctl.exe',
  ];
  const byFile = candidates.some((p) => { try { return fs.existsSync(p); } catch { return false; } });
  const detected = byService || byFile;
  return {
    installed: detected,
    detected,
    detectedBy: byService ? 'service' : byFile ? 'file' : 'none',
    version: detected ? winFspVersionFromFiles() : '',
    admin: isAdmin(),
    msi: findMsi(),
    hint: detected
      ? '已检测到 WinFsp' + (byService && !byFile ? '（服务运行中，安装在非标准路径）' : '')
      : '未检测到 WinFsp。exe 已请求管理员权限；全量包 windows/bin 内含官方 MSI，点「自动安装」即可静默安装，或从 https://winfsp.dev/rel/ 手动安装',
  };
}

// 用 net start（GBK 输出）判断 WinFsp.Launcher 服务是否在运行。
// 不依赖 sc.exe / reg.exe（沙箱或企业策略常拦截）；net.exe 一般可用。
function winFspServiceRunning() {
  try {
    const r = require('child_process').spawnSync('net.exe', ['start'], {
      shell: false, windowsHide: true, timeout: 10000,
    });
    if (r.error) return false;
    const text = iconv.decode(Buffer.concat([r.stdout || Buffer.alloc(0), r.stderr || Buffer.alloc(0)]), 'gbk');
    return /WinFsp\.Launcher/i.test(text);
  } catch { return false; }
}

// 管理员权限检测（Windows）：net session 需管理员，退出码 0 即已提权。
// shell:false + windowsHide，避免闪烁；失败一律当作非管理员（安全侧）。
function isAdmin() {
  if (!IS_WINDOWS) return false;
  try {
    const r = require('child_process').spawnSync('net.exe', ['session'], {
      shell: false, windowsHide: true, timeout: 8000, stdio: 'ignore',
    });
    return r.status === 0;
  } catch { return false; }
}

// 从已安装文件反推版本号（launchctl.exe 同级的 version 文件不可靠，直接看目录名/文件不一定有）。
// 这里只做存在性收集，版本以 manifest/注册表为准；返回空串表示无法判定。
function winFspVersionFromFiles() {
  for (const base of ['C:\\Program Files\\WinFsp', 'C:\\Program Files (x86)\\WinFsp']) {
    try {
      for (const name of fs.readdirSync(base)) {
        const m = /^(\d+\.\d+\.\d+)$/.exec(name);
        if (m) return m[1];
      }
    } catch { /* noop */ }
  }
  return '';
}

// 定位随包 WinFsp MSI：
//  1) 环境变量 DP_WINFSP_MSI 显式指定（绝对路径）
//  2) 全量包部署：appRoot/windows/bin/winfsp.msi、appRoot/windows/bootstrap/winfsp.msi
//  3) 控制台目录：appRoot/winfsp.msi、data/winfsp.msi
// 单文件 exe 分发（用户选「仅随全量包」）不含 MSI，此时返回 null 并给出在线安装提示。
function findMsi() {
  if (!IS_WINDOWS) return null;
  const explicit = String(process.env.DP_WINFSP_MSI || '').trim();
  if (explicit) {
    try { if (fs.existsSync(explicit) && fs.statSync(explicit).size > 1024 * 1024) return explicit; } catch { /* noop */ }
    return null;
  }
  // 全量包解压结构与源码/SEA 运行的 ROOT 不同：从 appRoot 向上找 3 级，
  // 覆盖 ROOT=platform/dist（launcher）、ROOT=platform（源码直跑）两种情况。
  // 每级相对候选：windows/bin、windows/bootstrap、本级、data。
  const rels = [
    ['windows', 'bin', 'winfsp.msi'],
    ['windows', 'bootstrap', 'winfsp.msi'],
    ['winfsp.msi'],
    ['data', 'winfsp.msi'],
  ];
  let dir = appRoot;
  for (let up = 0; up <= 3 && dir; up += 1) {
    for (const rel of rels) {
      const p = path.join(dir, ...rel);
      try { if (fs.existsSync(p) && fs.statSync(p).size > 1024 * 1024) return p; } catch { /* noop */ }
    }
    const parent = path.dirname(dir);
    dir = parent === dir ? null : parent;
  }
  return null;
}

function runNet(args, timeout = 20000) {
  return new Promise((resolve) => {
    const child = spawn('net.exe', args, { shell: false, windowsHide: true });
    const out = [];
    const err = [];
    const timer = setTimeout(() => { try { child.kill(); } catch { /* noop */ } }, timeout);
    child.stdout && child.stdout.on('data', (b) => out.push(Buffer.isBuffer(b) ? b : Buffer.from(b)));
    child.stderr && child.stderr.on('data', (b) => err.push(Buffer.isBuffer(b) ? b : Buffer.from(b)));
    const decode = (arr) => {
      try { return iconv.decode(Buffer.concat(arr), 'gbk').trim(); }
      catch { return Buffer.concat(arr).toString('utf8').trim(); }
    };
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, output: String(e.message || e) }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: Number(code || 0), output: decode(out) || decode(err) });
    });
  });
}

function targetRemote() {
  const g = state().storageGateway || {};
  const remote = rclone.findRemote(g.remoteId);
  if (!remote) throw new Error('请先配置 rclone 远端，并在共享网关里选择要共享的远端');
  return remote;
}

/* ------------------------- Linux / Docker 容器 ------------------------- */

function ensureScript() {
  fs.mkdirSync(GATEWAY_DIR, { recursive: true, mode: 0o700 });
  const script = `#!/bin/sh
set -e
echo '[gw] start.sh begin'
mkdir -p /mnt/dpstorage /run/samba /var/lib/samba
grep -q '^user_allow_other' /etc/fuse.conf 2>/dev/null || echo 'user_allow_other' >> /etc/fuse.conf
rclone mount "$RCLONE_REMOTE" /mnt/dpstorage --config /config/rclone/rclone.conf \\
  --allow-other --vfs-cache-mode writes --dir-cache-time 30s --umask 002 &
MOUNT_PID=$!
echo "[gw] rclone mount launched pid=$MOUNT_PID"
trap 'kill $MOUNT_PID 2>/dev/null || true' EXIT INT TERM
i=0
while ! grep -q ' /mnt/dpstorage ' /proc/mounts; do
  i=$((i+1))
  if [ $i -gt 30 ]; then echo 'rclone mount 未就绪' >&2; exit 1; fi
  sleep 1
done
echo '[gw] fuse mount ready'
adduser -D -H "$SMB_USER" >/dev/null 2>&1 || true
printf '%s\\n%s\\n' "$SMB_PASS" "$SMB_PASS" | smbpasswd -a -s "$SMB_USER" >/dev/null 2>&1 || true
cat > /etc/samba/smb.conf <<EOF
[global]
workgroup = WORKGROUP
security = user
map to guest = Bad User
log level = 1

[$SHARE_NAME]
path = /mnt/dpstorage
browseable = yes
writable = yes
read only = no
guest ok = no
valid users = $SMB_USER
EOF
echo '[gw] starting smbd'
smbd -F -s /etc/samba/smb.conf -d 1 --debug-stdout
echo "[gw] smbd exited code=$?"
exit 1
`;
  const file = path.join(GATEWAY_DIR, 'start.sh');
  fs.writeFileSync(file, script, { encoding: 'utf8', mode: 0o700 });
  return file;
}

async function ensureImage() {
  const g = state().storageGateway || {};
  if (await docker.imageExists('devplatform-storage-gateway', 'latest')) {
    return { ok: true, image: g.image || 'devplatform-storage-gateway:latest', cached: true };
  }
  let base = 'node:20-alpine';
  if (!(await docker.imageExists(base, 'latest'))) {
    const prefix = String((state().storageGateway || {}).imagePrefix || '').trim()
      || process.env.DP_IMAGE_PREFIX || '';
    const candidates = prefix ? [`${prefix}/library/node`] : ['node'];
    let pulled = false;
    for (const ref of candidates) {
      try { await docker.pullImage(ref, '20-alpine'); base = `${ref}:20-alpine`; pulled = true; break; }
      catch { /* 尝试下一个 */ }
    }
    if (!pulled) throw new Error('无法拉取基础镜像 node:20-alpine；请先在 Docker 中导入该镜像');
  }
  const name = `dp-gateway-build-${Date.now()}`;
  const created = await docker.createContainer({
    Image: base, Tty: true, Cmd: ['sleep', '3600'],
    HostConfig: { SecurityOpt: ['seccomp:unconfined'] },
  }, name);
  const id = created && created.Id;
  if (!id) throw new Error('创建网关构建容器失败');
  try {
    await docker.startContainer(id);
    const r = await docker.execContainerTimed(id,
      // rclone 1.72+ 在 Alpine 上需要 fuse3（提供 fusermount3），只装 fuse(v2) 会报
      // "fusermount3: executable file not found"。
      ['sh', '-c', 'apk add --no-cache rclone samba fuse3 >/dev/null 2>&1 && echo OK'], 300000);
    if (r.exitCode !== 0 || !String(r.output || '').includes('OK')) {
      throw new Error(`安装 rclone/samba/fuse 失败：${String(r.output).slice(0, 300)}`);
    }
    const committed = await docker.commitContainer(id, 'devplatform-storage-gateway', 'latest');
    return { ok: true, image: 'devplatform-storage-gateway:latest', cached: false, id: committed && committed.Id };
  } finally {
    await docker.removeContainer(id, true).catch(() => {});
  }
}

async function startContainerMode() {
  const g = state().storageGateway || {};
  const remote = targetRemote();
  await rclone.writeConfig();
  ensureScript();
  const built = await ensureImage();
  await docker.removeContainer(g.containerName || 'devplatform-storage-gateway', true).catch(() => {});
  // docker.sock 是宿主机 Docker：bind 源必须转成宿主机路径（容器里是 /app/data）。
  const hostRoot = rclone.HOST_DATA_DIR || DATA_DIR;
  const confDirName = path.basename(rclone.confPath() ? path.dirname(rclone.confPath()) : 'rclone');
  const sourceDir = path.join(hostRoot, confDirName);
  const gatewayHostDir = path.join(hostRoot, 'gateway');
  const spec = {
    Image: g.image || 'devplatform-storage-gateway:latest',
    Tty: true,
    Env: [
      `RCLONE_REMOTE=${remote.name}:`,
      `SMB_USER=${g.smbUser || 'dpstorage'}`,
      `SMB_PASS=${String((state().storageGateway || {}).smbPass || '')}`,
      `SHARE_NAME=${g.shareName || 'dpstorage'}`,
    ],
    ExposedPorts: { '445/tcp': {} },
    Labels: { [LABEL]: '1', 'devplatform.gateway.remote': remote.id },
    HostConfig: {
      Binds: [`${sourceDir}:/config/rclone`, `${gatewayHostDir}:/etc/dp-gateway`],
      Devices: [{ PathOnHost: '/dev/fuse', PathInContainer: '/dev/fuse', CgroupPermissions: 'rwm' }],
      CapAdd: ['SYS_ADMIN'],
      SecurityOpt: ['seccomp:unconfined', 'apparmor:unconfined'],
      PortBindings: { '445/tcp': [{ HostIp: '0.0.0.0', HostPort: String(g.smbPort || 445) }] },
      RestartPolicy: { Name: 'unless-stopped' },
    },
    Cmd: ['/bin/sh', '/etc/dp-gateway/start.sh'],
  };
  const created = await docker.createContainer(spec, g.containerName || 'devplatform-storage-gateway');
  if (!created || !created.Id) throw new Error('创建共享网关容器失败');
  await docker.startContainer(created.Id);
  return { mode: 'container', containerId: created.Id, built, share: `\\\\${'127.0.0.1'}\\${g.shareName || 'dpstorage'}`, port: g.smbPort || 445 };
}

async function stopContainerMode() {
  const g = state().storageGateway || {};
  await docker.removeContainer(g.containerName || 'devplatform-storage-gateway', true).catch(() => {});
  return { mode: 'container', stopped: true };
}

/* ------------------------------ Windows ------------------------------ */

// 静默安装 WinFsp：msiexec /i <msi> /qn /norestart，写详细日志到 data/gateway/winfsp-install.log。
// 前置条件：管理员权限（exe 已注入 requireAdministrator 清单，双击即提权）；随包 MSI 存在。
// 安装后重新检测（注册表服务 + 文件），以结果为准，不轻信 msiexec 退出码。
async function ensureWinFsp({ auto = false } = {}) {
  if (!IS_WINDOWS) throw new Error('WinFsp 仅适用于 Windows');
  const before = winFsp();
  if (before.installed) return { installed: true, already: true, admin: before.admin, version: before.version };
  if (!before.admin) {
    throw new Error('当前进程不是管理员权限：请右键 devplatform.exe 选「以管理员身份运行」（正式发行版双击会自动弹 UAC 提权）');
  }
  const msi = findMsi();
  if (!msi) {
    throw new Error('未找到随包 WinFsp MSI（windows/bin/winfsp.msi）。轻量包/单文件 exe 请运行 fetch-services.ps1 补齐，或从 https://winfsp.dev/rel/ 手动安装后重试');
  }
  fs.mkdirSync(GATEWAY_DIR, { recursive: true });
  const logFile = path.join(GATEWAY_DIR, 'winfsp-install.log');
  const args = ['/i', msi, '/qn', '/norestart', `/L*v`, logFile];
  const code = await new Promise((resolve) => {
    const child = spawn('msiexec.exe', args, { shell: false, windowsHide: true, detached: false });
    let done = false;
    const finish = (c) => { if (!done) { done = true; clearTimeout(timer); resolve(c); } };
    const timer = setTimeout(() => { try { child.kill(); } catch { /* noop */ } finish(-2); }, 300000);
    child.on('error', () => finish(-1));
    child.on('close', (c) => finish(Number(c || 0)));
  });
  const after = winFsp();
  const ok = after.installed;
  // msiexec 常见返回：0 成功、3010 需重启才生效、1641/1618 需重启。
  if (!ok) {
    const tail = (() => { try { return fs.readFileSync(logFile, 'utf8').split(/\r?\n/).slice(-8).join('\n'); } catch { return ''; } })();
    throw new Error(`WinFsp 静默安装未生效（msiexec 退出码 ${code}）${auto ? '（自动安装）' : ''}。日志：${logFile}${tail ? '\n' + tail.slice(0, 600) : ''}`);
  }
  return {
    installed: true, already: false, admin: true, version: after.version, msi,
    exitCode: code, rebootRequired: [3010, 1641, 1618].includes(code),
    note: [3010, 1641, 1618].includes(code) ? 'WinFsp 已安装，但需重启一次后才能挂载；重启后重试启动共享即可' : 'WinFsp 已静默安装完成',
  };
}

async function startWindowsMode() {
  const g = state().storageGateway || {};
  const remote = targetRemote();
  // v0.4.29：缺失时优先自动静默安装（exe 已提权 + 全量包自带 MSI），失败才抛可操作提示。
  const fsp = await ensureWinFsp({ auto: true });
  const bin = rclone.binPath();
  if (!bin) throw new Error('未找到 rclone.exe，请先在「rclone 挂载」页指定路径或放到 data/bin/');
  await rclone.writeConfig();
  const drive = g.winDrive || 'Z:';
  const mountArgs = ['mount', `${remote.name}:`, drive, '--config', rclone.confPath(),
    '--vfs-cache-mode', 'writes', '--volname', `DP-${remote.name}`];
  const child = spawn(bin, mountArgs, {
    shell: false, windowsHide: true, detached: true,
    stdio: 'ignore', env: { ...process.env, ...rclone.proxyEnv() },
  });
  child.unref();
  update((s) => { s.storageGateway = { ...(s.storageGateway || {}), winPid: child.pid || 0 }; });
  const share = await runNet(['share', `${g.shareName || 'dpstorage'}=${drive}\\`, '/grant:Everyone,FULL']);
  return {
    mode: 'windows', drive, pid: child.pid || 0, session: sessionInfo(),
    share: `\\\\127.0.0.1\\${g.shareName || 'dpstorage'}`,
    shareResult: share.output.slice(0, 300),
    note: 'WinFsp 挂载与 net share 均作用于平台进程所在会话/本机；请按会话提示确认盘符可见性',
  };
}

async function stopWindowsMode() {
  const g = state().storageGateway || {};
  if (g.winPid) {
    try { process.kill(Number(g.winPid)); } catch { /* 已退出 */ }
    update((s) => { s.storageGateway = { ...(s.storageGateway || {}), winPid: 0 }; });
  }
  const r = await runNet(['share', g.shareName || 'dpstorage', '/delete', '/y']);
  return { mode: 'windows', stopped: true, output: r.output.slice(0, 300) };
}

/* ------------------------------- 接口 ------------------------------- */

async function status() {
  const mode = effectiveMode();
  const base = {
    mode, platform: process.platform, supported: true,
    session: sessionInfo(), settings: settings(),
  };
  if (mode === 'windows') {
    return { ...base, winFsp: winFsp(), rclone: rclone.version(),
      share: await runNet(['share', (state().storageGateway || {}).shareName || 'dpstorage']).then((r) => ({
        exists: r.code === 0, detail: r.output.slice(0, 300),
      })) };
  }
  try {
    await docker.ping();
    const g = state().storageGateway || {};
    const name = g.containerName || 'devplatform-storage-gateway';
    let container = null;
    try { container = await docker.inspectContainer(name); } catch { /* 不存在 */ }
    return {
      ...base,
      docker: { available: true },
      image: await docker.imageExists('devplatform-storage-gateway', 'latest'),
      container: container ? {
        id: container.Id, running: Boolean(container.State && container.State.Running),
        status: container.State && container.State.Status,
      } : null,
      share: `\\\\127.0.0.1\\${g.shareName || 'dpstorage'}`,
      port: g.smbPort || 445,
      note: container && container.State && container.State.Running
        ? '网关容器运行中；Windows 客户端可用上面的地址映射网络盘'
        : '网关容器未运行；启动后可在 Windows 上映射 SMB 共享',
    };
  } catch (e) {
    return { ...base, docker: { available: false, error: e.message }, image: false, container: null };
  }
}

async function start() {
  return effectiveMode() === 'windows' ? startWindowsMode() : startContainerMode();
}
async function stop() {
  return effectiveMode() === 'windows' ? stopWindowsMode() : stopContainerMode();
}
async function logs(tail = 100) {
  if (effectiveMode() !== 'container') return { lines: [], note: 'Windows 模式请查看平台进程输出' };
  const g = state().storageGateway || {};
  const buf = await docker.containerLogs(g.containerName || 'devplatform-storage-gateway', tail);
  return { lines: String(buf || '').split('\n').slice(-tail) };
}

module.exports = { settings, updateSettings, effectiveMode, status, start, stop, logs, winFsp, sessionInfo, isAdmin, ensureWinFsp };
