import { semanticPart } from './semantic-part';

/** Data-free accounting layout and chart primitives, shared by browser and desktop. */
export const Usage = {
  Root: semanticPart('div', 'usage'),
  Toolbar: semanticPart('div', 'usage-toolbar'),
  Overview: semanticPart('div', 'usage-overview'),
  Summary: semanticPart('div', 'usage-summary'),
  Value: semanticPart('p', 'usage-value'),
  Caption: semanticPart('p', 'usage-caption'),
  Totals: semanticPart('dl', 'usage-totals'),
  Table: semanticPart('table', 'usage-table'),
  Scroll: semanticPart('div', 'usage-table-scroll'),
  Note: semanticPart('p', 'usage-note')
};

export function UsageChart({
  title,
  points,
  format
}: {
  title: string;
  points: readonly { label: string; value: number }[];
  format: (value: number) => string;
}) {
  const peak = Math.max(1, ...points.map((point) => point.value));
  const coordinates = points.map(
    (point, i) =>
      `${48 + (i * 640) / Math.max(1, points.length - 1)},${190 - (point.value / peak) * 160}`
  );
  const line = coordinates.join(' ');

  return (
    <figure className="usage-chart">
      <figcaption>{title}</figcaption>
      <svg viewBox="0 0 700 225" role="img" aria-label={title}>
        {[0, 0.5, 1].map((fraction) => (
          <g key={fraction}>
            <line
              x1="48"
              x2="688"
              y1={190 - fraction * 160}
              y2={190 - fraction * 160}
              className="usage-grid"
            />
            <text x="40" y={194 - fraction * 160} textAnchor="end">
              {format(peak * fraction)}
            </text>
          </g>
        ))}
        <polygon points={`48,190 ${line} 688,190`} className="usage-area" />
        <polyline points={line} className="usage-line" />
        {points.map((point, i) => (
          <circle
            key={point.label}
            cx={48 + (i * 640) / Math.max(1, points.length - 1)}
            cy={190 - (point.value / peak) * 160}
            r="3"
            className="usage-point"
          >
            <title>
              {point.label}: {format(point.value)}
            </title>
          </circle>
        ))}
        <text x="48" y="216">
          {points[0]?.label}
        </text>
        <text x="688" y="216" textAnchor="end">
          {points.at(-1)?.label}
        </text>
      </svg>
    </figure>
  );
}
