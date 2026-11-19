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
      channel: 'archive-import',
      message: gitOnly ? '已导入 .git 仓库并尝试自动恢复工作树文件' : '已导入仓库（含工作树文件）',
    };
  } catch (e) {
    try { if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true }); } catch { /* noop */ }
    throw e;
  }
}

module.exports = { importRepo };
