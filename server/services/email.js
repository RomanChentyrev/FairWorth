const nodemailer = require('nodemailer');
const logger = require('./logger');
const { authEmail } = require('./emailTemplates');

let transporter;
function getTransporter() {
  if (transporter !== undefined) return transporter;
  const developmentMailpit = (process.env.NODE_ENV || 'development') === 'development';
  const host = process.env.SMTP_HOST || (developmentMailpit ? '127.0.0.1' : '');
  if (!host) { transporter = null; return transporter; }
  transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || (developmentMailpit ? 1025 : 587)),
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

async function sendEmail({ to, subject, text, html, headers }) {
  const transport = getTransporter();
  if (!transport) {
    logger.info('email_skipped_no_smtp', { to, subject, preview: text });
    return { delivered: false, development_preview: text };
  }
  const defaultFrom = (process.env.NODE_ENV || 'development') === 'development' ? 'Fairworth <fairworth@gmail.com>' : 'Fairworth <no-reply@fairworth.app>';
  const info = await transport.sendMail({ from: process.env.EMAIL_FROM || defaultFrom, to, subject: String(subject).slice(0, 200), text: String(text || '').slice(0, 100000), html: html ? String(html).slice(0, 100000) : undefined, headers });
  return { delivered: true, message_id: info.messageId };
}

function linkEmail({ to, name, purpose, url, locale = 'en' }) {
  return sendEmail({ to, ...authEmail({ name, purpose, url, locale }) });
}

module.exports = { sendEmail, linkEmail };
