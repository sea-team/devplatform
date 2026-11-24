#!/usr/bin/env node
// 构建「单文件可执行程序 + 外置可热更新业务包」。
//   node build.mjs                 完整构建（bundle + public + release.json + devplatform.exe）
//   node build.mjs --bundle-only   只重建 bundle.cjs / public，供 --dev 热重载调用
//   node build.mjs --no-sea        只生成业务包，不生成 exe（调试用）
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, 'dist');
const PUBLIC_SRC = path.join(HERE, 'public');
const PUBLIC_DST = path.join(DIST, 'public');
// v0.4.29：Docker 应用商店模板（宝塔 appstore 格式）必须随所有分发路径走。
// 源码/246 部署读 platform/appstore；单文件 exe 与绿色包的 appRoot 指向 dist/。
const APPSTORE_SRC = path.join(HERE, 'appstore');
const APPSTORE_DST = path.join(DIST, 'appstore');
const LAUNCHER = path.join(HERE, 'launcher', 'launcher.js');
const BUNDLE = path.join(DIST, 'bundle.cjs');
// 默认写到 dist/；设置 DP_EXE_OUT 可将 exe 输出到别处（例如本机服务正在运行、
// dist/devplatform.exe 被占用时构建新壳，不影响正在跑的实例）。
const EXE = process.env.DP_EXE_OUT
  ? path.resolve(process.env.DP_EXE_OUT)
  : path.join(DIST, process.platform === 'win32' ? 'devplatform.exe' : 'devplatform');
const args = process.argv.slice(2);
const bundleOnly = args.includes('--bundle-only');
const noSea = args.includes('--no-sea');
// Node 二进制内的 SEA sentinel 字面量随 Node 版本 / 发行构建而变化，硬编码会让 CI
// （不同 Node 22 小版本）构建失败。这里直接从当前 node 可执行文件里提取。
// 回退值来自本机 Node 22.22.2，仅在提取失败时使用。
const SEA_FUSE_FALLBACK = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
function detectSeaFuse() {
  try {
    const buf = fs.readFileSync(process.execPath);
    const i = buf.indexOf(Buffer.from('NODE_SEA_FUSE_'));
    if (i < 0) return SEA_FUSE_FALLBACK;
    const tail = buf.toString('latin1', i, Math.min(i + 64, buf.length));
    const m = tail.match(/^NODE_SEA_FUSE_[0-9a-f]{32}/);
    return m ? m[0] : SEA_FUSE_FALLBACK;
  } catch {
    return SEA_FUSE_FALLBACK;
  }
}

const log = (...a) => console.log('[build]', ...a);
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function walk(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, base, out);
    else if (entry.isFile()) out.push(path.relative(base, abs).split(path.sep).join('/'));
  }
  return out.sort();
}

async function buildBundle() {
  const { build } = require('esbuild');
  await build({
    entryPoints: [path.join(HERE, 'src', 'server.js')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    outfile: BUNDLE,
    // ssh2 的可选原生加速模块，运行时由 ssh2 的 try/catch 降级为纯 JS。
    external: ['cpu-features'],
    logLevel: 'warning',
    sourcemap: false,
    legalComments: 'none',
  });
  log(`bundle.cjs  ${(fs.statSync(BUNDLE).size / 1024).toFixed(0)} KB`);
}

function copyTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const rel of walk(src)) {
    const from = path.join(src, rel);
    const to = path.join(dst, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
  return walk(src).length;
}

function syncPublic() {
  log(`public/     ${copyTree(PUBLIC_SRC, PUBLIC_DST)} 个文件`);
}

// v0.4.29：把内置应用模板同步到 dist/，供 exe/绿色包的 appRoot 读取。
function syncAppstore() {
  if (!fs.existsSync(APPSTORE_SRC)) { log('appstore/  未找到源目录，跳过'); return 0; }
  const n = copyTree(APPSTORE_SRC, APPSTORE_DST);
  log(`appstore/   ${n} 个文件`);
  return n;
}

// 极简 tar writer：只写普通文件与目录，供 SEA asset 首启释放使用。
function makeHeader(name, size, typeflag) {
  const b = Buffer.alloc(512);
  b.write(name, 0, 100, 'utf8');
  b.write('0000644\0', 100, 'utf8');
  b.write('0000000\0', 108, 'utf8');
  b.write('0000000\0', 116, 'utf8');
  b.write(size.toString(8).padStart(11, '0') + '\0', 124, 'utf8');
  b.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0', 136, 'utf8');
  b.fill(0x20, 148, 156);
  b.write(typeflag, 156, 'utf8');
  b.write('ustar\0', 257, 'utf8');
  b.write('00', 263, 'utf8');
  const sum = b.reduce((acc, byte) => acc + byte, 0);
  b.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'utf8');
  return b;
}

