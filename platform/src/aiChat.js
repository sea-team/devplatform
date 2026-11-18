'use strict';

/**
 * AI 会话（v0.4.10）：DeepSeek Harness 驱动的会话式对话。
 *
 * 与「AI 运维」(aiSessions + opsAgent) 完全独立、两页并存：
 *   - aiSessions：平台运维助手，先采集平台上下文再提问，支持服务器范围 / 写授权 / 附件；
 *   - aiChat：会话式编码助手，dsh 在工作区里多步执行，text / 轨迹结构化回显。
 *
 * 会话持久化在 state.aiChats，按 ownerId 隔离。消息落库完整文本与轨迹；
 * 引擎（dshSessionId）与引擎会话 sid 一并持久化，刷新页面后可用 open() 续接上下文。
 */
const { state, update, uid, HttpError, badRequest, notFound } = require('./core');
const dshTerminal = require('./dshTerminal');

const MAX_CHATS_PER_USER = 60;
const MAX_MESSAGES = 200;
const MAX_CONTENT = 200 * 1024;
const TITLE_MAX = 48;

const now = () => new Date().toISOString();
const chats = () => (Array.isArray(state().aiChats) ? state().aiChats : []);
const isAdmin = (user) => Boolean(user && user.role === 'admin');
function deny() { throw new HttpError(403, '无权访问该会话：只能操作自己创建的会话'); }

function findById(id) {
  return chats().find((s) => s && s.id === id) || null;
}

function owned(user, id, write = false) {
  const session = findById(String(id || ''));
  if (!session) throw notFound('会话不存在或已被删除');
  if (isAdmin(user)) return session;
  if (session.ownerId && session.ownerId === user.id) return session;
  if (write && !session.ownerId) deny();
  if (!session.ownerId) deny();
  return session;
}

function previewOf(session) {
  const last = [...(session.messages || [])].reverse().find((m) => m && m.role === 'user' && m.content);
  return last ? String(last.content).replace(/\s+/g, ' ').slice(0, 80) : '';
}

function summary(session) {
  return {
    id: session.id,
    title: session.title || '新会话',
    ownerId: session.ownerId || '',
    providerId: session.providerId || '',
    model: session.model || '',
    messageCount: (session.messages || []).length,
    preview: previewOf(session),
    stats: session.stats || { turns: 0, steps: 0 },
    createdAt: session.createdAt || '',
    updatedAt: session.updatedAt || '',
  };
}

function list(user) {
  return chats()
    .filter((s) => isAdmin(user) || (s.ownerId && s.ownerId === user.id))
    // 隐藏 0 条消息且标题仍是「新会话」的历史空记录。
    .filter((s) => (s.messages || []).length > 0 || (s.title || '新会话') !== '新会话')
    .slice()
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .map(summary);
}

function create(user, body = {}) {
  const own = chats().filter((s) => s.ownerId === user.id);
  if (own.length >= MAX_CHATS_PER_USER) {
    throw badRequest(`每个账号最多保留 ${MAX_CHATS_PER_USER} 个会话，请先删除旧会话`);
  }
  const session = {
    id: uid('ach'),
    ownerId: user.id,
    title: String((body && body.title) || '新会话').slice(0, TITLE_MAX),
    providerId: String((body && body.providerId) || ''),
    model: String((body && body.model) || ''),
    engineSid: '',
    dshSessionId: '',
    messages: [],
    stats: { turns: 0, steps: 0, tokens: 0 },
    createdAt: now(),
    updatedAt: now(),
  };
  update((s) => {
    if (!Array.isArray(s.aiChats)) s.aiChats = [];
    s.aiChats.push(session);
  });
  return summary(session);
}

function detail(user, id) {
  const session = owned(user, id);
  return {
    ...summary(session),
    messages: Array.isArray(session.messages) ? session.messages : [],
  };
}

function modify(user, id, body = {}) {
  owned(user, id, true);
  update((s) => {
    const target = (s.aiChats || []).find((x) => x && x.id === id);
    if (!target) return;
    if (body.title !== undefined) target.title = String(body.title).slice(0, TITLE_MAX) || '新会话';
    if (body.providerId !== undefined) target.providerId = String(body.providerId || '');
    if (body.model !== undefined) target.model = String(body.model || '');
    target.updatedAt = now();
  });
  return detail(user, id);
}

function remove(user, id) {
  owned(user, id, true);
  const session = findById(String(id));
  // 关闭底层引擎会话（持久会话的目录由 dshTerminal 保留，删除会话数据时一并清理）。
  if (session && session.engineSid) {
    try { dshTerminal.close(String(session.engineSid), user); } catch { /* noop */ }
  }
  update((s) => { s.aiChats = (s.aiChats || []).filter((x) => !x || x.id !== id); });
  return { deleted: id };
}

function clearMessages(user, id) {
  owned(user, id, true);
  const session = findById(String(id));
  update((s) => {
    const target = (s.aiChats || []).find((x) => x && x.id === id);
    if (!target) return;
    target.messages = [];
    target.stats = { turns: 0, steps: 0, tokens: 0 };
    target.updatedAt = now();
  });
  // 清空消息后重建引擎，彻底丢弃上下文（dshSessionId 置空）。
  if (session && session.engineSid) {
    try { dshTerminal.close(String(session.engineSid), user); } catch { /* noop */ }
  }
  update((s) => {
    const target = (s.aiChats || []).find((x) => x && x.id === id);
    if (target) { target.engineSid = ''; target.dshSessionId = ''; }
  });
  return detail(user, id);
}

