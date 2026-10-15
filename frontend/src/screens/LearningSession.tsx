import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { Step } from "../api/types";
import { ExplanationCard } from "../components/ExplanationCard";
import { HypothesisCard } from "../components/HypothesisCard";
import { QuestionCard } from "../components/QuestionCard";
import { Banner } from "../ui/Banner";
import { Button } from "../ui/Button";
import { StatusChip } from "../ui/StatusChip";

interface LearningSessionProps {
  sessionId: string;
  onExit: () => void;
  onFinish: (sessionId: string) => void;
}

export function LearningSession({ sessionId, onExit, onFinish }: LearningSessionProps) {
  const [step, setStep] = useState<Step | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [challenging, setChallenging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function loadStep() {
      try {
        setLoading(true);
        const data = await api.getSessionStep(sessionId);
        if (active) setStep(data.step);
      } catch (e) {
        if (!active) return;
        const err = e instanceof ApiError ? e : new ApiError("error", "Failed to load session step.");
        setError(err.message);
      } finally {
        if (active) setLoading(false);
      }
    }
    loadStep();
    return () => {
      active = false;
    };
  }, [sessionId]);

  async function handleAnswer(optionId: string, hintUsed: boolean) {
    if (!step) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.answerStep(sessionId, step.id, optionId, undefined, hintUsed);
      setStep(res.step);
      if (res.step.kind === "summary") {
        onFinish(sessionId);
      }
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError("error", "Error submitting answer.");
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleChallenge(freeText?: string) {
    if (!step) return;
    setChallenging(true);
    setError(null);
    try {
      const res = await api.challengeHypothesis(sessionId, step.id, freeText);
      setStep(res.step);
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError("error", "Failed to update hypothesis.");
      setError(err.message);
    } finally {
      setChallenging(false);
    }
  }

  async function handleNextAfterExplanation() {
    if (!step) return;
    setSubmitting(true);
    try {
      const res = await api.answerStep(sessionId, step.id);
      setStep(res.step);
      if (res.step.kind === "summary") {
        onFinish(sessionId);
      }
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError("error", "Failed to advance.");
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <main className="session-view session-view--loading">
        <div className="processing-card__spinner" />
        <p>Loading your learning session...</p>
      </main>
    );
  }

  if (!step) {
    return (
      <main className="session-view">
        <Banner>{error || "Session not found."}</Banner>
        <Button onClick={onExit}>Back</Button>
      </main>
    );
  }

  return (
    <main className="session-view">
      {/* Session Top Bar */}
      <header className="session-view__header">
        <Button variant="quiet" onClick={onExit}>
          &times; Leave session
        </Button>
        <div className="session-view__status-wrap">
          <span className="session-view__status-label">Mastery:</span>
          <StatusChip status={step.concept_status_after || step.concept_status_before} />
        </div>
      </header>

      {/* Investigation Strip */}
      {step.note && (
        <div className="investigation-strip" role="status">
          <svg className="investigation-strip__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <span className="investigation-strip__text">{step.note}</span>
        </div>
      )}

      {error && <Banner>{error}</Banner>}

      {/* Question or Follow-up */}
      {step.question && (step.kind === "question" || step.kind === "follow_up") && (
        <section className="session-step">
          <QuestionCard
            question={step.question}
            onAnswer={handleAnswer}
            submitting={submitting}
          />
        </section>
      )}

      {/* Explanation with Grounding & Hypothesis Card */}
      {step.kind === "explanation" && (
        <section className="session-step">
          {step.hypothesis && (
            <HypothesisCard
              hypothesis={step.hypothesis}
              onChallenge={handleChallenge}
              challenging={challenging}
            />
          )}

          {step.explanation && <ExplanationCard explanation={step.explanation} />}

          <div className="session-step__continue">
            <Button disabled={submitting} onClick={handleNextAfterExplanation}>
              {submitting ? "Loading practice..." : "Try a fresh practice question &rarr;"}
            </Button>
          </div>
        </section>
      )}

      {/* Summary Transition */}
      {step.kind === "summary" && (
        <section className="session-step session-step--done">
          <h2 className="session-step__done-title">Session Complete!</h2>
          <p className="session-step__done-desc">
            You've completed this diagnostic cycle. Check your updated progress and before/after mastery below.
          </p>
          <Button onClick={() => onFinish(sessionId)}>View session summary</Button>
        </section>
      )}
    </main>
  );
}
