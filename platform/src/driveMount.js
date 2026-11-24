'use strict';

/**
 * Windows 网络盘映射（v0.4.28）。
 *
 * 把某个 OpenList 连接的 WebDAV 根目录映射为 Windows 网络驱动器（`net use`），
 * 让资源管理器 / 本地程序像访问本地磁盘一样访问 OpenList 文件。
 *
 * 安全设计：
 *  - 只对 process.platform === 'win32' 生效，其它平台优雅降级（不报错、返回结构化原因）；
 *  - WebDAV 地址与凭据一律从服务端 state 里的连接对象推导，前端只能传 connectionId，
 *    不能传任意 UNC / URL —— 杜绝把 `\\attacker\share` 注入 net use；
 *  - 盘符白名单 ^[A-Z]:$，命令用 spawn(shell:false) 逐参数传递，无命令注入面；
 *  - 不记录命令中的明文密码，接口返回也不含密码；
 *  - 会话可见性探测：net use 映射是「用户会话级」的，平台若跑在服务/计划任务
 *    会话，映射盘符对交互登录用户不可见。这里如实上报，避免用户困惑。
 *
 * 已知限制：Windows 内置 WebDAV 重定向器(WebClient) 对 HTTPS 自签证书支持差、
 * 大文件稳定性一般；更稳的替代是 rclone + WinFsp。本功能定位为「方便的内网映射」。
 */
const { spawn } = require('child_process');
const iconv = require('iconv-lite');
const openlist = require('./openlist');

const IS_WINDOWS = process.platform === 'win32';
const DRIVE_RE = /^[A-Za-z]:$/;

function unsupported() {
  return {
    supported: false,
    platform: process.platform,
    reason: process.platform === 'win32'
      ? '当前不是 Windows 环境'
      : '网络盘映射仅在 Windows 桌面版可用；当前平台运行于 ' + process.platform + '（Linux/Docker 容器无 WebClient/FUSE，无法做系统级映射）。请使用「平台内根目录浏览」或自行用 rclone 挂载 WebDAV。',
  };
}

/** 会话可见性：映射盘符作用于平台进程所在会话，能否被「看得见」取决于它。 */
function sessionInfo() {
  const name = String(process.env.SESSIONNAME || '').trim();
  const consoleLike = /^console$/i.test(name);
  return {
    sessionName: name || '(未设置)',
    interactive: IS_WINDOWS ? consoleLike : null,
    visibleHint: !IS_WINDOWS
      ? '非 Windows，无网络盘映射'
      : consoleLike
        ? '平台运行在交互会话，映射盘符通常可在「此电脑」看到'
        : '平台似乎运行在服务 / 计划任务 / 非交互会话（SESSIONNAME=' + (name || '空') + '），net use 映射的盘符可能只对平台进程可见、不会出现在你的资源管理器；如需在桌面看到，请以当前登录用户双击运行平台 exe',
  };
}

/** 解析目标连接（服务端推导地址与凭据），返回 WebDAV 映射所需信息。 */
function resolveConnection(connectionId) {
  const conn = connectionId
    ? openlist.findConnection(connectionId)
    : openlist.activeConnection();
  if (!conn) throw new Error('没有可用的 OpenList 连接');
  const base = String(conn.url || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) throw new Error('该 OpenList 连接地址不是 http(s)://，无法映射为网络盘');
  return {
    connectionId: conn.id,
    connectionLabel: conn.label || base,
    webdav: `${base}/dav/`,
    user: String(conn.user || 'admin'),
    password: String(conn.password || ''),
    hasPassword: Boolean(conn.password),
    hasToken: Boolean(conn.token),
  };
}

