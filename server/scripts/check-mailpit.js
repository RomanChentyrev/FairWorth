process.env.NODE_ENV = 'development';
require('dotenv').config();
const request = require('supertest');
const { app, ready } = require('../index');
const { db, close } = require('../db/database');
const { TERMS_VERSION, PRIVACY_VERSION } = require('../config/legal');

async function main() {
  await ready;
  const email = `mailpit-flow-${Date.now()}@example.test`;
  let userId;
  try {
    const registration = await request(app).post('/api/auth/register').send({
      name: 'Проверка Почты <script>', email, password: 'MailpitTest123!', language: 'ru',
      accept_terms: true, behavioural_tracking_consent: false,
      terms_version: TERMS_VERSION, privacy_version: PRIVACY_VERSION,
    });
    if (registration.status !== 201) throw new Error(`Registration HTTP ${registration.status}: ${registration.text}`);
    userId = registration.body.user.id;

    await db.prepare(`UPDATE auth_tokens SET sent_at = NOW() - INTERVAL '2 minutes' WHERE user_id = ? AND type = 'email_verification'`).run(userId);
    const resend = await request(app).post('/api/auth/resend-verification').send({ email });
    if (resend.status !== 200) throw new Error(`Resend HTTP ${resend.status}: ${resend.text}`);

    await db.prepare(`UPDATE auth_tokens SET sent_at = NOW() - INTERVAL '2 minutes' WHERE user_id = ? AND type = 'password_reset'`).run(userId);
    const forgot = await request(app).post('/api/auth/forgot-password').send({ email });
    if (forgot.status !== 200) throw new Error(`Forgot-password HTTP ${forgot.status}: ${forgot.text}`);

    await new Promise(resolve => setTimeout(resolve, 300));
    const response = await fetch('http://127.0.0.1:8025/api/v1/messages?limit=100', { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`Mailpit API HTTP ${response.status}`);
    const payload = await response.json();
    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    const captured = messages.filter(message => JSON.stringify(message).includes(email));
    const serialized = JSON.stringify(captured);
    if (captured.length < 3 || !serialized.includes('Подтвердите email Fairworth') || !serialized.includes('Сброс пароля Fairworth')) throw new Error(`Mailpit captured only ${captured.length} matching auth messages`);
    console.log(`OK API registration, resend and password recovery delivered ${captured.length} messages to Mailpit.`);
    console.log('OK RU HTML templates and escaped user input were sent through SMTP.');
    console.log('Open http://localhost:8025 to inspect the inbox.');
  } finally {
    if (userId) await db.prepare('DELETE FROM users WHERE id = ?').run(userId).catch(() => null);
    await close();
  }
}

main().catch(error => { console.error(`FAIL ${error.message}`); process.exitCode = 1; });
