import { describe, expect, it } from "vitest";

import { interveneSchema } from "@/lib/tutor-schemas";

const long = (n: number) => Array.from({ length: n }, (_, i) => `Sentence ${i} explains it.`).join(" ");

describe("intervene steps", () => {
  it("splits over-long steps instead of failing", () => {
    const parsed = interveneSchema.parse({
      style: "example", title: "T", body: "B", diagram: null,
      steps: ["short", long(40), "ok", "x".repeat(900)],
    });
    expect(parsed.steps.length).toBeGreaterThan(4);
    expect(parsed.steps.length).toBeLessThanOrEqual(8);
    expect(parsed.steps.every((s) => s.length > 0 && s.length <= 400)).toBe(true);
  });
});
