'use strict';

// D 批：AI 运维 / 会话按服务器 read 权限过滤的冒烟测试。
// 用 DATA_DIR 指向临时目录，避免污染生产 state.json。
process.env.DATA_DIR = require('path').join(__dirname, '..', 'data', '_smoke_ai_scope');
const fs = require('fs');
const path = require('path');
const dataDir = process.env.DATA_DIR;
fs.mkdirSync(dataDir, { recursive: true });
const stateFile = path.join(dataDir, 'state.json');
fs.writeFileSync(stateFile, JSON.stringify({
  users: [
    { id: 'usr_alice', username: 'alice', role: 'user', status: 'active' },
    { id: 'usr_bob', username: 'bob', role: 'user', status: 'active' },
    { id: 'usr_admin', username: 'admin', role: 'admin', status: 'active' },
  ],
  servers: [
    { id: 'srv_a', name: 'A', host: '10.0.0.1', ownerId: 'usr_alice', collaborators: [] },
    { id: 'srv_b', name: 'B', host: '10.0.0.2', ownerId: 'usr_bob', collaborators: [] },
    { id: 'srv_shared', name: 'Shared', host: '10.0.0.3', ownerId: 'usr_alice',
      collaborators: [{ userId: 'usr_bob', permission: 'read' }] },
    { id: 'srv_legacy', name: 'Legacy', host: '10.0.0.4' }, // 历史遗留无 owner，普通用户不可见
  ],
  aiSessions: [],
}), 'utf8');

const { scopedServers } = require('../platform/src/engine');
const aiSessions = require('../platform/src/aiSessions');

const alice = { id: 'usr_alice', role: 'user', via: 'session' };
const bob = { id: 'usr_bob', role: 'user', via: 'session' };
const admin = { id: 'usr_admin', role: 'admin', via: 'session' };
const ids = (arr) => arr.map((s) => s.id).sort().join(',');
let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  console.log(`${ok ? '✔' : '✘'} ${name}: ${actual}${ok ? '' : ` (期望 ${expected})`}`);
  if (ok) pass++; else fail++;
}

// 1. 'all' / 未指定：按用户 read 权限收敛候选池
check('管理员 all=全部4台', ids(scopedServers(undefined, admin)), 'srv_a,srv_b,srv_legacy,srv_shared');
check('alice all=自己owner+协作者管理的2台', ids(scopedServers('all', alice)), 'srv_a,srv_shared');
check('bob all=自己owner+read协作的2台', ids(scopedServers('all', bob)), 'srv_b,srv_shared');
check('无user all=0台(兜底拒绝)', ids(scopedServers('all', null)), '');

// 2. 选中数组：候选池 ∩ 选中 id（伪造他人 id 被裁掉）
check('alice 伪造选srv_b被裁掉', ids(scopedServers(['srv_b'], alice)), '');
check('alice 选[srv_a,srv_b,srv_shared]只剩可见2台', ids(scopedServers(['srv_a', 'srv_b', 'srv_shared'], alice)), 'srv_a,srv_shared');
check('bob 选[srv_shared,srv_a]只剩可见1台', ids(scopedServers(['srv_shared', 'srv_a'], bob)), 'srv_shared');
check('alice 选空数组=0台', ids(scopedServers([], alice)), '');
check('管理员 伪造任意id仍可(全量)', ids(scopedServers(['srv_b', 'srv_legacy'], admin)), 'srv_b,srv_legacy');

// 3. aiSessions 落库收敛：越权 server id 不写进会话
const created = aiSessions.create(alice, { title: 't', serverScope: ['srv_b', 'srv_a'] });
check('create 落库剔除越权srv_b', JSON.stringify(created.serverScope), '["srv_a"]');
const detail = aiSessions.detail(alice, created.id);
check('detail 回显无越权id', JSON.stringify(detail.serverScope), '["srv_a"]');

console.log(`\nD 批 AI 服务器权限冒烟：${pass} 通过 / ${fail} 失败`);
try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
process.exit(fail ? 1 : 0);
