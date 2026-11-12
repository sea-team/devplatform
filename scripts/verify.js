'use strict';

/**
 * 平台端到端回归验证（在本机运行，直接打远端/本地平台 API）。
 *   node scripts/verify.js [http://10.0.0.246:9000]
 * 覆盖：健康检查、集成服务连通性、静态资源、SFTP 文件管理、交互式 SSH 终端、容器化构建。
 */
const BASE = process.argv[2] || process.env.PLATFORM_URL || 'http://10.0.0.246:9000';
// v0.4.0：强制登录后端到端回归走 ADMIN_TOKEN 机器通道（DP_TOKEN 环境变量）。
const TOKEN = String(process.env.DP_TOKEN || '').trim();
const authHeader = () => (TOKEN ? { authorization: `Bearer ${TOKEN}` } : {});
// 下载链接 / SSE 终端无法带自定义头，用 ?token= 传同一个 ADMIN_TOKEN。
const withToken = (url) => (TOKEN ? `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(TOKEN)}` : url);

async function api(path, options = {}) {
  const init = { ...options };
  init.headers = { ...authHeader(), ...(init.headers || {}) };
  if (init.body !== undefined && typeof init.body !== 'string' && !Buffer.isBuffer(init.body)) {
    init.body = JSON.stringify(init.body);
    init.headers = { 'content-type': 'application/json', ...init.headers };
  }
  const response = await fetch(`${BASE}/api${path}`, init);
  const payload = await response.json();
  if (!payload.ok) throw new Error(`${path} → ${payload.error}`);
  return payload.data;
}

const line = (label, ok, extra = '') => console.log(`${ok ? '✔' : '✖'} ${label}${extra ? ` · ${extra}` : ''}`);

async function verifyOverview() {
  const health = await api('/health');
  line('平台健康检查', health.mode === 'normal', `mode=${health.mode} executor=${health.executor}`);
  const overview = await api('/overview');
  for (const service of overview.services) line(`集成服务 ${service.name}`, service.status === 'online', `${service.status} ${service.detail || ''}`);
  const assets = await Promise.all([
    '/vendor/xterm.min.js', '/vendor/xterm.min.css', '/vendor/addon-fit.min.js',
    '/vendor/codemirror.js', '/vendor/codemirror.css', '/vendor/cm-modes.js',
    '/vendor/cm-addons.js', '/cm-theme.css',
  ].map((p) => fetch(BASE + p).then((r) => ({ p, status: r.status }))));
  for (const a of assets) line(`静态资源 ${a.p}`, a.status === 200, String(a.status));
  return overview.services.every((s) => s.status === 'online');
}

async function verifyFiles(id) {
  const root = '/data/platform';
  const dir = 'dp-fs-verify';
  const dirPath = `${root}/${dir}`;
  const file = `${dirPath}/hello.txt`;

  await api(`/servers/${id}/files/mkdir`, { method: 'POST', body: { path: root, name: dir } });
  await api(`/servers/${id}/files/content`, { method: 'PUT', body: { path: file, content: 'hello 文件管理 ✓' } });
  const read = await api(`/servers/${id}/files/content?path=${encodeURIComponent(file)}`);
  line('SFTP 读取文本文件', read.content === 'hello 文件管理 ✓', `${read.size} bytes`);

  const upload = await fetch(withToken(`${BASE}/api/servers/${id}/files/upload?path=${encodeURIComponent(dirPath)}&name=raw.bin`), {
    method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: Buffer.from([1, 2, 3, 4]),
  }).then((r) => r.json());
  line('SFTP 二进制上传', upload.ok, `${upload.data && upload.data.size} bytes`);

  await api(`/servers/${id}/files/rename`, { method: 'POST', body: { path: file, name: 'renamed.txt' } });
  const download = await fetch(withToken(`${BASE}/api/servers/${id}/files/download?path=${encodeURIComponent(`${dirPath}/renamed.txt`)}`));
  line('SFTP 下载', download.status === 200 && (await download.text()) === 'hello 文件管理 ✓');

  const list = await api(`/servers/${id}/files?path=${encodeURIComponent(dirPath)}`);
  line('SFTP 列目录', list.items.length >= 2, `${list.total} 项：${list.items.map((i) => i.name).join(', ')}`);

  let blocked = false;
  try { await api(`/servers/${id}/files/delete`, { method: 'POST', body: { path: '/', names: ['etc'] } }); }
  catch { blocked = true; }
  line('删除系统路径被拦截', blocked);

  let traversal = false;
  try { await api(`/servers/${id}/files?path=${encodeURIComponent('/data/../etc')}`); }
  catch { traversal = true; }
  line('路径穿越被拦截', traversal);

  await api(`/servers/${id}/files/delete`, { method: 'POST', body: { path: root, names: [dir] } });
  line('测试目录已清理', true);
}

