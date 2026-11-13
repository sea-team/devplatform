'use strict';

/**
 * 账号、会话与鉴权（v0.4.0）。
 *
 * 设计要点：
 *  1) 零依赖：密码用 Node 内置 scrypt + 随机 salt，会话存 state.json（600），Cookie 只放随机 token 的 sha256 索引；
 *  2) 首次启动无账号时自动创建 admin，随机初始密码写进 data/initial-admin.txt（600）并在启动日志打印一次，登录后强制改密；
 *  3) ADMIN_TOKEN 保留为「机器 / 应急管理员通道」，Bearer 与 ?token= 等价管理员，保证巡检脚本不被锁死；
 *  4) DP_AUTH_MODE=off|optional|required（默认 required），可一键回退到旧的无鉴权行为；
 *  5) 本机 CLI 通道：回环地址 + x-dp-cli: 1 头，只允许调用重置密码 / 重载两个路径，用于不停机重置管理员密码。
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { config, state, save, update, uid, HttpError, badRequest, notFound } = require('./core');
const permissions = require('./permissions');

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const LOCK_MS = 60 * 1000;
const attempts = new Map();

const PUBLIC_PATHS = ['/api/health', '/api/auth/login', '/api/auth/status', '/api/auth/2fa'];
const CLI_PATHS = ['/api/auth/reset-password', '/api/system/reload'];
const TOKEN_USER = Object.freeze({ id: '__admin_token__', username: 'admin(token)', role: 'admin', via: 'token' });
const CLI_USER = Object.freeze({ id: '__cli__', username: 'cli', role: 'admin', via: 'cli' });
const LEGACY_USER = Object.freeze({ id: '__legacy__', username: 'legacy', role: 'admin', via: 'off' });

function mode() {
  const raw = String(process.env.DP_AUTH_MODE || 'required').trim().toLowerCase();
  return ['off', 'optional', 'required'].includes(raw) ? raw : 'required';
}

/* ------------------------------ 密码与账号 ------------------------------ */

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  let actual;
  try { actual = crypto.scryptSync(String(password), parts[1], 64); }
  catch { return false; }
  const expected = Buffer.from(parts[2], 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function validatePassword(password) {
  const pw = String(password || '');
  if (pw.length < 8) throw badRequest('密码至少 8 位');
  if (pw.length > 200) throw badRequest('密码过长（上限 200 字符）');
  return pw;
}

/* --------------------------- 二次验证（TOTP，零依赖） --------------------------- */
// 默认不启用；启用后登录需「密码 + 动态码 / 恢复码」。动态码为标准 TOTP（SHA1, 6 位, 30 秒）。
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i];
    bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const s = String(str || '').toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0, value = 0;
  const out = [];
  for (let i = 0; i < s.length; i++) {
    const idx = B32.indexOf(s[i]);
    if (idx === -1) throw badRequest('非法的 TOTP 密钥');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

function totp(secretBytes, opts = {}) {
  const step = opts.step || 30;
  const digits = opts.digits || 6;
  const t = Math.floor((opts.time || Date.now()) / 1000 / step);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(t / 0x100000000), 0);
  buf.writeUInt32BE(t >>> 0, 4);
  const hmac = crypto.createHmac('sha1', secretBytes).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16)
    | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return String(code % (10 ** digits)).padStart(digits, '0');
}

function verifyTotp(secretBytes, code, opts = {}) {
  code = String(code || '').replace(/\s/g, '');
  if (!/^\d{4,8}$/.test(code)) return false;
  const window = opts.window == null ? 1 : opts.window;
  const step = opts.step || 30;
  const now = opts.time || Date.now();
  for (let w = -window; w <= window; w++) {
    if (totp(secretBytes, { step, time: now + w * step * 1000 }) === code) return true;
  }
  return false;
}

