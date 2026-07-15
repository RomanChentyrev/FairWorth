const { v4: uuidv4 } = require('uuid');
const { db } = require('../db/database');
const { refreshLiteApiRates } = require('./hotelRates');
const { enqueue } = require('./notificationQueue');
const { capabilities } = require('../config/capabilities');

function nextCheck(checkIn) {
  const days = Math.ceil((new Date(`${checkIn}T00:00:00Z`) - Date.now()) / 86400000);
  return days > 60 ? 24 : days > 14 ? 12 : 6;
}

async function processPriceWatches(limit = 20) {
  if (capabilities().hotels.status !== 'ready') return 0;
  const watches = await db.prepare(`SELECT pw.*, h.name AS hotel_name, p.alert_price_drop, p.alert_price_rise FROM price_watches pw JOIN hotels h ON h.id = pw.hotel_id JOIN user_preferences p ON p.user_id = pw.user_id WHERE pw.active = 1 AND pw.check_out > CURRENT_DATE AND pw.next_check_at <= NOW() ORDER BY pw.next_check_at LIMIT ?`).all(limit);
  const groups = new Map();
  for (const watch of watches) {
    const key = [watch.hotel_id, watch.check_in, watch.check_out, watch.guests, watch.currency].join(':');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(watch);
  }
  for (const group of groups.values()) {
    const sample = group[0];
    try {
      await refreshLiteApiRates([{ id: sample.hotel_id }], sample.check_in, sample.check_out, { guests: sample.guests, currency: sample.currency, force: true });
      const price = await db.prepare(`SELECT operator, price_per_night, currency FROM hotel_prices WHERE hotel_id = ? AND check_in = ? AND check_out = ? AND price_valid = 1 AND currency = ? ORDER BY price_per_night LIMIT 1`).get(sample.hotel_id, sample.check_in, sample.check_out, sample.currency);
      for (const watch of group) {
        const oldPrice = Number(watch.last_price || watch.baseline_price || 0);
        const newPrice = Number(price?.price_per_night || 0);
        await db.prepare(`INSERT INTO price_observations (id, watch_id, provider, price, currency, available) VALUES (?, ?, ?, ?, ?, ?)`).run(uuidv4(), watch.id, price?.operator || 'liteapi', newPrice || null, watch.currency, newPrice > 0 ? 1 : 0);
        if (newPrice > 0) {
          const change = oldPrice > 0 ? (newPrice - oldPrice) / oldPrice : 0;
          const targetReached = watch.target_price && newPrice <= Number(watch.target_price);
          const drop = watch.notify_on_drop && watch.alert_price_drop && (change <= -0.05 || targetReached);
          const rise = watch.notify_on_rise && watch.alert_price_rise && change >= 0.07;
          const lastNotified = Number(watch.last_notified_price || 0);
          if ((drop || rise) && newPrice !== lastNotified) {
            const direction = drop ? 'drop' : 'rise';
            const key = `price-${direction}:${watch.id}:${newPrice.toFixed(2)}`;
            const queued = await enqueue({ userId: watch.user_id, type: 'price_change', deduplicationKey: key, payload: { watch_id: watch.id, hotel_name: watch.hotel_name, old_price: oldPrice.toFixed(2), new_price: newPrice.toFixed(2), currency: watch.currency, direction, check_in: watch.check_in, check_out: watch.check_out } });
            if (queued) await db.prepare(`UPDATE price_watches SET last_notified_price = ? WHERE id = ?`).run(newPrice, watch.id);
          }
          await db.prepare(`UPDATE price_watches SET baseline_price = COALESCE(baseline_price, ?), last_price = ?, lowest_price = LEAST(COALESCE(lowest_price, ?), ?), last_checked_at = NOW(), next_check_at = NOW() + (? * INTERVAL '1 hour'), updated_at = NOW() WHERE id = ?`).run(newPrice, newPrice, newPrice, newPrice, nextCheck(watch.check_in), watch.id);
        } else {
          await db.prepare(`UPDATE price_watches SET last_checked_at = NOW(), next_check_at = NOW() + INTERVAL '12 hours', updated_at = NOW() WHERE id = ?`).run(watch.id);
        }
      }
    } catch (error) {
      for (const watch of group) await db.prepare(`UPDATE price_watches SET next_check_at = NOW() + INTERVAL '2 hours', updated_at = NOW() WHERE id = ?`).run(watch.id);
    }
  }
  await db.prepare(`UPDATE price_watches SET active = 0, updated_at = NOW() WHERE active = 1 AND check_out <= CURRENT_DATE`).run();
  return watches.length;
}

