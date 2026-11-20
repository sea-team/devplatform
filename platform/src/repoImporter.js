'use strict';

/**
 * v0.4.19 E 批：从上传的归档（.tar / .tar.gz / .tgz / .zip）导入为工作区 Git 仓库。
 * 独立成模块，避免与 gitSources 的克隆链路耦合。
 *
 * 流程：校验仓库名与安全路径 → 解压到暂存目录 → 单层包裹目录上提 → 必须有 .git →
 * 移动到最终目录 → 仅 .git（无工作树）时 git reset --hard HEAD 恢复文件（失败降级不阻断）。
 */
const fs = require('fs');
const path = require('path');
const { safeWorkspacePath, relativeWorkspacePath, HttpError } = require('./core');
const archive = require('./archive');
const workspaceGit = require('./workspaceGit');

function cloneTargetExists(target, repoName) {
  let complete = null;
  try { complete = fs.existsSync(path.join(target, '.git')); } catch { /* noop */ }
  const hint = complete === true
    ? '工作区里已存在同名完整仓库（含 .git），可直接打开；如需重新导入请换名或先清理目录。'
    : '工作区里已有同名目录（可能是上次导入的残留），请换一个仓库名或先清理该目录后重试。';
  return new HttpError(409, `目录已存在：${repoName}`, { errorCode: 'WORKSPACE_TARGET_EXISTS', complete, hint });
}

/** 跨平台目录移动：先 rename，Windows EPERM 时重试，仍失败则复制后删除。 */
function moveDir(from, to) {
  if (path.resolve(from) === path.resolve(to)) return;
  for (let i = 0; i < 4; i += 1) {
    try { fs.renameSync(from, to); return; }
    catch (e) {
      if (e.code !== 'EPERM' && e.code !== 'EACCES' && e.code !== 'EBUSY') throw e;
      try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40 * (i + 1)); } catch { /* noop */ }
    }
  }
  fs.cpSync(from, to, { recursive: true, force: true });
  fs.rmSync(from, { recursive: true, force: true });
}

/* --------------------- 导入仓库的 .git 配置净化（v0.4.21） --------------------- */
// 归档里的 .git 是不可信输入：git 会执行 config 中声明的外部程序
// （filter.*.smudge/clean、diff.external、core.fsmonitor、core.sshCommand、
// include.path、alias.* 等）。导入流程本身就会跑 `git reset --hard`，等于上传
// 一个压缩包即可在平台宿主机上执行任意命令。因此导入后必须只保留「数据描述」
// 类配置，凡是能驱动外部进程或引入外部文件的键一律丢弃；自带的钩子脚本也清掉。
const SAFE_CORE_KEYS = new Set([
  'repositoryformatversion', 'filemode', 'bare', 'logallrefupdates',
  'ignorecase', 'symlinks', 'precomposeunicode',
]);
const SAFE_REMOTE_KEYS = new Set(['url', 'pushurl', 'fetch', 'head', 'tagopt']);
const SAFE_URL = /^(?:https?|git|ssh):\/\//i;
const SAFE_SCP_URL = /^[^\s:@/]+@[^\s:/]+:[^\s]+$/;

function safeRemoteUrl(value) {
  const v = String(value || '').trim();
  // ext:: / fd:: 等传输协议可以携带命令，file:// 可读取任意本地仓库，一律不保留。
  return SAFE_URL.test(v) || SAFE_SCP_URL.test(v);
}

function sanitizeImportedGit(target) {
  const gitDir = path.join(target, '.git');
  const configFile = path.join(gitDir, 'config');
  const dropped = [];
  let text = '';
  try {
    text = fs.readFileSync(configFile, 'utf8');
  } catch {
    return { rewritten: false, dropped };
  }
  const kept = [];
  let section = '';
  let keepSection = false;
  for (const line of text.split(/\r?\n/)) {
    const header = line.match(/^\s*\[([^\]]+)\]/);
    if (header) {
      section = header[1].trim();
      const head = section.toLowerCase();
      keepSection = /^core(\s|$)/.test(head) || /^branch(\s|$)/.test(head)
        || /^remote(\s|$)/.test(head) || /^user(\s|$)/.test(head) || /^init(\s|$)/.test(head);
      if (keepSection) kept.push(line);
      else if (line.trim()) dropped.push(line.trim().slice(0, 80));
      continue;
    }
    if (!keepSection) {
      if (line.trim() && !line.trim().startsWith('#')) dropped.push(line.trim().slice(0, 80));
      continue;
    }
    if (!line.trim() || line.trim().startsWith('#')) { kept.push(line); continue; }
    const kv = line.match(/^\s*([A-Za-z0-9_.-]+)\s*=(.*)$/);
    if (!kv) { kept.push(line); continue; }
    const key = kv[1].toLowerCase();
    const value = kv[2];
    const head = section.toLowerCase();
    let ok = false;
    if (/^core(\s|$)/.test(head)) ok = SAFE_CORE_KEYS.has(key);
    else if (/^branch(\s|$)/.test(head)) ok = ['remote', 'merge', 'rebase'].includes(key);
    else if (/^remote(\s|$)/.test(head)) {
      ok = SAFE_REMOTE_KEYS.has(key) && ((key !== 'url' && key !== 'pushurl') || safeRemoteUrl(value));
    } else if (/^user(\s|$)/.test(head)) ok = ['name', 'email'].includes(key);
    else if (/^init(\s|$)/.test(head)) ok = key === 'defaultbranch';
    if (ok) kept.push(line); else dropped.push(line.trim().slice(0, 80));
  }
  try {
    fs.writeFileSync(configFile, `${kept.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`, { encoding: 'utf8', mode: 0o600 });
  } catch { /* 配置不可写时不阻断导入，reset 仍受下面的 hooks 清理保护 */ }
  // 归档自带的钩子脚本一律删除：后续 checkout / merge 不该执行上传者提供的脚本。
  try {
    const hooks = path.join(gitDir, 'hooks');
    for (const name of fs.readdirSync(hooks)) {
      try { fs.rmSync(path.join(hooks, name), { recursive: true, force: true }); } catch { /* noop */ }
    }
  } catch { /* 无 hooks 目录 */ }
  return { rewritten: true, dropped };
}

