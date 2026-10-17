import { describe, expect, it } from "vitest";

import { protectCoursePlan } from "@/lib/course-assessment.server";
import { clientAddress } from "@/lib/client-address.server";
import { signCoursePlan, verifyCoursePlan } from "@/lib/plan-signature.server";
import { publicCourseSchema } from "@/lib/tutor-schemas";

import { coursePlan } from "./course-fixtures";

const config = {
  activeKeyId: "current",
  keys: {
    current: "plan-signature-test-secret-long-enough-1",
    old: "plan-signature-old-secret-long-enough-22",
  },
};

async function publicPlan() {
  const json = await protectCoursePlan(JSON.stringify(coursePlan(["A", "B", "C", "D"])), config);
  return publicCourseSchema.parse(JSON.parse(json));
}

describe("course plan signatures", () => {
  it("accepts the plan the server signed", async () => {
    const plan = await publicPlan();
    const signature = await signCoursePlan(plan, config);
    expect(await verifyCoursePlan(plan, signature, config)).toBe(true);
  });

  it("rejects a plan whose phases or prerequisites were edited", async () => {
    const plan = await publicPlan();
    const signature = await signCoursePlan(plan, config);
    const edited = structuredClone(plan);
    edited.phases[1]!.topics[0]!.prerequisites = [];
    expect(await verifyCoursePlan(edited, signature, config)).toBe(false);
    expect(
      await verifyCoursePlan({ ...plan, phases: plan.phases.slice(1) }, signature, config),
    ).toBe(false);
  });

  it("rejects malformed or unknown-key signatures and survives key rotation", async () => {
    const plan = await publicPlan();
    const signature = await signCoursePlan(plan, config);
    expect(await verifyCoursePlan(plan, "garbage", config)).toBe(false);
    expect(await verifyCoursePlan(plan, signature.replace("current", "missing"), config)).toBe(
      false,
    );
    const rotated = { activeKeyId: "old", keys: config.keys };
    expect(await verifyCoursePlan(plan, signature, rotated)).toBe(true);
    expect(
      await verifyCoursePlan(plan, signature, {
        activeKeyId: "old",
        keys: { old: config.keys.old },
      }),
    ).toBe(false);
  });
});

describe("client address for guest rate limits", () => {
  const headers = (values: Record<string, string>) => ({
    get: (name: string) => values[name.toLowerCase()] ?? null,
  });

  it("uses the entry appended by the trusted proxy, not the client-supplied first value", () => {
    expect(clientAddress(headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }), {})).toBe(
      "203.0.113.9",
    );
    expect(
      clientAddress(headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.9, 10.0.0.1" }), {
        TRUSTED_PROXY_HOPS: "2",
      }),
    ).toBe("203.0.113.9");
  });

  it("ignores CF-Connecting-IP unless explicitly trusted", () => {
    const h = headers({ "cf-connecting-ip": "1.2.3.4", "x-forwarded-for": "203.0.113.9" });
    expect(clientAddress(h, {})).toBe("203.0.113.9");
    expect(clientAddress(h, { TRUST_CF_CONNECTING_IP: "true" })).toBe("1.2.3.4");
  });

  it("falls back safely", () => {
    expect(clientAddress(headers({}), {})).toBe("unknown");
    expect(clientAddress(undefined, {})).toBe("unknown");
  });
});
