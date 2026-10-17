export type GuestActivityInput = {
  id: string;
  conversionId: string;
  savedAt: string;
  record: {
    concept: string;
    status: string;
    misconceptions: string[];
    styles: string[];
    hintsUsed: number;
    correct: boolean;
    clean: boolean;
    explanation: string | null;
  };
};

export function unverifiedGuestActivity(event: GuestActivityInput) {
  return {
    source: "unverified-guest-history" as const,
    conversion_id: event.conversionId,
    saved_at: event.savedAt,
    record: {
      ...event.record,
      status: "Not assessed" as const,
      clean: false,
    },
  };
}
