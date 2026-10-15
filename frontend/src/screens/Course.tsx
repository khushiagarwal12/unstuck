import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { CourseData } from "../api/types";
import { QuestionCard } from "../components/QuestionCard";
import { Banner } from "../ui/Banner";
import { Button } from "../ui/Button";
import { StatusChip } from "../ui/StatusChip";

interface CourseProps {
  courseId: string;
  onBack: () => void;
  onStartModule: (conceptId: string) => void;
}

export function Course({ courseId, onBack, onStartModule }: CourseProps) {
  const [course, setCourse] = useState<CourseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [answeringPlacement, setAnsweringPlacement] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function fetchCourse() {
      try {
        setLoading(true);
        const data = await api.getCourse(courseId);
        if (active) setCourse(data);
      } catch (e) {
        if (!active) return;
        const err = e instanceof ApiError ? e : new ApiError("error", "Failed to load course.");
        setError(err.message);
      } finally {
        if (active) setLoading(false);
      }
    }
    fetchCourse();
    return () => {
      active = false;
    };
  }, [courseId]);

  async function handlePlacementAnswer(optionId: string) {
    if (!course || !course.placementQuestion) return;
    setAnsweringPlacement(true);
    setError(null);
    try {
      const res = await api.answerPlacement(courseId, "step_place", course.placementQuestion.id, optionId);
      setCourse((prev) =>
        prev
          ? {
              ...prev,
              status: res.status as "placement" | "ready",
              plan: res.plan,
              placementQuestion: res.placementQuestion,
            }
          : null,
      );
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError("error", "Error answering placement check.");
      setError(err.message);
    } finally {
      setAnsweringPlacement(false);
    }
  }

  if (loading) {
    return (
      <main className="course-view course-view--loading">
        <p>Loading your AI-guided course roadmap...</p>
      </main>
    );
  }

  if (!course) {
    return (
      <main className="course-view">
        <Banner>{error || "Course not found."}</Banner>
        <Button onClick={onBack}>Back</Button>
      </main>
    );
  }

  const isPlacement = course.status === "placement" && !!course.placementQuestion;

  return (
    <main className="course-view">
      <header className="course-view__header">
        <Button variant="quiet" onClick={onBack}>
          &larr; Back
        </Button>
        <div className="course-view__meta">
          <span className="chip chip--soon">Learn with AI</span>
          <h1 className="course-view__title">{course.topic}</h1>
        </div>
      </header>

      {error && <Banner>{error}</Banner>}

      {/* Placement Check Diagnostic Stage */}
      {isPlacement && course.placementQuestion && (
        <section className="placement-stage">
          <div className="placement-stage__header">
            <h2 className="placement-stage__title">Placement Diagnostic Check</h2>
            <p className="placement-stage__sub">
              Answer this quick question so UNSTUCK can identify what you already know and customize your roadmap.
            </p>
          </div>
          <QuestionCard
            question={course.placementQuestion}
            onAnswer={(opt) => handlePlacementAnswer(opt)}
            submitting={answeringPlacement}
          />
        </section>
      )}

      {/* Tailored Learning Path */}
      {!isPlacement && (
        <section className="course-roadmap">
          <div className="course-roadmap__head">
            <h2 className="course-roadmap__title">Your Personalized Roadmap</h2>
            <p className="course-roadmap__sub">
              Ordered prerequisites first. Confirm modules test knowledge you've shown; Learn modules dive deep.
            </p>
          </div>

          <ol className="roadmap-list">
            {course.plan.map((item, idx) => (
              <li key={item.conceptId} className="roadmap-step">
                <div className="roadmap-step__number">{idx + 1}</div>
                <div className="roadmap-step__content">
                  <div className="roadmap-step__top">
                    <h3 className="roadmap-step__name">{item.name}</h3>
                    <div className="roadmap-step__badges">
                      <span className={`chip chip--module-${item.type}`}>
                        {item.type === "confirm" ? "Confirm Understanding" : "Full Learning Loop"}
                      </span>
                      <StatusChip status={item.masteryStatus} />
                    </div>
                  </div>
                  <p className="roadmap-step__desc">{item.description}</p>
                  <div className="roadmap-step__action">
                    <Button onClick={() => onStartModule(item.conceptId)}>
                      {item.masteryStatus === "demonstrated" ? "Review module" : "Start module &rarr;"}
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
    </main>
  );
}