function tarGzDir(srcDir, outFile, label) {
  const chunks = [];
  const dirs = new Set();
  for (const rel of walk(srcDir)) {
    const parts = rel.split('/');
    for (let i = 1; i < parts.length; i += 1) dirs.add(parts.slice(0, i).join('/'));
  }
  for (const dir of [...dirs].sort()) {
    chunks.push(makeHeader(`${dir}/`, 0, '5'));
  }
  for (const rel of walk(srcDir)) {
    const body = fs.readFileSync(path.join(srcDir, rel));
    chunks.push(makeHeader(rel, body.length, '0'));
    chunks.push(body);
    const pad = (512 - (body.length % 512)) % 512;
    if (pad) chunks.push(Buffer.alloc(pad));
  }
  chunks.push(Buffer.alloc(1024));
  fs.writeFileSync(outFile, zlib.gzipSync(Buffer.concat(chunks)));
  log(`${label}.tar.gz  ${(fs.statSync(outFile).size / 1024).toFixed(0)} KB（内嵌于 exe，首启释放）`);
}

function tarGzPublic(outFile) {
  tarGzDir(PUBLIC_SRC, outFile, 'public');
}

function writeRelease() {
  const pkg = JSON.parse(fs.readFileSync(path.join(HERE, 'package.json'), 'utf8'));
  const release = {
    version: pkg.version,
    buildTime: new Date().toISOString(),
    runtime: process.version,
    bundle: { path: 'bundle.cjs', sha256: sha256(BUNDLE), size: fs.statSync(BUNDLE).size },
    public: walk(PUBLIC_DST).map((rel) => ({
      path: rel,
      sha256: sha256(path.join(PUBLIC_DST, rel)),
      size: fs.statSync(path.join(PUBLIC_DST, rel)).size,
    })),
    // v0.4.29：应用商店模板也纳入清单，便于热更新/回滚时核对完整性。
    appstore: fs.existsSync(APPSTORE_DST)
      ? walk(APPSTORE_DST).map((rel) => ({
        path: rel,
        sha256: sha256(path.join(APPSTORE_DST, rel)),
        size: fs.statSync(path.join(APPSTORE_DST, rel)).size,
      }))
      : [],
  };
  fs.writeFileSync(path.join(DIST, 'release.json'), JSON.stringify(release, null, 2));
  log(`release.json  v${release.version}`);
  return release;
}

// ---- v0.4.29：给 exe 注入「请求管理员权限」清单 ----
// WinFsp 是内核驱动，静默安装必须管理员权限；清单方式让双击 exe 即弹 UAC 提权。
// 用 Windows SDK 的 mt.exe 写入 RT_MANIFEST(#1)。已实测：先注入 manifest、再由
// postject 注入 SEA blob，两者互不破坏（blob 追加独立 section，资源段完好）。
// 注入必须放在 postject 之前，否则 mt.exe 重写资源可能扰动已注入的 blob。
// 省略 processorArchitecture 以避免跨 CPU 架构（x64/arm64）清单校验失败。
const ADMIN_MANIFEST = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <assemblyIdentity version="1.0.0.0" name="DevPlatform.Console" type="win32" />
  <description>DevPlatform Console</description>
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security>
      <requestedPrivileges>
        <requestedExecutionLevel level="requireAdministrator" uiAccess="false" />
      </requestedPrivileges>
    </security>
  </trustInfo>
