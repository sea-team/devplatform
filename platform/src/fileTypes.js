'use strict';

/**
 * 远程文件「类型识别 + 编码处理」（宝塔式文件编辑器后端逻辑）。
 *  - 按后缀 / 特殊文件名识别语言，给出 CodeMirror 的 mode、图标、MIME 与可编辑性；
 *  - 自动识别 BOM、UTF-8 / GBK 家族 / Big5 / UTF-16 / Latin1 并按原编码回写；
 *  - 识别 CRLF / CR / LF 换行，编辑器内统一用 \n，保存时还原；
 *  - 图片返回 data URL 预览，二进制文件禁止当作文本编辑。
 * iconv-lite 为可选依赖；缺失时自动降级为 UTF-8 / UTF-16 / Latin1（Node 原生支持）。
 */
let iconv = null;
try { iconv = require('iconv-lite'); } catch { iconv = null; }

const ICONV_ALIAS = { 'utf-16le': 'utf16-le', 'utf-16be': 'utf16-be', 'gb2312': 'gb18030' };

/* ------------------------------ 语言 / 后缀表 ----------------------------- */
// mode 直接对应 CodeMirror 5 的 mode 名称（cm-modes.js 已离线打包）。
const LANGUAGES = [
  { ext: ['js', 'mjs', 'cjs', 'jsx'], label: 'JavaScript', mode: 'javascript', icon: 'JS', color: 'amber' },
  { ext: ['ts', 'tsx', 'mts', 'cts'], label: 'TypeScript', mode: 'text/typescript', icon: 'TS', color: 'blue' },
  { ext: ['json', 'jsonc', 'json5'], label: 'JSON', mode: 'application/json', icon: '{}', color: 'amber' },
  { ext: ['html', 'htm', 'vue', 'svelte', 'hbs', 'ejs', 'twig', 'njk'], label: 'HTML / 模板', mode: 'htmlmixed', icon: '<>', color: 'orange' },
  { ext: ['xml', 'svg', 'xsl', 'xslt', 'xsd', 'wsdl'], label: 'XML / SVG', mode: 'xml', icon: '<>', color: 'orange' },
  { ext: ['css'], label: 'CSS', mode: 'css', icon: '#', color: 'blue' },
  { ext: ['scss', 'sass'], label: 'SCSS', mode: 'text/x-scss', icon: '#', color: 'pink' },
  { ext: ['less'], label: 'LESS', mode: 'text/x-less', icon: '#', color: 'pink' },
  { ext: ['py', 'pyw', 'pyi'], label: 'Python', mode: 'python', icon: 'Py', color: 'blue' },
  { ext: ['go'], label: 'Go', mode: 'text/x-go', icon: 'Go', color: 'cyan' },
  { ext: ['rs'], label: 'Rust', mode: 'text/x-rustsrc', icon: 'Rs', color: 'orange' },
  { ext: ['java'], label: 'Java', mode: 'text/x-java', icon: 'Jv', color: 'orange' },
  { ext: ['c', 'h'], label: 'C', mode: 'text/x-csrc', icon: 'C', color: 'gray' },
  { ext: ['cc', 'cpp', 'cxx', 'hpp', 'hh', 'hxx'], label: 'C++', mode: 'text/x-c++src', icon: 'C+', color: 'gray' },
  { ext: ['cs'], label: 'C#', mode: 'text/x-csharp', icon: 'C#', color: 'purple' },
  { ext: ['kt', 'kts'], label: 'Kotlin', mode: 'text/x-kotlin', icon: 'Kt', color: 'purple' },
  { ext: ['swift'], label: 'Swift', mode: '', icon: 'Sw', color: 'orange' },
  { ext: ['php', 'php3', 'php4', 'php5', 'php7', 'phtml'], label: 'PHP', mode: 'application/x-httpd-php', icon: 'PHP', color: 'purple' },
  { ext: ['sh', 'bash', 'zsh', 'ksh', 'fish'], label: 'Shell', mode: 'shell', icon: '$', color: 'green' },
  { ext: ['yml', 'yaml'], label: 'YAML', mode: 'yaml', icon: 'Y', color: 'green' },
  { ext: ['toml'], label: 'TOML', mode: '', icon: 'T', color: 'gray' },
  { ext: ['ini', 'conf', 'cnf', 'properties', 'editorconfig', 'gitconfig'], label: 'INI / 配置', mode: 'properties', icon: '⚙', color: 'gray' },
  { ext: ['md', 'markdown', 'mdx'], label: 'Markdown', mode: 'markdown', icon: 'M↓', color: 'blue' },
  { ext: ['sql'], label: 'SQL', mode: 'text/x-sql', icon: 'DB', color: 'amber' },
  { ext: ['lua'], label: 'Lua', mode: 'lua', icon: 'Lu', color: 'blue' },
  { ext: ['rb', 'rake'], label: 'Ruby', mode: 'ruby', icon: 'Rb', color: 'red' },
  { ext: ['pl', 'pm'], label: 'Perl', mode: 'perl', icon: 'Pl', color: 'purple' },
  { ext: ['txt', 'log', 'text', 'csv', 'tsv', 'lock', 'map', 'gitignore', 'dockerignore'], label: '纯文本', mode: '', icon: 'TXT', color: 'gray' },
];

