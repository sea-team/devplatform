'use strict';

/**
 * 可降级的构建后端（local / docker / wsl / ssh / auto）。
 *
 * 选型结论：编译环境用 Docker 体系，不引入 microVM。
 *  - microVM 解决的是「隔离不可信代码」，不是「提供可复现工具链」；
 *  - Firecracker 依赖 Linux KVM，Windows 原生不可用；Docker Desktop 本身已跑在 Hyper-V/WSL2 VM 里；
 *  - WSL2 官方明确不是安全沙箱，仅作为 Linux 工具链兼容层。
 *
 * Windows 且无 Docker 的主路径是 ssh：把编译任务推到已登记 Linux 服务器上的 Docker 容器执行，
 * 与「SSH 远程安装」共用 sshExec / sftpPut 链路，本机不需要任何容器运行时。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { config, state } = require('./core');
const { sshExec, sftpPut } = require('./integrations');
const remoteOps = require('./remoteOps');
const remoteDocker = require('./remoteDocker');
const runtime = require('./extRuntime');
const { runContainer } = require('./dockerApi');

const shq = remoteDocker.shq;

function runProcess(cmd, args, { cwd, onData, timeoutMs = 900000, stdinText = '' } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, shell: false });
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error('构建超时'));
    }, timeoutMs);
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    child.stdout.on('data', (c) => onData && onData(c.toString()));
    child.stderr.on('data', (c) => onData && onData(c.toString()));
    child.on('error', (e) => finish(reject, e));
    child.on('close', (code) => finish(resolve, code));
    if (stdinText) child.stdin.end(stdinText);
  });
}

function winToWsl(p) {
  const m = String(p).match(/^([A-Za-z]):[\\/](.*)$/);
  return m ? `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}` : String(p).replace(/\\/g, '/');
}

function localShell() {
  if (process.platform === 'win32') return 'bash';
  return fs.existsSync('/bin/bash') ? '/bin/bash' : 'sh';
}

function pickServer() {
  const servers = state().servers || [];
  if (!servers.length) return null;
  return servers.find((s) => s.id === config.buildServerId) || servers[0];
}

/* ------------------------------ 可用性探测 ------------------------------ */

async function detectBackends() {
  const items = [];
  let dockerOk = false;
  try { dockerOk = (await runtime.dockerStatus()).available; } catch { /* noop */ }
  items.push({ id: 'docker', label: '本机 Docker 容器', available: dockerOk,
    detail: dockerOk ? '复用 PROFILES 镜像，容器级隔离' : '本机未检测到 docker.sock / npipe' });

  let wslOk = false;
  if (process.platform === 'win32') {
    try {
      const args = config.wslDistro ? ['-d', config.wslDistro, '--', 'bash', '-c', 'echo ok'] : ['--', 'bash', '-c', 'echo ok'];
      const r = spawnSync('wsl.exe', args, { timeout: 8000, encoding: 'utf8' });
      wslOk = r.status === 0;
    } catch { /* noop */ }
  }
  items.push({ id: 'wsl', label: 'WSL2 Linux 工具链', available: wslOk,
    detail: wslOk ? 'Linux 工具链兼容性好（非安全边界）' : '仅 Windows 且已安装 WSL2 时可用' });

  let sshOk = false;
  let sshDetail = '未登记 Linux 服务器';
  const server = pickServer();
  if (server) {
    try {
      const v = await remoteDocker.dockerVersion(server.id);
      sshOk = v.available;
      sshDetail = sshOk ? `${server.name} · Docker ${v.version}` : `${server.name} 上 Docker 不可用`;
    } catch (e) { sshDetail = `${server.name} 探测失败：${String(e.message).slice(0, 100)}`; }
  }
  items.push({ id: 'ssh', label: 'SSH 远程 Docker 构建', available: sshOk, detail: sshDetail,
    recommended: true, note: 'Windows 无 Docker 时的推荐路径' });

  items.push({ id: 'local', label: '本地工具链兜底', available: true,
    detail: process.platform === 'win32' ? '依赖 Git Bash 与本机已装工具链，无隔离' : '依赖本机已装工具链，无隔离' });
  return items;
}

/** 选定后端：显式指定时校验可用性；auto 按 ssh → docker → wsl → local 降级。 */
async function resolveBackend(preferred = '') {
  const want = String(preferred || config.buildExecutor || 'local').toLowerCase();
  const items = await detectBackends();
  const byId = Object.fromEntries(items.map((x) => [x.id, x]));
  if (want !== 'auto' && want !== '') {
    const b = byId[want];
    if (!b) throw new Error(`未知构建后端：${want}`);
    if (!b.available) throw new Error(`构建后端「${b.label}」当前不可用：${b.detail}`);
    return { id: want, label: b.label, detail: b.detail, degraded: false };
  }
  for (const id of ['ssh', 'docker', 'wsl', 'local']) {
    if (byId[id] && byId[id].available) {
      return { id, label: byId[id].label, detail: byId[id].detail, degraded: id !== 'ssh' };
    }
  }
  return { id: 'local', label: '本地工具链兜底', detail: '所有后端探测失败，使用本机 shell', degraded: true };
}

