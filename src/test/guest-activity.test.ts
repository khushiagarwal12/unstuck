import { describe, expect, it } from "vitest";

import { unverifiedGuestActivity } from "@/lib/guest-activity";

describe("guest account conversion", () => {
  it("preserves history without trusting guest-reported accuracy or mastery", () => {
    const imported = unverifiedGuestActivity({
      id: "stable-event-id",
      conversionId: "stable-conversion-id",
      savedAt: "2026-10-16T00:00:00.000Z",
      record: {
        concept: "Fractions",
        status: "Demonstrated under current criteria",
        misconceptions: ["guest supplied hypothesis"],
        styles: ["example"],
        hintsUsed: 0,
        correct: true,
        clean: true,
        explanation: "guest supplied explanation",
      },
    });
    expect(imported.source).toBe("unverified-guest-history");
    expect(imported.conversion_id).toBe("stable-conversion-id");
    expect(imported.record.status).toBe("Not assessed");
    expect(imported.record.clean).toBe(false);
    expect(imported.record.concept).toBe("Fractions");
  });
});