/**
 * 打开/续接会话的引擎。首次或引擎已失效时用 openSession(persistent) 新建，
 * 并持久化 engineSid；已有则复用。返回引擎 sid 与模型信息。
 */
async function openEngine(stateObj, user, id, providerOverride = '', modelOverride = '') {
  const session = owned(user, id, true);
  let engineSid = String(session.engineSid || '');
  let info = null;
  if (engineSid) {
    try { info = dshTerminal.sessionInfo(engineSid, user); } catch { info = null; }
  }
  if (!info) {
    const providerId = String(providerOverride || session.providerId || '');
    const opened = await dshTerminal.openSession(stateObj, providerId, user, {
      persistent: true,
      chatId: id,
      dshSessionId: session.dshSessionId || '',
      model: modelOverride || session.model || '',
    });
    engineSid = opened.sid;
    update((s) => {
      const target = (s.aiChats || []).find((x) => x && x.id === id);
      if (!target) return;
      target.engineSid = engineSid;
      target.providerId = opened.provider.id;
      target.model = opened.provider.model;
      target.updatedAt = now();
    });
    info = dshTerminal.sessionInfo(engineSid, user);
  }
  return { engineSid, info };
}

/** 打开会话：确保引擎就绪，返回详情 + 引擎 sid，供前端订阅事件流。 */
async function open(stateObj, user, id, providerOverride = '', modelOverride = '') {
  const detailData = detail(user, id);
  const providerId = String(providerOverride || detailData.providerId || '');
  const model = String(modelOverride || '');
  // 切换了 AI 服务 / 模型时，重建引擎以应用新配置。
  if ((providerId && providerId !== detailData.providerId) || (model && model !== detailData.model)) {
    const cur = findById(String(id));
    if (cur && cur.engineSid) { try { dshTerminal.close(String(cur.engineSid), user); } catch { /* noop */ } }
    update((s) => {
      const target = (s.aiChats || []).find((x) => x && x.id === id);
      if (target) {
        target.engineSid = ''; target.dshSessionId = '';
        if (providerId) target.providerId = providerId;
        if (model) target.model = model;
      }
    });
  }
  const engine = await openEngine(stateObj, user, id, providerOverride, model);
  const fresh = detail(user, id);
  return { ...fresh, engineSid: engine.engineSid, providerId: engine.info.providerId, model: engine.info.model };
}

/**
 * 发送消息：落库用户消息 -> 提交给 dsh 引擎 -> 完成后续接结果落库。
 * 实时增量由前端订阅 /api/ai/chat/stream 获取；这里负责持久化完整文本与轨迹。
 */
async function send(stateObj, user, id, body = {}) {
  const content = String((body && body.content) || '').trim();
  if (!content) throw badRequest('请输入内容');
  if (content.length > MAX_CONTENT) throw badRequest('内容过长');
  owned(user, id, true);

  const current = findById(String(id));
  const engine = await openEngine(stateObj, user, id, '', String((current && current.model) || ''));
  const userMessage = { id: uid('msg'), role: 'user', content, at: now() };
  update((s) => {
    const target = (s.aiChats || []).find((x) => x && x.id === id);
    if (!target) return;
    if (!Array.isArray(target.messages)) target.messages = [];
    target.messages.push(userMessage);
    if (target.messages.length > MAX_MESSAGES) target.messages = target.messages.slice(-MAX_MESSAGES);
    if ((target.title || '新会话') === '新会话') {
      target.title = content.replace(/\s+/g, ' ').slice(0, TITLE_MAX);
    }
    target.updatedAt = now();
  });

  const submitted = dshTerminal.submitWithEvents(stateObj, engine.engineSid, content, user);
  if (!submitted.accepted) {
    const reason = submitted.reason === 'busy' ? '上一条任务尚未完成，请稍候或先中断' : '提交失败：AI 服务配置无效';
    throw badRequest(reason);
  }

  const result = await submitted.promise;
  const lr = (result && result.lastResult) || {};
  const steps = Array.isArray(lr.trace) ? lr.trace.filter((t) => t && t.phase === 'step_start').length : 0;
  const assistant = {
    id: uid('msg'), role: 'assistant',
    content: String(lr.text || '').trim() || (lr.errored ? '' : '（无文本输出）'),
    trace: Array.isArray(lr.trace) ? lr.trace : [],
    error: lr.errored ? String(lr.error || '执行失败') : '',
    model: result.model || '',
    status: result.status || '',
    at: now(),
  };
  update((s) => {
    const target = (s.aiChats || []).find((x) => x && x.id === id);
    if (!target) return;
    if (!Array.isArray(target.messages)) target.messages = [];
    target.messages.push(assistant);
    if (target.messages.length > MAX_MESSAGES) target.messages = target.messages.slice(-MAX_MESSAGES);
    target.dshSessionId = (result && result.dshSessionId) || target.dshSessionId || '';
    target.stats = {
      turns: (result && result.turns) || (target.stats && target.stats.turns) || 0,
      steps: steps || (target.stats && target.stats.steps) || 0,
      tokens: (target.stats && target.stats.tokens) || 0,
    };
    target.updatedAt = now();
  });

  return {
    session: summary(findById(String(id)) || {}),
    userMessage,
    assistantMessage: assistant,
  };
}

async function interrupt(user, id) {
  const session = owned(user, id, true);
  if (!session.engineSid) return { interrupted: false };
  return dshTerminal.interrupt(String(session.engineSid), user);
}

module.exports = {
  list, create, detail, modify, remove, clearMessages, open, send, interrupt,
};