</assembly>
`;

function findMt() {
  if (process.platform !== 'win32') return null;
  const roots = [
    'C:\\Program Files (x86)\\Windows Kits\\10\\bin',
    'C:\\Program Files\\Windows Kits\\10\\bin',
  ];
  const found = [];
  for (const root of roots) {
    let vers = [];
    try { vers = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { continue; }
    vers.sort().reverse(); // 版本号高的优先
    for (const v of vers) {
      for (const arch of ['x64', 'x86', 'arm64']) {
        const p = path.join(root, v, arch, 'mt.exe');
        if (fs.existsSync(p)) found.push(p);
      }
    }
  }
  if (found.length) return found[0];
  try {
    const r = spawnSync('where', ['mt.exe'], { encoding: 'utf8', shell: false });
    if (r.status === 0) {
      const line = String(r.stdout || '').split(/\r?\n/).map((s) => s.trim()).find(Boolean);
      if (line && fs.existsSync(line)) return line;
    }
  } catch { /* noop */ }
  return null;
}

function injectAdminManifest(exe) {
  if (process.platform !== 'win32') { log('manifest      跳过（非 Windows 构建）'); return false; }
  const mt = findMt();
  if (!mt) {
    console.warn('[build] 未找到 Windows SDK 的 mt.exe，跳过管理员清单注入；');
    console.warn('[build] exe 仍可运行，但需右键「以管理员身份运行」才能自动安装 WinFsp / 启动 SMB 共享。');
    return false;
  }
  const manifestPath = path.join(DIST, 'requireAdmin.manifest');
  fs.writeFileSync(manifestPath, ADMIN_MANIFEST, 'utf8');
  try {
    const r = spawnSync(mt, ['-manifest', manifestPath, `-outputresource:${exe};#1`], { encoding: 'utf8', shell: false });
    if (r.status !== 0) throw new Error(String(r.stderr || r.stdout || `exit ${r.status}`).trim().slice(0, 400));
    const verify = `${manifestPath}.verify`;
    const v = spawnSync(mt, [`-inputresource:${exe};#1`, `-out:${verify}`], { encoding: 'utf8', shell: false });
    const ok = v.status === 0 && fs.existsSync(verify)
      && fs.readFileSync(verify, 'utf8').includes('requireAdministrator');
    if (!ok) throw new Error('注入后反读未发现 requireAdministrator');
    log('manifest      已注入管理员权限清单（requireAdministrator）');
    return true;
  } catch (e) {
    console.warn(`[build] 管理员清单注入失败：${e.message}`);
    console.warn('[build] 降级：exe 可运行，但需右键「以管理员身份运行」方可自动装 WinFsp / 启 SMB 共享。');
    return false;
  } finally {
    for (const f of [manifestPath, `${manifestPath}.verify`]) { try { fs.unlinkSync(f); } catch { /* noop */ } }
  }
}

async function buildSea(assets) {
  if (!fs.existsSync(LAUNCHER)) throw new Error(`缺少引导器：${LAUNCHER}`);
  const configPath = path.join(DIST, 'sea-config.json');
  const blobPath = path.join(DIST, 'sea.blob');
  const releasePath = path.join(DIST, 'release.json');
  // 把业务包与版本清单一并内嵌：从 GitHub Release 单独下载 devplatform.exe
  // 到任意空目录，双击即可自释放成完整可运行实例；已存在的同名文件永远不覆盖，
  // 因此热更新（替换外置 bundle.cjs / public/ / appstore/）仍然生效。
  const seaAssets = {
    'public.tar.gz': assets.publicTar,
    'bundle.cjs': BUNDLE,
    'release.json': releasePath,
  };
  if (assets.appstoreTar && fs.existsSync(assets.appstoreTar)) {
    seaAssets['appstore.tar.gz'] = assets.appstoreTar;
  }
  fs.writeFileSync(configPath, JSON.stringify({
    main: LAUNCHER,
    output: blobPath,
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: true,
    assets: seaAssets,
  }, null, 2));

  const gen = spawnSync(process.execPath, ['--experimental-sea-config', configPath], {
    cwd: HERE, encoding: 'utf8',
  });
  if (gen.status !== 0) throw new Error(`SEA blob 生成失败：${gen.stderr || gen.stdout}`);
  log('sea.blob     已生成');

  fs.mkdirSync(path.dirname(EXE), { recursive: true });
  fs.copyFileSync(process.execPath, EXE);
  // 顺序关键：manifest 先、SEA blob 后（见 injectAdminManifest 注释）。
  injectAdminManifest(EXE);
  const { inject } = require('postject');
  const fuse = detectSeaFuse();
  log(`SEA sentinel  ${fuse}`);
  await inject(EXE, 'NODE_SEA_BLOB', fs.readFileSync(blobPath), {
    sentinelFuse: fuse,
    machoSegmentName: process.platform === 'darwin' ? 'NODE_SEA' : undefined,
  });
  log(`exe          ${path.basename(EXE)}  ${(fs.statSync(EXE).size / 1024 / 1024).toFixed(1)} MB`);

  // blob / 配置 / tar 只用于注入，不作为分发文件。
  for (const f of [configPath, blobPath, assets.publicTar, assets.appstoreTar]) {
    try { if (f) fs.unlinkSync(f); } catch { /* noop */ }
  }
}

