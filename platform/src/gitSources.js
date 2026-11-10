'use strict';

/**
 * 外部 Git 源（GitHub / 自建 Gitea / GitLab / 兼容 Gitea 的自建服务）。
 *
 * 设计要点：
 *  1. 平台自带的 Gitea 作为「内置源」永远存在，外部源登记到 state.gitSources；
 *  2. 凭据（token）只写 state.json（600 权限），列表/详情一律脱敏；
 *  3. clone 时用 `git -c http.extraHeader=...` 临时传递凭据，不把 token 写进
 *     .git/config 的 remote URL，也不落到工作区任何文件里；
 *  4. 所有仓库按统一结构归一化，前端只认一种形状。
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { config, state, update, uid, safeWorkspacePath, relativeWorkspacePath } = require('./core');
const { httpJSON } = require('./integrations');

const BUILTIN_ID = 'builtin-gitea';
const TYPES = ['github', 'gitea', 'gitlab', 'generic'];

/* ------------------------------ 数据存取 ------------------------------ */

function builtinSource() {
  return {
    id: BUILTIN_ID,
    label: '平台自带 Gitea',
    type: 'gitea',
    baseUrl: config.giteaUrl,
    token: config.giteaToken || '',
    username: '',
    builtin: true,
    createdAt: null,
  };
}

function allSources() {
  const custom = (state().gitSources || []).filter((s) => s.id !== BUILTIN_ID);
  return [builtinSource(), ...custom];
}

function findSource(id) {
  const s = allSources().find((x) => x.id === id);
  if (!s) throw new Error(`Git 源不存在：${id}`);
  return s;
}

function publicSource(s) {
  return {
    id: s.id, label: s.label, type: s.type, baseUrl: s.baseUrl,
    username: s.username || '', builtin: Boolean(s.builtin),
    hasToken: Boolean(s.token),
    tokenMasked: s.token ? `${String(s.token).slice(0, 3)}****${String(s.token).slice(-3)}` : '',
    createdAt: s.createdAt || null,
  };
}

function listSources() {
  return { items: allSources().map(publicSource) };
}

function normalizeBase(type, baseUrl) {
  let url = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(url)) throw new Error('服务地址必须是 http(s):// 开头');
  if (type === 'github' && !url) url = 'https://api.github.com';
  return url;
}

function createSource(body = {}) {
  const type = TYPES.includes(String(body.type)) ? String(body.type) : 'generic';
  const label = String(body.label || '').trim().slice(0, 60);
  if (!label) throw new Error('请填写源名称');
  const baseUrl = normalizeBase(type, body.baseUrl || (type === 'github' ? 'https://api.github.com' : ''));
  const token = String(body.token || '').trim().slice(0, 512);
  if (!token) throw new Error('请填写访问令牌（Token）');
  const source = {
    id: uid('gitsrc'), label, type, baseUrl, token,
    username: String(body.username || '').trim().slice(0, 80),
    builtin: false, createdAt: new Date().toISOString(),
  };
  update((s) => {
    if (!Array.isArray(s.gitSources)) s.gitSources = [];
    if (s.gitSources.some((x) => x.label === label)) throw new Error(`同名 Git 源已存在：${label}`);
    s.gitSources.push(source);
  });
  return publicSource(source);
}

function updateSource(id, body = {}) {
  if (id === BUILTIN_ID) throw new Error('内置 Gitea 源由 .env 配置，请在 dist/.env 中修改');
  const found = (state().gitSources || []).find((s) => s.id === id);
  if (!found) throw new Error(`Git 源不存在：${id}`);
  const patch = {};
  if (body.label !== undefined) patch.label = String(body.label).trim().slice(0, 60);
  if (body.type !== undefined && TYPES.includes(String(body.type))) patch.type = String(body.type);
  if (body.baseUrl !== undefined) patch.baseUrl = normalizeBase(patch.type || found.type, body.baseUrl);
  if (body.username !== undefined) patch.username = String(body.username).trim().slice(0, 80);
  if (body.token) patch.token = String(body.token).trim().slice(0, 512);
  update((s) => Object.assign(s.gitSources.find((x) => x.id === id), patch));
  return publicSource(findSource(id));
}