// 无后缀或特殊文件名优先匹配。
const SPECIAL_NAMES = {
  Dockerfile: { label: 'Dockerfile', mode: 'text/x-dockerfile', icon: 'DK', color: 'blue' },
  Makefile: { label: 'Makefile', mode: '', icon: 'MK', color: 'gray' },
  makefile: { label: 'Makefile', mode: '', icon: 'MK', color: 'gray' },
  Jenkinsfile: { label: 'Jenkinsfile', mode: '', icon: 'JK', color: 'red' },
  '.env': { label: '环境变量', mode: 'properties', icon: 'ENV', color: 'amber' },
  '.gitignore': { label: 'Git 忽略规则', mode: '', icon: 'GIT', color: 'orange' },
  '.bashrc': { label: 'Shell 配置', mode: 'shell', icon: '$', color: 'green' },
  '.zshrc': { label: 'Shell 配置', mode: 'shell', icon: '$', color: 'green' },
  'nginx.conf': { label: 'Nginx 配置', mode: 'text/x-nginx-conf', icon: 'NG', color: 'green' },
  'go.mod': { label: 'Go Module', mode: '', icon: 'Go', color: 'cyan' },
  'Cargo.lock': { label: 'Cargo Lock', mode: '', icon: 'Rs', color: 'orange' },
};

const IMAGE_EXT = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon', avif: 'image/avif',
};
const BINARY_EXT = new Set([
  'zip', 'gz', 'tgz', 'tar', 'bz2', 'xz', '7z', 'rar', 'pdf', 'exe', 'dll', 'so',
  'dylib', 'bin', 'woff', 'woff2', 'ttf', 'otf', 'eot', 'mp3', 'wav', 'mp4',
  'avi', 'mov', 'mkv', 'wasm', 'pyc', 'class', 'o', 'a', 'db', 'sqlite', 'sqlite3',
  'jar', 'war', 'deb', 'rpm', 'iso', 'img', 'psd', 'xlsx', 'docx', 'pptx',
]);

const EXT_MAP = new Map();
LANGUAGES.forEach((rule) => rule.ext.forEach((e) => EXT_MAP.set(e, rule)));

function fileMeta(name) {
  const base = String(name || '').split('/').pop();
  const special = SPECIAL_NAMES[base];
  const lower = base.toLowerCase();
  const ext = lower.startsWith('.') && !lower.includes('.', 1)
    ? lower.slice(1)
    : (lower.includes('.') ? lower.split('.').pop() : '');
  const rule = EXT_MAP.get(ext);
  const picked = special || rule;
  const mime = IMAGE_EXT[ext] || (picked ? 'text/plain' : 'application/octet-stream');

  if (IMAGE_EXT[ext]) {
    return {
      label: ext.toUpperCase() + ' 图片', mode: '', kind: 'image',
      mime: IMAGE_EXT[ext], icon: 'IMG', color: 'pink', editable: false,
    };
  }
  if (BINARY_EXT.has(ext)) {
    return {
      label: ext.toUpperCase() + ' 二进制', mode: '', kind: 'binary',
      mime: 'application/octet-stream', icon: 'BIN', color: 'gray', editable: false,
    };
  }
  return {
    label: picked ? picked.label : (ext ? ext.toUpperCase() : '纯文本'),
    mode: picked ? picked.mode : '',
    kind: 'text', mime: 'text/plain',
    icon: picked ? picked.icon : 'TXT',
    color: picked ? picked.color : 'gray',
    editable: true,
  };
}

