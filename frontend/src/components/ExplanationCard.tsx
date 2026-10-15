import { useEffect, useState } from "react";
import type { Explanation } from "../api/types";
import { VisualRenderer } from "../visuals/VisualRenderer";

const STRATEGY_LABELS: Record<string, string> = {
  hint: "Hint",
  simplified: "Simpler Explanation",
  worked_example: "Step-by-Step Example",
  analogy_visual: "Visual & Analogy",
  prerequisite_review: "Stepping Back to Basics",
};

export function ExplanationCard({ explanation }: { explanation: Explanation }) {
  const strategyName = STRATEGY_LABELS[explanation.strategy] || "Remediation";
  const [speaking, setSpeaking] = useState(false);
  const speechSupported = typeof window !== "undefined" && "speechSynthesis" in window;

  useEffect(() => {
    return () => {
      if (speechSupported) {
        window.speechSynthesis.cancel();
      }
    };
  }, [speechSupported]);

  const toggleSpeech = () => {
    if (!speechSupported) return;

    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }

    window.speechSynthesis.cancel();
    // Prepare clean speech text
    const cleanBody = explanation.body_markdown.replace(/[*_#`]/g, "");
    const textToSpeak = `${explanation.title}. ${cleanBody}`;

    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    utterance.rate = 0.95; // Slightly slower for clarity in learning
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);

    window.speechSynthesis.speak(utterance);
    setSpeaking(true);
  };

  return (
    <div className="explanation-card">
      <div className="explanation-card__header">
        <div className="explanation-card__badges">
          <span className="chip chip--strategy">{strategyName}</span>
          {explanation.grounded ? (
            <span className="explanation-card__grounded-tag">From your notes</span>
          ) : (
            <span className="explanation-card__general-tag">General explanation, not in your material</span>
          )}
        </div>

        {speechSupported && (
          <button
            type="button"
            className={`btn btn--subtle btn--sm explanation-card__listen-btn ${speaking ? "is-speaking" : ""}`}
            onClick={toggleSpeech}
            title={speaking ? "Stop listening" : "Listen to explanation"}
            aria-label={speaking ? "Stop listening" : "Listen to explanation"}
          >
            {speaking ? (
              <>
                <span className="speech-wave" aria-hidden="true">■</span> Stop
              </>
            ) : (
              <>
                <span aria-hidden="true">🔊</span> Listen
              </>
            )}
          </button>
        )}
      </div>

      <h2 className="explanation-card__title">{explanation.title}</h2>

      <div className="explanation-card__body">
        {explanation.body_markdown.split("\n\n").map((para, i) => (
          <p key={i}>{para}</p>
        ))}
      </div>

      {explanation.visual && <VisualRenderer visual={explanation.visual} />}

      {explanation.source_refs && explanation.source_refs.length > 0 && (
        <div className="citations-list">
          <p className="citations-list__title">References in your material:</p>
          {explanation.source_refs.map((ref, idx) => (
            <div key={idx} className="citation-item">
              <span className="citation-item__page">Page {ref.page}</span>
              <blockquote className="citation-item__quote">"{ref.quote}"</blockquote>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
