const test = require('node:test');
const assert = require('node:assert/strict');
const { authEmail, accountEmail } = require('../services/emailTemplates');

test('auth email templates support RU and EN', () => {
  const en = authEmail({ name: 'Alex', purpose: 'verify', url: 'https://example.test/verify', locale: 'en' });
  const ru = authEmail({ name: 'Алексей', purpose: 'reset', url: 'https://example.test/reset', locale: 'ru' });
  assert.equal(en.subject, 'Verify your Fairworth email');
  assert.equal(ru.subject, 'Сброс пароля Fairworth');
  assert.match(en.html, /<!doctype html>/);
  assert.match(ru.text, /30 минут/);
});

test('HTML email templates escape user names and URLs', () => {
  const message = authEmail({ name: '<img src=x onerror=alert(1)>', purpose: 'verify', url: 'https://example.test/?x=<script>', locale: 'en' });
  assert.ok(!message.html.includes('<img src=x'));
  assert.ok(!message.html.includes('<script>'));
  assert.match(message.html, /&lt;img/);
  assert.match(message.html, /&lt;script&gt;/);
});

test('security account templates are localised', () => {
  assert.match(accountEmail({ name: 'Alex', event: 'password_changed', locale: 'en' }).subject, /password/i);
  assert.match(accountEmail({ name: 'Алексей', event: 'account_deleted', locale: 'ru' }).subject, /удалён/i);
});
