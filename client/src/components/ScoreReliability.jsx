import React from 'react';
import { ShieldCheck, ShieldAlert } from 'lucide-react';
import { useLang } from '../i18n/LanguageContext';

export default function ScoreReliability({ value, level, adjustedScore }) {
  const { l } = useLang();
  if (!Number.isFinite(Number(value))) return null;

  const normalizedLevel = level || (value >= 80 ? 'high' : value >= 60 ? 'medium' : 'low');
  const labels = {
    high: l('High', 'Высокая'),
    medium: l('Medium', 'Средняя'),
    low: l('Low', 'Низкая'),
  };
  const colors = {
    high: { color: '#276749', background: '#F0FFF4', border: '#9AE6B4' },
    medium: { color: '#8A6508', background: '#FFFBEB', border: '#F2CF72' },
    low: { color: '#B83232', background: '#FFF5F5', border: '#FEB2B2' },
  };
  const palette = colors[normalizedLevel];
  const Icon = normalizedLevel === 'low' ? ShieldAlert : ShieldCheck;
  const title = l(
    `Reliability reflects how much data supports the score. Adjusted ranking score: ${adjustedScore ?? '—'}/100.`,
    `Уверенность показывает полноту данных, подтверждающих индекс. Скорректированная оценка для сортировки: ${adjustedScore ?? '—'}/100.`,
  );

  return (
    <span
      title={title}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '3px 6px', border: `1px solid ${palette.border}`,
        background: palette.background, color: palette.color,
        fontSize: 10, fontWeight: 700, lineHeight: 1.2, whiteSpace: 'nowrap',
      }}
    >
      <Icon size={11} />
      {labels[normalizedLevel]} · {Math.round(value)}%
    </span>
  );
}