function genRecoveryCodes(n = 8) {
  const codes = [];
  for (let i = 0; i < n; i++) {
    const raw = crypto.randomBytes(5).toString('hex').toUpperCase();
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return codes;
}

function hashRecovery(code) {
  return crypto.createHash('sha256').update(String(code || '').toUpperCase().replace(/\s/g, '')).digest('hex');
}

function otpauthUri(username, secret) {
  const label = encodeURIComponent(`DevPlatform:${username}`);
  const issuer = encodeURIComponent('DevPlatform');
  return `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
}

// 登录态二维验证挑战：密码正确但 2FA 启用时，先发一个短期 totpToken，校验动态码后才落地会话。
const pending2fa = new Map();

function create2faChallenge(userId) {
  const now = Date.now();
  for (const [k, v] of pending2fa) if (v.expiresAt <= now) pending2fa.delete(k);
  const token = crypto.randomBytes(24).toString('hex');
  pending2fa.set(token, { userId, expiresAt: now + 5 * 60 * 1000, attempts: 0 });
  return token;
}

function peek2faChallenge(token) {
  const rec = token ? pending2fa.get(token) : null;
  if (!rec || rec.expiresAt <= Date.now()) { if (rec) pending2fa.delete(token); return null; }
  return rec;
}

function drop2faChallenge(token) { if (token) pending2fa.delete(token); }

const users = () => (Array.isArray(state().users) ? state().users : []);
const byName = (name) => users().find((u) => u.username === String(name || '').toLowerCase());
const byId = (id) => users().find((u) => u.id === id);
const activeAdmins = () => users().filter((u) => u.role === 'admin' && u.status !== 'disabled');

/** 机器令牌创建的数据也归到真实管理员名下，避免 ownerId 变成一个不存在的虚拟账号。 */
const tokenUser = () => {
  const admin = activeAdmins()[0];
  // 机器令牌不参与「首次登录强制改密」流程，否则前端会卡在改密表单（改密接口只认账号会话）。
  return admin ? { ...admin, username: 'admin(token)', via: 'token', mustChangePassword: false } : TOKEN_USER;
};

function publicUser(u) {
  return {
    id: u.id, username: u.username, displayName: u.displayName || u.username,
    role: u.role, status: u.status || 'active',
    mustChangePassword: Boolean(u.mustChangePassword),
    totpEnabled: Boolean(u.totpEnabled),
    isInitialAdmin: Boolean(u.isInitialAdmin),
    createdAt: u.createdAt || '', lastLoginAt: u.lastLoginAt || '',
    // 密码变更留痕（2026-11-13）：只记时间与触发通道，绝不返回哈希或明文。
    passwordChangedAt: u.passwordChangedAt || '', passwordChangedVia: u.passwordChangedVia || '',
  };
}

/** 统一写密码变更审计字段并打一条不含明文的结构化日志，便于事后定位「谁改了密码」。 */
function auditPasswordChange(user, via) {
  const at = new Date().toISOString();
  console.log(`[auth] password changed: user=${user && user.username} via=${via} at=${at}`);
  return { passwordChangedAt: at, passwordChangedVia: String(via || 'unknown') };
}

/**
 * 首次启动初始化：创建初始管理员，并把历史数据（无 ownerId）全部归到它名下。
 * 已有账号时什么都不做，保证升级不覆盖用户数据。
 */
function initialize() {
  const s = state();
  let changed = false;
  if (!Array.isArray(s.users)) { s.users = []; changed = true; }
  if (!Array.isArray(s.sessions)) { s.sessions = []; changed = true; }
  if (s.users.length) {
    // v0.4.1：兼容旧版 / 部署脚本「整体替换对象」留下的无归属资源，启动时归到管理员，
    // 避免普通用户与协作者看不到这些历史数据；已有合法归属一律不动。
    const admin = activeAdmins()[0];
    if (admin) {
      for (const key of permissions.COLLECTIONS) {
        for (const item of (s[key] || [])) {
          if (!item || typeof item !== 'object') continue;
          if (item.id && !item.ownerId) { item.ownerId = admin.id; changed = true; }
          if (!Array.isArray(item.collaborators)) { item.collaborators = []; changed = true; }
        }
      }
    }
    if (changed) save();
    return null;
  }
  const password = crypto.randomBytes(12).toString('base64url');
  const admin = {
    id: uid('usr'), username: 'admin', displayName: '系统管理员',
    passwordHash: hashPassword(password), role: 'admin', status: 'active',
    isInitialAdmin: true, mustChangePassword: true, createdAt: new Date().toISOString(), lastLoginAt: '',
  };
  s.users.push(admin);
  for (const key of permissions.COLLECTIONS) {
    for (const item of (s[key] || [])) {
      if (item && !item.ownerId) item.ownerId = admin.id;
      if (item && !Array.isArray(item.collaborators)) item.collaborators = [];
    }
  }
  save();
  const dataDir = config.dataDir || path.join(config.appRoot || process.cwd(), 'data');
  let file = '';
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    file = path.join(dataDir, 'initial-admin.txt');
    fs.writeFileSync(file, `DevPlatform 初始管理员\n账号：admin\n初始密码：${password}\n首次登录后请立即修改密码。\n`, { encoding: 'utf8', mode: 0o600 });
    try { fs.chmodSync(file, 0o600); } catch { /* Windows 忽略 */ }
  } catch (e) {
    console.error('[auth] 初始密码文件写入失败：', e.message);
  }
  console.log('[auth] 已创建初始管理员 admin；初始密码见 ' + (file || '启动日志') + ` ：${password}`);
  return { username: 'admin', password, file };
}

/* -------------------------------- 会话 -------------------------------- */

function cookieValue(header, name) {
  for (const part of String(header || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return '';
}

const sessionKey = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

function createSession(userId, req) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  update((s) => {
    if (!Array.isArray(s.sessions)) s.sessions = [];
    s.sessions = s.sessions.filter((x) => x.expiresAt > now);
    s.sessions.push({
      id: sessionKey(token), userId, createdAt: new Date(now).toISOString(),
      expiresAt: now + SESSION_TTL_MS,
      ip: (req && req.socket && req.socket.remoteAddress) || '',
      agent: String((req && req.headers && req.headers['user-agent']) || '').slice(0, 160),
    });
  });
  return token;
}

function resolveSession(token) {
  if (!token) return null;
  const key = sessionKey(token);
  const session = (state().sessions || []).find((s) => s.id === key);
  if (!session || session.expiresAt <= Date.now()) return null;
  const user = byId(session.userId);
  if (!user || user.status === 'disabled') return null;
  return user;
}

function destroySession(token) {
  if (!token) return;
  const key = sessionKey(token);
  update((s) => { s.sessions = (s.sessions || []).filter((x) => x.id !== key); });
}

function revokeSessionsOf(userId) {
  update((s) => { s.sessions = (s.sessions || []).filter((x) => x.userId !== userId); });
}

function cookieHeader(token, req) {
  const secure = Boolean(req && (req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted));
  return `dp_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure ? '; Secure' : ''}`;
}
const clearCookieHeader = () => 'dp_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';

/* ------------------------------ 请求身份 ------------------------------ */

function isLoopback(req) {
  const addr = String((req && req.socket && req.socket.remoteAddress) || '');
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function isCliRequest(req, pathname) {
  return isLoopback(req) && req.headers['x-dp-cli'] === '1' && CLI_PATHS.includes(pathname);
}

function identity(req, parsed) {
  if (mode() === 'off') return { user: LEGACY_USER, via: 'off' };
  if (isCliRequest(req, parsed.pathname)) return { user: CLI_USER, via: 'cli' };
  // 应急 / 机器通道：ADMIN_TOKEN 始终等价管理员。
  if (config.adminToken) {
    const header = String(req.headers.authorization || '');
    const queryToken = parsed.searchParams.get('token') || '';
    if (header === `Bearer ${config.adminToken}` || queryToken === config.adminToken) {
      return { user: tokenUser(), via: 'token' };
    }
  }
  const user = resolveSession(cookieValue(req.headers.cookie, 'dp_session'));
  return user ? { user, via: 'session' } : null;
}

function authorize(req, pathname) {
  const user = req.user;
  if (!user) return mode() === 'optional';       // optional：未登录放行（灰度用）
  if (user.via === 'cli') return CLI_PATHS.includes(pathname);
  if (user.via === 'off') return true;
  // 首次登录的初始密码必须改掉，后端也强制：除登录状态 / 改密 / 登出外一律 403。
  if (req.identity && req.identity.via === 'session' && user.mustChangePassword
      && !['/api/auth/status', '/api/auth/password', '/api/auth/logout'].includes(pathname)) {
    throw new HttpError(403, '首次登录必须先修改初始密码');
  }
  return permissions.guard(req, pathname);
}

/* ------------------------------ 业务动作 ------------------------------ */

function login(req, res, body) {
  const username = String((body && body.username) || '').trim().toLowerCase();
  const password = String((body && body.password) || '');
  const key = `${username}|${(req.socket && req.socket.remoteAddress) || ''}`;
  const rec = attempts.get(key);
  if (rec && rec.lockedUntil > Date.now()) {
    throw new HttpError(429, '尝试次数过多，请 1 分钟后重试');
  }
  const user = byName(username);
  if (!user || user.status === 'disabled' || !verifyPassword(password, user.passwordHash)) {
    const next = rec && rec.until > Date.now() ? { ...rec, count: rec.count + 1 } : { count: 1, until: Date.now() + LOCK_MS };
    next.lockedUntil = next.count >= MAX_ATTEMPTS ? Date.now() + LOCK_MS : 0;
    attempts.set(key, next);
    throw new HttpError(401, '账号或密码错误');
  }
  attempts.delete(key);
  // 启用二次验证：先返回挑战令牌，校验动态码后才落地会话（见 verify2fa）。
  if (user.totpEnabled) {
    const totpToken = create2faChallenge(user.id);
    return { requiresTwoFactor: true, totpToken, methods: ['totp', 'recovery'] };
  }
  const token = createSession(user.id, req);
  update((s) => {
    const u = (s.users || []).find((x) => x.id === user.id);
    if (u) u.lastLoginAt = new Date().toISOString();
  });
  res.setHeader('Set-Cookie', cookieHeader(token, req));
  return { user: publicUser(user), mustChangePassword: Boolean(user.mustChangePassword) };
}

/** 登录第二步：校验 TOTP 动态码或一次性恢复码，校验通过才创建会话。 */
function verify2fa(req, res, body) {
  const totpToken = (body && body.totpToken) || '';
  const rec = peek2faChallenge(totpToken);
  if (!rec) throw new HttpError(401, '验证已过期，请重新登录');
  rec.attempts += 1;
  if (rec.attempts > 5) { drop2faChallenge(totpToken); throw new HttpError(429, '尝试次数过多，请重新登录'); }
  const user = byId(rec.userId);
  if (!user || user.status === 'disabled') { drop2faChallenge(totpToken); throw new HttpError(401, '账号不可用'); }
  const method = (body && body.method) || 'totp';
  const code = String((body && body.code) || '').trim();
  let ok = false;
  if (method === 'recovery') {
    const hash = hashRecovery(code);
    const idx = (user.totpRecovery || []).findIndex((h) => h === hash);
    if (idx >= 0) {
      ok = true;
      const removeAt = idx;
      update((s) => {
        const u = (s.users || []).find((x) => x.id === user.id);
        if (u && Array.isArray(u.totpRecovery)) u.totpRecovery.splice(removeAt, 1);
      });
    }
  } else if (user.totpSecret) {
    ok = verifyTotp(base32Decode(user.totpSecret), code);
  }
  if (!ok) throw new HttpError(401, '验证码错误');
  drop2faChallenge(totpToken);
  const token = createSession(user.id, req);
  update((s) => {
    const u = (s.users || []).find((x) => x.id === user.id);
    if (u) u.lastLoginAt = new Date().toISOString();
  });
  res.setHeader('Set-Cookie', cookieHeader(token, req));
  return { user: publicUser(user), mustChangePassword: Boolean(user.mustChangePassword) };
}

function logout(req, res) {
  destroySession(cookieValue(req.headers.cookie, 'dp_session'));
  res.setHeader('Set-Cookie', clearCookieHeader());
  return { ok: true };
}

function changePassword(user, body) {
  const current = byId(user.id);
  if (!current) throw notFound('账号不存在');
  if (!verifyPassword(String((body && body.oldPassword) || ''), current.passwordHash)) {
    throw new HttpError(401, '当前密码不正确');
  }
  const next = validatePassword((body && body.newPassword) || '');
  update((s) => {
    const u = (s.users || []).find((x) => x.id === current.id);
    if (u) {
      u.passwordHash = hashPassword(next); u.mustChangePassword = false;
      Object.assign(u, auditPasswordChange(current, 'self'));
    }
  });
  revokeSessionsOf(current.id);
  return { ok: true, message: '密码已修改，请重新登录' };
}

/** CLI / 管理员重置密码：吊销该账号所有会话；重置后无需再强制改密。 */
function resetPassword(username, newPassword, via = 'local') {
  const target = username ? byName(username) : activeAdmins()[0];
  if (!target) throw notFound('未找到要重置的账号');
  const password = newPassword ? validatePassword(newPassword) : crypto.randomBytes(12).toString('base64url');
  update((s) => {
    const u = (s.users || []).find((x) => x.id === target.id);
    if (u) {
      u.passwordHash = hashPassword(password);
      u.mustChangePassword = false;
      u.status = 'active';
      Object.assign(u, auditPasswordChange(target, via));
    }
    s.sessions = (s.sessions || []).filter((x) => x.userId !== target.id);
  });
  return { username: target.username, password };
}

function listUsers() { return users().map(publicUser); }

/* ----------------------------- 二次验证自服务 ----------------------------- */
/** 发起启用：生成密钥与恢复码（此时 totpEnabled 仍为 false，需 confirm2fa 校验后才生效）。 */
function setup2fa(user) {
  const current = byId(user.id);
  if (!current) throw notFound('账号不存在');
  const secret = base32Encode(crypto.randomBytes(20));
  const recovery = genRecoveryCodes(8);
  update((s) => {
    const u = (s.users || []).find((x) => x.id === user.id);
    if (u) { u.totpSecret = secret; u.totpRecovery = recovery.map(hashRecovery); u.totpEnabled = false; }
  });
  return { otpauthUri: otpauthUri(current.username, secret), secret, recoveryCodes: recovery };
}

/** 确认启用：校验一个动态码，正确后把 totpEnabled 置为 true。 */
function confirm2fa(user, body) {
  const u = byId(user.id);
  if (!u || !u.totpSecret) throw badRequest('请先发起二次验证设置');
  const code = String((body && body.code) || '').trim();
  if (!verifyTotp(base32Decode(u.totpSecret), code)) throw new HttpError(401, '验证码错误，请重试');
  update((s) => { const x = (s.users || []).find((y) => y.id === user.id); if (x) x.totpEnabled = true; });
  revokeSessionsOf(user.id);
  return { ok: true };
}

function disable2fa(user) {
  update((s) => {
    const x = (s.users || []).find((y) => y.id === user.id);
    if (x) { x.totpEnabled = false; x.totpSecret = ''; x.totpRecovery = []; }
  });
  revokeSessionsOf(user.id);
  return { ok: true };
}

function twoFactorStatus(user) {
  const u = byId(user.id);
  if (!u) throw notFound('账号不存在');
  return { enabled: Boolean(u.totpEnabled), recoveryCount: Array.isArray(u.totpRecovery) ? u.totpRecovery.length : 0 };
}

function createUser(body) {
  const username = String((body && body.username) || '').trim().toLowerCase();
  if (!/^[a-z0-9_.-]{2,32}$/.test(username)) throw badRequest('账号只能是 2-32 位小写字母 / 数字 / _ . -');
  if (byName(username)) throw new HttpError(409, '账号已存在');
  // 角色固定为普通用户：仅初始管理员可拥有管理员权限，新账号一律无法被提升为管理员。
  const role = 'user';
  const provided = (body && body.password) ? String(body.password) : '';
  let password = provided;
  let generatedPassword = false;
  if (!provided) { password = crypto.randomBytes(12).toString('base64url'); generatedPassword = true; }
  else validatePassword(provided);
  const user = {
    id: uid('usr'), username, displayName: String((body && body.displayName) || username).slice(0, 60),
    passwordHash: hashPassword(password), role, status: 'active',
    mustChangePassword: false, createdAt: new Date().toISOString(), lastLoginAt: '',
  };
  update((s) => { s.users.push(user); });
  const result = publicUser(user);
  if (generatedPassword) result.generatedPassword = password;
  return result;
}

function updateUser(id, body, actor) {
  const user = byId(id);
  if (!user) throw notFound('账号不存在');
  const patch = {};
  if (body && body.displayName !== undefined) patch.displayName = String(body.displayName).slice(0, 60);
  // 角色不可变更：仅初始管理员为管理员，普通账号无法被提升，初始管理员也无法被降级。
  if (body && body.role !== undefined) {
    throw badRequest('账号角色不可变更（仅初始管理员为管理员）');
  }
  if (body && body.status !== undefined) {
    const status = body.status === 'disabled' ? 'disabled' : 'active';
    if (user.isInitialAdmin) throw badRequest('初始管理员不可禁用或降级');
    if (status === 'disabled' && user.id === actor.id) throw badRequest('不能禁用自己');
    if (status === 'disabled' && user.role === 'admin' && activeAdmins().length <= 1) {
      throw badRequest('不能禁用最后一个管理员');
    }
    patch.status = status;
  }
  if (body && body.password) {
    patch.passwordHash = hashPassword(validatePassword(body.password));
    Object.assign(patch, auditPasswordChange(user, 'admin'));
  }
  update((s) => {
    const u = (s.users || []).find((x) => x.id === id);
    if (u) Object.assign(u, patch);
  });
  if (patch.passwordHash || patch.status === 'disabled') revokeSessionsOf(id);
  return publicUser(byId(id));
}

/** 禁用账号而不是物理删除：避免已有资源的 ownerId 变成悬空引用。 */
function deleteUser(id, actor) {
  return updateUser(id, { status: 'disabled' }, actor);
}

function status(user) {
  return {
    mode: mode(),
    authenticated: Boolean(user && user.via !== 'off' && user.id !== '__legacy__'),
    user: user && user.via !== 'off' ? publicUser(user) : null,
    tokenChannel: Boolean(config.adminToken),
  };
}

module.exports = {
  PUBLIC_PATHS, CLI_PATHS, SESSION_TTL_MS,
  mode, initialize, identity, authorize, isCliRequest,
  hashPassword, verifyPassword, validatePassword,
  login, logout, changePassword, resetPassword, status,
  verify2fa, setup2fa, confirm2fa, disable2fa, twoFactorStatus,
  listUsers, createUser, updateUser, deleteUser, publicUser,
  byId, byName, users, cookieValue, clearCookieHeader,
};