async function scheduleTripReminders() {
  const trips = await db.prepare(`SELECT t.*, u.name FROM trips t JOIN users u ON u.id = t.user_id JOIN user_preferences p ON p.user_id = t.user_id WHERE t.reminder_enabled = 1 AND p.alert_booking_reminder = 1 AND t.status IN ('planned','booking_started','booked') AND t.start_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 8`).all();
  const now = Date.now();
  for (const trip of trips) {
    const hours = Math.round((new Date(`${trip.start_date}T09:00:00Z`) - now) / 3600000);
    const windows = [{ code: '7d', hours: 168, tolerance: 24 }, { code: '24h', hours: 24, tolerance: 6 }, { code: '3h', hours: 3, tolerance: 3 }];
    for (const window of windows) if (hours <= window.hours && hours > window.hours - window.tolerance) {
      await enqueue({ userId: trip.user_id, type: 'trip_reminder', deduplicationKey: `trip-reminder:${trip.id}:${window.code}`, payload: { trip_id: trip.id, title: trip.title, start_date: trip.start_date, label: window.code } });
    }
  }
}

async function scheduleBookingReminders() {
  const clicks = await db.prepare(`SELECT pc.click_id, pc.user_id, pc.provider FROM provider_clicks pc JOIN user_preferences p ON p.user_id = pc.user_id WHERE p.alert_booking_reminder = 1 AND pc.status IN ('created','redirected') AND pc.created_at BETWEEN NOW() - INTERVAL '48 hours' AND NOW() - INTERVAL '24 hours'`).all();
  for (const click of clicks) await enqueue({ userId: click.user_id, type: 'booking_reminder', deduplicationKey: `booking-reminder:${click.click_id}:24h`, payload: { click_id: click.click_id, provider: click.provider } });
}

async function scheduleWeeklyDigests() {
  const users = await db.prepare(`SELECT u.id, u.locale FROM users u JOIN user_preferences p ON p.user_id = u.id WHERE u.email_verified = 1 AND p.alert_weekly_insights = 1 AND EXTRACT(DOW FROM NOW() AT TIME ZONE u.timezone) = u.digest_weekday AND EXTRACT(HOUR FROM NOW() AT TIME ZONE u.timezone) = u.digest_hour`).all();
  const periodStart = new Date(); periodStart.setUTCDate(periodStart.getUTCDate() - 7);
  const start = periodStart.toISOString().slice(0, 10); const end = new Date().toISOString().slice(0, 10);
  for (const user of users) {
    const existing = await db.prepare(`SELECT id FROM weekly_digest_runs WHERE user_id = ? AND period_start = ?`).get(user.id, start);
    if (existing) continue;
    const changes = await db.prepare(`SELECT h.name, MIN(po.price) AS lowest, pw.currency FROM price_observations po JOIN price_watches pw ON pw.id = po.watch_id JOIN hotels h ON h.id = pw.hotel_id WHERE pw.user_id = ? AND po.observed_at >= NOW() - INTERVAL '7 days' AND po.available = 1 GROUP BY h.name, pw.currency ORDER BY MIN(po.price) LIMIT 3`).all(user.id);
    const ru = user.locale === 'ru';
    const items = changes.map(item => ru ? `${item.name}: лучшая цена за неделю ${item.currency} ${Number(item.lowest).toFixed(2)}` : `${item.name}: weekly low ${item.currency} ${Number(item.lowest).toFixed(2)}`);
    const notificationId = await enqueue({ userId: user.id, type: 'weekly_digest', deduplicationKey: `weekly-digest:${user.id}:${start}`, payload: { items, period_start: start, period_end: end } });
    if (notificationId) await db.prepare(`INSERT INTO weekly_digest_runs (id, user_id, period_start, period_end, notification_id) VALUES (?, ?, ?, ?, ?)`).run(uuidv4(), user.id, start, end, notificationId);
  }
}

async function recoverStaleJobs() {
  await db.prepare(`UPDATE notification_jobs SET status = 'pending', locked_at = NULL, scheduled_at = NOW(), last_error = 'Recovered stale worker lock' WHERE status = 'processing' AND locked_at < NOW() - INTERVAL '15 minutes'`).run();
}

