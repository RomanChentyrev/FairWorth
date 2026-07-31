const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../db/database');
const { t } = require('../i18n');
const { sendEmail } = require('./email');

const frontendUrl = () => process.env.FRONTEND_URL || 'http://localhost:5173';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const escapeHtml = value => String(value || '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

async function enqueue({ userId, type, deduplicationKey, payload, scheduledAt = new Date() }) {
  const id = uuidv4();
  const result = await db.prepare(`INSERT INTO notification_jobs (id, user_id, type, deduplication_key, payload, scheduled_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (deduplication_key) DO NOTHING RETURNING id`)
    .get(id, userId, type, deduplicationKey, JSON.stringify(payload || {}), scheduledAt);
  return result?.id || null;
}

async function unsubscribeUrl(userId, scope = 'all_marketing') {
  const token = crypto.randomBytes(32).toString('base64url');
  await db.prepare(`INSERT INTO notification_unsubscribes (id, user_id, token_hash, scope) VALUES (?, ?, ?, ?)`).run(uuidv4(), userId, hash(token), scope);
  return `${frontendUrl()}/unsubscribe?token=${encodeURIComponent(token)}`;
}

function oneClickUrl(unsubscribe) {
  const url = new URL(unsubscribe);
  return `${url.origin}/api/notifications/unsubscribe?token=${encodeURIComponent(url.searchParams.get('token') || '')}`;
}

function render(type, payload, locale, unsubscribe) {
  const name = payload.name || t(locale, 'notification.traveller');
  const greeting = t(locale, 'email.greeting', { name });
  const footer = unsubscribe ? `<p style="font-size:12px;color:#667"><a href="${escapeHtml(unsubscribe)}">${escapeHtml(t(locale, 'notification.manage'))}</a></p>` : '';
  if (type === 'price_change') {
    const down = payload.direction === 'drop';
    const subject = t(locale, down ? 'notification.price_drop_subject' : 'notification.price_rise_subject', { hotel: payload.hotel_name });
    const body = t(locale, 'notification.price_body', {
      currency: payload.currency,
      newPrice: payload.new_price,
      oldPrice: payload.old_price,
    });
    return { subject, text: `${greeting}\n\n${body}${unsubscribe ? `\n${unsubscribe}` : ''}`, html: `<p>${escapeHtml(greeting)}</p><p>${escapeHtml(body)}</p>${footer}` };
  }
  if (type === 'trip_reminder') {
    const subject = t(locale, 'notification.trip_subject', { title: payload.title });
    const body = t(locale, 'notification.trip_body', { date: payload.start_date, label: payload.label });
    return { subject, text: `${greeting}\n\n${body}${unsubscribe ? `\n${unsubscribe}` : ''}`, html: `<p>${escapeHtml(greeting)}</p><p>${escapeHtml(body)}</p>${footer}` };
  }
  if (type === 'booking_reminder') {
    const subject = t(locale, 'notification.booking_subject');
    const body = t(locale, 'notification.booking_body', { provider: payload.provider });
    return { subject, text: `${greeting}\n\n${body}`, html: `<p>${escapeHtml(greeting)}</p><p>${escapeHtml(body)}</p>` };
  }
  const subject = t(locale, 'notification.weekly_subject');
  const lines = payload.items?.length ? payload.items : [t(locale, 'notification.weekly_empty')];
  return { subject, text: `${greeting}\n\n${lines.join('\n')}${unsubscribe ? `\n${unsubscribe}` : ''}`, html: `<p>${escapeHtml(greeting)}</p><h2>${escapeHtml(subject)}</h2><ul>${lines.map(line => `<li>${escapeHtml(line)}</li>`).join('')}</ul>${footer}` };
}

async function processOne() {
  const job = await db.transaction(async () => {
    const row = (await db.query(`SELECT * FROM notification_jobs WHERE status = 'pending' AND scheduled_at <= NOW() ORDER BY scheduled_at FOR UPDATE SKIP LOCKED LIMIT 1`)).rows[0];
    if (!row) return null;
    await db.prepare(`UPDATE notification_jobs SET status = 'processing', locked_at = NOW(), attempts = attempts + 1 WHERE id = ?`).run(row.id);
    return row;
  });
  if (!job) return false;
  try {
    const user = await db.prepare(`SELECT email, name, locale FROM users WHERE id = ?`).get(job.user_id);
    if (!user) throw new Error('Notification user no longer exists');
    const payload = JSON.parse(job.payload || '{}');
    const marketing = ['price_change', 'trip_reminder', 'weekly_digest'].includes(job.type);
    const unsubscribe = marketing ? await unsubscribeUrl(job.user_id) : null;
    const message = render(job.type, { ...payload, name: user.name }, user.locale, unsubscribe);
    const headers = unsubscribe ? { 'List-Unsubscribe': `<${oneClickUrl(unsubscribe)}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : undefined;
    const result = await sendEmail({ to: user.email, ...message, headers });
    if (!result.delivered && process.env.NODE_ENV === 'production') throw new Error('SMTP did not deliver the message');
    await db.prepare(`UPDATE notification_jobs SET status = 'sent', sent_at = NOW(), locked_at = NULL WHERE id = ?`).run(job.id);
    if (job.type === 'weekly_digest') await db.prepare(`UPDATE weekly_digest_runs SET status = 'sent' WHERE notification_id = ?`).run(job.id);
  } catch (error) {
    const attempts = Number(job.attempts || 0) + 1;
    if (attempts >= 5) {
      await db.prepare(`UPDATE notification_jobs SET status = 'failed', failed_at = NOW(), locked_at = NULL, last_error = ? WHERE id = ?`).run(error.message, job.id);
      if (job.type === 'weekly_digest') await db.prepare(`UPDATE weekly_digest_runs SET status = 'failed' WHERE notification_id = ?`).run(job.id);
    }
    else await db.prepare(`UPDATE notification_jobs SET status = 'pending', scheduled_at = NOW() + (? * INTERVAL '1 minute'), locked_at = NULL, last_error = ? WHERE id = ?`).run([1, 5, 30, 120][attempts - 1] || 120, error.message, job.id);
  }
  return true;
}

async function unsubscribe(token) {
  const row = await db.prepare(`UPDATE notification_unsubscribes SET used_at = NOW() WHERE token_hash = ? AND used_at IS NULL RETURNING user_id, scope`).get(hash(token));
  if (!row) return false;
  await db.prepare(`UPDATE user_preferences SET alert_price_drop = 0, alert_price_rise = 0, alert_booking_reminder = 0, alert_weekly_insights = 0, alert_destination_deals = 0 WHERE user_id = ?`).run(row.user_id);
  await db.prepare(`UPDATE price_watches SET active = 0, updated_at = NOW() WHERE user_id = ?`).run(row.user_id);
  return true;
}

module.exports = { enqueue, processOne, unsubscribe, render };
