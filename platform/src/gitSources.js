'use strict';

/**
 * 外部 Git 源（GitHub / 自建 Gitea / GitLab / 兼容 Gitea 的自建服务）。
 *
 * 设计要点：
 *  1. 平台自带的 Gitea 作为「内置源」永远存在，外部源登记到 state.gitSources；
 *  2. 凭据（token）只写 state.json（600 权限），列表/详情一律脱敏；
 *  3. clone 时用 `git -c http.extraHeader=...` 临时传递凭据，不把 token 写进
 *     .git/config 的 remote URL，也不落到工作区任何文件里；
 *  4. 所有仓库按统一结构归一化，前端只认一种形状；
 *  5. v0.3.3：Git 可执行文件由 src/gitRuntime.js 统一解析（支持 GIT_BIN / 控制台
 *     指定路径 / 常见安装路径）。容器镜像不含 Git 时自动降级到已登记的 SSH 宿主机，
 *     借 HOST_WORKSPACE_DIR 这个 bind mount 执行 clone，不再抛 spawn git ENOENT；
 *  6. v0.3.4：克隆通道由 src/environment.js 的环境档案决定（auto / local /
 *     ssh-host / disabled）。换机器时平台自动体检并切换，无需改代码；
 *  7. 临时凭据用 `git -c ... clone`（`-c` 必须在 clone 之前），否则会被写进
 *     .git/config 的 http.extraheader，造成 Token 落盘。
 */
const fs = require('fs');
const path = require('path');
const { config, state, update, uid, safeWorkspacePath, relativeWorkspacePath, HttpError } = require('./core');
const { httpJSON, sshExec } = require('./integrations');
const proxyModule = require('./proxy');
const environment = require('./environment');
const gitRuntime = require('./gitRuntime');

const BUILTIN_ID = 'builtin-gitea';
const TYPES = ['github', 'gitea', 'gitlab', 'generic'];
// v0.3.2：既支持 Token，也支持「账号 + 密码 / 个人访问令牌」的 Basic 认证。
const AUTH_TYPES = ['token', 'password'];
// 表单回显的脱敏占位符：提交时沿用已保存的凭据，避免把 ****** 写回 state.json。
const isMasked = (v) => String(v || '').includes('******');
const keepSecret = (value, saved) => (isMasked(value) ? (saved || '') : String(value || ''));
const hasCreds = (s) => Boolean(s && (s.token || (s.username && s.password)));

function assertCredentials(s) {
  if (!hasCreds(s)) {
    throw new Error(`Git 源「${s.label}」未配置凭据：请填写 Token，或选择「账号密码」并填写用户名与密码`);
  }
}

