'use strict';

/**
 * AI 运维对话会话（v0.4.3）。
 *
 * 与登录会话 sessions 完全独立，落在 state.aiSessions：
 *   - 按 ownerId 隔离：普通用户只看得到自己的会话，管理员可查看全部；
 *   - 消息（含附件与工具调用轨迹）持久化，刷新 / 换设备后可恢复继续对话；
 *   - 支持人工删除会话、清空消息后复用会话。
 *
 * 注意：aiSessions 刻意不加入 OWNED_COLLECTIONS —— 它不属于「资源协作」可授权的对象，
 * 因此不依赖 guard() / filterResponse() 的自动隔离，本模块对每个入口显式校验 owner。
 */
const { state, update, uid, HttpError, badRequest, notFound } = require('./core');
const { opsAgent } = require('./engine');

const MAX_SESSIONS_PER_USER = 60;
const MAX_MESSAGES = 160;
const MAX_ATTACHMENTS = 6;
const MAX_ATTACHMENT_CHARS = 4 * 1024 * 1024;   // 单个附件 dataURL / 文本上限
const MAX_TOTAL_ATTACHMENT_CHARS = 16 * 1024 * 1024;
const TITLE_MAX = 48;

const now = () => new Date().toISOString();
const sessions = () => (Array.isArray(state().aiSessions) ? state().aiSessions : []);
const isAdmin = (user) => Boolean(user && user.role === 'admin');

function deny() { throw new HttpError(403, '无权访问该会话：只能操作自己创建的对话'); }

function findById(id) {
  return sessions().find((s) => s && s.id === id) || null;
}

/** 取会话并校验归属；write=true 时要求 owner 或管理员（管理员不改他人会话内容）。 */
function owned(user, id, write = false) {
  const session = findById(id);
  if (!session) throw notFound('会话不存在或已被删除');
  if (isAdmin(user)) return session;
  if (session.ownerId && session.ownerId === user.id) return session;
  // 历史会话没有 ownerId（升级前遗留）：仅管理员可接管，普通用户不可见。
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
    allowWrite: Boolean(session.allowWrite),
    messageCount: (session.messages || []).length,
    preview: previewOf(session),
    createdAt: session.createdAt || '',
    updatedAt: session.updatedAt || '',
  };
}

/** 列出当前账号可见的会话摘要（不含消息正文，避免列表接口传输附件）。 */
function list(user) {
  const all = sessions().filter((s) => isAdmin(user) || (s.ownerId && s.ownerId === user.id));
  return all
    .slice()
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .map(summary);
}

function create(user, body = {}) {
  const own = sessions().filter((s) => s.ownerId === user.id);
  if (own.length >= MAX_SESSIONS_PER_USER) {
    throw badRequest(`每个账号最多保留 ${MAX_SESSIONS_PER_USER} 个会话，请先删除旧会话`);
  }
  const session = {
    id: uid('ais'),
    ownerId: user.id,
    title: String((body && body.title) || '新会话').slice(0, TITLE_MAX),
    providerId: String((body && body.providerId) || ''),
    allowWrite: Boolean(body && body.allowWrite),
    messages: [],
    createdAt: now(),
    updatedAt: now(),
  };
  update((s) => {
    if (!Array.isArray(s.aiSessions)) s.aiSessions = [];
    s.aiSessions.push(session);
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
    const target = (s.aiSessions || []).find((x) => x && x.id === id);
    if (!target) return;
    if (body.title !== undefined) target.title = String(body.title).slice(0, TITLE_MAX) || '新会话';
    if (body.providerId !== undefined) target.providerId = String(body.providerId || '');
    if (body.allowWrite !== undefined) target.allowWrite = Boolean(body.allowWrite);
    target.updatedAt = now();
  });
  return detail(user, id);
}

function remove(user, id) {
  owned(user, id, true);
  update((s) => { s.aiSessions = (s.aiSessions || []).filter((x) => !x || x.id !== id); });
  return { deleted: id };
}

