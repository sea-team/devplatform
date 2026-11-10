'use strict';

/**
 * DbGate 连接自动同步。
 *
 * DbGate 官方镜像支持用环境变量预置连接：
 *   CONNECTIONS=con1,con2
 *   LABEL_con1 / ENGINE_con1 / SERVER_con1 / USER_con1 / PASSWORD_con1 / PORT_con1 / DATABASE_con1
 * 平台把所有非 dbgate 的实例翻译成这组变量，安装/增删/升级实例后重建 DbGate 容器即可生效，
 * 用户打开页面就能看到全部数据库，无需手工录入连接。
 *
 * 本模块只依赖 core + catalog，不反向依赖 extensions / extRuntime，避免循环引用。
 */
const { state } = require('./core');

const ENGINES = {
  mysql: 'mysql@dbgate-plugin-mysql',
  pgsql: 'postgres@dbgate-plugin-postgres',
  redis: 'redis@dbgate-plugin-redis',
  mongo: 'mongo@dbgate-plugin-mongo',
  mariadb: 'mysql@dbgate-plugin-mysql',
  postgres: 'postgres@dbgate-plugin-postgres',
};

function dbGateInstance() {
  return (state().extensions || []).find((x) => x.catalogId === 'dbgate' && x.mode === 'docker');
}

/** 返回追加到容器 Env 的字符串数组（KEY=VALUE），密码只在这里以明文进入容器环境。 */
function connectionsEnv() {
  const items = (state().extensions || []).filter((x) => x.catalogId !== 'dbgate' && ENGINES[x.catalogId]);
  const env = [];
  if (!items.length) return { env, count: 0, ids: [] };
  const ids = items.map((_, i) => `c${i + 1}`);
  env.push(`CONNECTIONS=${ids.join(',')}`);
  items.forEach((inst, i) => {
    const id = ids[i];
    const label = `${inst.label || inst.catalogId} · ${inst.name}`;
    env.push(`LABEL_${id}=${label}`);
    env.push(`ENGINE_${id}=${ENGINES[inst.catalogId]}`);
    env.push(`SERVER_${id}=${inst.host}`);
    env.push(`PORT_${id}=${inst.port}`);
    if (inst.user) env.push(`USER_${id}=${inst.user}`);
    if (inst.secrets && inst.secrets.PASSWORD) env.push(`PASSWORD_${id}=${inst.secrets.PASSWORD}`);
    if (inst.dbName) env.push(`DATABASE_${id}=${inst.dbName}`);
    if (inst.catalogId === 'redis') env.push(`URL_${id}=redis://:${encodeURIComponent(inst.secrets.PASSWORD || '')}@${inst.host}:${inst.port}/0`);
  });
  return { env, count: items.length, ids };
}

module.exports = { ENGINES, dbGateInstance, connectionsEnv };