function builtinSource() {
  return {
    id: BUILTIN_ID,
    label: '平台自带 Gitea',
    type: 'gitea',
    baseUrl: config.giteaUrl,
    token: config.giteaToken || '',
    username: '',
    password: '',
    authType: 'token',
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

/** Git 作用域代理链：单个仓库 > Host 匹配规则 > Git 分组 > 全局。 */
function gitProxyFor(url, itemId = '') {
  return proxyModule.forHttp(url, 'git', {
    url, itemId, host: proxyModule.hostOf(url),
  });
}

function publicSource(s) {
  const authType = AUTH_TYPES.includes(s.authType) ? s.authType : 'token';
  return {
    id: s.id, label: s.label, type: s.type, baseUrl: s.baseUrl,
    username: s.username || '', authType, builtin: Boolean(s.builtin),
    hasToken: Boolean(s.token),
    hasPassword: Boolean(s.password),
    hasCreds: hasCreds(s),
    tokenMasked: s.token ? `${String(s.token).slice(0, 3)}******${String(s.token).slice(-3)}` : '',
    passwordMasked: s.password ? `******${String(s.password).slice(-2)}` : '',
    effectiveProxy: gitProxyFor(s.baseUrl, s.id).masked,
    host: proxyModule.hostOf(s.baseUrl),
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
  const authType = AUTH_TYPES.includes(String(body.authType)) ? String(body.authType) : 'token';
  const username = String(body.username || '').trim().slice(0, 80);
  const token = String(body.token || '').trim().slice(0, 512);
  const password = String(body.password || '').trim().slice(0, 256);
  if (authType === 'password') {
    if (!username || !password) throw new Error('账号密码方式必须填写用户名和密码');
  } else if (!token) {
    throw new Error('Token 方式必须填写访问令牌；也可切换为「账号密码」认证');
  }
  const source = {
    id: uid('gitsrc'), label, type, baseUrl, authType,
    token: authType === 'token' ? token : '',
    username, password: authType === 'password' ? password : '',
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
  if (body.authType !== undefined && AUTH_TYPES.includes(String(body.authType))) patch.authType = String(body.authType);
  if (body.token !== undefined) patch.token = keepSecret(body.token, found.token).trim().slice(0, 512);
  if (body.password !== undefined) patch.password = keepSecret(body.password, found.password).trim().slice(0, 256);
  // 切换认证方式时清掉另一种凭据，避免明文长期留在 state.json。
  if (patch.authType === 'token') patch.password = '';
  if (patch.authType === 'password') patch.token = '';
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
  // 账号密码方式：Gitea / GitHub / GitLab 的 REST API 都接受 HTTP Basic。
  // GitHub 早已停用账户密码登录，这里请把 PAT 填在「密码」里、用户名填 GitHub 账号。
  if (s.authType === 'password') {
    const basic = Buffer.from(`${s.username || 'git'}:${s.password || ''}`).toString('base64');
    return { Authorization: `Basic ${basic}`, Accept: 'application/vnd.github+json', 'User-Agent': 'devplatform' };
  }
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
  assertCredentials(s);
  const { url, kind } = apiBase(s);
  const pathname = kind === 'github' ? '/user/repos?per_page=100&sort=updated'
    : kind === 'gitlab' ? '/projects?membership=true&per_page=100&order_by=updated_at'
      : '/user/repos?limit=100';
  const target = `${url}${pathname}`;
  const payload = await httpJSON(target, {
    headers: authHeaders(s), timeout: 12000,
    proxy: gitProxyFor(target, s.id).proxy,
  });
  if (!Array.isArray(payload)) throw new Error(`Git 源「${s.label}」返回了非预期数据`);
  return payload.map((r) => normalizeRepo(s, r));
}

/**
 * v0.3.7 · 扫描工作区里已经克隆好的本地仓库（目录中含 .git）。
 * 远程源一个都连不上时，这些仓库也必须出现在「仓库列表」里——用户克隆成功后
 * 看不到任何数据，就是因为它以前只聚合远端 API 的结果。
 */
function listWorkspaceRepos() {
  const root = config.workspaceDir;
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); }
  catch (e) { return { items: [], error: `工作区目录不可读：${e.message}` }; }
  const items = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const dir = path.join(root, ent.name);
    let gitStat;
    try { gitStat = fs.statSync(path.join(dir, '.git')); } catch { continue; }
    let remote = '';
    let branch = '';
    try {
      if (gitStat.isDirectory()) {
        const cfg = fs.readFileSync(path.join(dir, '.git', 'config'), 'utf8');
        const m = cfg.match(/^\s*url\s*=\s*(.+)$/m);
        if (m) remote = m[1].trim();
        const head = fs.readFileSync(path.join(dir, '.git', 'HEAD'), 'utf8').trim();
        branch = head.startsWith('ref:') ? head.replace(/^ref:\s*refs\/heads\//, '') : head.slice(0, 8);
      }
    } catch { /* 配置读不到也要把仓库列出来 */ }
    let updatedAt = gitStat.mtime.toISOString();
    try { updatedAt = fs.statSync(dir).mtime.toISOString(); } catch { /* noop */ }
    items.push({
      sourceId: 'workspace', sourceLabel: '工作区', sourceType: 'workspace',
      id: `workspace:${ent.name}`,
      name: ent.name,
      fullName: `工作区/${ent.name}`,
      owner: '',
      cloneUrl: remote,
      sshUrl: '',
      htmlUrl: '',
      description: [branch ? `分支 ${branch}` : '', remote ? '已关联远端' : '仅本地仓库'].filter(Boolean).join(' · '),
      private: false,
      defaultBranch: branch || 'main',
      updatedAt,
      localPath: relativeWorkspacePath(dir),
      isLocal: true,
    });
  }
  items.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return { items, error: '' };
}

/** 聚合「工作区本地仓库 + 所有远端源」；单个源失败不影响其它源，错误单独返回供前端提示。 */
async function listAllRepos() {
  const sources = allSources();
  const results = await Promise.allSettled(sources.map(listReposOf));
  const items = [];
  const errors = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') items.push(...r.value);
    else {
      const reason = r.reason || {};
      errors.push({
        sourceId: sources[i].id,
        label: sources[i].label,
        error: String(reason.message || reason),
        hint: String(reason.hint || ''),
      });
    }
  });
  const local = listWorkspaceRepos();
  // 本地仓库排在最前：即使所有远端源都挂了，用户也能立刻打开 IDE 或复制地址。
  items.unshift(...local.items);
  if (local.error) errors.push({ sourceId: 'workspace', label: '工作区', error: local.error, hint: '' });
  return {
    items, errors, sources: sources.map(publicSource),
    workspace: { count: local.items.length, dir: config.workspaceDir },
  };
}

