import { describe, expect, it } from "vitest";

import {
  appendGuestProgress,
  clearGuestProgress,
  GUEST_PROGRESS_KEY,
  readGuestProgress,
} from "@/lib/guest-progress";
import type { SessionRecord } from "@/components/LearnSession";

const record: SessionRecord = {
  concept: "Fractions",
  status: "Progressing",
  misconceptions: ["Comparing denominators"],
  styles: ["example"],
  hintsUsed: 0,
  correct: true,
  clean: true,
  explanation: "Compared the fractions.",
};

describe("guest progress storage", () => {
  it("persists completed progress and imports it once without discarding concurrent records", () => {
    const storage = window.localStorage;
    storage.removeItem(GUEST_PROGRESS_KEY);
    const conversionId = "00000000-0000-4000-8000-000000000000";
    const first = appendGuestProgress(
      readGuestProgress(storage, conversionId)!,
      record,
      "00000000-0000-4000-8000-000000000001",
    );
    storage.setItem(GUEST_PROGRESS_KEY, JSON.stringify(first));
    expect(readGuestProgress(storage)?.events).toHaveLength(1);

    const second = appendGuestProgress(
      first,
      { ...record, concept: "Decimals" },
      "00000000-0000-4000-8000-000000000002",
    );
    storage.setItem(GUEST_PROGRESS_KEY, JSON.stringify(second));
    clearGuestProgress(
      storage,
      first.conversionId,
      [first.events[0]!.id],
      "00000000-0000-4000-8000-000000000003",
    );

    const remaining = readGuestProgress(storage);
    expect(remaining?.events.map((event) => event.record.concept)).toEqual(["Decimals"]);
    expect(remaining?.conversionId).not.toBe(first.conversionId);
  });
});