function clearMessages(user, id) {
  owned(user, id, true);
  update((s) => {
    const target = (s.aiSessions || []).find((x) => x && x.id === id);
    if (!target) return;
    target.messages = [];
    target.updatedAt = now();
  });
  return detail(user, id);
}

function normalizeAttachments(input) {
  if (!Array.isArray(input)) return [];
  if (input.length > MAX_ATTACHMENTS) throw badRequest(`每条消息最多附带 ${MAX_ATTACHMENTS} 个文件`);
  let total = 0;
  const list = input.map((a) => {
    const data = String((a && a.data) || '');
    if (data.length > MAX_ATTACHMENT_CHARS) throw badRequest(`附件「${(a && a.name) || ''}」过大，单个上限约 3MB`);
    total += data.length;
    return {
      name: String((a && a.name) || 'file').slice(0, 200),
      mime: String((a && a.mime) || '').slice(0, 120),
      size: Number(a && a.size) || 0,
      kind: (a && a.kind) === 'image' ? 'image' : 'text',
      data,
    };
  });
  if (total > MAX_TOTAL_ATTACHMENT_CHARS) throw badRequest('附件总大小超出限制，请减少文件数量');
  return list;
}

/**
 * 发送一条消息：先落库用户消息（保证失败也有记录），再调用 opsAgent，
 * 最后把 AI 结论 + 工具调用轨迹作为助手消息落库。
 */
async function send(user, id, body = {}) {
  const session = owned(user, id, true);
  const content = String((body && body.content) || '').trim();
  const files = normalizeAttachments(body && body.attachments);
  if (!content && !files.length) throw badRequest('请输入内容或附加文件');

  const providerId = String((body && body.providerId) || session.providerId || '');
  const allowWrite = body && body.allowWrite !== undefined
    ? Boolean(body.allowWrite) : Boolean(session.allowWrite);
  const userMessage = {
    id: uid('msg'), role: 'user', content,
    attachments: files, trace: [], at: now(),
  };

  // session 是 state 内的同一对象引用，必须在 push 之前取历史快照，
  // 否则当前这条用户消息会被重复算进 history。
  const history = (session.messages || [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.content)
    .map((m) => ({ role: m.role, content: m.content }));

  update((s) => {
    const target = (s.aiSessions || []).find((x) => x && x.id === id);
    if (!target) return;
    if (!Array.isArray(target.messages)) target.messages = [];
    target.messages.push(userMessage);
    if (target.messages.length > MAX_MESSAGES) target.messages = target.messages.slice(-MAX_MESSAGES);
    if ((target.title || '新会话') === '新会话' && content) {
      target.title = content.replace(/\s+/g, ' ').slice(0, TITLE_MAX);
    }
    target.providerId = providerId;
    target.allowWrite = allowWrite;
    target.updatedAt = now();
  });

  let assistant;
  try {
    const result = await opsAgent({ providerId, prompt: content, allowWrite, history, attachments: files });
    assistant = {
      id: uid('msg'), role: 'assistant',
      content: result.answer || '（无文本结论）',
      trace: Array.isArray(result.trace) ? result.trace : [],
      provider: result.provider || '', model: result.model || '',
      mode: result.mode || '', attachmentMode: result.attachmentMode || 'none',
      at: now(),
    };
  } catch (e) {
    assistant = {
      id: uid('msg'), role: 'assistant', content: '',
      trace: [], error: String((e && e.message) || e), at: now(),
    };
  }

  update((s) => {
    const target = (s.aiSessions || []).find((x) => x && x.id === id);
    if (!target) return;
    if (!Array.isArray(target.messages)) target.messages = [];
    target.messages.push(assistant);
    if (target.messages.length > MAX_MESSAGES) target.messages = target.messages.slice(-MAX_MESSAGES);
    target.updatedAt = now();
  });

  return { session: summary(findById(id) || {}), userMessage, assistantMessage: assistant };
}

module.exports = {
  list, create, detail, modify, remove, clearMessages, send,
  MAX_ATTACHMENTS, MAX_ATTACHMENT_CHARS,
};