async function listBranches(sourceId, fullName) {
  const s = findSource(sourceId);
  assertCredentials(s);
  if (!/^[A-Za-z0-9._/-]{1,200}$/.test(String(fullName))) throw new Error('仓库名不合法');
  const { url, kind } = apiBase(s);
  let pathname;
  if (kind === 'github') pathname = `/repos/${fullName}/branches?per_page=100`;
  else if (kind === 'gitlab') pathname = `/projects/${encodeURIComponent(fullName)}/repository/branches`;
  else pathname = `/repos/${fullName}/branches`;
  const target = `${url}${pathname}`;
  const payload = await httpJSON(target, {
    headers: authHeaders(s), timeout: 12000,
    proxy: gitProxyFor(target, s.id).proxy,
  });
  if (!Array.isArray(payload)) throw new Error('分支接口返回了非预期数据');
  return { items: payload.map((b) => ({ name: String(b.name || ''), protected: Boolean(b.protected), sha: String((b.commit && (b.commit.sha || b.commit.id)) || '').slice(0, 12) })) };
}

async function createRepo(sourceId, body = {}) {
  const s = findSource(sourceId);
  assertCredentials(s);
  const name = String(body.name || '').replace(/[^A-Za-z0-9_.-]/g, '-');
  if (!name) throw new Error('请填写仓库名');
  const { url, kind } = apiBase(s);
  const payload = kind === 'github'
    ? { name, description: body.description || '', private: Boolean(body.private), auto_init: true }
    : kind === 'gitlab'
      ? { name, description: body.description || '', visibility: body.private ? 'private' : 'public', initialize_with_readme: true }
      : { name, description: body.description || '', private: Boolean(body.private), auto_init: true };
  const target = `${url}${kind === 'github' ? '/user/repos' : kind === 'gitlab' ? '/projects' : '/user/repos'}`;
  const created = await httpJSON(target, {
    method: 'POST', headers: authHeaders(s), body: payload, timeout: 20000,
    proxy: gitProxyFor(target, s.id).proxy,
  });
  return normalizeRepo(s, created);
}

async function testSource(id) {
  const items = await listReposOf(findSource(id));
  return { online: true, count: items.length };
}

/* ------------------------------ 克隆仓库 ------------------------------ */

/**
 * 生成临时凭据头。v0.3.2 起同时支持：
 *  - 已登记 Git 源的 Token；
 *  - 已登记 Git 源的「账号 + 密码」；
 *  - 克隆表单本次直接填写的账号密码 / Token（不落盘，只在本次进程参数里出现）。
 * 返回 secret 供日志脱敏使用。
 */
