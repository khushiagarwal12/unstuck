interface PointItem {
  val: number; // 0 to 1
  label?: string;
}

export function NumberLine({ params }: { params: { points?: PointItem[] } }) {
  const points = params.points || [
    { val: 0.375, label: "3/8" },
    { val: 0.667, label: "2/3" },
  ];

  const width = 360;
  const height = 90;
  const startX = 40;
  const endX = startX + width;
  const y = 40;

  return (
    <div className="visual visual--number-line">
      <svg
        viewBox={`0 0 ${width + 80} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-label="Number line diagram"
      >
        {/* Main Line */}
        <line
          x1={startX}
          y1={y}
          x2={endX}
          y2={y}
          stroke="var(--ink)"
          strokeWidth="2.5"
          strokeLinecap="round"
        />

        {/* Major Ticks 0, 1/2, 1 */}
        {[
          { pos: 0, text: "0" },
          { pos: 0.5, text: "1/2" },
          { pos: 1, text: "1" },
        ].map((t) => {
          const x = startX + t.pos * width;
          return (
            <g key={t.pos}>
              <line x1={x} y1={y - 8} x2={x} y2={y + 8} stroke="var(--ink)" strokeWidth="2" />
              <text x={x} y={y + 24} textAnchor="middle" fontSize="12" fill="var(--muted)">
                {t.text}
              </text>
            </g>
          );
        })}

        {/* Custom Point Markers */}
        {points.map((p, idx) => {
          const x = startX + Math.max(0, Math.min(1, p.val)) * width;
          const color = idx === 0 ? "var(--accent)" : "var(--demo-accent)";

          return (
            <g key={idx}>
              <circle cx={x} cy={y} r="6" fill={color} stroke="#fff" strokeWidth="2" />
              <text
                x={x}
                y={y - 12}
                textAnchor="middle"
                fontSize="12"
                fontWeight="700"
                fill={color}
              >
                {p.label || p.val.toFixed(2)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
