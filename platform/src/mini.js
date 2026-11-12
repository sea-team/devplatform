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
  const source = pattern.replace(/:([A-Za-z0-9_]+)/g, (_, key) => {
    keys.push(key);
    return '([^/]+)';
  });
  const found = pathname.match(new RegExp(`^${source}$`));
  if (!found) return null;
  const params = {};
  keys.forEach((key, index) => { params[key] = decodeURIComponent(found[index + 1]); });
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
      const server = http.createServer((req, res) => { dispatch(req, res); });
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
    const pathname = decodeURIComponent(parsed.pathname);

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
              limit: route.options.raw ? 100 * 1024 * 1024 : 2 * 1024 * 1024,
            })
          : {};
        if (authGate && req.identity && !authGate.isPublic(pathname) && !authGate.authorize(req, pathname, route)) {
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
