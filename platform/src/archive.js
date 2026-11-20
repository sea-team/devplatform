'use strict';

/**
 * 轻量归档解压模块（v0.4.19 · E 批）。
 *
 * 零第三方依赖，纯 Node 内置 zlib：
 *  - tar / tar.gz / tgz：移植 launcher 的 ustar 解析并加固（GNU longname / PAX 扩展头、目录、普通文件）。
 *  - zip：手写 minimal ZIP 解析（local file header 遍历 + deflate/store），用 zlib.inflateRawSync。
 *
 * 安全（zip-slip / tar-slip 是本模块的生命线）：
 *  - 所有条目路径先做正斜杠归一、去掉前导 "./"，拒绝绝对路径、UNC、盘符、含 \0、".." 段；
 *  - 最终落点用 path.resolve(dest, rel) 后必须仍在 path.resolve(dest) + sep 之内；
 *  - 拒绝符号链接 / 硬链接 / 设备文件等非常规 type，杜绝通过软链逃出目标目录；
 *  - 单条目 / 总解压大小与文件数设上限，防 zip 炸弹内存耗尽。
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { HttpError } = require('./core');

const MAX_ENTRIES = 20000;
const MAX_FILE_BYTES = 256 * 1024 * 1024;   // 单个文件解压后上限 256MB
const MAX_TOTAL_BYTES = 1024 * 1024 * 1024; // 总解压上限 1GB

/** 把归档内的名字归一为安全的相对路径；不安全则抛错。 */
function safeRel(rawName) {
  let name = String(rawName == null ? '' : rawName).replace(/\\/g, '/');
  if (!name || name.includes('\0')) throw new HttpError(400, '归档包含非法文件名为空或含 NUL');
  // 去前导 ./（可连续），统一分隔符
  while (name.startsWith('./')) name = name.slice(2);
  if (!name) return null; // "./" 这类纯目录前缀，忽略
  if (/^(\/|[A-Za-z]:|\/\/)/.test(name)) throw new HttpError(400, `归档包含绝对路径条目：${name.slice(0, 80)}`);
  const parts = name.split('/');
  if (parts.some((p) => p === '..')) throw new HttpError(400, `归档包含目录穿越条目：${name.slice(0, 80)}`);
  const clean = parts.filter((p) => p && p !== '.').join('/');
  if (!clean) return null;
  return clean;
}

/** 计算落点并校验仍在 dest 之内（zip-slip 最终防线）。 */
function resolveInside(dest, rel) {
  const base = path.resolve(dest);
  const target = path.resolve(base, rel);
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new HttpError(400, `归档条目越界：${rel.slice(0, 80)}`);
  }
  return target;
}

function parseOctal(field) {
  const s = String(field || '').replace(/\0/g, '').trim();
  if (!s) return 0;
  const n = parseInt(s, 8);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** 识别压缩格式：优先魔数，后缀兜底。返回 'tar' | 'tgz' | 'zip'。 */
function detectFormat(buffer, filename = '') {
  const b = Buffer.isBuffer(buffer) ? buffer : Buffer.alloc(0);
  if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07)) return 'zip';
  if (b.length >= 2 && b[0] === 0x1f && b[1] === 0x8b) return 'tgz';
  // tar：257 偏移处的 "ustar" 魔数
  if (b.length >= 262 && b.toString('ascii', 257, 262) === 'ustar') return 'tar';
  const lower = String(filename || '').toLowerCase();
  if (/\.tar\.gz$|\.tgz$/.test(lower)) return 'tgz';
  if (/\.tar$/.test(lower)) return 'tar';
  if (/\.zip$/.test(lower)) return 'zip';
  return '';
}

/**
 * 解压 tar / tar.gz 到 dest。
 * 条目数据以回调形式交给调用方写入，便于统一安全校验。
 */
