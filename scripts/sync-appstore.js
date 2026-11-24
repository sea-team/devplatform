'use strict';

/**
 * 从宝塔官方 aaPanel/appstore 同步应用模板到本地 platform/appstore/apps/。
 *
 * 背景：git clone / codeload tarball 在受限网络下会超时；改用 GitHub API 一次拿
 * 完整 git tree（含每个 blob 的 sha/size），再用 raw.githubusercontent.com 按
 * sha 或 ref 批量下载需要的文件（app.json / 版本目录 compose+.env / 图标）。
 *
 * 用法：
 *   node scripts/sync-appstore.js                 # 同步全部
 *   node scripts/sync-appstore.js --limit 30      # 只同步前 30 个（调试）
 *   node scripts/sync-appstore.js --app nginx,mysql  # 只同步指定应用
 *   node scripts/sync-appstore.js --no-icon       # 跳过图标
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const DEST = path.join(ROOT, 'platform', 'appstore', 'apps');
const TREE_API = 'https://api.github.com/repos/aaPanel/appstore/git/trees/main?recursive=1';
const RAW = 'https://raw.githubusercontent.com/aaPanel/appstore/main/';
// 受限网络下高并发容易 ECONNRESET：低并发 + 重试 + keepAlive。
const CONCURRENCY = 4;
const RETRIES = 4;
const agent = new https.Agent({ keepAlive: true, maxSockets: CONCURRENCY });

const argv = process.argv.slice(2);
const argVal = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const noIcon = argv.includes('--no-icon');
const dryRun = argv.includes('--dry-run');
const limit = parseInt(argVal('--limit', '0'), 10) || 0;
const onlyApps = argVal('--app', '').split(',').map((s) => s.trim()).filter(Boolean);

function getJSON(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'user-agent': 'devplatform-appstore-sync', 'accept-encoding': 'gzip' },
    }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`${res.statusCode} ${url}`));
      }
      const zlib = require('zlib');
      const enc = res.headers['content-encoding'];
      const stream = enc === 'gzip' ? res.pipe(zlib.createGunzip()) : res;
      const chunks = [];
      stream.on('data', (c) => chunks.push(c));
      stream.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(120000, () => req.destroy(new Error('timeout')));
  });
}

function downloadOnce(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const req = https.get(url, {
      headers: { 'user-agent': 'devplatform-appstore-sync' }, agent,
    }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        file.destroy();
        try { fs.unlinkSync(dest); } catch { /* noop */ }
        return reject(new Error(`${res.statusCode} ${url}`));
      }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
    });
    req.on('error', (e) => {
      file.destroy();
      try { fs.unlinkSync(dest); } catch { /* noop */ }
      reject(e);
    });
    req.setTimeout(60000, () => req.destroy(new Error('timeout')));
  });
}

async function download(url, dest) {
  let lastErr;
  for (let i = 0; i < RETRIES; i += 1) {
    try { return await downloadOnce(url, dest); }
    catch (e) {
      lastErr = e;
      // 指数退避，缓解限流/连接重置
      await new Promise((r) => setTimeout(r, 300 * (i + 1)));
    }
  }
  throw lastErr;
}

async function mapLimit(items, n, fn) {
  let idx = 0;
  let done = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (idx < items.length) {
      const item = items[idx++];
      try { await fn(item); } catch (e) { console.error('  ✖', item.path, e.message); }
      done += 1;
      if (done % 50 === 0) console.log(`  进度 ${done}/${items.length}`);
    }
  });
  await Promise.all(workers);
}

async function main() {
  console.log('▶ 获取完整 git tree…');
  const tree = await getJSON(TREE_API);
  if (tree.truncated) throw new Error('git tree 被截断，无法保证全量');
  let entries = tree.tree.filter((x) => x.path.startsWith('apps/') && x.type === 'blob');

  // 只保留需要的文件：app.json / 版本目录 compose+.env / 图标。
  // 图标只取应用根目录一级（apps/<name>/*.png|jpg|jpeg|svg），不下应用内部的
  // 装饰性图片（如 coze-studio 的 minio/default_icon/*，几百个且与商店展示无关）。
  entries = entries.filter((x) => {
    const parts = x.path.split('/');
    const base = parts.pop();
    if (base === 'app.json' || base === 'docker-compose.yml' || base === '.env') return true;
    if (noIcon) return false;
    const isRootIcon = parts.length === 2 && /\.(png|jpe?g|svg)$/i.test(base); // apps/<name>/<icon>
    return isRootIcon;
  });

  const appNames = [...new Set(entries.map((x) => x.path.split('/')[1]))].filter(Boolean);
  let selected = appNames;
  if (onlyApps.length) selected = appNames.filter((a) => onlyApps.includes(a));
  else if (limit) selected = appNames.slice(0, limit);
  const selSet = new Set(selected);
  entries = entries.filter((x) => selSet.has(x.path.split('/')[1]));

  console.log(`▶ 目标应用 ${selected.length} 个，文件 ${entries.length} 个`);
  if (dryRun) {
    console.log('  （dry-run，不写盘）');
    selected.slice(0, 20).forEach((a) => console.log('  ', a));
    return;
  }

  fs.mkdirSync(DEST, { recursive: true });
  let ok = 0;
  let skip = 0;
  await mapLimit(entries, CONCURRENCY, async (entry) => {
    const rel = entry.path.replace(/^apps\//, '');
    const dest = path.join(DEST, rel);
    // 断点续传：已存在且大小一致则跳过
    if (fs.existsSync(dest) && fs.statSync(dest).size === entry.size) { skip += 1; return; }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    await download(RAW + entry.path, dest);
    if (fs.statSync(dest).size !== entry.size) {
      throw new Error(`大小不符 ${rel}: ${fs.statSync(dest).size} != ${entry.size}`);
    }
    ok += 1;
  });

  console.log(`\n✔ 完成：下载 ${ok}，跳过 ${skip}，应用 ${selected.length} 个`);
}

main().catch((e) => { console.error('同步失败：', e); process.exit(1); });
