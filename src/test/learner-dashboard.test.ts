import { describe, expect, it } from "vitest";

import { daysSincePractice, rankDueConcepts, summarizeCourses } from "@/lib/learner-dashboard";

const plan = {
  phases: [
    {
      id: "phase-1",
      title: "Foundations",
      topics: [{ id: "topic-1", name: "Fractions" }],
      assessment: { answerToken: "signed" },
    },
    {
      id: "phase-2",
      title: "Applications",
      topics: [{ id: "topic-2", name: "Ratios" }],
      assessment: { answerToken: "signed" },
    },
  ],
};
const course = { id: "course-1", title: "Math", created_at: "2026-01-01T00:00:00.000Z", plan };
const passed = {
  course_id: "course-1",
  phase_id: "phase-1",
  created_at: "2026-02-01T00:00:00.000Z",
  evaluation: {
    passed: true,
    needsFollowUp: false,
    percentage: 90,
    score: 9,
    maxScore: 10,
    recommendedAction: "advance",
  },
};

describe("learner dashboard summaries", () => {
  it("leaves a brand-new learner without fabricated courses or history", () => {
    expect(summarizeCourses([], {}, [])).toEqual([]);
  });

  it("shows a new learner the first actual course lesson without inventing activity", () => {
    const [summary] = summarizeCourses([course], {}, []);
    expect(summary?.started).toBe(false);
    expect(summary?.lastActivityAt).toBeNull();
    expect(summary?.next).toEqual({
      kind: "topic",
      phaseId: "phase-1",
      topic: { id: "topic-1", name: "Fractions" },
    });
  });

  it("resumes a returning learner at the saved, incomplete topic", () => {
    const [summary] = summarizeCourses(
      [course],
      {
        "course-1": {
          current_phase_id: "phase-2",
          current_topic_id: "topic-2",
          completed_topic_ids: ["topic-1"],
          completed_phase_ids: [],
          updated_at: "2026-03-01T00:00:00.000Z",
        },
      },
      [passed],
    );
    expect(summary?.started).toBe(true);
    expect(summary?.phaseTitle).toBe("Applications");
    expect(summary?.next).toEqual({
      kind: "topic",
      phaseId: "phase-2",
      topic: { id: "topic-2", name: "Ratios" },
    });
  });

  it("marks a course complete only when every phase has a passing assessment", () => {
    const [incomplete] = summarizeCourses([course], {}, [passed]);
    expect(incomplete?.completed).toBe(false);
    const secondPhase = { ...passed, phase_id: "phase-2", created_at: "2026-02-02T00:00:00.000Z" };
    const [complete] = summarizeCourses([course], {}, [passed, secondPhase]);
    expect(complete?.completed).toBe(true);
    expect(complete?.next).toEqual({ kind: "complete" });
    const unclear = {
      ...secondPhase,
      evaluation: { ...secondPhase.evaluation, needsFollowUp: true },
    };
    expect(summarizeCourses([course], {}, [passed, unclear])[0]?.completed).toBe(false);
  });

  it("prioritizes active courses ahead of completed ones and sorts active work by recent progress", () => {
    const olderCourse = {
      ...course,
      id: "older",
      title: "Earlier course",
      created_at: "2025-01-01T00:00:00.000Z",
    };
    const recentCourse = {
      ...course,
      id: "recent",
      title: "Recent course",
      created_at: "2026-04-01T00:00:00.000Z",
    };
    const completionHistory = [
      { ...passed, course_id: "older" },
      { ...passed, course_id: "older", phase_id: "phase-2" },
    ];
    const summaries = summarizeCourses(
      [olderCourse, recentCourse],
      {
        older: {
          current_phase_id: "phase-2",
          current_topic_id: "topic-2",
          completed_topic_ids: ["topic-1"],
          completed_phase_ids: [],
          updated_at: "2026-05-01T00:00:00.000Z",
        },
        recent: {
          current_phase_id: "phase-1",
          current_topic_id: "topic-1",
          completed_topic_ids: [],
          completed_phase_ids: [],
          updated_at: "2026-05-10T00:00:00.000Z",
        },
      },
      completionHistory,
    );
    expect(summaries.map((summary) => summary.course.id)).toEqual(["recent", "older"]);
  });

  it("prioritizes due concepts still developing over demonstrated concepts", () => {
    const now = Date.parse("2026-05-01T00:00:00.000Z");
    const concepts = [
      {
        id: "demonstrated",
        status: "Demonstrated under current criteria",
        review_at: "2026-04-01T00:00:00.000Z",
        updated_at: "2026-04-01T00:00:00.000Z",
      },
      {
        id: "developing",
        status: "Progressing",
        review_at: "2026-04-15T00:00:00.000Z",
        updated_at: "2026-04-20T00:00:00.000Z",
      },
      {
        id: "gap",
        status: "Needs more practice",
        review_at: "2026-04-20T00:00:00.000Z",
        updated_at: "2026-04-28T00:00:00.000Z",
      },
      {
        id: "not-due",
        status: "Needs more practice",
        review_at: "2026-06-01T00:00:00.000Z",
        updated_at: "2026-04-28T00:00:00.000Z",
      },
    ];
    expect(rankDueConcepts(concepts, now).map((concept) => concept.id)).toEqual([
      "gap",
      "developing",
      "demonstrated",
    ]);
    expect(daysSincePractice("2026-04-28T00:00:00.000Z", now)).toBe(3);
  });
});
