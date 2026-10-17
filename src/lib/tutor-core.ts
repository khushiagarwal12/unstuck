import { promptFor, solvePrompt, SYSTEM } from "./tutor-prompts";
import {
  type Action,
  extractJson,
  helperRequestSchema,
  normalize,
  schemas,
  solveSchema,
} from "./tutor-schemas";

export type Tier = "main" | "fast";
export type ImageInput = { mimeType: string; data: string }; // data is base64
export type Generate = (req: {
  system: string;
  prompt: string;
  tier: Tier;
  temperature: number;
  image?: ImageInput;
}) => Promise<string>;

export class TutorError extends Error {}

const UNUSABLE = "The tutor couldn't produce a usable answer. Please try again.";
const UNRELIABLE = "The tutor couldn't produce a question it could verify. Please try again.";

async function generateValid(
  gen: Generate,
  action: Action,
  prompt: string,
  tier: Tier,
  temperature: number,
) {
  let note = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await gen({ system: SYSTEM, prompt: prompt + note, tier, temperature });
    try {
      const parsed = schemas[action].parse(JSON.parse(extractJson(raw)));
      return parsed;
    } catch {
      note =
        "\n\nYour previous reply did not match the required JSON shape. Reply again with only the JSON object.";
    }
  }
  throw new TutorError(UNUSABLE);
}

/** A second, independent call must pick the same answer. Otherwise the key is not trusted. */
export async function keyIsVerified(
  gen: Generate,
  question: string,
  options: string[],
  correctIndex: number,
) {
  try {
    const raw = await gen({
      system: SYSTEM,
      prompt: solvePrompt(question, options),
      tier: "fast",
      temperature: 0,
    });
    const { choice } = solveSchema.parse(JSON.parse(extractJson(raw)));
    return choice === correctIndex;
  } catch {
    return false;
  }
}

export async function runTutor(
  gen: Generate,
  action: Action,
  payload: Record<string, unknown>,
): Promise<string> {
  const tier: Tier = action === "coach" ? "fast" : "main";
  const temperature = action === "diagnose" ? 0.2 : 0.5;

  if (action === "start" || action === "transfer") {
    // Never serve an unverified answer key: regenerate once, then give up.
    for (let attempt = 0; attempt < 2; attempt++) {
      const hint = attempt
        ? "\n\nA previous draft had an incorrect answer key. Work the problem carefully and double-check correctIndex."
        : "";
      const q = (await generateValid(
        gen,
        action,
        promptFor(action, payload) + hint,
        tier,
        temperature,
      )) as {
        question: string;
        options: ({ text: string } | string)[];
        correctIndex: number;
      };
      const texts = q.options.map((o) => (typeof o === "string" ? o : o.text));
      if (await keyIsVerified(gen, q.question, texts, q.correctIndex)) return JSON.stringify(q);
    }
    throw new TutorError(UNRELIABLE);
  }

  if (action === "course") {
    for (let attempt = 0; attempt < 2; attempt++) {
      const note = attempt
        ? "\n\nA previous course assignment had an answer key that did not match an independent solve. Rework each objective question and verify its correctIndex."
        : "";
      const value = await generateValid(
        gen,
        action,
        promptFor(action, payload) + note,
        tier,
        temperature,
      );
      const plan = normalize(action, value, payload) as {
        phases: {
          assessment: {
            objectiveQuestions: { question: string; options: string[]; correctIndex: number }[];
          };
        }[];
      };
      const checks = await Promise.all(
        plan.phases.flatMap((phase) =>
          phase.assessment.objectiveQuestions.map((question) =>
            keyIsVerified(gen, question.question, question.options, question.correctIndex),
          ),
        ),
      );
      if (checks.every(Boolean)) return JSON.stringify(plan);
    }
    throw new TutorError(
      "The tutor couldn't create an assignment with verified answer keys. Please try again.",
    );
  }

  if (action === "helper") {
    const request = helperRequestSchema.parse(payload);
    if (request.assessmentActive && request.mode !== "hint") {
      throw new TutorError("During an active assessment, the helper can provide hints only.");
    }
    const value = (await generateValid(gen, action, promptFor(action, request), "fast", 0.3)) as {
      mode: typeof request.mode;
      teachingMethod: string | null;
      representation: {
        kind: string;
        notice?: string;
        body?: string;
        bars?: { label: string; value: number }[];
      };
    };
    if (value.mode !== request.mode)
      throw new TutorError("The helper couldn't honor that format request. Please try again.");
    const expectedRepresentation: Record<string, string> = {
      simpler: "text",
      "worked-example": "worked-example",
      hint: "text",
      analogy: "text",
      flowchart: "flowchart",
      "different-method": "text",
      "incorrect-answer": "text",
      "prerequisite-review": "text",
      "comparison-table": "comparison-table",
    };
    const expected = expectedRepresentation[request.mode];
    if (expected && value.representation.kind !== expected) {
      throw new TutorError(
        "The helper couldn't create the requested representation. Please try again.",
      );
    }
    if (request.mode === "different-method") {
      const currentTokens = new Set(request.currentMethod?.toLowerCase().match(/[a-z0-9]+/g) ?? []);
      const nextTokens = new Set(value.teachingMethod?.toLowerCase().match(/[a-z0-9]+/g) ?? []);
      const overlap = [...currentTokens].filter((token) => nextTokens.has(token)).length;
      if (
        !value.teachingMethod ||
        (currentTokens.size > 0 && overlap / currentTokens.size >= 0.7)
      ) {
        throw new TutorError(
          "The helper couldn't provide a clearly different teaching method. Please try again.",
        );
      }
    }
    if (
      request.mode === "hint" &&
      (value.representation.kind !== "text" ||
        (value.representation.body?.length ?? 0) > 280 ||
        JSON.stringify(value).length > 1000)
    ) {
      throw new TutorError(
        "The helper couldn't produce a concise hint without exposing a solution. Please try again.",
      );
    }
    if (request.mode === "bar-chart") {
      const sourcePairs = request.numericEvidence.split(/\r?\n/).flatMap((line) => {
        const match = /^\s*([A-Za-z][A-Za-z0-9 _-]{0,39})\s*[:,=]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(
          line,
        );
        return match ? [{ label: match[1]!.trim().toLowerCase(), value: Number(match[2]) }] : [];
      });
      const hasMeaningfulData =
        sourcePairs.length >= 2 && new Set(sourcePairs.map((pair) => pair.label)).size >= 2;
      if (value.representation.kind === "bar-chart") {
        const bars = value.representation.bars ?? [];
        if (
          !hasMeaningfulData ||
          bars.some(
            (bar) =>
              !sourcePairs.some(
                (pair) => pair.label === bar.label.trim().toLowerCase() && pair.value === bar.value,
              ),
          )
        ) {
          throw new TutorError(
            "The helper couldn't verify chart values in the supplied material. No chart was shown.",
          );
        }
      } else if (hasMeaningfulData || !value.representation.notice) {
        throw new TutorError("The helper couldn't honor the chart request. Please try again.");
      }
    }
    return JSON.stringify(value);
  }

  const value = await generateValid(gen, action, promptFor(action, payload), tier, temperature);
  return JSON.stringify(normalize(action, value, payload));
}