function extractTar(buffer, dest, { gzip = false } = {}) {
  let buf = buffer;
  if (gzip) {
    // 必须在这里就设上限：gunzipSync 会先把整个归档解压成内存 Buffer，
    // 旧写法解压完才比较大小，几百 KB 的压缩包就能要求 GB 级内存（解压炸弹）。
    try { buf = zlib.gunzipSync(buffer, { maxOutputLength: MAX_TOTAL_BYTES }); }
    catch (e) { throw new HttpError(400, `gzip 解压失败或解压后体积超过安全上限：${e.message}`); }
  }
  let off = 0;
  let entries = 0;
  let total = 0;
  let longName = null; // GNU longname 暂存
  const written = [];
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512);
    if (!h.some((byte) => byte !== 0)) break; // 全 0 = 归档结束
    let name = h.subarray(0, 100).toString('utf8').split('\0')[0];
    const prefix = h.subarray(345, 500).toString('utf8').split('\0')[0];
    if (prefix) name = `${prefix}/${name}`;
    const size = parseOctal(h.subarray(124, 136));
    const typeChar = h[156] === 0 ? '0' : String.fromCharCode(h[156]);
    off += 512;
    const data = buf.subarray(off, off + size);
    off += Math.ceil(size / 512) * 512;

    // GNU 长文件名：L 类型的 data 就是下一个条目的真实名字
    if (typeChar === 'L') { longName = data.toString('utf8').split('\0')[0]; continue; }
    if (longName) { name = longName; longName = null; }
    // PAX 扩展头（x/g）：跳过其内容，用 path= 覆盖名字
    if (typeChar === 'x' || typeChar === 'g') {
      const m = data.toString('utf8').match(/\bpath=([^\n]+)/);
      if (m) name = m[1];
      continue;
    }
    // 只接受普通文件 / 目录；符号链接(2)/硬链(1)/设备(3,4,6)等一律拒绝
    if (typeChar !== '0' && typeChar !== '\0' && typeChar !== '5' && typeChar !== '7') continue;

    const rel = safeRel(name);
    if (!rel) continue;
    const target = resolveInside(dest, rel);
    entries += 1;
    if (entries > MAX_ENTRIES) throw new HttpError(400, `归档条目过多（上限 ${MAX_ENTRIES}）`);

    if (typeChar === '5' || name.endsWith('/')) {
      fs.mkdirSync(target, { recursive: true });
      written.push({ path: rel, dir: true });
      continue;
    }
    total += size;
    if (size > MAX_FILE_BYTES || total > MAX_TOTAL_BYTES) {
      throw new HttpError(400, '归档解压后体积超过安全上限，已拒绝');
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
    written.push({ path: rel, dir: false, size });
  }
  if (!written.length) throw new HttpError(400, 'tar 归档中没有可解压的文件');
  return written;
}

/** 从 local file header 读取一个 zip 条目，返回 {rel, data, nextOff} 或 null。 */
function readZipEntry(buf, off, dest) {
  if (off + 30 > buf.length) return null;
  if (buf.readUInt32LE(off) !== 0x04034b50) return null;
  const flags = buf.readUInt16LE(off + 6);
  const method = buf.readUInt16LE(off + 8);
  const compSize = buf.readUInt32LE(off + 18);
  const nameLen = buf.readUInt16LE(off + 26);
  const extraLen = buf.readUInt16LE(off + 28);
  const nameStart = off + 30;
  const dataStart = nameStart + nameLen + extraLen;
  if (dataStart + compSize > buf.length) throw new HttpError(400, 'zip 归档数据不完整');
  if (flags & 0x1) throw new HttpError(400, '不支持加密的 zip 归档');
  const rawName = buf.subarray(nameStart, nameStart + nameLen).toString('utf8');
  const rel = safeRel(rawName);
  const data = buf.subarray(dataStart, dataStart + compSize);
  let content;
  if (method === 0) content = data; // store
  else if (method === 8) {
    // 同 tar：inflate 前就限制解压后大小，避免「先爆内存再判超限」。
    try { content = zlib.inflateRawSync(data, { maxOutputLength: MAX_FILE_BYTES }); }
    catch (e) { throw new HttpError(400, `zip deflate 解压失败或解压后体积超过安全上限：${e.message}`); }
  } else throw new HttpError(400, `不支持的 zip 压缩方式：${method}`);
  return { rel, dir: /\/$/.test(rawName), content, nextOff: dataStart + compSize, rawName };
}

