const nodemailer = require('nodemailer');
const logger = require('./logger');

let transporter;
function getTransporter() {
  if (transporter !== undefined) return transporter;
  if (!process.env.SMTP_HOST) { transporter = null; return transporter; }
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
    connectionTimeout: Number(process.env.SMTP_CONNECTION_TIMEOUT_MS || 10000),
    greetingTimeout: Number(process.env.SMTP_GREETING_TIMEOUT_MS || 10000),
    socketTimeout: Number(process.env.SMTP_SOCKET_TIMEOUT_MS || 20000),
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  return transporter;
}

async function sendEmail({ to, subject, text, html }) {
  const transport = getTransporter();
  if (!transport) {
    logger.info('email_skipped_no_smtp', { to, subject, preview: text });
    return { delivered: false, development_preview: text };
  }
  const info = await transport.sendMail({ from: process.env.EMAIL_FROM || 'Fairworth <no-reply@fairworth.app>', to, subject: String(subject).slice(0, 200), text: String(text || '').slice(0, 100000), html: html ? String(html).slice(0, 100000) : undefined });
  return { delivered: true, message_id: info.messageId };
}

function linkEmail({ to, name, purpose, url }) {
  const subjects = { verify: 'Verify your Fairworth email', reset: 'Reset your Fairworth password' };
  const actions = { verify: 'Verify email', reset: 'Reset password' };
  return sendEmail({ to, subject: subjects[purpose], text: `Hello ${name},\n\n${actions[purpose]}: ${url}\n\nIf you did not request this, ignore this email.`, html: `<p>Hello ${name},</p><p><a href="${url}">${actions[purpose]}</a></p><p>If you did not request this, ignore this email.</p>` });
}

module.exports = { sendEmail, linkEmail };
