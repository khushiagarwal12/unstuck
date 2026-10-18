import { Fragment } from "react";

/** Renders **bold**; strips other stray markdown marks. Tolerates spaces Translate adds inside **. */
export function RichText({ text }: { text: string }) {
  const parts = text.replace(/`|__/g, "").split(/\*\*\s*(.+?)\s*\*\*/g);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 ? <strong key={i}>{p}</strong> : <Fragment key={i}>{p.replace(/\*/g, "")}</Fragment>,
      )}
    </>
  );
}