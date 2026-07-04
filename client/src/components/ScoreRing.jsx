import React from 'react';

export default function ScoreRing({ score = 0, size = 56, strokeWidth = 4 }) {
  const radius = (size - strokeWidth * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  const color = score >= 80 ? '#276749' : score >= 65 ? '#B8860B' : '#C53030';

  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke="#E2E8F0" strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke={color} strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.7s ease' }}
        />
      </svg>
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: 1
      }}>
        <span style={{ fontSize: size * 0.26, fontWeight: 700, color: '#1A2B4A', lineHeight: 1 }}>{score}</span>
        <span style={{ fontSize: size * 0.16, color: '#9AA5B4', fontWeight: 500 }}>/100</span>
      </div>
    </div>
  );
}