/** 文件编辑器：后缀识别、编码往返、换行符、图片/二进制、有损编码保护。 */
async function verifyEditorFeatures(id) {
  const root = '/data/platform';
  const dir = 'dp-editor-verify';
  const dirPath = `${root}/${dir}`;
  const full = (name) => `${dirPath}/${name}`;
  const read = (name) => api(`/servers/${id}/files/content?path=${encodeURIComponent(full(name))}`);
  const putText = (name, body) => api(`/servers/${id}/files/content`, {
    method: 'PUT', body: { path: full(name), ...body },
  });
  const putRaw = (name, buffer) => fetch(withToken(`${BASE}/api/servers/${id}/files/upload?path=${encodeURIComponent(dirPath)}&name=${encodeURIComponent(name)}`), {
    method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: buffer,
  }).then((r) => r.json());
  const download = (name) => fetch(withToken(`${BASE}/api/servers/${id}/files/download?path=${encodeURIComponent(full(name))}`))
    .then((r) => r.arrayBuffer()).then((b) => Buffer.from(b));

  await api(`/servers/${id}/files/mkdir`, { method: 'POST', body: { path: root, name: dir } });
  try {
    const created = await api(`/servers/${id}/files/create`, {
      method: 'POST', body: { path: dirPath, name: 'new.json', content: '{}\n' },
    });
    line('新建文件 API', created.path === full('new.json'));

    const samples = [
      ['main.go', 'package main\n', 'Go', 'text/x-go'],
      ['app.py', 'print(1)\n', 'Python', 'python'],
      ['index.html', '<html></html>\n', 'HTML / 模板', 'htmlmixed'],
      ['config.yaml', 'a: 1\n', 'YAML', 'yaml'],
      ['Cargo.toml', '[package]\n', 'TOML', ''],
      ['Dockerfile', 'FROM node:22\n', 'Dockerfile', 'text/x-dockerfile'],
      ['Cargo.lock', '# lock\n', 'Cargo Lock', ''],
      ['main.rs', 'fn main() {}\n', 'Rust', 'text/x-rustsrc'],
      ['script.sh', 'echo hi\n', 'Shell', 'shell'],
    ];
    for (const [name, text] of samples) await putRaw(name, Buffer.from(text, 'utf8'));
    const wrong = [];
    for (const [name, , label, mode] of samples) {
      const r = await read(name);
      if (r.language !== label || (r.mode || '') !== mode) wrong.push(`${name}→${r.language}/${r.mode}`);
    }
    line('后缀 → 语言 / CodeMirror mode 识别', wrong.length === 0,
      wrong.length ? wrong.join(', ') : `${samples.length} 种`);

    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000100ffff03000006000557bfabd40000000049454e44ae426082', 'hex');
    await putRaw('logo.png', png);
    const image = await read('logo.png');
    line('图片识别并生成预览', image.kind === 'image' && image.editable === false
      && String(image.preview).startsWith('data:image/png;base64,'));

    await putRaw('blob.zip', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 1, 2, 3]));
    const binary = await read('blob.zip');
    line('二进制文件禁止文本编辑', binary.kind === 'binary' && binary.editable === false);

    await putRaw('icon.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>\n'));
    const svg = await read('icon.svg');
    line('SVG 按 XML 文本编辑', svg.editable === true && svg.mode === 'xml');

    // GBK 字节（"中文注释" = d6d0 cec4 d7a2 cacd），自动检测 + 按原编码回写。
    const gbk = Buffer.concat([Buffer.from('// '), Buffer.from('d6d0cec4d7a2cacd', 'hex'), Buffer.from('\n')]);
    await putRaw('gbk.txt', gbk);
    const g = await read('gbk.txt');
    line('GBK 自动检测与解码', g.encoding === 'gb18030' && g.content.includes('中文注释'), `encoding=${g.encoding}`);
    line('编辑器元数据选项完整', Array.isArray(g.languages) && g.languages.length > 10
      && g.encodings.length >= 5 && g.newlines.length === 3,
    `语言 ${g.languages.length} / 编码 ${g.encodings.length} / 换行 ${g.newlines.length}`);
    await putText('gbk.txt', { content: g.content, encoding: g.encoding, newline: 'LF' });
    line('按原编码回写字节一致', (await download('gbk.txt')).equals(gbk));

    await putRaw('win.txt', Buffer.from('a\r\nb\r\n', 'utf8'));
    const win = await read('win.txt');
    line('CRLF 识别并归一化为 LF', win.newline === 'CRLF' && win.content === 'a\nb\n');
    await putText('win.txt', { content: 'x\ny\n', encoding: 'utf-8', newline: 'CRLF' });
    line('按换行符设置回写', (await download('win.txt')).toString('utf8') === 'x\r\ny\r\n');

    let blocked = false;
    try { await putText('win.txt', { content: '中文', encoding: 'latin1' }); }
    catch { blocked = true; }
    line('有损编码保存被拒绝（防损坏）', blocked);

    const list = await api(`/servers/${id}/files?path=${encodeURIComponent(dirPath)}`);
    const go = (list.items || []).find((i) => i.name === 'main.go');
    line('文件列表带类型 / 语言 / 图标', Boolean(go && go.language === 'Go' && go.icon && go.kind === 'text'));
  } finally {
    try { await api(`/servers/${id}/files/delete`, { method: 'POST', body: { path: root, names: [dir] } }); }
    catch (e) { console.log(`⚠ 测试目录清理失败：${e.message}`); }
    line('编辑器测试目录已清理', true);
  }
}