async function enforceDataRetention() {
  const months = Math.max(1, Number(process.env.LEGAL_ACTIVITY_HISTORY_MONTHS || 24));
  const sessionDays = Math.max(1, Number(process.env.SESSION_RETENTION_DAYS || 30));
  const cacheDays = Math.max(1, Number(process.env.CACHE_RETENTION_DAYS || 30));
  const technicalDays = Math.max(1, Number(process.env.TECHNICAL_RETENTION_DAYS || 90));
  const removed = {};
  const cleanup = async (name, sql, ...params) => { removed[name] = Number((await db.prepare(sql).run(...params)).rowCount || 0); };
  await cleanup('auth_tokens', `DELETE FROM auth_tokens WHERE expires_at < NOW() OR used_at < NOW() - INTERVAL '7 days'`);
  await cleanup('user_sessions', `DELETE FROM user_sessions WHERE (revoked_at IS NOT NULL AND revoked_at < NOW() - (? * INTERVAL '1 day')) OR refresh_expires_at < NOW() - (? * INTERVAL '1 day')`, sessionDays, sessionDays);
  await cleanup('price_observations', `DELETE FROM price_observations WHERE observed_at < NOW() - (? * INTERVAL '1 month')`, months);
  await cleanup('user_interactions', `DELETE FROM user_interactions WHERE created_at < NOW() - (? * INTERVAL '1 month')`, months);
  await cleanup('searches', `DELETE FROM searches WHERE created_at < NOW() - (? * INTERVAL '1 month')`, months);
  await cleanup('compare_sessions', `DELETE FROM compare_sessions WHERE created_at < NOW() - (? * INTERVAL '1 month')`, months);
  await cleanup('ai_analyses', `DELETE FROM ai_analyses WHERE created_at < NOW() - (? * INTERVAL '1 month')`, months);
  await cleanup('score_snapshots', `DELETE FROM score_snapshots WHERE calculated_at < NOW() - (? * INTERVAL '1 month')`, months);
  await cleanup('partner_postbacks', `DELETE FROM partner_postbacks WHERE processed_at < NOW() - (? * INTERVAL '1 month')`, months);
  await cleanup('provider_clicks', `DELETE FROM provider_clicks WHERE created_at < NOW() - (? * INTERVAL '1 month')`, months);
  await cleanup('hotel_prices', `DELETE FROM hotel_prices WHERE updated_at < NOW() - (? * INTERVAL '1 day') OR check_out < CURRENT_DATE - (? * INTERVAL '1 day')`, cacheDays, cacheDays);
  await cleanup('hotel_rate_checks', `DELETE FROM hotel_rate_checks WHERE checked_at < NOW() - (? * INTERVAL '1 day')`, cacheDays);
  await cleanup('insights_cache', `DELETE FROM insights_cache WHERE expires_at < NOW() - (? * INTERVAL '1 day')`, cacheDays);
  await cleanup('notification_unsubscribes', `DELETE FROM notification_unsubscribes WHERE used_at < NOW() - INTERVAL '30 days'`);
  await cleanup('weekly_digest_runs', `DELETE FROM weekly_digest_runs WHERE created_at < NOW() - (? * INTERVAL '1 month')`, months);
  await cleanup('notification_jobs', `DELETE FROM notification_jobs WHERE status IN ('sent','cancelled','failed') AND created_at < NOW() - (? * INTERVAL '1 month')`, months);
  await cleanup('catalog_syncs', `DELETE FROM hotel_catalog_syncs WHERE completed_at < NOW() - (? * INTERVAL '1 day')`, technicalDays);
  await cleanup('mapping_reviews', `DELETE FROM hotel_mapping_reviews WHERE status != 'open' AND resolved_at < NOW() - (? * INTERVAL '1 day')`, technicalDays);
  await cleanup('score_anomalies', `DELETE FROM score_anomalies WHERE status != 'open' AND resolved_at < NOW() - (? * INTERVAL '1 day')`, technicalDays);
  await cleanup('price_anomalies', `DELETE FROM price_anomalies WHERE status != 'open' AND resolved_at < NOW() - (? * INTERVAL '1 day')`, technicalDays);
  return removed;
}

module.exports = { processPriceWatches, scheduleTripReminders, scheduleBookingReminders, scheduleWeeklyDigests, recoverStaleJobs, enforceDataRetention, nextCheck };
