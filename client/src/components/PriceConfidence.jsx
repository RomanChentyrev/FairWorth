import React from 'react';
import { BadgeDollarSign, TriangleAlert } from 'lucide-react';
import { useLang } from '../i18n/LanguageContext';

export default function PriceConfidence({ value, level }) {
  const { l } = useLang();
  if (!Number.isFinite(Number(value))) return null;
  const normalizedLevel = level || (value >= 90 ? 'high' : value >= 60 ? 'medium' : 'low');
  const labels = {
    high: l('Price: high', 'Цена: высокая'),
    medium: l('Price: medium', 'Цена: средняя'),
    low: l('Price: low', 'Цена: низкая'),
  };
  const colors = {
    high: { color: '#276749', background: '#F0FFF4', border: '#9AE6B4' },
    medium: { color: '#8A6508', background: '#FFFBEB', border: '#F2CF72' },
    low: { color: '#B83232', background: '#FFF5F5', border: '#FEB2B2' },
  };
  const palette = colors[normalizedLevel];
  const Icon = normalizedLevel === 'low' ? TriangleAlert : BadgeDollarSign;
  return (
    <span
      title={l('Confidence in price freshness and completeness', 'Уверенность в актуальности и полноте цены')}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 6px', border: `1px solid ${palette.border}`, background: palette.background, color: palette.color, fontSize: 10, fontWeight: 700, lineHeight: 1.2, whiteSpace: 'nowrap' }}
    >
      <Icon size={11} /> {labels[normalizedLevel]} · {Math.round(value)}%
    </span>
  );
}