/* -------------------------------- 编码处理 ------------------------------- */

const ENCODINGS = [
  { value: 'auto', label: '自动检测' },
  { value: 'utf-8', label: 'UTF-8' },
  { value: 'gb18030', label: 'GB18030 / GBK / GB2312' },
  { value: 'gbk', label: 'GBK' },
  { value: 'big5', label: 'Big5（繁体）' },
  { value: 'utf-16le', label: 'UTF-16 LE' },
  { value: 'utf-16be', label: 'UTF-16 BE' },
  { value: 'latin1', label: 'Latin-1 / ISO-8859-1' },
];
const NEWLINES = [
  { value: 'LF', label: 'LF（Unix / Linux）' },
  { value: 'CRLF', label: 'CRLF（Windows）' },
  { value: 'CR', label: 'CR（旧版 Mac）' },
];

function swapBytes(buf) {
  const size = buf.length - (buf.length % 2);
  const out = Buffer.alloc(size);
  for (let i = 0; i < size; i += 2) { out[i] = buf[i + 1]; out[i + 1] = buf[i]; }
  return out;
}

function decodeWith(body, encoding) {
  switch (encoding) {
    case 'utf-8': case 'utf8': return body.toString('utf8');
    case 'utf-16le': return body.toString('utf16le');
    case 'utf-16be': return swapBytes(body).toString('utf16le');
    case 'latin1': case 'iso-8859-1': return body.toString('latin1');
    default: {
      const name = ICONV_ALIAS[encoding] || encoding;
      if (iconv && iconv.encodingExists(name)) return iconv.decode(body, name);
      return body.toString('utf8');
    }
  }
}

function encodeWith(text, encoding) {
  switch (encoding) {
    case 'utf-8': case 'utf8': case '': return Buffer.from(text, 'utf8');
    case 'utf-16le': return Buffer.from(text, 'utf16le');
    case 'utf-16be': return swapBytes(Buffer.from(text, 'utf16le'));
    case 'latin1': case 'iso-8859-1': return Buffer.from(text, 'latin1');
    default: {
      const name = ICONV_ALIAS[encoding] || encoding;
      if (iconv && iconv.encodingExists(name)) return iconv.encode(text, name);
      return Buffer.from(text, 'utf8');
    }
  }
}

function looksLikeUtf8(buf) {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return true;
  } catch { return false; }
}

function detectBom(buf) {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return { name: 'utf-8', offset: 3 };
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return { name: 'utf-16le', offset: 2 };
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return { name: 'utf-16be', offset: 2 };
  return { name: '', offset: 0 };
}

function looksBinary(buf) {
  const sample = buf.subarray(0, 4096);
  if (!sample.length) return false;
  if (sample.includes(0)) return true;
  let bad = 0;
  for (const byte of sample) {
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) bad += 1;
  }
  return bad / sample.length > 0.08;
}

function splitNewlines(text) {
  const crlf = (text.match(/\r\n/g) || []).length;
  const rest = text.replace(/\r\n/g, '');
  const cr = (rest.match(/\r/g) || []).length;
  const lf = (rest.match(/\n/g) || []).length;
  let newline = 'LF';
  if (crlf > 0 && crlf >= cr && crlf >= lf) newline = 'CRLF';
  else if (cr > 0 && cr >= lf) newline = 'CR';
  return { text: text.replace(/\r\n?/g, '\n'), newline };
}

function applyNewlines(text, newline) {
  if (newline === 'CRLF') return text.replace(/\n/g, '\r\n');
  if (newline === 'CR') return text.replace(/\n/g, '\r');
  return text;
}

