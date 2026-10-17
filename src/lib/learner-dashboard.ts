export type DashboardTopic = { id: string; name: string };
export type DashboardPhase = {
  id: string;
  title: string;
  topics: DashboardTopic[];
  assessment?: { answerToken?: string | null | undefined };
};
export type DashboardCourse = {
  id: string;
  title: string;
  created_at: string;
  plan: { phases: DashboardPhase[] } | null;
};
export type DashboardProgress = {
  current_phase_id: string | null;
  current_topic_id: string | null;
  completed_topic_ids: string[];
  completed_phase_ids: string[];
  updated_at: string;
};
export type DashboardAttempt = {
  course_id: string;
  phase_id: string;
  created_at: string;
  evaluation: {
    passed: boolean;
    needsFollowUp: boolean;
    percentage: number;
    score: number;
    maxScore: number;
    recommendedAction: string;
  };
};
export type CourseDashboardSummary = {
  course: DashboardCourse;
  completed: boolean;
  started: boolean;
  completedTopicCount: number;
  topicCount: number;
  phaseTitle: string | null;
  next: { kind: "topic"; phaseId: string; topic: DashboardTopic } |
    { kind: "assessment"; phaseId: string; phaseTitle: string } |
    { kind: "complete" } | null;
  lastActivityAt: string | null;
  attemptCount: number;
  latestAttempt: DashboardAttempt | null;
};

export function summarizeCourses(
  courses: DashboardCourse[],
  progressByCourse: Record<string, DashboardProgress>,
  attempts: DashboardAttempt[],
): CourseDashboardSummary[] {
  return courses.map((course) => {
    const progress = progressByCourse[course.id];
    const courseAttempts = attempts.filter((attempt) => attempt.course_id === course.id);
    const phases = course.plan?.phases ?? [];
    const completedTopics = new Set(progress?.completed_topic_ids ?? []);
    const phasesComplete = (phase: DashboardPhase) => phase.assessment?.answerToken
      ? courseAttempts.some((attempt) => attempt.phase_id === phase.id && attempt.evaluation.passed && !attempt.evaluation.needsFollowUp)
      : (progress?.completed_phase_ids ?? []).includes(phase.id);
    const openPhase = phases.find((phase) => !phasesComplete(phase));
    const knownTopicIds = new Set(phases.flatMap((phase) => phase.topics.map((topic) => topic.id)));
    const savedPhase = openPhase?.id === progress?.current_phase_id ? openPhase : undefined;
    const savedTopic = savedPhase?.topics.find((topic) =>
      topic.id === progress?.current_topic_id && !completedTopics.has(topic.id));
    const phaseWithTopicsDone = openPhase?.topics.every((topic) => completedTopics.has(topic.id)) ?? false;
    const nextTopic = openPhase?.topics.find((topic) => !completedTopics.has(topic.id));
    const unfinishedTopic = savedTopic ?? nextTopic;
    const next: CourseDashboardSummary["next"] = !openPhase
      ? phases.length ? { kind: "complete" } : null
      : phaseWithTopicsDone || !unfinishedTopic
        ? { kind: "assessment", phaseId: openPhase.id, phaseTitle: openPhase.title }
        : {
          kind: "topic",
          phaseId: openPhase.id,
          topic: unfinishedTopic,
        };
    const activityDates = [
      progress?.updated_at,
      ...courseAttempts.map((attempt) => attempt.created_at),
    ].filter((value): value is string => !!value).sort((a, b) => Date.parse(b) - Date.parse(a));
    const latestAttempt = courseAttempts.reduce<DashboardAttempt | null>((latest, attempt) =>
      !latest || Date.parse(attempt.created_at) > Date.parse(latest.created_at) ? attempt : latest, null);
    const topicCount = phases.reduce((count, phase) => count + phase.topics.length, 0);
    return {
      course,
      completed: !!phases.length && phases.every(phasesComplete),
      started: !!progress || courseAttempts.length > 0,
      completedTopicCount: Array.from(completedTopics).filter((id) => knownTopicIds.has(id)).length,
      topicCount,
      phaseTitle: openPhase?.title ?? (phases.at(-1)?.title ?? null),
      next,
      lastActivityAt: activityDates[0] ?? null,
      attemptCount: courseAttempts.length,
      latestAttempt,
    };
  }).sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    const activityDifference = Date.parse(b.lastActivityAt ?? b.course.created_at) - Date.parse(a.lastActivityAt ?? a.course.created_at);
    return activityDifference || Date.parse(b.course.created_at) - Date.parse(a.course.created_at);
  });
}

export type ReviewConcept = {
  id: string;
  status: string;
  review_at: string | null;
  updated_at: string;
};

export function rankDueConcepts<T extends ReviewConcept>(concepts: T[], now: number): T[] {
  const attentionRank = (status: string) =>
    status.startsWith("Demonstrated") ? 2 : status === "Progressing" ? 1 : 0;
  return concepts
    .filter((concept) => concept.review_at && Date.parse(concept.review_at) <= now)
    .sort((a, b) => attentionRank(a.status) - attentionRank(b.status) ||
      Date.parse(a.review_at!) - Date.parse(b.review_at!) ||
      Date.parse(a.updated_at) - Date.parse(b.updated_at));
}

export function daysSincePractice(updatedAt: string, now: number): number {
  return Math.max(0, Math.floor((now - Date.parse(updatedAt)) / 86_400_000));
}
