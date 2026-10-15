export function AreaModel({ params }: { params: { rows?: number; cols?: number; shaded?: number } }) {
  const rows = params.rows || 2;
  const cols = params.cols || 4;
  const total = rows * cols;
  const shaded = Math.min(total, params.shaded ?? 3);

  const cellWidth = 40;
  const cellHeight = 35;
  const width = cols * cellWidth;
  const height = rows * cellHeight;

  const cells = Array.from({ length: total }, (_, i) => i);

  return (
    <div className="visual visual--area-model">
      <svg
        viewBox={`0 0 ${width + 20} ${height + 20}`}
        width="100%"
        height={height + 20}
        role="img"
        aria-label="Area model fraction diagram"
      >
        <g transform="translate(10, 10)">
          {cells.map((idx) => {
            const r = Math.floor(idx / cols);
            const c = idx % cols;
            const isShaded = idx < shaded;
            return (
              <rect
                key={idx}
                x={c * cellWidth}
                y={r * cellHeight}
                width={cellWidth}
                height={cellHeight}
                fill={isShaded ? "var(--accent)" : "var(--surface)"}
                stroke="var(--line-strong)"
                strokeWidth="1.5"
              />
            );
          })}
        </g>
      </svg>
      <p className="visual__caption">
        {shaded} of {total} parts shaded ({shaded}/{total})
      </p>
    </div>
  );
}