function cloneCredential(source) {
  if (!source) return null;
  if (source.authType === 'password' && source.password) {
    const user = source.username || 'git';
    const basic = Buffer.from(`${user}:${source.password}`).toString('base64');
    return { header: `Authorization: Basic ${basic}`, secrets: [source.password, basic] };
  }
  if (!source.token) return null;
  if (source.type === 'gitlab') {
    return { header: `PRIVATE-TOKEN: ${source.token}`, secrets: [source.token] };
  }
  const user = source.type === 'github'
    ? 'x-access-token'
    : (source.username || (source.type === 'gitea' ? 'token' : 'git'));
  const basic = Buffer.from(`${user}:${source.token}`).toString('base64');
  return { header: `Authorization: Basic ${basic}`, secrets: [source.token, basic] };
}

function cloneArgs(source, cloneUrl, resolved = null) {
  // 关键：`-c` 必须放在 `clone` 子命令之前。
  // `git clone -c key=value` 会把配置持久化到新仓库的 .git/config（凭据随之落盘）；
  // `git -c key=value clone` 只是本次进程的临时配置，不会写任何文件。
  const args = [];
  let env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  const url = String(cloneUrl || '').trim();
  if (!/^(https?:\/\/|git@|ssh:\/\/)/.test(url)) throw new Error('cloneUrl 必须是 http(s)/ssh/git 地址');
  const isHttp = /^https?:\/\//i.test(url);

  // 分层代理结果：HTTP(S) 用 git -c http.proxy；SSH 地址用 core.sshCommand 挂 CONNECT 隧道。
  const proxyUrl = resolved && resolved.url
    && !proxyModule.shouldBypass(proxyModule.hostOf(url), resolved.noProxy)
    ? resolved.url : '';
  if (proxyUrl) {
    proxyModule.validateUrl(proxyUrl, { allowDirect: false });
    if (isHttp) {
      args.push('-c', `http.proxy=${proxyUrl}`);
      args.push('-c', `https.proxy=${proxyUrl}`);
    } else if (process.platform !== 'win32' && /^https?:\/\//i.test(proxyUrl)) {
      const u = new URL(proxyUrl);
      args.push('-c', `core.sshCommand=ssh -o ProxyCommand='nc -X connect -x ${u.hostname}:${u.port || 80} %h %p'`);
    }
  }
  if (resolved) env = { ...env, ...proxyModule.envFor(resolved) };

  const cred = isHttp ? cloneCredential(source) : null;
  if (cred) {
    args.push('-c', `http.extraHeader=${cred.header}`);
    // 只让凭据出现在本次进程参数里，不写入 .git/config，也不让 git 打印到日志。
    args.push('-c', 'http.extraHeaderRedact=true');
  }
  args.push('clone');
  args.push(url);
  return { args, env, auth: Boolean(cred), proxyUrl, secrets: cred ? cred.secrets : [] };
}

function scrub(text, secrets = []) {
  let out = String(text);
  for (const secret of secrets.filter(Boolean)) out = out.split(secret).join('******');
  return out.replace(/(Basic\s+)[A-Za-z0-9+/=]{8,}/gi, '$1******');
}

/** shell 单引号转义：把 git 参数原样送到 SSH 宿主机，不经过本地 shell。 */
function shQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

/**
 * v0.3.6：工作区同名目录冲突属于「用户可自行处理」的业务冲突，不是服务端异常。
 * 以前统一抛普通 Error → wrap() 兜底 500，前端显示成「服务端异常」让人以为程序坏了。
 * 现在返回 409 + 明确指引：若已是完整 .git 仓库，直接打开即可；若是上次失败的
 * 残留目录，改名或清理后重试。SSH 宿主机通道与本地通道共用同一份提示。
 */
