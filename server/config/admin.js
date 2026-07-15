function adminEmails(source = process.env.ADMIN_EMAILS) {
  return new Set(String(source || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean));
}

function isAdminEmail(email, source = process.env.ADMIN_EMAILS) {
  return adminEmails(source).has(String(email || '').trim().toLowerCase());
}

function effectiveRole(email) {
  return isAdminEmail(email) ? 'admin' : 'user';
}

module.exports = { adminEmails, isAdminEmail, effectiveRole };