/** 运行 net.exe 并返回结构化结果；密码经参数数组传递，不拼接 shell 字符串、不写日志。 */
function runNet(args, timeout = 20000) {
  return new Promise((resolve) => {
    const child = spawn('net.exe', args, { shell: false, windowsHide: true });
    const outChunks = [];
    const errChunks = [];
    const timer = setTimeout(() => { try { child.kill(); } catch { /* noop */ } }, timeout);
    // 中文 Windows 的 net.exe 输出是 GBK/GB2312，直接 String(buf) 会得到乱码，
    // 用 iconv-lite 按 gbk 解码（英文系统下 gbk 解码 ascii 也不会损坏可读性）。
    child.stdout && child.stdout.on('data', (b) => { outChunks.push(Buffer.isBuffer(b) ? b : Buffer.from(b)); });
    child.stderr && child.stderr.on('data', (b) => { errChunks.push(Buffer.isBuffer(b) ? b : Buffer.from(b)); });
    const decode = (chunks) => {
      try { return iconv.decode(Buffer.concat(chunks), 'gbk').trim(); }
      catch { return Buffer.concat(chunks).toString('utf8').trim(); }
    };
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, stdout: '', stderr: String(e.message || e) }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: Number(code || 0), stdout: decode(outChunks), stderr: decode(errChunks) });
    });
  });
}

/** 状态：是否支持、会话可见性、当前已映射盘符（可选探测）。 */
async function status(drive) {
  const base = IS_WINDOWS ? { supported: true, platform: process.platform } : unsupported();
  /** @type {Record<string, any>} */
  const out = { ...base, session: sessionInfo() };
  if (!IS_WINDOWS) return out;
  if (drive && DRIVE_RE.test(drive)) {
    const r = await runNet(['use', drive.toUpperCase()]);
    out.drive = drive.toUpperCase();
    out.mapped = r.code === 0;
    out.detail = (r.stdout || r.stderr || '').slice(0, 500);
  }
  return out;
}

/** 映射：connectionId 决定地址/凭据，drive 为盘符，persistent 是否持久。 */
async function map(body = {}) {
  if (!IS_WINDOWS) return unsupported();
  const drive = String(body.drive || '').trim().toUpperCase();
  if (!DRIVE_RE.test(drive)) throw new Error('盘符格式不合法：请填单个字母加冒号，如 Z:');

  const conn = resolveConnection(body.connectionId);
  if (!conn.hasPassword) {
    throw new Error('该 OpenList 连接未保存管理员密码，无法映射 WebDAV。请到「连接管理」为该连接填写管理员密码（Token 不能用于 WebDAV 映射）');
  }
  const persistent = body.persistent === true || body.persistent === 'true';

  // net use Z: http://host:5244/dav/ /user:admin <password> /persistent:{yes|no}
  // 先删除同盘符旧映射，避免「本地名称已在使用」导致幂等失败。
  const existing = await runNet(['use', drive]);
  if (existing.code === 0) await runNet(['use', drive, '/delete', '/y']);

  const args = ['use', drive, conn.webdav, `/user:${conn.user}`, conn.password, `/persistent:${persistent ? 'yes' : 'no'}`];
  const r = await runNet(args, 30000);
  if (r.code !== 0) {
    const msg = (r.stderr || r.stdout || '').slice(0, 400);
    throw new Error(`映射失败（net use 返回 ${r.code}）：${msg || '请检查 WebClient 服务是否启动、地址与密码是否正确、HTTPS 证书是否被信任'}`);
  }
  return {
    mapped: true,
    drive,
    connectionId: conn.connectionId,
    connectionLabel: conn.connectionLabel,
    webdav: conn.webdav,
    persistent,
    session: sessionInfo(),
  };
}

/** 断开映射。 */
async function unmap(body = {}) {
  if (!IS_WINDOWS) return unsupported();
  const drive = String(body.drive || '').trim().toUpperCase();
  if (!DRIVE_RE.test(drive)) throw new Error('盘符格式不合法：请填单个字母加冒号，如 Z:');
  const r = await runNet(['use', drive, '/delete', '/y']);
  if (r.code !== 0 && !/not connected|找不到|没有连接|not found/i.test(r.stderr + r.stdout)) {
    throw new Error(`断开失败（net use 返回 ${r.code}）：${(r.stderr || r.stdout || '').slice(0, 300)}`);
  }
  return { unmapped: true, drive };
}

module.exports = { status, map, unmap, sessionInfo, isWindows: IS_WINDOWS };
