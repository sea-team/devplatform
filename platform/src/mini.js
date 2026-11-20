'use strict';

// 极简内置 HTTP 路由：零依赖即可运行控制台。
// 生产容器里仍可安装 ssh2 / undici / iconv-lite 获得完整能力，本文件不依赖它们。
const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
};

function sendJSON(res, code, payload) {
  if (res.headersSent) return;
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(payload));
}

function decorateResponse(res) {
  res.json = (payload) => sendJSON(res, res.statusCode >= 400 ? res.statusCode : 200, payload);
  res.status = (code) => { res.statusCode = code; return res; };
  res.sendFile = (file) => {
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    // 控制台静态资源一律不缓存：前端改动部署后刷新页面即可生效，无需强制刷新。
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  };
  return res;
}

function matchPattern(pattern, pathname) {
  const keys = [];
  let source = pattern.replace(/:([A-Za-z0-9_]+)/g, (_, key) => {
    keys.push(key);
    return '([^/]+)';
  });
  // v0.4.7：支持 * 通配（匹配任意路径含 /），用于 OpenList 后台同源代理的多段路径。
  // 捕获按出现顺序存到 params[0]、params[1]…，与 Express 风格一致。
  const starCount = (source.match(/\*/g) || []).length;
  source = source.replace(/\*/g, '(.*)');
  const found = pathname.match(new RegExp(`^${source}$`));
  if (!found) return null;
  const params = {};
  // 注意：dispatch 已经对整个 pathname 做过一次 decodeURIComponent，这里不能再解一次。
  // 二次解码会 (1) 让 %25xx 被解释成路径分隔符/字面量，绕过路由与权限判定；
  // (2) 遇到合法的「%」字面量时抛 URIError，而本函数在 try 之外，会直接打断进程。
  keys.forEach((key, index) => { params[key] = found[index + 1]; });
  for (let i = 0; i < starCount; i++) params[i] = found[keys.length + i + 1];
  return params;
}

function readBody(req, { limit = 2 * 1024 * 1024, raw = false } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    // 解析失败属于客户端错误，必须带显式 status：否则会被兜底推断误判成上游故障 / 500。
    const clientError = (message, status) => {
      const err = new Error(message);
      err.status = status;
      return err;
    };
    req.on('data', (chunk) => {
      if (tooLarge) return; // 继续把请求流读完，避免 destroy 把 socket 重置、客户端收不到 413
      size += chunk.length;
      if (size > limit) {
        tooLarge = true;
        reject(clientError('请求体过大', 413));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) return; // 已按 413 拒绝，不再走解析
      const buffer = Buffer.concat(chunks);
      if (raw) return resolve(buffer);
      const contentType = String(req.headers['content-type'] || '').toLowerCase();
      if (!buffer.length) return resolve({});
      if (contentType.includes('application/json')) {
        try { return resolve(JSON.parse(buffer.toString('utf8'))); }
        catch { return reject(clientError('请求体不是合法 JSON', 400)); }
      }
      resolve(buffer.toString('utf8'));
    });
    req.on('error', reject);
  });
}

function serveStatic(staticDir, pathname, res) {
  const root = path.resolve(staticDir);
  const target = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (target !== root && !target.startsWith(root + path.sep)) {
    return sendJSON(res, 403, { ok: false, error: '禁止访问', status: 403 });
  }
  if (fs.existsSync(target) && fs.statSync(target).isFile()) return res.sendFile(target);
  const index = path.join(root, 'index.html');
  if (fs.existsSync(index)) return res.sendFile(index);
  return sendJSON(res, 404, { ok: false, error: '控制台文件不存在', status: 404 });
}

