import { createServerFn } from "@tanstack/react-start";
import { FieldPath, type DocumentData, type DocumentReference } from "firebase-admin/firestore";
import { z } from "zod";

import { requireFirebaseAuth } from "@/integrations/firebase/auth-middleware";
import { firestore } from "@/integrations/firebase/admin.server";
import { assignmentResultSchema } from "./course-assessment";
import { learnerCollection, learnerDocument } from "./firestore-ownership.server";
import { unverifiedGuestActivity } from "./guest-activity";
import { enforceSharedLimits } from "./shared-limits.server";
import { publicCourseSchema } from "./tutor-schemas";

const id = z.string().min(1).max(120);
const profilePatch = z.object({
  goal: z.string().trim().max(300).nullable().optional(),
  subject: z.string().trim().max(200).nullable().optional(),
  level: z.string().trim().max(80).nullable().optional(),
  study_minutes: z.number().int().min(5).max(60).optional(),
  preferred_styles: z.array(z.enum(["visual", "example", "simpler", "analogy"])).max(4).optional(),
  onboarded: z.boolean().optional(),
}).strict();
const progressPatch = z.object({
  current_phase_id: z.string().max(40).nullable().optional(),
  current_topic_id: z.string().max(40).nullable().optional(),
  completeTopicId: z.string().max(40).optional(),
  skipTopicIds: z.array(z.string().max(40)).max(100).optional(),
}).strict();
const courseDraft = z.object({
  title: z.string().trim().min(1).max(120),
  goal: z.string().trim().max(300).nullable(),
  outcomes: z.array(z.string().max(200)).max(6),
  topics: z.array(z.object({
    id: id,
    name: z.string().max(80),
    why: z.string().max(300),
    prerequisites: z.array(id).max(4),
    minutes: z.number().int().min(1).max(120),
  })).max(20),
  plan: publicCourseSchema,
});

type UserContext = { userId: string };

function userRef(userId: string) {
  return learnerDocument(firestore(), userId);
}

function subcollection(userId: string, name: string) {
  return learnerCollection(firestore(), userId, name);
}

function plain<T extends DocumentData>(snapshot: { id: string; data: () => T | undefined }, userId: string) {
  return { ...(snapshot.data() ?? {}), id: snapshot.id, user_id: userId };
}

function completedPhases(
  courses: { id: string; plan?: unknown }[],
  attempts: { course_id: string; phase_id: string; evaluation: unknown }[],
) {
  const passed = new Map<string, Set<string>>();
  for (const attempt of attempts) {
    const evaluation = assignmentResultSchema.safeParse(attempt.evaluation);
    if (evaluation.success && evaluation.data.passed && !evaluation.data.needsFollowUp) {
      const phases = passed.get(attempt.course_id) ?? new Set<string>();
      phases.add(attempt.phase_id);
      passed.set(attempt.course_id, phases);
    }
  }
  return Object.fromEntries(courses.map((course) => {
    const plan = publicCourseSchema.safeParse(course.plan);
    return [course.id, plan.success
      ? plan.data.phases.filter((phase) => passed.get(course.id)?.has(phase.id)).map((phase) => phase.id)
      : []];
  }));
}

