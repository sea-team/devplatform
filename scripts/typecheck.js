'use strict';

/**
 * 渐进式类型检查（可选，不影响运行 / 构建 / 部署）。
 *
 * 对 platform/src 下所有 .js 跑 TypeScript 的 checkJs，把错误数与基线比对：
 *   - 错误数 <= 基线：通过（基线内的历史错误是已知技术债，不阻塞）；
 *   - 错误数 >  基线：失败（说明本次改动引入了新的类型问题）。
 * 这样形成"棘轮"：只许错误变少，不许变多，逐步清零即可把基线调到 0。
 *
 * 依赖来自 platform/node_modules（devDependencies 中的 typescript / @types/node）。
 * 部署 / 运行时使用 npm install --omit=dev，不会安装它们，故本脚本与生产无关。
 *
 * 用法：node scripts/typecheck.js [--update-baseline]
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PLATFORM = path.join(ROOT, 'platform');
const TSC = path.join(PLATFORM, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');
const TSCONFIG = path.join(PLATFORM, 'tsconfig.typecheck.json');
const BASELINE_FILE = path.join(__dirname, 'typecheck-baseline.json');

if (!fs.existsSync(TSC)) {
  console.log('⚠ 类型检查已跳过：未安装 devDependencies（typescript / @types/node）。');
  console.log('  在 platform/ 下执行 npm install 后重试；此项不影响运行与部署。');
  process.exit(0);
}

const isWinCmd = process.platform === 'win32';
const result = spawnSync(TSC, ['-p', TSCONFIG, '--pretty', 'false'], {
  encoding: 'utf8',
  cwd: PLATFORM,
  maxBuffer: 16 * 1024 * 1024,
  shell: isWinCmd, // Windows 的 .cmd 必须经 shell 执行，否则 spawn 静默失败、空输出被误判为 0 错误。
});
const output = `${result.stdout || ''}${result.stderr || ''}`;
// 启动失败（如 tsconfig 路径错、spawn 异常）不能当作"零错误通过"。
if (result.error || (result.status !== 0 && result.status !== 2 && !/error TS\d+/.test(output))) {
  console.log(`✖ 类型检查未能执行：${result.error ? result.error.message : `exit=${result.status}`}`);
  console.log(output.slice(0, 500));
  process.exit(1);
}
const errorLines = output.split('\n').filter((l) => /error TS\d+/.test(l));
const count = errorLines.length;

// 按文件聚合，便于定位新增错误。
const byFile = new Map();
for (const line of errorLines) {
  const m = line.match(/^(.+\.js)\(/);
  const file = m ? path.basename(m[1]) : '(其他)';
  byFile.set(file, (byFile.get(file) || 0) + 1);
}

let baseline = 0;
if (fs.existsSync(BASELINE_FILE)) {
  try { baseline = Number(JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')).maxErrors) || 0; } catch { /* 忽略损坏的基线 */ }
}

const args = process.argv.slice(2);
if (args.includes('--update-baseline')) {
  fs.writeFileSync(BASELINE_FILE, `${JSON.stringify({ maxErrors: count, note: 'checkJs 错误数基线；仅允许下降，改动后如确需上调请人工确认。' }, null, 2)}\n`);
  console.log(`✔ 基线已更新为 ${count} 个类型错误。`);
  process.exit(0);
}

console.log(`TypeScript checkJs：${count} 个类型错误（基线 ${baseline}）`);
for (const [file, n] of [...byFile.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(3)}  ${file}`);
}

if (count > baseline) {
  console.log(`\n✖ 类型错误超过基线 ${count - baseline} 个，请修复或评估后更新基线（--update-baseline）。`);
  process.exit(1);
}
console.log(`\n✔ 未超过基线（可收敛 ${baseline - count} 个）。详表：platform 下 npx tsc -p tsconfig.typecheck.json`);
process.exit(0);
