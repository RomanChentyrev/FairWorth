const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../db/database');
const { validate } = require('../middleware/validate');
const { aiConversationSchema, aiMessageSchema, aiToolResultSchema, aiEventSchema } = require('../config/apiSchemas');
const { planMessage, redactSensitiveText } = require('../services/aiModeOrchestrator');
const monitoring = require('../services/monitoring');
const { aiLimiter } = require('../middleware/security');

const router = express.Router();

function json(value, fallback) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(value || JSON.stringify(fallback)); } catch { return fallback; }
}

function serializeConversation(row) {
  return {
    ...row,
    search_context: json(row.search_context, {}),
    selected_entities: json(row.selected_entities, []),
  };
}

function serializeMessage(row) {
  return { ...row, metadata: json(row.metadata, {}) };
}

async function ownedConversation(id, userId) {
  return db.prepare('SELECT * FROM ai_conversations WHERE id = ? AND user_id = ?').get(id, userId);
}

async function recordEvent(userId, conversationId, eventType, properties = {}) {
  await db.prepare(`INSERT INTO ai_mode_events (id, user_id, conversation_id, event_type, properties) VALUES (?, ?, ?, ?, ?)`)
    .run(uuidv4(), userId, conversationId || null, eventType, JSON.stringify(properties));
}

router.get('/conversations', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
    const rows = await db.prepare(`
      SELECT c.*, (SELECT COUNT(*) FROM ai_messages m WHERE m.conversation_id = c.id) AS message_count
      FROM ai_conversations c WHERE c.user_id = ? ORDER BY c.updated_at DESC LIMIT ?
    `).all(req.user.id, limit);
    res.json({ conversations: rows.map(serializeConversation) });
  } catch (error) { next(error); }
});

router.post('/conversations', validate(aiConversationSchema), async (req, res, next) => {
  try {
    const id = uuidv4();
    await db.prepare(`INSERT INTO ai_conversations (id, user_id, title) VALUES (?, ?, ?)`)
      .run(id, req.user.id, req.body.title || 'New trip');
    await recordEvent(req.user.id, id, 'ai_mode_open', { language: req.body.language });
    res.status(201).json({ conversation: serializeConversation(await ownedConversation(id, req.user.id)) });
  } catch (error) { next(error); }
});

router.post('/events', validate(aiEventSchema), async (req, res, next) => {
  try {
    if (req.body.conversation_id && !await ownedConversation(req.body.conversation_id, req.user.id)) {
      return res.status(404).json({ error: 'Conversation not found', code: 'NOT_FOUND' });
    }
    await recordEvent(req.user.id, req.body.conversation_id, req.body.event_type, req.body.properties);
    res.status(201).json({ recorded: true });
  } catch (error) { next(error); }
});

router.get('/conversations/:id', async (req, res, next) => {
  try {
    const conversation = await ownedConversation(req.params.id, req.user.id);
    if (!conversation) return res.status(404).json({ error: 'Conversation not found', code: 'NOT_FOUND' });
    const messages = await db.prepare(`SELECT * FROM ai_messages WHERE conversation_id = ? AND user_id = ? ORDER BY created_at ASC`)
      .all(req.params.id, req.user.id);
    res.json({ conversation: serializeConversation(conversation), messages: messages.map(serializeMessage) });
  } catch (error) { next(error); }
});