function cloneTargetExists(target, localName = '', known = null) {
  const name = localName || path.posix.basename(String(target).replace(/\/+$/, ''));
  let complete = known;
  if (complete === null) {
    // 宿主机路径在容器内不可见，无法判断是否为完整仓库。
    try { complete = fs.existsSync(path.join(target, '.git')); } catch { complete = null; }
  }
  const done = '工作区里已存在同名完整仓库（含 .git），说明之前已克隆成功，可直接到「仓库列表 / 在线 IDE」打开；如需重新克隆，请换一个仓库名或先删除该目录。';
  const partial = '工作区里已有同名目录但不是完整 Git 仓库（可能是上次克隆中断留下的残留），请换一个仓库名，或到「存储 / 文件」清理该目录后重试。';
  const unknown = '工作区里已存在同名目录。若之前已克隆成功，请直接到「仓库列表 / 在线 IDE」打开；否则换一个仓库名或清理该目录后重试。';
  return new HttpError(409, `目录已存在：${name}`, {
    errorCode: 'WORKSPACE_TARGET_EXISTS',
    complete,
    hint: complete === true ? done : complete === false ? partial : unknown,
  });
}

/**
 * 容器内没有 Git 时的降级通道：借已登记的 SSH 宿主机执行同一条 git clone。
 * 工作区是 bind mount（HOST_WORKSPACE_DIR），宿主机写入后容器内立即可见。
 * 凭据沿用 -c http.extraHeader（不写 .git/config），错误输出统一脱敏。
 */
async function cloneViaSshHost({ args, resolved, secrets, hostTarget, server }) {
  const probe = await sshExec(server,
    'command -v git >/dev/null 2>&1 && git --version || { echo GIT_MISSING; exit 2; }', 20000);
  if (probe.code !== 0 || /GIT_MISSING/.test(`${probe.stdout}${probe.stderr}`)) {
    throw new Error(`SSH 宿主机「${server.name}」上也没有 Git：请在宿主机安装 git，或改用自带 Git 的平台镜像`);
  }
  const proxyEnv = proxyModule.envFor(resolved) || {};
  const envPrefix = [
    'GIT_TERMINAL_PROMPT=0',
    ...Object.entries(proxyEnv)
      .filter(([, v]) => typeof v === 'string')
      .map(([k, v]) => `${k}=${shQuote(v)}`),
  ].join(' ');
  const command = [
    `test ! -e ${shQuote(hostTarget)} || { echo "TARGET_EXISTS"; exit 3; }`,
    `${envPrefix} git ${args.map(shQuote).join(' ')} 2>&1`,
  ].join('; ');
  const result = await sshExec(server, command, 300000);
  const text = scrub(`${result.stdout || ''}${result.stderr || ''}`.trim(), secrets);
  if (result.code !== 0) {
    if (/TARGET_EXISTS/.test(text)) throw cloneTargetExists(hostTarget);
    throw new Error(`宿主机 git clone 失败（exit=${result.code}）：${text.slice(-800) || '无输出'}`);
  }
  return { gitVersion: probe.stdout.trim(), output: text.slice(-200) };
}

