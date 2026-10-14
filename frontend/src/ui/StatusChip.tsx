import type { MasteryStatus } from "../api/types";

/**
 * One visual language for evidence strength (ARCHITECTURE.md section 9.2):
 *  - hypothesis: dashed amber outline, worded "likely". Never shown as fact.
 *  - demonstrated: solid green with a check.
 */
const LABEL: Record<MasteryStatus | "hypothesis", string> = {
  not_assessed: "Not assessed",
  developing: "Developing",
  demonstrated: "Demonstrated",
  hypothesis: "Likely",
};

export function StatusChip({ status }: { status: MasteryStatus | "hypothesis" }) {
  return (
    <span className={`chip chip--${status}`}>
      {status === "demonstrated" && (
        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12">
          <path d="M2.5 6.5 5 9l4.5-5.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {LABEL[status]}
    </span>
  );
}
