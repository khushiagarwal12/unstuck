import type { ReactNode } from "react";

/** Errors say what happened and what to do. They never apologize or stay vague. */
export function Banner({ tone = "error", children, action }: { tone?: "error" | "info"; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={`banner banner--${tone}`} role={tone === "error" ? "alert" : "status"}>
      <p>{children}</p>
      {action}
    </div>
  );
}
