export function formatAmount(value, language = 'en') {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return new Intl.NumberFormat(language, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Math.round((number + Number.EPSILON) * 100) / 100);
}

export function formatMoney(value, currency = 'USD', language = 'en') {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return new Intl.NumberFormat(language, {
    style: 'currency', currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Math.round((number + Number.EPSILON) * 100) / 100);
}
