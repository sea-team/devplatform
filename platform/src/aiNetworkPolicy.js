'use strict';

/**
 * AI Base URL 属地分级（v0.4.23，SSRF 防护）。
 *
 * 背景：AI 服务的 baseURL 由服务端 fetch(baseURL + '/models' 或 '/chat/completions') 发起请求，
 * 普通账号若可填任意地址，就能让服务器访问内网 / 云元数据并把响应内容通过接口回显（SSRF）。
 * 但本机 Ollama（127.0.0.1:11434）是合法场景，不能简单拒绝所有私网。
 *
 * 策略（分级放行）：
 *   - 公网地址：所有账号可配置；
 *   - 私网 / 本机 / 链路本地 / 云元数据地址：仅管理员可配置；
 *   - 非法地址：一律拒绝。
 * 这样既堵住普通账号的 SSRF，又保留管理员的本机 Ollama / 内网 vLLM 场景。
 *
 * 说明：域名（非 IP）默认按公网处理。DNS rebinding（域名解析到私网）属于残余风险，
 * 需在出口层用防火墙 / 代理约束解决；本模块针对的是「直接填写内网地址」这一主要攻击面。
 */
const net = require('net');
const { HttpError } = require('./core');

/** 判断 IPv4 是否属于需要管理员权限的属地。 */
function privateV4(a, b) {
  if (a === 0) return true;                       // 0.0.0.0/8 — 本网络
  if (a === 10) return true;                      // 10.0.0.0/8
  if (a === 127) return true;                     // 127.0.0.0/8 — loopback
  if (a === 169 && b === 254) return true;        // 169.254.0.0/16 — 链路本地 / 云元数据
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true;        // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 — 运营商级 NAT
  if (a === 192 && b === 0) return true;          // 192.0.0.0/24 — IETF 协议分配
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 — 基准测试
  if (a === 224) return true;                     // 组播，不作为 AI 服务地址
  return false;
}

/** 判断 IPv6 是否属于需要管理员权限的属地。 */
function privateV6(lower) {
  if (lower === '::1' || lower === '::' || lower === '::ffff:0:0') return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // fc00::/7 唯一本地
  if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true; // fe80::/10 链路本地
  if (lower.startsWith('::ffff:')) {              // IPv4-mapped
    const mapped = lower.slice(7);
    const parts = mapped.split(':');
    if (parts.length === 2) {
      const hi = parseInt(parts[0], 16);
      const lo = parseInt(parts[1], 16);
      const a = (hi >> 8) & 0xff;
      const b = hi & 0xff;
      return privateV4(a, b);
    }
  }
  return false;
}

/**
 * 分类地址属地。
 * @returns {'public'|'private'|'invalid'}
 */
function classify(baseURL) {
  let u;
  try { u = new URL(String(baseURL || '').trim()); } catch { return 'invalid'; }
  if (!['http:', 'https:'].includes(u.protocol)) return 'invalid';
  let host = u.hostname.toLowerCase();
  // Node 的 URL.hostname 对 IPv6 保留外层中括号（如 "[::1]"），先剥离。
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  // 去掉可选 Zone ID（%eth0）。
  const zone = host.indexOf('%');
  if (zone >= 0) host = host.slice(0, zone);

  if (host === 'localhost' || host.endsWith('.localhost')) return 'private';
  const ver = net.isIP(host);
  if (ver === 4) {
    const [a, b] = host.split('.').map(Number);
    return privateV4(a, b) ? 'private' : 'public';
  }
  if (ver === 6) return privateV6(host) ? 'private' : 'public';
  // 域名：按公网处理（DNS rebinding 由出口层兜底，见模块头注释）。
  if (!/^[a-z0-9.-]+$/.test(host) || host.includes('..')) return 'invalid';
  return 'public';
}

/**
 * 校验 baseURL 是否允许当前用户配置。
 * @param {string} baseURL
 * @param {object} user  req.user
 * @throws HttpError 400（非法地址）/ 403（私网地址但非管理员）
 */
function assertAllowed(baseURL, user) {
  const scope = classify(baseURL);
  if (scope === 'invalid') throw new HttpError(400, 'AI Base URL 不是合法的 http(s) 地址');
  if (scope === 'private') {
    const isAdmin = Boolean(user && user.role === 'admin');
    if (!isAdmin) {
      throw new HttpError(403, '私网 / 本机 / 云元数据地址仅管理员可配置为 AI 服务地址（如需使用本机 Ollama，请联系管理员添加）');
    }
  }
  return scope;
}

module.exports = { classify, assertAllowed, privateV4, privateV6 };
