import { useState } from "react";
import type { Hypothesis } from "../api/types";
import { Button } from "../ui/Button";

interface HypothesisCardProps {
  hypothesis: Hypothesis;
  onChallenge: (freeText?: string) => void;
  challenging?: boolean;
}

export function HypothesisCard({ hypothesis, onChallenge, challenging }: HypothesisCardProps) {
  const [showInput, setShowInput] = useState(false);
  const [justification, setJustification] = useState("");

  const percent = Math.round(hypothesis.probability * 100);
  const isTentative = hypothesis.status === "tentative";

  function handleChallengeSubmit() {
    onChallenge(justification.trim() || undefined);
    setShowInput(false);
  }

  return (
    <div className={`hypothesis-card ${isTentative ? "hypothesis-card--tentative" : ""}`}>
      <div className="hypothesis-card__header">
        <div className="hypothesis-card__badge">
          <span className="hypothesis-card__dot" />
          <span className="hypothesis-card__title">
            {isTentative ? "Possible mistake pattern" : "Identified mistake pattern"}
          </span>
        </div>
        <span className="hypothesis-card__probability">{percent}% confidence</span>
      </div>

      <h3 className="hypothesis-card__label">{hypothesis.label}</h3>
      <p className="hypothesis-card__evidence">{hypothesis.evidence}</p>

      {!showInput ? (
        <div className="hypothesis-card__actions">
          <button
            type="button"
            className="hypothesis-card__challenge-btn"
            disabled={challenging}
            onClick={() => setShowInput(true)}
          >
            That's not why I chose it
          </button>
        </div>
      ) : (
        <div className="hypothesis-card__challenge-form">
          <label htmlFor="challenge-text" className="hypothesis-card__challenge-label">
            Tell the tutor what you were thinking (optional):
          </label>
          <textarea
            id="challenge-text"
            className="hypothesis-card__textarea"
            rows={2}
            value={justification}
            placeholder="e.g. I accidentally misread the denominator..."
            onChange={(e) => setJustification(e.target.value)}
          />
          <div className="hypothesis-card__form-actions">
            <Button variant="quiet" onClick={() => setShowInput(false)}>
              Cancel
            </Button>
            <Button disabled={challenging} onClick={handleChallengeSubmit}>
              {challenging ? "Updating..." : "Update diagnosis"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