export const loadWorkspace = createServerFn({ method: "GET" })
  .middleware([requireFirebaseAuth])
  .inputValidator((data: unknown) => z.object({
    displayName: z.string().max(200).nullable().optional(),
    avatarUrl: z.string().url().max(2000).nullable().optional(),
  }).parse(data))
  .handler(async ({ data, context }) => {
    const uid = (context as UserContext).userId;
    await enforceSharedLimits(uid);
    const profileRef = userRef(uid);
    const profile = await firestore().runTransaction(async (transaction) => {
      const snapshot = await transaction.get(profileRef);
      if (snapshot.exists) return { ...snapshot.data(), id: uid };
      const initial = {
        display_name: data.displayName ?? null,
        avatar_url: data.avatarUrl ?? null,
        goal: null,
        subject: null,
        level: null,
        study_minutes: 20,
        preferred_styles: [],
        onboarded: false,
        updated_at: new Date().toISOString(),
      };
      transaction.create(profileRef, initial);
      return { ...initial, id: uid };
    });
    const [concepts, courses, progress, attempts, guestActivity] = await Promise.all([
      subcollection(uid, "concepts").get(),
      subcollection(uid, "courses").get(),
      subcollection(uid, "courseProgress").get(),
      subcollection(uid, "courseAssessmentAttempts").get(),
      subcollection(uid, "guestActivity").orderBy("saved_at", "desc").limit(100).get(),
    ]);
    const courseRows = courses.docs.map((doc) => plain(doc, uid));
    const attemptRows = attempts.docs.map((doc) => plain(doc, uid));
    const progressByCourse = Object.fromEntries(progress.docs.map((doc) => {
      const row = plain(doc, uid);
      return [doc.id, { ...row, course_id: doc.id, completed_phase_ids: [] as string[] }];
    }));
    const computedPhases = completedPhases(courseRows, attemptRows);
    for (const [courseId, phaseIds] of Object.entries(computedPhases)) {
      if (progressByCourse[courseId]) progressByCourse[courseId]!.completed_phase_ids = phaseIds;
    }
    return {
      profile,
      concepts: concepts.docs.map((doc) => plain(doc, uid)),
      courses: courseRows,
      courseProgress: progressByCourse,
      assessmentAttempts: attemptRows,
      guestActivity: guestActivity.docs.map((doc) => plain(doc, uid)),
    };
  });

export const saveProfile = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((data: unknown) => profilePatch.parse(data))
  .handler(async ({ data, context }) => {
    const uid = (context as UserContext).userId;
    await enforceSharedLimits(uid);
    const ref = userRef(uid);
    await ref.set({ ...data, updated_at: new Date().toISOString() }, { merge: true });
    const snapshot = await ref.get();
    return { ...snapshot.data(), id: uid };
  });

export const saveCourse = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((data: unknown) => courseDraft.parse(data))
  .handler(async ({ data, context }) => {
    const uid = (context as UserContext).userId;
    await enforceSharedLimits(uid);
    const courseId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const row = { ...data, id: courseId, user_id: uid, created_at: createdAt };
    await subcollection(uid, "courses").doc(courseId).create(row);
    return row;
  });