async function cloneRepo({ sourceId, cloneUrl, name, branch, proxy, repoId,
  username, password, token } = {}) {
  const source = sourceId ? findSource(sourceId) : null;
  const url = String(cloneUrl || '').trim();
  if (!url) throw new Error('缺少 cloneUrl');
  const repoName = String(name || path.basename(url, '.git')).replace(/[^A-Za-z0-9_.-]/g, '-');
  if (!repoName || repoName === '.' || repoName === '..') throw new Error('仓库名不合法');
  const target = safeWorkspacePath(repoName);
  if (fs.existsSync(target)) throw cloneTargetExists(target, repoName);

  // 本次表单直填的凭据优先于已登记源，且不写入 state.json。
  const inlineUser = String(username || '').trim().slice(0, 80);
  const inlinePass = String(password || '').trim().slice(0, 256);
  const inlineToken = String(token || '').trim().slice(0, 512);
  const inline = (inlinePass || inlineToken) ? {
    type: source ? source.type : 'generic',
    authType: inlinePass ? 'password' : 'token',
    username: inlineUser, password: inlinePass, token: inlineToken,
    label: '本次克隆',
  } : null;
  if (inline && inline.authType === 'password' && !inlineUser) {
    throw new Error('填写密码时必须同时填写用户名');
  }
  const effective = inline || source;

  // 单个仓库代理可来自：克隆表单本次指定 > 代理页按仓库 id 登记的覆盖 > Host 规则 > Git 分组 > 全局。
  const resolved = proxyModule.resolve('git', {
    itemId: repoId || name || url, url, host: proxyModule.hostOf(url),
    inlineProxy: proxy || '',
  });
  const { args, env, auth, proxyUrl, secrets } = cloneArgs(effective, url, resolved);
  if (branch && /^[A-Za-z0-9._/-]{1,120}$/.test(String(branch))) args.splice(args.length - 1, 0, '-b', String(branch));

  const allSecrets = [...secrets, source && source.token, source && source.password].filter(Boolean);
  // 每次克隆重新探测：容器里后续装了 git、或用户在控制台保存了路径，无需重启即可生效。
  gitRuntime.refresh();
  const runtime = gitRuntime.describe();
  // v0.3.4：通道由环境档案决定。auto 已由 environment.heal() 按体检结果落到具体通道，
  // 因此这里只会拿到 local / ssh-host / disabled / none 四种确定值。
  const strategy = environment.gitStrategy();
  let channel = strategy === 'ssh-host' ? 'ssh-host' : 'local';
  let channelLabel = channel === 'ssh-host' ? 'SSH 宿主机' : '本机 / 当前容器';
  let gitVersion = runtime.version;

  if (strategy === 'disabled') {
    throw new Error('克隆功能已被当前环境档案禁用：请在「环境适配」页把「克隆通道」改为 auto / local / ssh-host，或切换档案。');
  }
  if (strategy === 'none') throw new Error(gitRuntime.missingMessage());

  if (strategy === 'local') {
    if (!runtime.available) {
      throw new Error(`当前环境档案要求在本机执行克隆，但本机没有 Git。\n${gitRuntime.missingMessage()}\n也可在「环境适配」页切换档案或点「应用自动处置」自动降级通道。`);
    }
    const result = await gitRuntime.exec([...args, target], { env, timeoutMs: 300000 });
    if (result.code !== 0) {
      throw new Error(`git clone 失败：${scrub(result.output.slice(-600), allSecrets)}`);
    }
  } else {
    const fb = gitRuntime.fallback();
    if (!fb.ready) throw new Error(gitRuntime.missingMessage());
    const server = (state().servers || []).find((s) => s.id === fb.serverId);
    if (!server) throw new Error(gitRuntime.missingMessage());
    const hostTarget = path.posix.join(fb.hostWorkspaceDir, repoName);
    const remote = await cloneViaSshHost({
      args: [...args, hostTarget], resolved, secrets: allSecrets, hostTarget, server,
    });
    channel = 'ssh-host';
    channelLabel = `SSH 宿主机 ${server.name}（${server.host}）`;
    gitVersion = remote.gitVersion;
  }

  return {
    name: repoName, path: relativeWorkspacePath(target), cloneUrl: url,
    sourceId: sourceId || '', authenticated: auth,
    credentialSource: inline ? '本次填写' : (source ? `Git 源「${source.label}」` : '无（公开仓库 / SSH 密钥）'),
    proxy: proxyModule.maskUrl(proxyUrl), proxySource: resolved.sourceLabel,
    channel, channelLabel, gitVersion,
    strategy, profile: environment.profile().name,
  };
}

module.exports = {
  BUILTIN_ID, TYPES, listSources, createSource, updateSource, removeSource,
  listAllRepos, listReposOf, listBranches, createRepo, testSource,
  cloneRepo, cloneArgs, cloneCredential, hasCreds, shQuote,
  allSources, findSource, publicSource, gitProxyFor,
};
