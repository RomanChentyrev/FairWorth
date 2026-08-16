const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../db/database');

const hashToken = token => crypto.createHash('sha256').update(token).digest('hex');
async function createToken(userId, type, ttlMinutes) {
  const recent = await db.prepare(`SELECT sent_at FROM auth_tokens WHERE user_id = ? AND type = ? ORDER BY sent_at DESC LIMIT 1`).get(userId, type);
  if (recent && Date.now() - new Date(recent.sent_at).getTime() < 60_000) {
    const error = new Error('Please wait 60 seconds before requesting another email'); error.status = 429; throw error;
  }
  await db.prepare('UPDATE auth_tokens SET used_at = CURRENT_TIMESTAMP WHERE user_id = ? AND type = ? AND used_at IS NULL').run(userId, type);
  const token = crypto.randomBytes(32).toString('base64url');
  await db.prepare(`INSERT INTO auth_tokens (id, user_id, type, token_hash, expires_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP + (? * INTERVAL '1 minute'))`)
    .run(uuidv4(), userId, type, hashToken(token), ttlMinutes);
  return token;
}
async function consumeToken(token, type) {
  return db.prepare(`
    UPDATE auth_tokens
    SET used_at = CURRENT_TIMESTAMP
    WHERE token_hash = ? AND type = ? AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP
    RETURNING *
  `).get(hashToken(token), type);
}
module.exports = { createToken, consumeToken };
