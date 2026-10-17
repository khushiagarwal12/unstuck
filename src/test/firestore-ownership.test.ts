import type { Firestore } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";

import { learnerCollection, learnerDocument } from "@/lib/firestore-ownership.server";

function fakeFirestore() {
  return {
    collection: (name: string) => ({
      path: name,
      doc: (id: string) => ({
        path: `${name}/${id}`,
        collection: (child: string) => ({ path: `${name}/${id}/${child}` }),
      }),
    }),
  } as unknown as Firestore;
}

describe("Firestore learner ownership paths", () => {
  it("places each learner's documents and subcollections beneath only that UID", () => {
    const db = fakeFirestore();
    expect(learnerDocument(db, "verified-user-a").path).toBe("users/verified-user-a");
    expect(learnerCollection(db, "verified-user-a", "courses").path).toBe("users/verified-user-a/courses");
    expect(learnerCollection(db, "verified-user-b", "courses").path).toBe("users/verified-user-b/courses");
    expect(learnerCollection(db, "verified-user-a", "courses").path)
      .not.toBe(learnerCollection(db, "verified-user-b", "courses").path);
  });
});
