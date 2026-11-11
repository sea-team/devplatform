'use strict';

/**
 * 扩展清单 v1（manifest v1）—— 只描述「是什么」，不携带可执行代码。
 *
 * 为什么不是插件：平台是 Node SEA 单文件程序，require 只能加载构建快照内的模块，
 * 动态加载用户放进来的 JS 在 exe 里跑不通；而且清单要能随 bundle.cjs 热更新。
 * 因此扩展 = 纯数据声明 + 平台内置适配器（extRuntime.js），命令一律来自内置模板，
 * 用户可覆盖的只有镜像 tag、端口、库名、卷名等参数，不能传 shell 字符串。
 *
 * 内置清单放在本文件（常量），随 bundle.cjs 一起热更新；
 * 自定义清单放 <DATA_DIR>/extensions/*.json，不入库、不占 SEA assets。
 */

/** 模板里允许出现的变量，校验清单时会逐一核对，杜绝任意表达式。 */
const TEMPLATE_KEYS = ['HOST', 'PORT', 'INTERNAL_PORT', 'PASSWORD', 'USER', 'DB_NAME', 'TAG', 'IMAGE', 'NAME'];

/** 所有实例共用的表单字段；由后端下发，前端按 type 动态渲染。 */
const COMMON_FIELDS = [
  {
    key: 'NAME', label: '实例名称', type: 'text', required: true,
    placeholder: '例如 app-dev',
    help: '仅字母、数字、短横线，用作容器名与数据卷名',
  },
  { key: 'TAG', label: '版本', type: 'tags', required: true, help: '选择官方镜像 tag' },
  {
    key: 'PORT', label: '宿主机端口', type: 'number', required: true,
    help: '安装前会检测端口占用；只绑定内网地址，不对公网开放',
  },
  {
    key: 'PASSWORD', label: '密码', type: 'password', required: false,
    placeholder: '留空自动生成 24 位随机串',
    help: '凭据只写入本机 state.json（600 权限），列表接口一律脱敏',
  },
];

/** 安装目标（后端按已登记服务器动态填充 options）。 */
const TARGET_FIELD = {
  key: 'TARGET', label: '安装到', type: 'select', required: true,
  default: 'local', options: [{ value: 'local', label: '本机 Docker' }],
  help: '选择已登记的 Linux 服务器可远程安装（通过 SSH 下发 docker 命令，本机无需 Docker）',
};

const EXTERNAL_HOST_FIELD = {
  key: 'HOST', label: '数据库地址', type: 'text', required: true,
  placeholder: '例如 10.0.0.246 或 db.internal',
  help: '外部连接模式只登记连接信息，平台不会安装或改动该服务',
};

/**
 * 内置清单。health.cmd 是容器内执行的固定命令数组（不经 shell 拼接用户值），
 * 用环境变量引用密码，避免凭据出现在 docker inspect / 日志里。
 */