function createApp({ adminToken = '', staticDir = '', errorStatus = null, authGate = null } = {}) {
  const routes = [];
  let staticRoot = staticDir;

  const register = (method, pattern, handler, options = {}) => {
    routes.push({ method, pattern, handler, options });
    return app;
  };

  const app = {
    disable: () => app,
    use: () => app,
    useStatic: (dir) => { staticRoot = dir; return app; },
    get: (p, h, o) => register('GET', p, h, o),
    post: (p, h, o) => register('POST', p, h, o),
    put: (p, h, o) => register('PUT', p, h, o),
    delete: (p, h, o) => register('DELETE', p, h, o),
    listen: (port, callback) => {
      const server = http.createServer((req, res) => {
        // dispatch 是 async 函数：分发层的身份解析（Cookie / 路径解码）等在路由 try
        // 之外执行，任何漏网异常都会变成 unhandledRejection，而 Node ≥ 15 默认把它
        // 升级成未捕获异常并终止进程——单个畸形请求即可打挂整个控制台。统一兜底。
        Promise.resolve(dispatch(req, res)).catch((error) => {
          console.error('[devplatform] 请求处理异常：', (error && error.stack) || error);
          try {
            if (!res.headersSent) sendJSON(res, 500, { ok: false, error: '服务器内部错误', status: 500 });
            else res.end();
          } catch { /* 连接已断开，忽略 */ }
        });
      });
      server.listen(port, callback);
      return server;
    },
  };

  async function dispatch(req, res) {
    decorateResponse(res);
    // 账号体系：统一过滤响应里的 items 数组，让所有列表接口都不泄露他人资源，
    // 不必逐个改 168 条路由；只认能在归属集合里反查到 id 的对象。
    if (authGate && authGate.filterResponse) {
      const originalJson = res.json;
      res.json = (payload) => originalJson(authGate.filterResponse(req, payload));
    }
    let parsed;
    try { parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`); }
    catch { return sendJSON(res, 400, { ok: false, error: '非法请求路径', status: 400 }); }
    let pathname;
    try { pathname = decodeURIComponent(parsed.pathname); }
    catch {
      // 畸形 % 编码（如 /api/%ZZ）曾是未捕获的 URIError，会直接终止整个 Node 进程：
      // 单个畸形 URL 就能让平台对所有用户不可用。必须在这里收敛成客户端错误。
      return sendJSON(res, 400, { ok: false, error: '非法请求路径编码', status: 400 });
    }

    if (!pathname.startsWith('/api/')) return serveStatic(staticRoot, pathname, res);

    // 账号体系：统一在分发层解析身份；off 是应急回退，required 会拦截除公开路径外的所有 API。
    // 资源级权限在 req.body / req.params 解析完成后再判（见下方 authorize）。
    if (authGate) {
      const currentMode = authGate.mode();
      if (currentMode === 'off') {
        req.user = { id: '__legacy__', username: 'legacy', role: 'admin', via: 'off' };
        req.identity = { user: req.user, via: 'off' };
      } else {
        // 公开路径也要解析身份：/api/auth/status 需要据此告诉前端「是否已登录」。
        const identity = authGate.identity(req, parsed);
        if (!identity && currentMode === 'required' && !authGate.isPublic(pathname)) {
          return sendJSON(res, 401, { ok: false, error: '未登录：请先登录控制台', status: 401 });
        }
        req.user = identity ? identity.user : null;
        req.identity = identity;
      }
    } else if (adminToken && pathname !== '/api/health') {
      // 兼容未注入 authGate 的调用方（旧脚本 / 单测）：仍按单一 ADMIN_TOKEN 校验。
      const header = req.headers.authorization || '';
      const queryToken = parsed.searchParams.get('token') || '';
      if (header !== `Bearer ${adminToken}` && queryToken !== adminToken) {
        return sendJSON(res, 401, { ok: false, error: '未授权：需要 Bearer ADMIN_TOKEN', status: 401 });
      }
    }

    for (const route of routes) {
      if (route.method !== req.method) continue;
      const params = matchPattern(route.pattern, pathname);
      if (!params) continue;
      try {
        req.params = params;
        req.query = Object.fromEntries(parsed.searchParams.entries());
        req.body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)
          ? await readBody(req, {
              raw: route.options.raw,
              // 会话消息可能带 base64 图片/文本附件，允许单路由放宽上限。
              limit: Number(route.options.bodyLimit)
                || (route.options.raw ? 100 * 1024 * 1024 : 2 * 1024 * 1024),
            })
          : {};
        // 无论有没有解析出身份都要过 authorize：optional 灰度模式下未登录请求的
        // req.identity 为 null，旧写法会整段跳过守卫，让匿名写请求直达配置/部署接口。
        if (authGate && !authGate.isPublic(pathname) && !authGate.authorize(req, pathname, route)) {
          return sendJSON(res, req.user ? 403 : 401, {
            ok: false,
            error: req.user ? '无权操作：该资源不属于你，或你的协作权限不足（全局配置仅管理员可改）'
              : '未登录：请先登录控制台',
            status: req.user ? 403 : 401,
          });
        }
        if (authGate && authGate.withUser) await authGate.withUser(req.user, () => route.handler(req, res));
        else await route.handler(req, res);
      } catch (error) {
        // 未经过 wrap() 的同步处理器也走同一套状态码推断，避免「明明是参数错误」却报 500。
        const status = Number(error && error.status) || (errorStatus ? errorStatus(error) : 500);
        const payload = { ok: false, error: String((error && error.message) || error), status };
        if (error && error.errorCode) payload.code = error.errorCode;
        if (error && error.hint) payload.hint = error.hint;
        sendJSON(res, status, payload);
      }
      return;
    }
    return sendJSON(res, 404, { ok: false, error: `接口不存在：${req.method} ${pathname}`, status: 404 });
  }

  return app;
}

module.exports = { createApp };
