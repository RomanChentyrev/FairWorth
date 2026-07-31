const { t } = require('../i18n');

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function shell({ title, greeting, intro, action, url, outro }) {
  const safeUrl = escapeHtml(url);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title></head><body style="margin:0;background:#f4f6f9;font-family:Arial,sans-serif;color:#1a2b4a"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="padding:32px 16px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:auto;background:#fff;border:1px solid #e2e6ed;border-radius:16px"><tr><td style="padding:32px"><div style="font-size:24px;font-weight:700;margin-bottom:28px">Tripalora</div><h1 style="font-size:24px;margin:0 0 18px">${escapeHtml(title)}</h1><p style="line-height:1.6">${escapeHtml(greeting)}</p><p style="line-height:1.6">${escapeHtml(intro)}</p>${url ? `<p style="margin:28px 0"><a href="${safeUrl}" style="display:inline-block;padding:13px 20px;border-radius:9px;background:#1a2b4a;color:#fff;text-decoration:none;font-weight:700">${escapeHtml(action)}</a></p><p style="font-size:12px;color:#687386;word-break:break-all">${safeUrl}</p>` : ''}<p style="line-height:1.6;color:#687386">${escapeHtml(outro)}</p></td></tr></table></td></tr></table></body></html>`;
}

function authEmail({ name, purpose, url, locale = 'en' }) {
  if (!['verify', 'reset'].includes(purpose)) throw new Error(`Unknown auth email purpose: ${purpose}`);
  const copy = {
    subject: t(locale, `email.${purpose}_subject`),
    title: t(locale, `email.${purpose}_title`),
    intro: t(locale, `email.${purpose}_intro`),
    action: t(locale, `email.${purpose}_action`),
    outro: t(locale, `email.${purpose}_outro`),
  };
  const greeting = t(locale, 'email.greeting', { name });
  const text = `${greeting}\n\n${copy.intro}\n\n${copy.action}: ${url}\n\n${copy.outro}`;
  return { subject: copy.subject, text, html: shell({ ...copy, greeting, url }) };
}

function accountEmail({ name, event, locale = 'en' }) {
  if (!['password_changed', 'account_deleted'].includes(event)) throw new Error(`Unknown account email event: ${event}`);
  const copy = {
    subject: t(locale, `email.${event}_subject`),
    title: t(locale, `email.${event}_title`),
    intro: t(locale, `email.${event}_intro`),
    outro: t(locale, `email.${event}_outro`),
  };
  const greeting = t(locale, 'email.greeting', { name });
  return { subject: copy.subject, text: `${greeting}\n\n${copy.intro}\n\n${copy.outro}`, html: shell({ ...copy, greeting }) };
}

module.exports = { escapeHtml, authEmail, accountEmail };