// 首启/首次构建时给 dist/ 一份可编辑的配置模板。
// 已存在的 .env 一律保留（用户填过的 Token 与地址不能被构建覆盖）。
function ensureDotEnv() {
  const file = path.join(DIST, '.env');
  if (fs.existsSync(file)) return;
  const lines = [
    '# DevPlatform 单文件程序配置（本文件不会提交 Git；更新/回滚不会覆盖）',
    '# 默认指向本机端口，需自行启动集成服务；修改后必须完全重启 devplatform.exe。',
    '# 复用已部署服务器上的服务：node scripts/sync-integrations.js --from <host>',
    'PORT=9000',
    'GITEA_URL=http://localhost:3002',
    'GITEA_TOKEN=',
    'OPENLIST_URL=http://localhost:5244',
    'OPENLIST_TOKEN=',
    'OPENLIST_USER=admin',
    'CODE_SERVER_URL=http://localhost:8080',
    '# ADMIN_TOKEN：控制台 / API 访问令牌。留空＝所有 /api/* 无鉴权（仅限可信本机 / 内网，',
    '#   且 /api/servers/:id/exec 降级为只读白名单）；对局域网 / 公网暴露时必须设置。',
    "# 启用：填强随机值 → 完全重启 exe → 每台浏览器执行 localStorage.setItem('dp_token', '<同一令牌>')。",
    '# 详细风险与步骤见 .env.example、README §5 / §40 与控制台「环境配置 → 鉴权说明」。',
    '# 账号体系：首次启动自动生成 admin 初始密码（data/initial-admin.txt），首次登录强制改密；',
    '# 未登录会拦截所有 /api/*；DP_AUTH_MODE=off 可应急回退；重置密码 devplatform.exe reset-admin。',
    '# ADMIN_TOKEN=',
  ];
  fs.writeFileSync(file, lines.join('\n') + '\n', { encoding: 'utf8', mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch { /* Windows 下忽略 */ }
  log('已生成 dist/.env 配置模板（集成服务地址与 Token 需按实际环境填写）');
}

async function main() {
  fs.mkdirSync(DIST, { recursive: true });
  ensureDotEnv();
  await buildBundle();
  if (bundleOnly) { syncPublic(); syncAppstore(); log('完成（--bundle-only）'); return; }
  syncPublic();
  syncAppstore();
  const publicTar = path.join(DIST, 'public.tar.gz');
  tarGzPublic(publicTar);
  const appstoreTar = fs.existsSync(APPSTORE_SRC) ? path.join(DIST, 'appstore.tar.gz') : null;
  if (appstoreTar) tarGzDir(APPSTORE_SRC, appstoreTar, 'appstore');
  const release = writeRelease();
  if (noSea) { log('完成（--no-sea）'); return; }
  await buildSea({ publicTar, appstoreTar });
  log('产物目录：' + DIST);
  log(`版本 ${release.version}；分发时复制整个 dist/，双击 ${path.basename(EXE)} 即可运行`);
}

main().catch((error) => {
  console.error('[build] 失败：', error);
  process.exit(1);
});