async function verifyTerminal(id) {
  const session = await api(`/servers/${id}/terminal/open`, { method: 'POST', body: { cols: 100, rows: 28 } });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let found = false;
  try {
    const response = await fetch(withToken(`${BASE}/api/servers/${id}/terminal/stream?sid=${encodeURIComponent(session.sid)}`), {
      signal: controller.signal,
    });
    const reader = response.body.getReader();
    const marker = 'DP_TERM_OK_9527';
    await api(`/servers/${id}/terminal/input`, { method: 'POST', body: { sid: session.sid, input: `echo ${marker}\r` } });
    let buffer = '';
    while (!found) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += Buffer.from(value).toString('utf8');
      for (const frame of buffer.split('\n')) {
        if (!frame.startsWith('data: ')) continue;
        const text = Buffer.from(frame.slice(6), 'base64').toString('utf8');
        if (text.includes(marker)) found = true;
      }
    }
  } catch { /* abort 结束读取 */ }
  clearTimeout(timer);
  controller.abort();
  await api(`/servers/${id}/terminal/close`, { method: 'POST', body: { sid: session.sid } });
  line('SSH 终端 输入 → SSE 输出', found, `sid=${session.sid}`);
  const sessions = await api(`/servers/${id}/terminals`);
  line('终端会话已释放', sessions.items.length === 0);
}

async function verifyBuild(id) {
  // 使用平台内置的零依赖自检项目（workspace/smoke-test），验证容器化构建执行器。
  const build = await api('/builds', {
    method: 'POST',
    body: { repoPath: 'smoke-test', profile: 'smoke', runTests: true },
  });
  for (let i = 0; i < 60; i += 1) {
    const record = await api(`/builds/${build.id}`);
    if (record.status !== 'running') {
      const log = await api(`/builds/${build.id}/log`);
      line('容器化构建 + 测试', record.status === 'success', `status=${record.status} exit=${record.exitCode}`);
      if (record.status !== 'success') console.log((log.log || '').slice(-1200));
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  line('容器化构建 + 测试', false, '超时');
  void id;
}

(async () => {
  console.log(`目标平台：${BASE}\n`);
  const allOnline = await verifyOverview();
  const servers = await api('/servers');
  if (!servers.items.length) { console.log('✖ 没有已登记服务器，跳过后续验证'); return; }
  const id = servers.items[0].id;
  console.log('');
  await verifyFiles(id);
  console.log('');
  await verifyEditorFeatures(id);
  console.log('');
  await verifyTerminal(id);
  console.log('');
  await verifyBuild(id);
  console.log(`\n${allOnline ? '✔ 集成服务全部在线' : '⚠ 仍有集成服务离线'}`);
})().catch((e) => { console.error(`✖ 验证中断：${e.message}`); process.exitCode = 1; });