const BUILTIN = [
  {
    id: 'mysql', label: 'MySQL', kind: 'database', icon: 'DB',
    description: '关系型数据库 · 官方镜像 · 自动建初始库',
    image: 'mysql', tags: ['8.4', '8.0', '5.7'], defaultTag: '8.4',
    port: 3306, internalPort: 3306, volume: '/var/lib/mysql',
    envKey: 'DATABASE_URL', connection: 'mysql://${USER}:${PASSWORD}@${HOST}:${PORT}/${DB_NAME}',
    env: {
      MYSQL_DATABASE: '${DB_NAME}',
      MYSQL_ROOT_PASSWORD: '${PASSWORD}',
    },
    command: [],
    health: {
      cmd: ['sh', '-c', 'mysqladmin ping -h 127.0.0.1 -uroot -p"$MYSQL_ROOT_PASSWORD" --silent'],
    },
    fields: [
      { key: 'DB_NAME', label: '初始库名', type: 'text', default: 'app', required: true },
    ],
    defaults: { USER: 'root' },
    backup: 'mysqldump', restore: 'mysql', backupFile: '/tmp/dp-backup.sql',
  },
  {
    id: 'pgsql', label: 'PostgreSQL', kind: 'database', icon: 'DB',
    description: '关系型数据库 · 官方镜像 · 自动建初始库与用户',
    image: 'postgres', tags: ['16', '15', '14'], defaultTag: '16',
    port: 5432, internalPort: 5432, volume: '/var/lib/postgresql/data',
    envKey: 'DATABASE_URL', connection: 'postgresql://${USER}:${PASSWORD}@${HOST}:${PORT}/${DB_NAME}',
    env: {
      POSTGRES_DB: '${DB_NAME}',
      POSTGRES_USER: '${USER}',
      POSTGRES_PASSWORD: '${PASSWORD}',
    },
    command: [],
    health: {
      cmd: ['sh', '-c', 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'],
    },
    fields: [
      { key: 'USER', label: '初始用户', type: 'text', default: 'app', required: true },
      { key: 'DB_NAME', label: '初始库名', type: 'text', default: 'app', required: true },
    ],
    defaults: {},
    backup: 'pgdump', restore: 'psql', backupFile: '/tmp/dp-backup.sql',
  },
  {
    id: 'redis', label: 'Redis', kind: 'cache', icon: 'KV',
    description: '缓存 / 队列 · 官方镜像 · 开启 AOF 持久化与密码',
    image: 'redis', tags: ['7.4', '7.2', '6.2'], defaultTag: '7.4',
    port: 6379, internalPort: 6379, volume: '/data',
    envKey: 'REDIS_URL', connection: 'redis://:${PASSWORD}@${HOST}:${PORT}/0',
    env: { DP_PASSWORD: '${PASSWORD}' },
    // Cmd 是数组，不做 shell 展开；此处由平台替换白名单变量后直接传给 Docker API。
    command: ['redis-server', '--appendonly', 'yes', '--requirepass', '${PASSWORD}'],
    health: {
      cmd: ['sh', '-c', '[ "$(redis-cli -a "$DP_PASSWORD" ping 2>/dev/null)" = PONG ]'],
    },
    fields: [],
    defaults: { USER: 'default' },
    backup: 'redis-rdb', restore: 'redis-rdb', backupFile: '/data/dp-backup.rdb',
  },
  {
    // 工具型清单：安装后由平台把所有实例的连接自动写成 CONNECTIONS 环境变量，
    // 用户打开页面就能看到 MySQL / PgSQL / Redis，无需逐个手工录入。
    id: 'dbgate', label: 'DbGate 数据库管理', kind: 'tool', icon: 'SQL',
    description: 'GPL-3.0 开源多数据库 Web 客户端：SQL + NoSQL 一个界面，自动同步平台实例连接',
    image: 'dbgate/dbgate', tags: ['latest'], defaultTag: 'latest',
    port: 3000, internalPort: 3000, volume: '/root/.dbgate',
    envKey: 'DBGATE_URL', connection: 'http://${HOST}:${PORT}/',
    // v0.3.11：DbGate 登录页要「账号 + 密码」。以前 LOGIN 硬编码成 admin、安装表单也没有账号栏，
    // 现在账号可在安装时填写并写进容器 LOGIN 环境变量（旧实例仍回退到 admin）。
    env: { LOGIN: '${USER}', PASSWORD: '${PASSWORD}', LANGUAGE: 'zh' },
    command: [], health: {},
    fields: [
      {
        key: 'USER', label: '登录账号', type: 'text', default: 'admin', required: true,
        placeholder: 'admin', help: 'DbGate 登录页需要账号 + 密码；账号写入容器的 LOGIN 环境变量',
      },
    ],
    defaults: { USER: 'admin' },
    dynamicEnv: 'dbgate-connections', openable: true,
  },
];

/** 备份 / 恢复只接受这些内置模板 id，命令实现在 backup.js，清单里不写 shell。 */
const BACKUP_RECIPES = ['mysqldump', 'pgdump', 'redis-rdb'];
const RESTORE_RECIPES = ['mysql', 'psql', 'redis-rdb'];
const DYNAMIC_ENV = ['', 'dbgate-connections'];

const TEMPLATE_RE = /\$\{([A-Z_]+)\}/g;

function assertTemplate(value, where) {
  const keys = [...String(value).matchAll(TEMPLATE_RE)].map((m) => m[1]);
  const bad = keys.filter((k) => !TEMPLATE_KEYS.includes(k));
  if (bad.length) throw new Error(`${where} 使用了未知变量：${bad.join(', ')}`);
  if (String(value).includes('`') || String(value).includes('\n')) {
    throw new Error(`${where} 不允许反引号或换行`);
  }
}

/** 校验并归一化一份清单；自定义 json 与内置清单走同一套规则。 */
function validateManifest(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('清单必须是 JSON 对象');
  const m = JSON.parse(JSON.stringify(raw));
  if (!/^[a-z][a-z0-9-]{1,31}$/.test(String(m.id || ''))) throw new Error('清单 id 必须是小写字母开头的 2~32 位标识');
  if (!m.label || String(m.label).length > 40) throw new Error(`${m.id}: label 缺失或过长`);
  if (!/^[a-z0-9][a-z0-9._/-]{0,79}$/i.test(String(m.image || ''))) throw new Error(`${m.id}: image 不合法`);
  const tags = Array.isArray(m.tags) && m.tags.length ? m.tags.map(String) : [m.defaultTag || 'latest'];
  for (const tag of tags) if (!/^[A-Za-z0-9._-]{1,40}$/.test(tag)) throw new Error(`${m.id}: tag 不合法 ${tag}`);
  m.tags = tags;
  m.defaultTag = String(m.defaultTag || tags[0]);
  if (!tags.includes(m.defaultTag)) throw new Error(`${m.id}: defaultTag 不在 tags 里`);

  m.port = Number(m.port);
  m.internalPort = Number(m.internalPort || m.port);
  if (![m.port, m.internalPort].every((p) => Number.isInteger(p) && p > 0 && p < 65536)) {
    throw new Error(`${m.id}: 端口必须是 1~65535 的整数`);
  }
  if (m.volume && !String(m.volume).startsWith('/')) throw new Error(`${m.id}: volume 必须是容器内绝对路径`);
  if (!m.envKey || !/^[A-Z][A-Z0-9_]{1,39}$/.test(m.envKey)) throw new Error(`${m.id}: envKey 不合法`);
  if (!m.connection) throw new Error(`${m.id}: 缺少 connection 模板`);
  assertTemplate(m.connection, `${m.id}.connection`);

  m.env = m.env && typeof m.env === 'object' ? m.env : {};
  for (const [key, value] of Object.entries(m.env)) {
    if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(key)) throw new Error(`${m.id}: 环境变量名不合法 ${key}`);
    assertTemplate(value, `${m.id}.env.${key}`);
  }
  m.command = Array.isArray(m.command) ? m.command : [];
  if (m.command.length > 16) throw new Error(`${m.id}: command 过长`);
  for (const part of m.command) {
    if (typeof part !== 'string' || part.includes('\n')) throw new Error(`${m.id}: command 必须是单行字符串数组`);
    assertTemplate(part, `${m.id}.command`);
  }
  m.fields = Array.isArray(m.fields) ? m.fields : [];
  const fieldKeys = new Set();
  for (const f of m.fields) {
    if (!f || !/^[A-Z][A-Z0-9_]{0,31}$/.test(String(f.key || ''))) throw new Error(`${m.id}: 表单字段 key 不合法`);
    if (fieldKeys.has(f.key)) throw new Error(`${m.id}: 表单字段重复 ${f.key}`);
    fieldKeys.add(f.key);
    if (!['text', 'number', 'password'].includes(f.type || 'text')) throw new Error(`${m.id}: 表单字段类型不合法`);
  }
  m.health = m.health && typeof m.health === 'object' ? m.health : {};
  m.health.cmd = Array.isArray(m.health.cmd) ? m.health.cmd : [];
  if (m.health.cmd.length > 16) throw new Error(`${m.id}: health.cmd 过长`);
  for (const part of m.health.cmd) {
    if (typeof part !== 'string' || part.includes('\n')) throw new Error(`${m.id}: health.cmd 必须是单行字符串数组`);
  }
  m.defaults = m.defaults && typeof m.defaults === 'object' ? m.defaults : {};
  m.kind = ['database', 'cache', 'queue', 'storage', 'tool', 'custom'].includes(m.kind) ? m.kind : 'custom';
  m.description = String(m.description || '').slice(0, 120);
  m.icon = String(m.icon || 'EXT').slice(0, 4);

  // 备份 / 恢复 / 动态环境变量 / 可打开界面：全部是白名单枚举，不接受任意命令或脚本。
  m.backup = BACKUP_RECIPES.includes(m.backup) ? m.backup : '';
  m.restore = RESTORE_RECIPES.includes(m.restore) ? m.restore : '';
  m.backupFile = /^\/[A-Za-z0-9._/-]{1,120}$/.test(String(m.backupFile || '')) ? m.backupFile : '';
  if (m.backup && !m.backupFile) throw new Error(`${m.id}: 声明 backup 时必须提供容器内绝对路径 backupFile`);
  m.dynamicEnv = DYNAMIC_ENV.includes(m.dynamicEnv) ? m.dynamicEnv : '';
  m.openable = m.openable === true;
  return m;
}