/* ------------------------------ 执行 ------------------------------ */

async function runBuild({ backend, image, script, abs, artifact, buildId, onData, timeoutMs }) {
  if (backend === 'docker') {
    const rel = path.relative(path.resolve(config.workspaceDir), abs).split(path.sep).join('/');
    const hostPath = config.hostWorkspaceDir ? path.posix.join(config.hostWorkspaceDir, rel) : abs;
    return runContainer({
      image: `${config.dockerImagePrefix || ''}${image}`, hostPath, script,
      name: `dp-build-${buildId}`, onData, timeoutMs,
    });
  }
  if (backend === 'wsl') {
    const args = [];
    if (config.wslDistro) args.push('-d', config.wslDistro);
    args.push('--', 'bash', '-s');
    return runProcess('wsl.exe', args, {
      onData, timeoutMs,
      stdinText: `cd ${shq(winToWsl(abs))} || exit 1\n${script}\n`,
    });
  }
  if (backend === 'ssh') return runRemoteBuild({ image, script, abs, artifact, buildId, onData, timeoutMs });
  return runProcess(localShell(), ['-c', script], { cwd: abs, onData, timeoutMs });
}

/**
 * 远程构建：打包工作区 → SFTP 上传 → 远端容器执行 → 回传产物 → 清理。
 * 日志通过 sshExec 一次性返回（非实时流），这是远程后端与本机后端的唯一差异。
 */
async function runRemoteBuild({ image, script, abs, artifact, buildId, onData, timeoutMs }) {
  const server = pickServer();
  if (!server) throw new Error('没有可用的 Linux 服务器，请先在「服务器」页登记');
  const base = `${config.remoteTmpDir}/build/${buildId}`;
  const srcTar = `${base}/src.tar.gz`;
  const outTar = `${base}/artifact.tar.gz`;
  const workDir = `${base}/work`;
  const localTar = path.join(os.tmpdir(), `dp-build-${buildId}.tar.gz`);
  const localOut = path.join(os.tmpdir(), `dp-build-${buildId}-artifact.tar.gz`);
  const fullImage = `${config.dockerImagePrefix || ''}${image}`;

  onData(`[ssh] 目标服务器 ${server.name} (${server.host})\n`);
  await runProcess('tar', ['-czf', localTar, '-C', abs, '.'], { cwd: abs, onData, timeoutMs: 300000 });
  await sftpPut(server, localTar, srcTar);
  fs.rmSync(localTar, { force: true });

  const remoteScript = [
    'set -e',
    `mkdir -p ${shq(workDir)}`,
    `tar -xzf ${shq(srcTar)} -C ${shq(workDir)}`,
    `docker run --rm --name ${shq(`dp-build-${buildId}`)} -v ${shq(`${workDir}:/src`)} -w /src ${shq(fullImage)} sh -c ${shq(script)}`,
    `if [ -d ${shq(`${workDir}/${artifact}`)} ]; then tar -czf ${shq(outTar)} -C ${shq(`${workDir}/${artifact}`)} .; else echo '[ssh] 未生成产物目录' >&2; fi`,
  ].join(' && ');
  onData(`[ssh] 远程容器镜像 ${fullImage}\n`);
  const r = await sshExec(server, remoteScript, Math.max(timeoutMs, 120000));
  if (r.stdout) onData(`${r.stdout}\n`);
  if (r.stderr) onData(`${r.stderr}\n`);

  let code = r.code;
  if (code === 0 && artifact) {
    try {
      const buf = await remoteOps.readFile(server, outTar, 512 * 1024 * 1024);
      fs.writeFileSync(localOut, buf);
      const artifactAbs = path.join(abs, artifact);
      fs.mkdirSync(artifactAbs, { recursive: true });
      await runProcess('tar', ['-xzf', localOut, '-C', artifactAbs], { cwd: abs, onData, timeoutMs: 300000 });
      onData(`[ssh] 产物已回传：${artifact}/\n`);
    } catch (e) {
      onData(`[ssh] 产物回传失败（构建本身已成功）：${e.message}\n`);
      code = 1;
    } finally {
      fs.rmSync(localOut, { force: true });
    }
  }
  await sshExec(server, `rm -rf ${shq(base)}`, 30000).catch(() => {});
  return code;
}

module.exports = { detectBackends, resolveBackend, runBuild, runProcess, winToWsl, pickServer };
