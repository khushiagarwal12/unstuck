import type { VisualSpec } from "../api/types";
import { AreaModel } from "./AreaModel";
import { FractionBar } from "./FractionBar";
import { NumberLine } from "./NumberLine";

export function VisualRenderer({ visual }: { visual?: VisualSpec | null }) {
  if (!visual || visual.type === "none") return null;

  switch (visual.type) {
    case "fraction_bar":
      return <FractionBar params={visual.params} />;
    case "number_line":
      return <NumberLine params={visual.params} />;
    case "area_model":
      return <AreaModel params={visual.params} />;
    default:
      return null;
  }
}