function decodeBuffer(buffer, requested = 'auto') {
  const bom = detectBom(buffer);
  const body = buffer.subarray(bom.offset);
  let encoding = requested && requested !== 'auto' ? requested : '';
  if (!encoding) encoding = bom.name || (looksLikeUtf8(body) ? 'utf-8' : 'gb18030');
  let text;
  try { text = decodeWith(body, encoding); }
  catch { encoding = 'utf-8'; text = body.toString('utf8'); }
  const { text: normalized, newline } = splitNewlines(text);
  return { text: normalized, encoding, bom: bom.name, newline, hasBom: Boolean(bom.name) };
}

/**
 * 读取文件并给出编辑器需要的全部元信息。
 * @returns {{content:string, encoding:string, newline:string, bom:string, ...}}
 */
function analyzeBuffer(name, buffer, requestedEncoding = 'auto') {
  const meta = fileMeta(name);
  const base = {
    size: buffer.length,
    language: meta.label,
    mode: meta.mode,
    kind: meta.kind,
    mime: meta.mime,
    icon: meta.icon,
    color: meta.color,
    editable: meta.editable,
    preview: null,
    binary: false,
    warning: '',
  };
  if (meta.kind === 'image') {
    return { ...base, content: '', encoding: '', newline: 'LF', bom: '', hasBom: false,
      preview: `data:${meta.mime};base64,${buffer.toString('base64')}`,
      warning: '图片文件以预览模式打开，编辑请使用「下载」或「上传」。' };
  }
  if (meta.kind === 'binary' || looksBinary(buffer)) {
    return { ...base, kind: 'binary', editable: false, binary: true, content: '',
      encoding: '', newline: 'LF', bom: '', hasBom: false,
      warning: '检测到二进制内容，不能按文本编辑；可用「下载」保存到本地。' };
  }
  const decoded = decodeBuffer(buffer, requestedEncoding);
  return { ...base, ...decoded, content: decoded.text,
    warning: !iconv ? '未安装 iconv-lite：仅支持 UTF-8 / UTF-16 / Latin-1 编码。' : '' };
}

function encodeContent(text, options = {}) {
  const encoding = options.encoding && options.encoding !== 'auto' ? options.encoding : 'utf-8';
  const newline = NEWLINES.some((n) => n.value === options.newline) ? options.newline : 'LF';
  const normalized = applyNewlines(String(text), newline);
  const body = encodeWith(normalized, encoding);
  // 非 Unicode 编码可能把无法表示的字符变成 '?'，静默保存会损坏文件；直接拒绝。
  if (!/^utf/i.test(encoding)) {
    let roundTrip;
    try { roundTrip = decodeWith(body, encoding); } catch { roundTrip = null; }
    if (roundTrip !== normalized) {
      throw new Error(`「${encoding}」无法表示文件中的部分字符，保存已中止；请改用 UTF-8 或 GB18030`);
    }
  }
  let prefix = Buffer.alloc(0);
  if (options.bom === true || options.bom === 'true') {
    if (encoding === 'utf-8') prefix = Buffer.from([0xef, 0xbb, 0xbf]);
    else if (encoding === 'utf-16le') prefix = Buffer.from([0xff, 0xfe]);
    else if (encoding === 'utf-16be') prefix = Buffer.from([0xfe, 0xff]);
  }
  return { buffer: Buffer.concat([prefix, body]), encoding, newline };
}

const LANGUAGE_OPTIONS = [
  { value: '', label: '纯文本' },
  ...LANGUAGES.map((r) => ({ value: r.mode, label: r.label })),
  { value: 'text/x-dockerfile', label: 'Dockerfile' },
  { value: 'text/x-nginx-conf', label: 'Nginx 配置' },
].filter((item, index, arr) => arr.findIndex((x) => x.value === item.value) === index);

module.exports = {
  fileMeta, analyzeBuffer, encodeContent, decodeBuffer,
  ENCODINGS, NEWLINES, LANGUAGE_OPTIONS,
  hasIconv: () => Boolean(iconv),
};
