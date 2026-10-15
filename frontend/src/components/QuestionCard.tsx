import { useState } from "react";
import type { QuestionPublic } from "../api/types";
import { Button } from "../ui/Button";
import { VisualRenderer } from "../visuals/VisualRenderer";

interface QuestionCardProps {
  question: QuestionPublic;
  onAnswer: (optionId: string, hintUsed: boolean) => void;
  submitting?: boolean;
}

export function QuestionCard({ question, onAnswer, submitting }: QuestionCardProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [hintOpen, setHintOpen] = useState(false);

  function handleSubmit() {
    if (!selected) return;
    onAnswer(selected, hintOpen);
  }

  return (
    <div className="question-card">
      <h2 className="question-card__stem">{question.stem}</h2>

      {question.visual && <VisualRenderer visual={question.visual} />}

      <div className="question-card__options" role="radiogroup" aria-label="Answer options">
        {question.options.map((opt) => {
          const isSelected = selected === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              className={`option-btn ${isSelected ? "option-btn--selected" : ""}`}
              onClick={() => setSelected(opt.id)}
            >
              <span className="option-btn__id">{opt.id.toUpperCase()}</span>
              <span className="option-btn__text">{opt.text}</span>
            </button>
          );
        })}
      </div>

      <div className="question-card__footer">
        <div className="question-card__hint-wrap">
          <button
            type="button"
            className="link hint-toggle"
            onClick={() => setHintOpen((o) => !o)}
          >
            {hintOpen ? "Hide hint" : "Need a hint?"}
          </button>
          {hintOpen && (
            <p className="question-card__hint-text">
              Think about how many equal parts the whole is divided into and what each piece represents.
            </p>
          )}
        </div>

        <Button disabled={!selected || submitting} onClick={handleSubmit}>
          {submitting ? "Checking..." : "Submit answer"}
        </Button>
      </div>
    </div>
  );
}
