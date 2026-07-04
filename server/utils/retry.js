async function withRetry(operation, { attempts = 3, baseDelayMs = 250, shouldRetry } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try { return await operation(attempt); } catch (error) {
      lastError = error;
      if (attempt === attempts || (shouldRetry && !shouldRetry(error))) throw error;
      await new Promise(resolve => setTimeout(resolve, baseDelayMs * (2 ** (attempt - 1))));
    }
  }
  throw lastError;
}
module.exports = { withRetry };
