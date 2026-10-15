import { useState } from "react";

interface FractionItem {
  num: number;
  den: number;
  label?: string;
}

export function FractionBar({ params }: { params: { fractions?: FractionItem[] } }) {
  const baseFractions = params.fractions || [
    { num: 2, den: 3, label: "2/3" },
    { num: 3, den: 8, label: "3/8" },
  ];

  const [interactive, setInteractive] = useState(false);
  const [denA, setDenA] = useState(baseFractions[0]?.den || 3);
  const [numA, setNumA] = useState(baseFractions[0]?.num || 2);
  const [denB, setDenB] = useState(baseFractions[1]?.den || 8);
  const [numB, setNumB] = useState(baseFractions[1]?.num || 3);

  const displayFractions: FractionItem[] = interactive
    ? [
        { num: numA, den: denA, label: `${numA}/${denA}` },
        { num: numB, den: denB, label: `${numB}/${denB}` },
      ]
    : baseFractions;

  const width = 360;
  const barHeight = 28;
  const barGap = 32;
  const height = displayFractions.length * (barHeight + barGap) + 20;

  return (
    <div className="visual visual--fraction-bar">
      <svg
        viewBox={`0 0 ${width + 100} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-label="Fraction comparison diagram"
      >
        {displayFractions.map((f, idx) => {
          const y = idx * (barHeight + barGap) + 16;
          const pieceWidth = width / f.den;
          const pieces = Array.from({ length: f.den }, (_, i) => i);

          return (
            <g key={idx} transform={`translate(10, ${y})`}>
              {/* Label */}
              <text
                x="0"
                y={barHeight / 2 + 5}
                className="visual__label"
                fill="var(--ink)"
                fontSize="14"
                fontWeight="600"
              >
                {f.label || `${f.num}/${f.den}`}
              </text>

              {/* Bar Pieces */}
              <g transform="translate(60, 0)">
                {pieces.map((p) => {
                  const isShaded = p < f.num;
                  return (
                    <rect
                      key={p}
                      x={p * pieceWidth}
                      y="0"
                      width={pieceWidth - 1}
                      height={barHeight}
                      rx="3"
                      fill={isShaded ? "var(--accent, #2563eb)" : "var(--line, #e2e8f0)"}
                      stroke="var(--line-strong, #cbd5e1)"
                      strokeWidth="1.5"
                    />
                  );
                })}
              </g>
            </g>
          );
        })}
      </svg>

      <div className="visual__controls">
        <button
          type="button"
          className="link visual__toggle-btn"
          onClick={() => setInteractive(!interactive)}
        >
          {interactive ? "← Back to lesson diagram" : "⚡ Try changing denominators yourself"}
        </button>

        {interactive && (
          <div className="manipulative-panel">
            <div className="manipulative-slider-group">
              <label>
                Top Fraction ({numA}/{denA}):
                <div className="manipulative-inputs">
                  <span>Parts: </span>
                  <input
                    type="range"
                    min="1"
                    max={denA}
                    value={numA}
                    onChange={(e) => setNumA(Number(e.target.value))}
                  />
                  <span>Split into: </span>
                  <input
                    type="range"
                    min="2"
                    max="12"
                    value={denA}
                    onChange={(e) => {
                      const newDen = Number(e.target.value);
                      setDenA(newDen);
                      if (numA > newDen) setNumA(newDen);
                    }}
                  />
                  <span>{denA} pieces</span>
                </div>
              </label>
            </div>

            <div className="manipulative-slider-group">
              <label>
                Bottom Fraction ({numB}/{denB}):
                <div className="manipulative-inputs">
                  <span>Parts: </span>
                  <input
                    type="range"
                    min="1"
                    max={denB}
                    value={numB}
                    onChange={(e) => setNumB(Number(e.target.value))}
                  />
                  <span>Split into: </span>
                  <input
                    type="range"
                    min="2"
                    max="12"
                    value={denB}
                    onChange={(e) => {
                      const newDen = Number(e.target.value);
                      setDenB(newDen);
                      if (numB > newDen) setNumB(newDen);
                    }}
                  />
                  <span>{denB} pieces</span>
                </div>
              </label>
            </div>
          </div>
        )}
      </div>

      <p className="visual__caption">
        Notice piece size: more divisions mean smaller individual parts.
      </p>
    </div>
  );
}
