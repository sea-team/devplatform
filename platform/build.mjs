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
const LAUNCHER = path.join(HERE, 'launcher', 'launcher.js');
const BUNDLE = path.join(DIST, 'bundle.cjs');
const EXE = path.join(DIST, process.platform === 'win32' ? 'devplatform.exe' : 'devplatform');
const args = process.argv.slice(2);
const bundleOnly = args.includes('--bundle-only');
const noSea = args.includes('--no-sea');
// 与 Node 二进制内 node_sea.cc 的字面量保持一致（可由
// node -e "fs.readFileSync(process.execPath).indexOf('NODE_SEA_FUSE_')" 核对）。
const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

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

function syncPublic() {
  fs.mkdirSync(PUBLIC_DST, { recursive: true });
  for (const rel of walk(PUBLIC_SRC)) {
    const from = path.join(PUBLIC_SRC, rel);
    const to = path.join(PUBLIC_DST, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
  log(`public/     ${walk(PUBLIC_SRC).length} 个文件`);
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

function tarGzPublic(outFile) {
  const chunks = [];
  const dirs = new Set();
  for (const rel of walk(PUBLIC_SRC)) {
    const parts = rel.split('/');
    for (let i = 1; i < parts.length; i += 1) dirs.add(parts.slice(0, i).join('/'));
  }
  for (const dir of [...dirs].sort()) {
    chunks.push(makeHeader(`${dir}/`, 0, '5'));
  }
  for (const rel of walk(PUBLIC_SRC)) {
    const body = fs.readFileSync(path.join(PUBLIC_SRC, rel));
    chunks.push(makeHeader(rel, body.length, '0'));
    chunks.push(body);
    const pad = (512 - (body.length % 512)) % 512;
    if (pad) chunks.push(Buffer.alloc(pad));
  }
  chunks.push(Buffer.alloc(1024));
  fs.writeFileSync(outFile, zlib.gzipSync(Buffer.concat(chunks)));
  log(`public.tar.gz  ${(fs.statSync(outFile).size / 1024).toFixed(0)} KB（内嵌于 exe，首启释放）`);
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
  };
  fs.writeFileSync(path.join(DIST, 'release.json'), JSON.stringify(release, null, 2));
  log(`release.json  v${release.version}`);
  return release;
}

async function buildSea(tarFile) {
  if (!fs.existsSync(LAUNCHER)) throw new Error(`缺少引导器：${LAUNCHER}`);
  const configPath = path.join(DIST, 'sea-config.json');
  const blobPath = path.join(DIST, 'sea.blob');
  fs.writeFileSync(configPath, JSON.stringify({
    main: LAUNCHER,
    output: blobPath,
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: true,
    assets: { 'public.tar.gz': tarFile },
  }, null, 2));

  const gen = spawnSync(process.execPath, ['--experimental-sea-config', configPath], {
    cwd: HERE, encoding: 'utf8',
  });
  if (gen.status !== 0) throw new Error(`SEA blob 生成失败：${gen.stderr || gen.stdout}`);
  log('sea.blob     已生成');

  fs.copyFileSync(process.execPath, EXE);
  const { inject } = require('postject');
  await inject(EXE, 'NODE_SEA_BLOB', fs.readFileSync(blobPath), {
    sentinelFuse: SEA_FUSE,
    machoSegmentName: process.platform === 'darwin' ? 'NODE_SEA' : undefined,
  });
  log(`exe          ${path.basename(EXE)}  ${(fs.statSync(EXE).size / 1024 / 1024).toFixed(1)} MB`);

  // blob / 配置 / tar 只用于注入，不作为分发文件。
  for (const f of [configPath, blobPath, tarFile]) {
    try { fs.unlinkSync(f); } catch { /* noop */ }
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
  if (bundleOnly) { syncPublic(); log('完成（--bundle-only）'); return; }
  syncPublic();
  const tarFile = path.join(DIST, 'public.tar.gz');
  tarGzPublic(tarFile);
  const release = writeRelease();
  if (noSea) { log('完成（--no-sea）'); return; }
  await buildSea(tarFile);
  log('产物目录：' + DIST);
  log(`版本 ${release.version}；分发时复制整个 dist/，双击 ${path.basename(EXE)} 即可运行`);
}

main().catch((error) => {
  console.error('[build] 失败：', error);
  process.exit(1);
});
