function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return res.status(400).json({
        error: 'Request validation failed',
        code: 'VALIDATION_ERROR',
        details: result.error.issues.map(issue => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }
    req[source] = result.data;
    return next();
  };
}

module.exports = { validate };
