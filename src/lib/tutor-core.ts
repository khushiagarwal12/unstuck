import { promptFor, solvePrompt, SYSTEM } from "./tutor-prompts";
import { type Action, extractJson, normalize, schemas, solveSchema } from "./tutor-schemas";

export type Tier = "main" | "fast";
export type Generate = (req: { system: string; prompt: string; tier: Tier; temperature: number }) => Promise<string>;

export class TutorError extends Error {}

const UNUSABLE = "The tutor couldn't produce a usable answer. Please try again.";
const UNRELIABLE = "The tutor couldn't produce a question it could verify. Please try again.";

async function generateValid(gen: Generate, action: Action, prompt: string, tier: Tier, temperature: number) {
  let note = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await gen({ system: SYSTEM, prompt: prompt + note, tier, temperature });
    try {
      const parsed = schemas[action].parse(JSON.parse(extractJson(raw)));
      return parsed;
    } catch {
      note = "\n\nYour previous reply did not match the required JSON shape. Reply again with only the JSON object.";
    }
  }
  throw new TutorError(UNUSABLE);
}

/** A second, independent call must pick the same answer. Otherwise the key is not trusted. */
export async function keyIsVerified(gen: Generate, question: string, options: string[], correctIndex: number) {
  try {
    const raw = await gen({ system: SYSTEM, prompt: solvePrompt(question, options), tier: "fast", temperature: 0 });
    const { choice } = solveSchema.parse(JSON.parse(extractJson(raw)));
    return choice === correctIndex;
  } catch {
    return false;
  }
}

export async function runTutor(gen: Generate, action: Action, payload: Record<string, unknown>): Promise<string> {
  const tier: Tier = action === "coach" ? "fast" : "main";
  const temperature = action === "diagnose" ? 0.2 : 0.5;

  if (action === "start" || action === "transfer") {
    // Never serve an unverified answer key: regenerate once, then give up.
    for (let attempt = 0; attempt < 2; attempt++) {
      const hint = attempt ? "\n\nA previous draft had an incorrect answer key. Work the problem carefully and double-check correctIndex." : "";
      const q = (await generateValid(gen, action, promptFor(action, payload) + hint, tier, temperature)) as {
        question: string;
        options: ({ text: string } | string)[];
        correctIndex: number;
      };
      const texts = q.options.map((o) => (typeof o === "string" ? o : o.text));
      if (await keyIsVerified(gen, q.question, texts, q.correctIndex)) return JSON.stringify(q);
    }
    throw new TutorError(UNRELIABLE);
  }

  const value = await generateValid(gen, action, promptFor(action, payload), tier, temperature);
  return JSON.stringify(normalize(action, value, payload));
}
