/** A line that loops on itself, then runs free. */
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size * 1.5} height={size} viewBox="0 0 36 24" className="mark">
      <path d="M12 4a8 8 0 1 0 0 16 8 8 0 0 0 8-8c0-2 1-4 4-4h10" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