function removeSource(id) {
  if (id === BUILTIN_ID) throw new Error('内置 Gitea 源不可删除');
  update((s) => { s.gitSources = (s.gitSources || []).filter((x) => x.id !== id); });
  return { removed: id };
}

/* --------------------------- 平台适配（只读） --------------------------- */

function apiBase(s) {
  switch (s.type) {
    case 'github': return { url: s.baseUrl || 'https://api.github.com', kind: 'github' };
    case 'gitlab': return { url: `${s.baseUrl}/api/v4`, kind: 'gitlab' };
    case 'gitea': return { url: `${s.baseUrl}/api/v1`, kind: 'gitea' };
    default: return { url: `${s.baseUrl}/api/v1`, kind: 'gitea' };
  }
}

function authHeaders(s) {
  switch (s.type) {
    case 'github':
      return { Authorization: `Bearer ${s.token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'devplatform' };
    case 'gitlab':
      return { 'PRIVATE-TOKEN': s.token };
    default:
      return { Authorization: `token ${s.token}` };
  }
}

function normalizeRepo(s, r) {
  const fullName = String(
    s.type === 'gitlab' ? (r.path_with_namespace || '') : (r.full_name || `${(r.owner && (r.owner.login || r.owner.username)) || ''}/${r.name}`),
  ) || String(r.name || '');
  const owner = String(fullName).split('/')[0] || '';
  return {
    sourceId: s.id, sourceLabel: s.label, sourceType: s.type,
    id: `${s.id}:${fullName}`,
    name: String(r.name || fullName.split('/').pop() || ''),
    fullName, owner,
    cloneUrl: String(r.clone_url || r.http_url_to_repo || ''),
    sshUrl: String(r.ssh_url || ''),
    htmlUrl: String(r.html_url || r.web_url || ''),
    description: String(r.description || '').slice(0, 200),
    private: Boolean(r.private || r.visibility === 'private'),
    defaultBranch: String(r.default_branch || 'main'),
    updatedAt: r.updated_at || r.last_activity_at || null,
  };
}

async function listReposOf(s) {
  if (!s.token) throw Object.assign(new Error(`Git 源「${s.label}」未配置 Token`), { code: 'unconfigured' });
  const { url, kind } = apiBase(s);
  const pathname = kind === 'github' ? '/user/repos?per_page=100&sort=updated'
    : kind === 'gitlab' ? '/projects?membership=true&per_page=100&order_by=updated_at'
      : '/user/repos?limit=100';
  const payload = await httpJSON(`${url}${pathname}`, {
    headers: authHeaders(s), timeout: 12000,
  });
  if (!Array.isArray(payload)) throw new Error(`Git 源「${s.label}」返回了非预期数据`);
  return payload.map((r) => normalizeRepo(s, r));
}

/** 聚合所有源；单个源失败不影响其它源，错误单独返回供前端提示。 */
async function listAllRepos() {
  const sources = allSources();
  const results = await Promise.allSettled(sources.map(listReposOf));
  const items = [];
  const errors = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') items.push(...r.value);
    else errors.push({ sourceId: sources[i].id, label: sources[i].label, error: String(r.reason && r.reason.message || r.reason) });
  });
  return { items, errors, sources: sources.map(publicSource) };
}

async function listBranches(sourceId, fullName) {
  const s = findSource(sourceId);
  if (!s.token) throw new Error(`Git 源「${s.label}」未配置 Token`);
  if (!/^[A-Za-z0-9._/-]{1,200}$/.test(String(fullName))) throw new Error('仓库名不合法');
  const { url, kind } = apiBase(s);
  let pathname;
  if (kind === 'github') pathname = `/repos/${fullName}/branches?per_page=100`;
  else if (kind === 'gitlab') pathname = `/projects/${encodeURIComponent(fullName)}/repository/branches`;
  else pathname = `/repos/${fullName}/branches`;
  const payload = await httpJSON(`${url}${pathname}`, { headers: authHeaders(s), timeout: 12000 });
  if (!Array.isArray(payload)) throw new Error('分支接口返回了非预期数据');
  return { items: payload.map((b) => ({ name: String(b.name || ''), protected: Boolean(b.protected), sha: String((b.commit && (b.commit.sha || b.commit.id)) || '').slice(0, 12) })) };
}

async function createRepo(sourceId, body = {}) {
  const s = findSource(sourceId);
  if (!s.token) throw new Error(`Git 源「${s.label}」未配置 Token`);
  const name = String(body.name || '').replace(/[^A-Za-z0-9_.-]/g, '-');
  if (!name) throw new Error('请填写仓库名');
  const { url, kind } = apiBase(s);
  const payload = kind === 'github'
    ? { name, description: body.description || '', private: Boolean(body.private), auto_init: true }
    : kind === 'gitlab'
      ? { name, description: body.description || '', visibility: body.private ? 'private' : 'public', initialize_with_readme: true }
      : { name, description: body.description || '', private: Boolean(body.private), auto_init: true };
  const created = await httpJSON(`${url}${kind === 'github' ? '/user/repos' : kind === 'gitlab' ? '/projects' : '/user/repos'}`, {
    method: 'POST', headers: authHeaders(s), body: payload, timeout: 20000,
  });
  return normalizeRepo(s, created);
}

async function testSource(id) {
  const items = await listReposOf(findSource(id));
  return { online: true, count: items.length };
}

/* ------------------------------ 克隆仓库 ------------------------------ */

/**
 * 构造带临时凭据的 git clone 参数。凭据以 `git -c http.extraHeader=...` 传入，
 * 只在本次进程的参数中出现，不写入 .git/config、不落到磁盘。
 * SSH 地址（git@ / ssh://）不做处理，走本机 SSH 密钥。
 */
function cloneArgs(source, cloneUrl) {
  const args = ['clone'];
  let env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  const url = String(cloneUrl || '').trim();
  if (!/^(https?:\/\/|git@|ssh:\/\/)/.test(url)) throw new Error('cloneUrl 必须是 http(s)/ssh/git 地址');
  const isHttp = /^https?:\/\//i.test(url);
  if (isHttp && source && source.token) {
    let header;
    if (source.type === 'gitlab') header = `PRIVATE-TOKEN: ${source.token}`;
    else {
      const user = source.type === 'github'
        ? 'x-access-token'
        : (source.username || (source.type === 'gitea' ? 'token' : 'git'));
      const basic = Buffer.from(`${user}:${source.token}`).toString('base64');
      header = `Authorization: Basic ${basic}`;
    }
    args.push('-c', `http.extraHeader=${header}`);
    // 只允许对这个源的地址附加凭据，避免被重定向到第三方时泄漏。
    args.push('-c', 'http.extraHeaderRedact=true');
  }
  args.push(url);
  return { args, env, auth: Boolean(isHttp && source && source.token) };
}

function scrub(text, token) {
  if (!token) return text;
  return String(text).split(token).join('******').replace(/(Basic\s+)[A-Za-z0-9+/=]{8,}/gi, '$1******');
}

async function cloneRepo({ sourceId, cloneUrl, name, branch } = {}) {
  const source = sourceId ? findSource(sourceId) : null;
  const url = String(cloneUrl || '').trim();
  if (!url) throw new Error('缺少 cloneUrl');
  const repoName = String(name || path.basename(url, '.git')).replace(/[^A-Za-z0-9_.-]/g, '-');
  if (!repoName || repoName === '.' || repoName === '..') throw new Error('仓库名不合法');
  const target = safeWorkspacePath(repoName);
  if (fs.existsSync(target)) throw new Error(`目录已存在：${repoName}`);

  const { args, env, auth } = cloneArgs(source, url);
  if (branch && /^[A-Za-z0-9._/-]{1,120}$/.test(String(branch))) args.splice(args.length - 1, 0, '-b', String(branch));
  args.push(target);

  await new Promise((resolve, reject) => {
    const child = spawn('git', args, { shell: false, env });
    let stderr = '';
    child.stderr.on('data', (c) => { stderr += c.toString(); });
    child.on('error', reject);
    child.on('close', (code) => (code === 0
      ? resolve()
      : reject(new Error(`git clone 失败：${scrub(stderr.slice(-600), source && source.token)}`))));
  });
  return {
    name: repoName, path: relativeWorkspacePath(target), cloneUrl: url,
    sourceId: sourceId || '', authenticated: auth,
  };
}

module.exports = {
  BUILTIN_ID, TYPES, listSources, createSource, updateSource, removeSource,
  listAllRepos, listReposOf, listBranches, createRepo, testSource,
  cloneRepo, cloneArgs, allSources, findSource, publicSource,
};