async function importRepo({ name, buffer, filename = '', format = '', user = null } = {}) {
  const repoName = String(name || path.basename(String(filename || ''), '.zip') || '')
    .replace(/\.tar(\.gz)?$|\.tgz$/i, '')
    .replace(/[^A-Za-z0-9_.-]/g, '-');
  if (!repoName || repoName === '.' || repoName === '..' || !/^[A-Za-z0-9_.-]+$/.test(repoName)) {
    throw new HttpError(400, '仓库名不合法：只能是工作区内一级目录名（字母 / 数字 / . _ -）');
  }
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new HttpError(400, '归档内容为空');

  const target = safeWorkspacePath(repoName);
  if (fs.existsSync(target)) throw cloneTargetExists(target, repoName);

  const fmt = format || archive.detectFormat(buffer, filename);
  if (!fmt) throw new HttpError(400, '无法识别的归档格式：请上传 .tar / .tar.gz / .tgz / .zip');

  const stagingName = `.import-${repoName}-${Date.now().toString(36)}`;
  const staging = safeWorkspacePath(stagingName);
  if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });

  let entries = [];
  try {
    entries = archive.extract(buffer, staging, { format: fmt, filename });
    const top = fs.readdirSync(staging, { withFileTypes: true });
    let contentRoot = staging;
    if (top.length === 1 && top[0].isDirectory() && top[0].name !== '.git') {
      const candidate = path.join(staging, top[0].name);
      if (fs.existsSync(path.join(candidate, '.git'))) contentRoot = candidate;
    }
    if (!fs.existsSync(path.join(contentRoot, '.git'))) {
      throw new HttpError(400, '归档中未找到 .git 目录：请上传包含 .git 的仓库压缩包');
    }
    moveDir(contentRoot, target);
    if (contentRoot !== staging) {
      try { fs.rmSync(staging, { recursive: true, force: true }); } catch { /* noop 清理空壳 */ }
    }
    // 必须在任何 git 命令（含下面的 reset --hard）之前净化 .git：
    // 不可信 config 里的 filter / diff.external / hooks 会以平台权限执行命令。
    const gitConfig = sanitizeImportedGit(target);

    const finalTop = fs.readdirSync(target, { withFileTypes: true });
    const gitOnly = finalTop.length === 1 && finalTop[0].name === '.git';
    let recovery = { attempted: false, ok: false, warning: '' };
    if (gitOnly) {
      recovery.attempted = true;
      try {
        const r = await workspaceGit.run({ repo: repoName, command: 'reset', args: ['--hard', 'HEAD'] });
        const text = `${r.output || ''}`;
        if (r.code !== 0 && !/nothing to commit|unknown revision|bad revision|ambiguous/i.test(text)) {
          recovery.warning = '从 .git 恢复工作树未完全成功（仓库可能尚无提交），可在仓库内手动执行 git checkout。';
        } else {
          recovery.ok = true;
        }
      } catch (e) {
        recovery.warning = `已导入 .git 仓库，但当前环境无法自动恢复工作树：${(e && e.message) || e}。请在「Git 运行时」配置通道后手动执行 git checkout。`;
      }
    }

    return {
      name: repoName, path: relativeWorkspacePath(target), format: fmt,
      entries: entries.length, hasGit: true, gitOnly, recovery,
      gitConfig: { sanitized: gitConfig.rewritten, droppedKeys: gitConfig.dropped.length },
      channel: 'archive-import',
      message: gitOnly ? '已导入 .git 仓库并尝试自动恢复工作树文件' : '已导入仓库（含工作树文件）',
    };
  } catch (e) {
    try { if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true }); } catch { /* noop */ }
    throw e;
  }
}

module.exports = { importRepo, sanitizeImportedGit };
