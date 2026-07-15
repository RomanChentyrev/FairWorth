const test = require('node:test');
const assert = require('node:assert/strict');
const { render } = require('../services/notificationQueue');
const { nextCheck } = require('../services/notificationScheduler');

test('notification templates escape user and provider content', () => {
  const result = render('booking_reminder', { name: '<script>x</script>', provider: '<b>Hotel</b>' }, 'en', 'https://example.test/unsubscribe');
  assert.ok(!result.html.includes('<script>'));
  assert.ok(!result.html.includes('<b>Hotel</b>'));
  assert.match(result.html, /&lt;b&gt;Hotel&lt;\/b&gt;/);
});

test('price checks become more frequent close to departure', () => {
  const date = days => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  assert.equal(nextCheck(date(90)), 24);
  assert.equal(nextCheck(date(30)), 12);
  assert.equal(nextCheck(date(7)), 6);
});
