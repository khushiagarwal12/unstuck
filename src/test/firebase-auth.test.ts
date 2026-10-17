import { describe, expect, it, vi } from "vitest";

import { verifyFirebaseIdToken } from "@/integrations/firebase/auth-user.server";

describe("Firebase ID token verification", () => {
  it("uses only the UID returned by token verification", async () => {
    const verify = vi.fn().mockResolvedValue({ uid: "trusted-user" });
    await expect(verifyFirebaseIdToken("signed-token", verify)).resolves.toBe("trusted-user");
    expect(verify).toHaveBeenCalledWith("signed-token");
  });

  it("rejects invalid, expired, revoked, or malformed identity claims", async () => {
    await expect(
      verifyFirebaseIdToken("expired", async () => {
        throw new Error("expired");
      }),
    ).rejects.toThrow(/invalid or expired/);
    await expect(verifyFirebaseIdToken("missing-uid", async () => ({ uid: "" }))).rejects.toThrow(
      /invalid or expired/,
    );
  });
});
