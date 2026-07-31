export function parseStringList(value) {
  if (Array.isArray(value)) return value.filter(item => typeof item === 'string');
  if (typeof value !== 'string' || !value.trim()) return [];

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.filter(item => typeof item === 'string');
  } catch {
    return value.split(',').map(item => item.trim()).filter(Boolean);
  }

  return [];
}
