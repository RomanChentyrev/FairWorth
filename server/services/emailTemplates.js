function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function shell({ title, greeting, intro, action, url, outro }) {
  const safeUrl = escapeHtml(url);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title></head><body style="margin:0;background:#f4f6f9;font-family:Arial,sans-serif;color:#1a2b4a"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="padding:32px 16px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:auto;background:#fff;border:1px solid #e2e6ed;border-radius:16px"><tr><td style="padding:32px"><div style="font-size:24px;font-weight:700;margin-bottom:28px">Fairworth</div><h1 style="font-size:24px;margin:0 0 18px">${escapeHtml(title)}</h1><p style="line-height:1.6">${escapeHtml(greeting)}</p><p style="line-height:1.6">${escapeHtml(intro)}</p>${url ? `<p style="margin:28px 0"><a href="${safeUrl}" style="display:inline-block;padding:13px 20px;border-radius:9px;background:#1a2b4a;color:#fff;text-decoration:none;font-weight:700">${escapeHtml(action)}</a></p><p style="font-size:12px;color:#687386;word-break:break-all">${safeUrl}</p>` : ''}<p style="line-height:1.6;color:#687386">${escapeHtml(outro)}</p></td></tr></table></td></tr></table></body></html>`;
}

function authEmail({ name, purpose, url, locale = 'en' }) {
  const ru = locale === 'ru';
  const copy = {
    verify: ru ? { subject: 'Подтвердите email Fairworth', title: 'Подтвердите email', intro: 'Нажмите кнопку, чтобы подтвердить адрес и продолжить настройку аккаунта.', action: 'Подтвердить email', outro: 'Если вы не создавали аккаунт Fairworth, просто проигнорируйте это письмо.' } : { subject: 'Verify your Fairworth email', title: 'Verify your email', intro: 'Select the button to verify your address and continue setting up your account.', action: 'Verify email', outro: 'If you did not create a Fairworth account, you can ignore this email.' },
    reset: ru ? { subject: 'Сброс пароля Fairworth', title: 'Восстановление пароля', intro: 'Мы получили запрос на установку нового пароля. Ссылка действует 30 минут.', action: 'Установить новый пароль', outro: 'Если вы не запрашивали сброс пароля, проигнорируйте письмо и не передавайте ссылку другим.' } : { subject: 'Reset your Fairworth password', title: 'Reset your password', intro: 'We received a request to set a new password. This link expires in 30 minutes.', action: 'Set a new password', outro: 'If you did not request a password reset, ignore this email and do not share the link.' },
  }[purpose];
  if (!copy) throw new Error(`Unknown auth email purpose: ${purpose}`);
  const greeting = ru ? `Здравствуйте, ${name}!` : `Hello ${name},`;
  const text = `${greeting}\n\n${copy.intro}\n\n${copy.action}: ${url}\n\n${copy.outro}`;
  return { subject: copy.subject, text, html: shell({ ...copy, greeting, url }) };
}

function accountEmail({ name, event, locale = 'en' }) {
  const ru = locale === 'ru';
  const copy = {
    password_changed: ru ? { subject: 'Пароль Fairworth изменён', title: 'Пароль изменён', intro: 'Пароль вашего аккаунта был успешно изменён.', outro: 'Если это были не вы, немедленно свяжитесь с поддержкой и восстановите доступ.' } : { subject: 'Your Fairworth password was changed', title: 'Password changed', intro: 'The password for your account was successfully changed.', outro: 'If this was not you, contact support immediately and recover your account.' },
    account_deleted: ru ? { subject: 'Аккаунт Fairworth удалён', title: 'Аккаунт удалён', intro: 'Ваш аккаунт и связанные с ним персональные данные удалены из рабочей базы.', outro: 'Некоторые данные могут временно сохраняться в резервных копиях в соответствии с Политикой конфиденциальности.' } : { subject: 'Your Fairworth account was deleted', title: 'Account deleted', intro: 'Your account and associated personal data were removed from the operational database.', outro: 'Some data may remain temporarily in backups as described in the Privacy Policy.' },
  }[event];
  if (!copy) throw new Error(`Unknown account email event: ${event}`);
  const greeting = ru ? `Здравствуйте, ${name}!` : `Hello ${name},`;
  return { subject: copy.subject, text: `${greeting}\n\n${copy.intro}\n\n${copy.outro}`, html: shell({ ...copy, greeting }) };
}

module.exports = { escapeHtml, authEmail, accountEmail };
