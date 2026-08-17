"use client";

import React from 'react';

export interface CashflowChartSeries {
  name: string;
  color: string;
  values: number[];
}

interface CashflowBarChartProps {
  labels: string[];
  series: CashflowChartSeries[];
  height?: number;
  formatValue?: (v: number) => string;
}

// Compact axis/value formatting: 1.5M / 250k / 820
const defaultFormat = (v: number) => {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(v / 1_000).toFixed(0)}k`;
  return String(Math.round(v));
};

/**
 * Dependency-free grouped bar chart (SVG) that supports negative values (zero baseline).
 * Used for the cashflow "Realized vs Projected" views.
 */
export const CashflowBarChart: React.FC<CashflowBarChartProps> = ({
  labels,
  series,
  height = 260,
  formatValue = defaultFormat
}) => {
  const W = 1000;
  const PAD_L = 54;
  const PAD_R = 14;
  const PAD_T = 26;
  const PAD_B = 36;
  const innerW = W - PAD_L - PAD_R;
  const innerH = height - PAD_T - PAD_B;

  const all = series.flatMap(s => s.values);
  const rawMin = Math.min(0, ...all);
  const rawMax = Math.max(0, ...all);
  const range = (rawMax - rawMin) || 1;
  const max = rawMax + range * 0.12;
  const min = rawMin - range * 0.12;

  const y = (v: number) => PAD_T + ((max - v) / (max - min)) * innerH;

  const groupWidth = innerW / (labels.length || 1);
  const nSeries = series.length;
  const barW = Math.min(42, (groupWidth - 8) / nSeries);

  const gridVals = Array.from({ length: 5 }, (_, i) => min + ((max - min) * i) / 4);

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${height}`} className="w-full min-w-[680px]" role="img" aria-label="Cashflow bar chart">
        {/* Gridlines + y labels */}
        {gridVals.map((gv, i) => (
          <g key={i}>
            <line x1={PAD_L} x2={W - PAD_R} y1={y(gv)} y2={y(gv)} stroke={i === 2 ? '#cbd5e1' : '#eef2f7'} strokeWidth={1} />
            <text x={PAD_L - 6} y={y(gv) + 3.5} textAnchor="end" fontSize={10} fill="#94a3b8" fontFamily="monospace">
              {formatValue(gv)}
            </text>
          </g>
        ))}

        {/* Zero baseline */}
        <line x1={PAD_L} x2={W - PAD_R} y1={y(0)} y2={y(0)} stroke="#64748b" strokeWidth={1.5} />

        {/* Bars */}
        {labels.map((label, gi) => {
          const gx = PAD_L + gi * groupWidth;
          return series.map((s, si) => {
            const v = s.values[gi] || 0;
            const x = gx + 4 + si * (barW + 1.5);
            const yTop = Math.min(y(v), y(0));
            const barH = Math.abs(y(v) - y(0));
            const isNeg = v < 0;
            return (
              <g key={`${gi}-${si}`}>
                <rect x={x} y={yTop} width={barW} height={Math.max(barH, 0.5)} fill={s.color} rx={3}>
                  <title>{`${label} · ${s.name}: ${formatValue(v)}`}</title>
                </rect>
                <text
                  x={x + barW / 2}
                  y={isNeg ? yTop + barH + 12 : yTop - 5}
                  textAnchor="middle"
                  fontSize={9}
                  fill="#475569"
                  fontFamily="monospace"
                  fontWeight={700}
                >
                  {formatValue(v)}
                </text>
              </g>
            );
          });
        })}

        {/* X labels */}
        {labels.map((label, gi) => (
          <text
            key={gi}
            x={PAD_L + gi * groupWidth + groupWidth / 2}
            y={height - 12}
            textAnchor="middle"
            fontSize={10}
            fill="#475569"
            fontWeight={700}
            fontFamily="monospace"
          >
            {label}
          </text>
        ))}
      </svg>
      <div className="flex items-center gap-4 mt-2 flex-wrap">
        {series.map(s => (
          <span key={s.name} className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
            <span className="w-3 h-3 rounded" style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </div>
    </div>
  );
};
