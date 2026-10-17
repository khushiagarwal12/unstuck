import { useServerFn } from "@tanstack/react-start";
import { Component, useEffect, useState, type FormEvent, type ReactNode } from "react";

import { askTutor } from "@/lib/tutor.functions";
import { helperModes, helperReplySchema } from "@/lib/tutor-schemas";

type Reply = ReturnType<typeof helperReplySchema.parse>;
type HelperMode = (typeof helperModes)[number];
type Message = {
  role: "learner" | "helper";
  text: string;
  mode: HelperMode;
  reply?: Reply;
};

const labels: Record<HelperMode, string> = {
  simpler: "Explain simply",
  "worked-example": "Worked example",
  hint: "Hint, not answer",
  analogy: "Real-world analogy",
  flowchart: "Flowchart",
  "bar-chart": "Bar chart",
  "comparison-table": "Compare in a table",
  "different-method": "Try another method",
  "incorrect-answer": "Why was I incorrect?",
  "prerequisite-review": "Review a prerequisite",
};

const starters: Record<HelperMode, string> = {
  simpler: "Explain the current idea more simply.",
  "worked-example": "Show a worked example of the current idea.",
  hint: "Give me one hint for the current question without revealing the answer.",
  analogy: "Explain the current idea using a real-world analogy.",
  flowchart: "Show how the current idea works as a flowchart.",
  "bar-chart": "Show a bar chart if the supplied material contains meaningful numerical data.",
  "comparison-table": "Compare the relevant concepts in a table.",
  "different-method": "Teach the same concept using a genuinely different method.",
  "incorrect-answer": "Explain why my submitted answer was incorrect using the feedback available.",
  "prerequisite-review": "Help me review the prerequisite I am missing.",
};

const persistedMessages = (value: unknown): Message[] => {
  if (!Array.isArray(value)) return [];
  return value.slice(-12).flatMap((item): Message[] => {
    if (typeof item !== "object" || item === null) return [];
    const message = item as Record<string, unknown>;
    if (
      (message["role"] !== "learner" && message["role"] !== "helper") ||
      typeof message["text"] !== "string" ||
      message["text"].length > 1800 ||
      !helperModes.includes(message["mode"] as HelperMode)
    )
      return [];
    if (message["role"] === "helper") {
      const parsed = helperReplySchema.safeParse(message["reply"]);
      return parsed.success
        ? [{ role: "helper", mode: parsed.data.mode, text: message["text"], reply: parsed.data }]
        : [];
    }
    return [{ role: "learner", mode: message["mode"] as HelperMode, text: message["text"] }];
  });
};

class VisualBoundary extends Component<
  { children: ReactNode; fallback: string },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    return this.state.failed ? (
      <p role="alert" className="rounded-md bg-secondary p-3 text-sm">
        {this.props.fallback}
      </p>
    ) : (
      this.props.children
    );
  }
}

