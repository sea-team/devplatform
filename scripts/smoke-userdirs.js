'use strict';

// C 批 userDirs 隔离逻辑冒烟：用 DATA_DIR 指向临时目录，避免污染生产 state.json。
process.env.DATA_DIR = require('path').join(__dirname, '..', 'data', '_smoke_userdirs');
const fs = require('fs');
const path = require('path');
const dataDir = process.env.DATA_DIR;
fs.mkdirSync(dataDir, { recursive: true });
const stateFile = path.join(dataDir, 'state.json');
fs.writeFileSync(stateFile, JSON.stringify({
  users: [
    { id: 'usr_a', username: 'alice', role: 'user', status: 'active' },
    { id: 'usr_b', username: 'bob', role: 'user', status: 'active' },
    { id: 'usr_admin', username: 'admin', role: 'admin', status: 'active' },
  ],
  directories: [
    { id: 'dir_usr_a', name: 'alice', aclKind: 'directory', dirPath: '/workspace/users/alice', ownerId: 'usr_a',
      collaborators: [{ userId: 'usr_b', permission: 'read' }], createdAt: '' },
    { id: 'dir_usr_b', name: 'bob', aclKind: 'directory', dirPath: '/workspace/users/bob', ownerId: 'usr_b',
      collaborators: [], createdAt: '' },
  ],
  openlistMountOwners: {
    'user:usr_a': { ownerId: 'usr_a', mountPath: '/workspace/users/alice' },
    'user:usr_b': { ownerId: 'usr_b', mountPath: '/workspace/users/bob' },
  },
}), 'utf8');

const core = require('../platform/src/core');
const permissions = require('../platform/src/permissions');
const userDirs = require('../platform/src/userDirs');

// 校验 core 读到了我们的临时 state
if (!core.state().users || core.state().users.length !== 3) {
  console.error('FAIL: 临时 state 未被 core 加载，users=', core.state().users);
  process.exit(1);
}

const alice = { id: 'usr_a', role: 'user', via: 'session' };
const bob = { id: 'usr_b', role: 'user', via: 'session' };
const admin = { id: 'usr_admin', role: 'admin', via: 'session' };
let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  console.log(`${ok ? '✔' : '✘'} ${name}: ${actual}${ok ? '' : ` (期望 ${expected})`}`);
  if (ok) pass++; else fail++;
}

// 1. 家目录完整路径前缀隔离
check('alice 可访问自己家目录', permissions.guard(
  { user: alice, method: 'GET', query: { path: '/workspace/users/alice' }, params: {} }, '/api/openlist/files'), true);
check('alice 不可访问 bob 家目录', permissions.guard(
  { user: alice, method: 'GET', query: { path: '/workspace/users/bob' }, params: {} }, '/api/openlist/files'), false);
check('alice 可访问家目录子路径', permissions.guard(
  { user: alice, method: 'GET', query: { path: '/workspace/users/alice/子目录' }, params: {} }, '/api/openlist/files'), true);
check('bob 作为 read 协作者可读 alice 家目录', permissions.guard(
  { user: bob, method: 'GET', query: { path: '/workspace/users/alice' }, params: {} }, '/api/openlist/files'), true);
check('bob 作为 read 协作者不可写 alice 家目录', permissions.guard(
  { user: bob, method: 'POST', body: { path: '/workspace/users/alice', name: 'x' }, params: {} }, '/api/openlist/files/mkdir'), false);
check('管理员可访问任意家目录', permissions.guard(
  { user: admin, method: 'GET', query: { path: '/workspace/users/bob' }, params: {} }, '/api/openlist/files'), true);
check('根目录读取放行', permissions.guard(
  { user: alice, method: 'GET', query: { path: '/' }, params: {} }, '/api/openlist/files'), true);

// 2. OpenList admin 代理写操作收口
check('普通用户不可通过 admin 代理写上游', permissions.guard(
  { user: alice, method: 'POST', body: {}, params: {} }, '/api/openlist/admin/api/storage/save'), false);
check('普通用户可读 admin 代理', permissions.guard(
  { user: alice, method: 'GET', query: {}, params: {} }, '/api/openlist/admin/api/storage/list'), true);

// 3. 协作者目录归属记录存在（懒建幂等）
permissions.ensureAclRecord(admin, 'directories', 'dir_usr_a');
check('ensureAclRecord 不重复建目录记录',
  core.state().directories.filter((d) => d.id === 'dir_usr_a').length, 1);

// 4. allowedPrefixes / allowsPath 直接校验
check('userDirs.allowsPath alice->bob=false', userDirs.allowsPath(alice, '/workspace/users/bob'), false);
check('userDirs.allowsPath alice->alice=true', userDirs.allowsPath(alice, '/workspace/users/alice'), true);
check('userDirs.canWritePath bob->alice=false (read only)', userDirs.canWritePath(bob, '/workspace/users/alice'), false);

console.log(`\nC 批隔离冒烟：${pass} 通过 / ${fail} 失败`);
// 清理临时 state
try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
process.exit(fail ? 1 : 0);