/** 解压 zip 到 dest。用 data descriptor（flags bit 3）时 size 字段为 0，改从 central directory 解析。 */
function extractZip(buffer, dest) {
  const buf = buffer;
  // 先尝试 local header 顺序遍历（大多数 git/工具生成的 zip 都带正确 size）
  const out = [];
  let off = 0;
  let total = 0;
  let usedCentral = false;
  try {
    while (off + 30 <= buf.length && buf.readUInt32LE(off) === 0x04034b50) {
      // data descriptor（flags bit 3）时 local header 里的 size 字段为 0，内容不可信：
      // 必须在写盘之前转 central directory，否则会按错误长度落盘。
      if (buf.readUInt16LE(off + 6) & 0x8) { usedCentral = true; break; }
      const e = readZipEntry(buf, off, dest);
      if (!e) break;
      // 按「条目是否存在」判断，不看 content.length：0 字节文件与纯目录条目同样是
      // 合法内容。旧写法直接跳过它们，导入只含 .git 的归档时会丢掉 objects/、
      // refs/ 这类空目录，后续所有 git 命令都被判成「不是完整仓库」。
      if (e.rel) {
        total += e.content.length;
        if (e.content.length > MAX_FILE_BYTES || total > MAX_TOTAL_BYTES) {
          throw new HttpError(400, '归档解压后体积超过安全上限，已拒绝');
        }
        const target = resolveInside(dest, e.rel);
        if (e.dir || /\/$/.test(e.rawName)) {
          fs.mkdirSync(target, { recursive: true });
          out.push({ path: e.rel, dir: true });
        } else {
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, e.content);
          out.push({ path: e.rel, dir: false, size: e.content.length });
        }
      }
      off = e.nextOff;
      if (out.length > MAX_ENTRIES) throw new HttpError(400, `归档条目过多（上限 ${MAX_ENTRIES}）`);
    }
  } catch (e) {
    if (e instanceof HttpError) throw e;
    usedCentral = true;
  }

  if (usedCentral || !out.length) {
    // central directory 解析：找 EOCD(0x06054b50)，逐个 0x02014b50 条目
    const central = parseZipCentral(buf);
    out.length = 0; total = 0;
    for (const c of central) {
      if (!c.rel) continue;
      const target = resolveInside(dest, c.rel);
      if (c.dir) { fs.mkdirSync(target, { recursive: true }); out.push({ path: c.rel, dir: true }); continue; }
      let content = buf.subarray(c.dataStart, c.dataStart + c.compSize);
      if (c.method === 8) {
        try { content = zlib.inflateRawSync(content, { maxOutputLength: MAX_FILE_BYTES }); }
        catch (e) { throw new HttpError(400, `zip deflate 解压失败或解压后体积超过安全上限：${e.message}`); }
      } else if (c.method !== 0) throw new HttpError(400, `不支持的 zip 压缩方式：${c.method}`);
      total += content.length;
      if (content.length > MAX_FILE_BYTES || total > MAX_TOTAL_BYTES) {
        throw new HttpError(400, '归档解压后体积超过安全上限，已拒绝');
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
      out.push({ path: c.rel, dir: false, size: content.length });
      if (out.length > MAX_ENTRIES) throw new HttpError(400, `归档条目过多（上限 ${MAX_ENTRIES}）`);
    }
  }
  if (!out.length) throw new HttpError(400, 'zip 归档中没有可解压的文件');
  return out;
}

function parseZipCentral(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new HttpError(400, '无法识别的 zip 归档（找不到结束记录）');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const list = [];
  for (let i = 0; i < count && off + 46 <= buf.length; i += 1) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const rawName = buf.subarray(off + 46, off + 46 + nameLen).toString('utf8');
    let dataStart = localOff;
    if (buf.readUInt32LE(localOff) === 0x04034b50) {
      dataStart = localOff + 30 + buf.readUInt16LE(localOff + 26) + buf.readUInt16LE(localOff + 28);
    }
    list.push({
      rawName, rel: safeRel(rawName), dir: /\/$/.test(rawName),
      method, compSize, dataStart,
    });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return list;
}

/**
 * 统一入口：解压 buffer 到 dest（dest 不存在会创建）。
 * options.format 可指定，否则自动识别。返回写入的条目数组。
 */
function extract(buffer, dest, options = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new HttpError(400, '归档内容为空');
  const fmt = options.format || detectFormat(buffer, options.filename);
  if (!fmt) throw new HttpError(400, '无法识别的归档格式（仅支持 .tar / .tar.gz / .tgz / .zip）');
  fs.mkdirSync(dest, { recursive: true });
  if (fmt === 'zip') return extractZip(buffer, dest);
  return extractTar(buffer, dest, { gzip: fmt === 'tgz' });
}

/** 仅列出条目名（不落盘），供检测归档结构用。基于临时解压太重，这里走轻量解析。 */
function listNames(buffer, options = {}) {
  const fmt = options.format || detectFormat(buffer, options.filename);
  const names = [];
  if (fmt === 'zip') {
    for (const c of parseZipCentral(buffer)) if (c.rel) names.push(c.rel);
    return names;
  }
  if (fmt === 'tar' || fmt === 'tgz') {
    let buf = buffer;
    if (fmt === 'tgz') buf = zlib.gunzipSync(buffer);
    let off = 0;
    let longName = null;
    while (off + 512 <= buf.length) {
      const h = buf.subarray(off, off + 512);
      if (!h.some((b) => b !== 0)) break;
      let name = h.subarray(0, 100).toString('utf8').split('\0')[0];
      const prefix = h.subarray(345, 500).toString('utf8').split('\0')[0];
      if (prefix) name = `${prefix}/${name}`;
      const size = parseOctal(h.subarray(124, 136));
      const typeChar = h[156] === 0 ? '0' : String.fromCharCode(h[156]);
      off += 512 + Math.ceil(size / 512) * 512;
      if (typeChar === 'L') { longName = buf.subarray(off - Math.ceil(size / 512) * 512 - size, off - Math.ceil(size / 512) * 512).toString('utf8').split('\0')[0]; continue; }
      if (longName) { name = longName; longName = null; }
      const rel = safeRel(name);
      if (rel) names.push(rel);
    }
    return names;
  }
  throw new HttpError(400, '无法识别的归档格式');
}

module.exports = { detectFormat, extract, listNames, safeRel, MAX_ENTRIES };

// E批探针 1795097860