function Representation({ reply }: { reply: Reply }) {
  const view = reply.representation;
  if (view.kind === "text")
    return (
      <div className="whitespace-pre-line text-sm leading-relaxed">
        {view.body}
        {view.notice && <p className="mt-2 text-xs text-muted-foreground">{view.notice}</p>}
      </div>
    );
  if (view.kind === "worked-example")
    return (
      <ol className="list-decimal space-y-2 pl-5 text-sm">
        {view.steps.map((step, index) => (
          <li key={`${index}-${step}`}>{step}</li>
        ))}
      </ol>
    );
  if (view.kind === "flowchart")
    return (
      <div
        aria-label={`Flowchart: ${view.textAlternative}`}
        className="flex flex-col items-center gap-1"
      >
        {view.nodes.map((node, index) => (
          <div key={node.id} className="flex w-full flex-col items-center">
            <div className="w-full max-w-sm rounded-lg border bg-background p-3 text-center text-sm font-medium">
              {node.label}
            </div>
            {index < view.nodes.length - 1 && (
              <div className="py-1 text-center text-xs text-muted-foreground" aria-hidden="true">
                ↓{" "}
                {
                  view.edges.find(
                    (edge) => edge.from === node.id && edge.to === view.nodes[index + 1]?.id,
                  )?.label
                }
              </div>
            )}
          </div>
        ))}
        <p className="sr-only">{view.textAlternative}</p>
      </div>
    );
  if (view.kind === "bar-chart") {
    const maxMagnitude = Math.max(...view.bars.map((bar) => Math.abs(bar.value)), 1);
    const baseline = 110;
    const scale = 55 / maxMagnitude;
    const step = 480 / view.bars.length;
    return (
      <figure>
        <svg
          viewBox="0 0 480 190"
          role="img"
          aria-label={`${view.title}. ${view.textAlternative}`}
          className="h-auto w-full"
        >
          <text
            x="240"
            y="16"
            textAnchor="middle"
            className="fill-current text-[12px] font-semibold"
          >
            {view.title}
          </text>
          <line x1="24" x2="456" y1={baseline} y2={baseline} className="stroke-current" />
          {view.bars.map((bar, index) => {
            const x = step * index + step * 0.2;
            const width = step * 0.6;
            const height = Math.abs(bar.value) * scale;
            const y = bar.value >= 0 ? baseline - height : baseline;
            return (
              <g key={`${bar.label}-${index}`}>
                <rect
                  x={x}
                  y={y}
                  width={width}
                  height={Math.max(height, 1)}
                  rx="3"
                  className="fill-primary"
                />
                <text
                  x={x + width / 2}
                  y={bar.value >= 0 ? y - 4 : y + height + 12}
                  textAnchor="middle"
                  className="fill-current text-[10px]"
                >
                  {bar.value}
                </text>
                <text
                  x={x + width / 2}
                  y="178"
                  textAnchor="middle"
                  className="fill-current text-[9px]"
                >
                  {bar.label.slice(0, 12)}
                </text>
              </g>
            );
          })}
        </svg>
        <figcaption className="mt-2 text-xs text-muted-foreground">
          {view.xLabel} · {view.yLabel}. {view.textAlternative}
        </figcaption>
        <ul className="sr-only">
          {view.bars.map((bar) => (
            <li key={bar.label}>
              {bar.label}: {bar.value}
            </li>
          ))}
        </ul>
      </figure>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <caption className="sr-only">{view.textAlternative}</caption>
        <thead>
          <tr>
            {view.headers.map((header) => (
              <th key={header} scope="col" className="border-b p-2 font-semibold">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {view.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="border-b p-2 align-top">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="sr-only">{view.textAlternative}</p>
    </div>
  );
}

export function LearningHelper({
  context,
  numericEvidence = "",
  currentMethod,
  assessmentActive = false,
  storageKey,
  onHintUsed,
}: {
  context: string;
  numericEvidence?: string;
  currentMethod?: string | undefined;
  assessmentActive?: boolean | undefined;
  storageKey: string;
  onHintUsed?: (() => void | Promise<void>) | undefined;
}) {
  const ask = useServerFn(askTutor);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<HelperMode>("simpler");
  const [request, setRequest] = useState(starters.simpler);
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hydratedKey, setHydratedKey] = useState<string | null>(null);

  useEffect(() => {
    setHydratedKey(null);
    try {
      const raw = window.localStorage.getItem(storageKey);
      setMessages(raw ? persistedMessages(JSON.parse(raw)) : []);
    } catch {
      setMessages([]);
      setError("Saved helper conversation couldn't be read on this device.");
    }
    setHydratedKey(storageKey);
  }, [storageKey]);

  useEffect(() => {
    if (hydratedKey !== storageKey) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(messages.slice(-12)));
    } catch {
      setError("This helper conversation couldn't be saved on this device.");
    }
  }, [hydratedKey, messages, storageKey]);

  const chooseMode = (next: HelperMode) => {
    if (assessmentActive && next !== "hint") return;
    setMode(next);
    setRequest(starters[next]);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const prompt = request.trim().slice(0, 300);
    if (!prompt || busy || (assessmentActive && mode !== "hint")) return;
    const learnerMessage: Message = { role: "learner", text: prompt, mode };
    const previousMessages = messages;
    setMessages((current) => [...current, learnerMessage].slice(-12));
    setBusy(true);
    setError(null);
    try {
      const { json } = await ask({
        data: {
          action: "helper",
          payload: {
            mode,
            request: prompt,
            context: context.slice(0, 7000),
            numericEvidence: numericEvidence.slice(0, 3000),
            currentMethod,
            assessmentActive,
            history: previousMessages
              .slice(-6)
              .map((item) => ({ mode: item.mode, response: item.text.slice(0, 800) })),
          },
        },
      });
      const reply = helperReplySchema.parse(JSON.parse(json));
      if (reply.mode !== mode)
        throw new Error("The helper response didn't match the selected request format.");
      const representationSummary =
        reply.representation.kind === "text"
          ? reply.representation.body
          : reply.representation.kind === "worked-example"
            ? reply.representation.steps.join(" ")
            : reply.representation.kind === "flowchart"
              ? reply.representation.textAlternative
              : reply.representation.kind === "bar-chart"
                ? reply.representation.textAlternative
                : reply.representation.textAlternative;
      const summary = [
        reply.title,
        reply.explanation,
        reply.teachingMethod ?? "",
        representationSummary,
      ]
        .filter(Boolean)
        .join(". ")
        .slice(0, 1800);
      if (mode === "hint") await onHintUsed?.();
      setMessages((current) =>
        [...current, { role: "helper" as const, mode: reply.mode, text: summary, reply }].slice(
          -12,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "The helper couldn't answer. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="mt-4 rounded-lg border bg-background"
      aria-label="Persistent learning helper"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-3 p-3 text-left font-medium"
      >
        <span>Ask your learning helper</span>
        <span className="text-xs text-muted-foreground">
          {open ? "Hide" : "Open"} · context saved on this device
        </span>
      </button>
      {open && (
        <div className="border-t p-3">
          <div className="flex max-h-80 flex-col gap-3 overflow-y-auto" aria-live="polite">
            {messages.map((message, index) => (
              <article
                key={`${message.role}-${index}`}
                className={`min-w-0 rounded-lg p-3 text-sm ${message.role === "learner" ? "ml-6 bg-secondary" : "mr-2 border"}`}
              >
                {message.role === "learner" ? (
                  <p>{message.text}</p>
                ) : (
                  message.reply && (
                    <div className="space-y-2">
                      <h4 className="font-semibold">{message.reply.title}</h4>
                      <p className="whitespace-pre-line leading-relaxed">
                        {message.reply.explanation}
                      </p>
                      {message.reply.teachingMethod && (
                        <p className="text-xs text-muted-foreground">
                          Method: {message.reply.teachingMethod}
                        </p>
                      )}
                      <VisualBoundary fallback="This visual couldn't be rendered. The explanation above is still available.">
                        <Representation reply={message.reply} />
                      </VisualBoundary>
                    </div>
                  )
                )}
              </article>
            ))}
            {messages.length === 0 && (
              <p className="text-sm text-muted-foreground">
                I’ll use the current lesson, course, and material so you don’t have to repeat the
                topic.
              </p>
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {helperModes.map((item) => (
              <button
                key={item}
                type="button"
                disabled={busy || (assessmentActive && item !== "hint")}
                aria-pressed={mode === item}
                onClick={() => chooseMode(item)}
                className={`rounded-full border px-2.5 py-1 text-xs hover:bg-secondary disabled:opacity-40 ${mode === item ? "border-primary bg-primary/10" : ""}`}
              >
                {labels[item]}
              </button>
            ))}
          </div>
          {assessmentActive && (
            <p className="mt-2 text-xs text-muted-foreground">
              While this assessment is active, the helper only offers a hint and will not solve the
              question.
            </p>
          )}
          <form
            onSubmit={(event) => void submit(event)}
            className="mt-3 flex flex-col gap-2 sm:flex-row"
          >
            <label
              className="sr-only"
              htmlFor={`helper-request-${storageKey.replace(/[^a-zA-Z0-9-]/g, "-")}`}
            >
              Ask the learning helper
            </label>
            <input
              id={`helper-request-${storageKey.replace(/[^a-zA-Z0-9-]/g, "-")}`}
              maxLength={300}
              value={request}
              onChange={(event) => setRequest(event.target.value)}
              className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="Ask about this lesson…"
            />
            <button
              disabled={busy || !request.trim() || (assessmentActive && mode !== "hint")}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {busy ? "Thinking…" : "Ask"}
            </button>
          </form>
          {error && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
