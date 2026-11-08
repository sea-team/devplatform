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
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) { reject(new Error('请求体过大')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const buffer = Buffer.concat(chunks);
      if (raw) return resolve(buffer);
      const contentType = String(req.headers['content-type'] || '').toLowerCase();
      if (!buffer.length) return resolve({});
      if (contentType.includes('application/json')) {
        try { return resolve(JSON.parse(buffer.toString('utf8'))); }
        catch { return reject(new Error('请求体不是合法 JSON')); }
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
    return sendJSON(res, 403, { ok: false, error: '禁止访问' });
  }
  if (fs.existsSync(target) && fs.statSync(target).isFile()) return res.sendFile(target);
  const index = path.join(root, 'index.html');
  if (fs.existsSync(index)) return res.sendFile(index);
  return sendJSON(res, 404, { ok: false, error: '控制台文件不存在' });
}

function createApp({ adminToken = '', staticDir = '' } = {}) {
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
    let parsed;
    try { parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`); }
    catch { return sendJSON(res, 400, { ok: false, error: '非法请求路径' }); }
    const pathname = decodeURIComponent(parsed.pathname);

    if (!pathname.startsWith('/api/')) return serveStatic(staticRoot, pathname, res);

    if (adminToken && pathname !== '/api/health') {
      // EventSource / 下载链接无法带自定义 Header，允许用 ?token= 传递同一个 ADMIN_TOKEN。
      const header = req.headers.authorization || '';
      const queryToken = parsed.searchParams.get('token') || '';
      if (header !== `Bearer ${adminToken}` && queryToken !== adminToken) {
        return sendJSON(res, 401, { ok: false, error: '未授权：需要 Bearer ADMIN_TOKEN' });
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
        await route.handler(req, res);
      } catch (error) {
        sendJSON(res, 500, { ok: false, error: String((error && error.message) || error) });
      }
      return;
    }
    return sendJSON(res, 404, { ok: false, error: `接口不存在：${req.method} ${pathname}` });
  }

  return app;
}

module.exports = { createApp };
