function write(level, message, fields = {}) {
  const entry = { timestamp: new Date().toISOString(), level, message, ...fields };
  const output = JSON.stringify(entry);
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(output);
}

module.exports = {
  info: (message, fields) => write('info', message, fields),
  warn: (message, fields) => write('warn', message, fields),
  error: (message, fields) => write('error', message, fields),
  requestLogger(req, res, next) {
    const started = Date.now();
    res.on('finish', () => write('info', 'http_request', {
      method: req.method, path: req.originalUrl.split('?')[0], status: res.statusCode,
      duration_ms: Date.now() - started, user_id: req.user?.id || null,
    }));
    next();
  },
};