router.delete('/conversations/:id', async (req, res, next) => {
  try {
    const result = await db.prepare('DELETE FROM ai_conversations WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    if (!result.rowCount) return res.status(404).json({ error: 'Conversation not found', code: 'NOT_FOUND' });
    res.status(204).end();
  } catch (error) { next(error); }
});

router.post('/conversations/:id/messages', aiLimiter, validate(aiMessageSchema), async (req, res, next) => {
  try {
    const conversation = await ownedConversation(req.params.id, req.user.id);
    if (!conversation) return res.status(404).json({ error: 'Conversation not found', code: 'NOT_FOUND' });
    const content = redactSensitiveText(req.body.content);
    const userMessageId = uuidv4();
    await db.prepare(`INSERT INTO ai_messages (id, conversation_id, user_id, role, content) VALUES (?, ?, ?, 'user', ?)`)
      .run(userMessageId, conversation.id, req.user.id, content);

    const [preferences, recentMessages] = await Promise.all([
      db.prepare('SELECT * FROM user_preferences WHERE user_id = ?').get(req.user.id),
      db.prepare(`SELECT role, content FROM ai_messages WHERE conversation_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 10`)
        .all(conversation.id, req.user.id),
    ]);
    const started = Date.now();
    const plan = await planMessage({
      message: content,
      language: req.body.language,
      currentContext: json(conversation.search_context, {}),
      recentMessages: recentMessages.reverse(),
      preferences: preferences || {},
      previousIntent: conversation.intent,
    });
    const assistantMessageId = uuidv4();
    const metadata = {
      intent: plan.intent,
      action: plan.action,
      missing_fields: plan.missing_fields,
      used_profile_fields: plan.used_profile_fields,
      fallback: plan.fallback,
    };
    await db.transaction(async () => {
      await db.prepare(`INSERT INTO ai_messages (id, conversation_id, user_id, role, content, metadata) VALUES (?, ?, ?, 'assistant', ?, ?)`)
        .run(assistantMessageId, conversation.id, req.user.id, plan.reply, JSON.stringify(metadata));
      const messageCount = await db.prepare('SELECT COUNT(*) AS count FROM ai_messages WHERE conversation_id = ?').get(conversation.id);
      const title = Number(messageCount?.count) <= 2 ? content.slice(0, 80) : conversation.title;
      await db.prepare(`UPDATE ai_conversations SET title = ?, intent = ?, search_context = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?`)
        .run(title, plan.intent, JSON.stringify(plan.context), conversation.id, req.user.id);
      await recordEvent(req.user.id, conversation.id, 'ai_message_sent', { intent: plan.intent, length: content.length, latency_ms: Date.now() - started, fallback: plan.fallback });
      if (plan.action.type !== 'none') await recordEvent(req.user.id, conversation.id, 'ai_tool_called', { tool: plan.action.type, status: 'requested' });
      if (plan.fallback) await recordEvent(req.user.id, conversation.id, 'ai_fallback', { reason: plan.error || 'planner_fallback' });
    });
    res.json({
      user_message: { id: userMessageId, role: 'user', content },
      assistant_message: { id: assistantMessageId, role: 'assistant', content: plan.reply, metadata },
      conversation: serializeConversation(await ownedConversation(conversation.id, req.user.id)),
      action: plan.action,
    });
  } catch (error) {
    monitoring.captureProviderDegradation('OpenRouter', error, { operation: 'ai_mode_plan' });
    next(error);
  }
});

router.post('/conversations/:id/tool-results', validate(aiToolResultSchema), async (req, res, next) => {
  try {
    const conversation = await ownedConversation(req.params.id, req.user.id);
    if (!conversation) return res.status(404).json({ error: 'Conversation not found', code: 'NOT_FOUND' });
    const id = uuidv4();
    const metadata = {
      tool: req.body.tool,
      status: req.body.status,
      request: req.body.request,
      results: req.body.results,
      error_code: req.body.error_code || null,
      result_timestamp: new Date().toISOString(),
    };
    await db.transaction(async () => {
      await db.prepare(`INSERT INTO ai_messages (id, conversation_id, user_id, role, message_type, content, metadata) VALUES (?, ?, ?, 'tool', 'results', ?, ?)`)
        .run(id, conversation.id, req.user.id, req.body.summary, JSON.stringify(metadata));
      await db.prepare('UPDATE ai_conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?').run(conversation.id, req.user.id);
      await recordEvent(req.user.id, conversation.id, 'ai_results_shown', { tool: req.body.tool, count: req.body.results.length, status: req.body.status });
    });
    res.status(201).json({ message: { id, role: 'tool', message_type: 'results', content: req.body.summary, metadata } });
  } catch (error) { next(error); }
});

module.exports = router;