export const deleteCourse = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((data: unknown) => z.object({ courseId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const uid = (context as UserContext).userId;
    await enforceSharedLimits(uid);
    const courseRef = subcollection(uid, "courses").doc(data.courseId);
    const course = await courseRef.get();
    if (!course.exists) throw new Error("This course was not found in your account.");
    const refs: DocumentReference[] = [
      courseRef,
      subcollection(uid, "courseProgress").doc(data.courseId),
    ];
    const attempts = await subcollection(uid, "courseAssessmentAttempts")
      .where("course_id", "==", data.courseId)
      .select(FieldPath.documentId())
      .get();
    refs.push(...attempts.docs.map((doc) => doc.ref));
    const hints = await subcollection(uid, "courseAssessmentHints")
      .where("course_id", "==", data.courseId)
      .select(FieldPath.documentId())
      .get();
    refs.push(...hints.docs.map((doc) => doc.ref));
    for (let start = 0; start < refs.length; start += 450) {
      const batch = firestore().batch();
      refs.slice(start, start + 450).forEach((ref) => batch.delete(ref));
      await batch.commit();
    }
    return { deleted: true };
  });

export const saveCourseProgress = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((data: unknown) => z.object({ courseId: z.string().uuid(), patch: progressPatch }).parse(data))
  .handler(async ({ data, context }) => {
    const uid = (context as UserContext).userId;
    await enforceSharedLimits(uid);
    const db = firestore();
    const courseRef = subcollection(uid, "courses").doc(data.courseId);
    const progressRef = subcollection(uid, "courseProgress").doc(data.courseId);
    const attemptsQuery = subcollection(uid, "courseAssessmentAttempts").where("course_id", "==", data.courseId);
    const conceptsQuery = subcollection(uid, "concepts");
    return db.runTransaction(async (transaction) => {
    const [courseSnapshot, progressSnapshot, attemptsSnapshot, conceptsSnapshot] = await Promise.all([
      transaction.get(courseRef),
      transaction.get(progressRef),
      transaction.get(attemptsQuery),
      transaction.get(conceptsQuery),
    ]);
    if (!courseSnapshot.exists) throw new Error("This course was not found in your account.");
    const courseData = courseSnapshot.data();
    const plan = publicCourseSchema.safeParse(courseData?.plan);
    if (!plan.success) throw new Error("This course plan could not be validated. Please reload it.");
    const existing = progressSnapshot.data() ?? {};
    const attempts = attemptsSnapshot.docs.map((doc) => doc.data());
    const donePhases = new Set(attempts.flatMap((attempt) => {
      const result = assignmentResultSchema.safeParse(attempt.evaluation);
      return result.success && result.data.passed && !result.data.needsFollowUp ? [attempt.phase_id as string] : [];
    }));
    const allTopics = plan.data.phases.flatMap((phase) => phase.topics.map((topic) => ({ phase, topic })));
    const existingCompleted = Array.isArray(existing.completed_topic_ids) ? existing.completed_topic_ids as string[] : [];
    const conceptRows = new Map(conceptsSnapshot.docs.map((doc) => {
      const row = doc.data();
      return [typeof row.concept === "string" ? row.concept.toLowerCase() : "", row];
    }));
    const skipIds = Array.from(new Set(data.patch.skipTopicIds ?? []));
    const newlyCompleted = Array.from(new Set([
      ...existingCompleted,
      ...skipIds,
      ...(data.patch.completeTopicId ? [data.patch.completeTopicId] : []),
    ]));
    for (const topicId of skipIds) {
      const entry = allTopics.find(({ topic }) => topic.id === topicId);
      if (!entry) throw new Error("This progress update contains a lesson outside the saved course.");
      const hasDemonstratedCoverage = entry.topic.covers.length > 0 && entry.topic.covers.every((name) => {
        const concept = conceptRows.get(name.toLowerCase());
        return typeof concept?.status === "string" &&
          concept.status.startsWith("Demonstrated") &&
          typeof concept.clean_successes === "number" && concept.clean_successes >= 2;
      });
      if (!existingCompleted.includes(topicId) && !hasDemonstratedCoverage) {
        throw new Error("This lesson can only be skipped when its concepts have independently demonstrated evidence.");
      }
      const priorPhases = plan.data.phases.slice(0, plan.data.phases.findIndex((phase) => phase.id === entry.phase.id));
      if (priorPhases.some((phase) => !donePhases.has(phase.id))) {
        throw new Error("Complete the previous phase assignment before recording this lesson.");
      }
    }
    if (data.patch.completeTopicId) {
      const entry = allTopics.find(({ topic }) => topic.id === data.patch.completeTopicId);
      if (!entry) throw new Error("This progress update contains a lesson outside the saved course.");
      if (entry.topic.prerequisites.some((prerequisite) => !newlyCompleted.includes(prerequisite))) {
        throw new Error("Complete the lesson prerequisites before completing this lesson.");
      }
      const phaseIndex = plan.data.phases.findIndex((phase) => phase.id === entry.phase.id);
      if (plan.data.phases.slice(0, phaseIndex).some((phase) => !donePhases.has(phase.id))) {
        throw new Error("Complete the previous phase assignment before recording this lesson.");
      }
    }
    const phaseId = data.patch.current_phase_id ?? null;
    const topicId = data.patch.current_topic_id ?? null;
    if (phaseId !== null) {
      const phaseIndex = plan.data.phases.findIndex((phase) => phase.id === phaseId);
      if (phaseIndex < 0 || plan.data.phases.slice(0, phaseIndex).some((phase) => !donePhases.has(phase.id))) {
        throw new Error("This phase is not available yet. Complete the previous phase assignment first.");
      }
    }
    if (topicId !== null) {
      const entry = allTopics.find(({ phase, topic }) => phase.id === phaseId && topic.id === topicId);
      if (!entry) throw new Error("This lesson does not belong to the selected course phase.");
      if (entry.topic.prerequisites.some((prerequisite) => !newlyCompleted.includes(prerequisite))) {
        throw new Error("Complete the lesson prerequisites before opening this lesson.");
      }
    }
    const next = {
      current_phase_id: data.patch.current_phase_id === undefined ? existing.current_phase_id ?? null : phaseId,
      current_topic_id: data.patch.current_topic_id === undefined ? existing.current_topic_id ?? null : topicId,
      completed_topic_ids: newlyCompleted,
      updated_at: new Date().toISOString(),
    };
    transaction.set(progressRef, next, { merge: true });
    return { ...next, user_id: uid, course_id: data.courseId, completed_phase_ids: [...donePhases] };
    });
  });

export const deleteConcept = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((data: unknown) => z.object({ conceptId: z.string().regex(/^[a-f0-9]{64}$/) }).parse(data))
  .handler(async ({ data, context }) => {
    const uid = (context as UserContext).userId;
    await enforceSharedLimits(uid);
    await subcollection(uid, "concepts").doc(data.conceptId).delete();
    return { deleted: true };
  });

export const rescheduleConcept = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((data: unknown) => z.object({ conceptId: z.string().regex(/^[a-f0-9]{64}$/) }).parse(data))
  .handler(async ({ data, context }) => {
    const uid = (context as UserContext).userId;
    await enforceSharedLimits(uid);
    const ref = subcollection(uid, "concepts").doc(data.conceptId);
    const at = new Date(Date.now() + 7 * 86400000).toISOString();
    const snapshot = await ref.get();
    if (!snapshot.exists) throw new Error("This concept history was not found in your account.");
    await ref.update({ review_at: at, updated_at: new Date().toISOString() });
    return { review_at: at };
  });

export const recordLearningHint = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((data: unknown) => z.object({ concept: z.string().trim().min(1).max(80) }).parse(data))
  .handler(async ({ data, context }) => {
    const uid = (context as UserContext).userId;
    await enforceSharedLimits(uid);
    const { recordLearningHint: recordHint } = await import("./learning-evidence.server");
    await recordHint(uid, data.concept);
    return { recorded: true };
  });

export const importGuestProgress = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((data: unknown) => z.object({
    conversionId: z.string().uuid(),
    events: z.array(z.object({
      id: z.string().uuid(),
      savedAt: z.string().datetime(),
      record: z.object({
        concept: z.string().trim().min(1).max(200),
        status: z.enum(["Not assessed", "Needs more practice", "Progressing", "Demonstrated under current criteria"]),
        misconceptions: z.array(z.string().max(400)).max(10),
        styles: z.array(z.enum(["visual", "example", "hint", "simpler", "analogy", "prerequisite"])).max(20),
        hintsUsed: z.number().int().min(0).max(100),
        correct: z.boolean(),
        clean: z.boolean(),
        explanation: z.string().max(3000).nullable(),
      }),
    })).max(500),
  }).parse(data))
  .handler(async ({ data, context }) => {
    const uid = (context as UserContext).userId;
    await enforceSharedLimits(uid);
    const events = subcollection(uid, "guestActivity");
    let imported = 0;
    const uniqueEvents = Array.from(new Map(data.events.map((event) => [event.id, event])).values());
    for (let start = 0; start < uniqueEvents.length; start += 100) {
      const chunk = uniqueEvents.slice(start, start + 100);
      const count = await firestore().runTransaction(async (transaction) => {
        const refs = chunk.map((event) => events.doc(event.id));
        const snapshots = await transaction.getAll(...refs);
        let inserted = 0;
        snapshots.forEach((snapshot, index) => {
          if (snapshot.exists) return;
          const event = chunk[index]!;
          transaction.create(refs[index]!, unverifiedGuestActivity({
            id: event.id,
            conversionId: data.conversionId,
            savedAt: event.savedAt,
            record: event.record,
          }));
          inserted++;
        });
        return inserted;
      });
      imported += count;
    }
    return { imported };
  });