/** 渲染模板：只替换白名单变量，未知变量原样保留，便于排错。 */
function renderTemplate(template, vars) {
  return String(template).replace(TEMPLATE_RE, (all, key) => (
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : all
  ));
}

/** 组装某个清单的安装表单（docker 与 external 两种模式字段不同）。 */
function formFields(manifest, mode) {
  const fields = [{ ...COMMON_FIELDS[0] }]; // NAME
  if (mode === 'external') {
    fields.push({ ...EXTERNAL_HOST_FIELD });
    fields.push({ ...COMMON_FIELDS[2], default: manifest.port }); // PORT
    if (manifest.connection.includes('${USER}')) {
      fields.push({
        key: 'USER', label: '用户名', type: 'text', required: false,
        default: manifest.defaults.USER || '', placeholder: manifest.defaults.USER || '',
      });
    }
    fields.push({
      ...COMMON_FIELDS[3], label: '密码（可留空）', required: false,
      help: '只用于生成连接串，平台不会连接或修改外部服务',
    });
    const declared = new Set(fields.map((f) => f.key));
    for (const f of manifest.fields) if (!declared.has(f.key)) fields.push({ ...f });
  } else {
    fields.push({ ...COMMON_FIELDS[1], options: manifest.tags, default: manifest.defaultTag }); // TAG
    fields.push({ ...COMMON_FIELDS[2], default: manifest.port }); // PORT
    fields.push({ ...COMMON_FIELDS[3] }); // PASSWORD
    for (const f of manifest.fields) fields.push({ ...f });
    fields.push({ ...TARGET_FIELD, options: TARGET_FIELD.options.map((o) => ({ ...o })) });
  }
  return fields;
}

function builtinCatalog() {
  return BUILTIN.map((m) => validateManifest(m));
}

module.exports = {
  BUILTIN, COMMON_FIELDS, EXTERNAL_HOST_FIELD, TARGET_FIELD, TEMPLATE_KEYS,
  BACKUP_RECIPES, RESTORE_RECIPES, DYNAMIC_ENV,
  validateManifest, renderTemplate, formFields, builtinCatalog,
};
