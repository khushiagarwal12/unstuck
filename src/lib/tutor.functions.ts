import { createServerFn } from "@tanstack/react-start";

type Action = "start" | "diagnose" | "intervene" | "transfer" | "course";

const SYSTEM = `You are UNSTUCK, a careful diagnostic tutor. Principle: diagnose before prescribing; never present uncertain inferences as fact; all content must be factually and mathematically correct; answer keys must be verified by working the problem yourself. Always reply with a single JSON object only.`;

function promptFor(action: Action, p: Record<string, unknown>): string {
  const ctx = JSON.stringify(p);
  switch (action) {
    case "start":
      return `Learner is stuck on: ${ctx}.
Create ONE short multiple-choice diagnostic question that tests the core concept, with 4 options where each wrong option corresponds to a distinct plausible misconception.
JSON: {"concept": string (short name), "question": string, "options": [{"text": string, "misconception": string|null}], "correctIndex": number, "why": string (one sentence: why we ask this)}`;
    case "diagnose":
      return `Context: ${ctx}.
The learner answered the diagnostic. Maintain 2-3 plausible hypotheses for their difficulty (e.g. conceptual misunderstanding, missing prerequisite, confusing related concepts, procedural error, misreading, careless slip) using all evidence incl. any follow-up answers and any hypotheses the learner disputed (lower those heavily).
If the evidence does not clearly separate the top two, set needsFollowUp true and give a short follow-up multiple-choice question that discriminates them. Do not ask more than 2 follow-ups total (followUpCount in context).
Write summaries in warm, plain learner language, phrased tentatively ("You may be...").
JSON: {"hypotheses":[{"label": string, "summary": string, "confidence": "low"|"medium"|"high"}], "needsFollowUp": boolean, "followUp": {"question": string, "options": [string], "why": string} | null, "recommendedStyle": "visual"|"example"|"hint"|"simpler"|"analogy"|"prerequisite"}`;
    case "intervene":
      return `Context: ${ctx}.
Write a targeted teaching intervention addressing the top diagnosed difficulty, in the requested style. Styles must differ in representation, not just wording: visual = an ASCII/text diagram plus walkthrough; example = fully worked example step by step; hint = a single graduated hint without the answer; simpler = short plain-language explanation; analogy = real-world analogy mapped to the concept; prerequisite = review the missing prerequisite. Do not repeat previous styles' content (previousStyles in context). Do not reveal the answer to any upcoming question. Use markdown-free plain text; for diagrams put them inside the "diagram" field.
JSON: {"title": string, "body": string, "diagram": string|null, "steps": [string]}`;
    case "course":
      return `Learner profile and goal: ${ctx}.
Design a compact personalized course (4-7 topics) ordered so prerequisites come first. Fit it to their level and available study time. Each topic is a single teachable concept that can be checked with a multiple-choice question. Self-reported level is only a starting signal, so begin with one short check-in topic covering the most likely prerequisite.
JSON: {"title": string, "goal": string, "outcomes": [string], "topics": [{"name": string, "why": string, "prerequisites": [string], "minutes": number}]}`;
    case "transfer":
      return `Context: ${ctx}.
Write ONE transfer question testing the same underlying concept but in a meaningfully different context from the original and previous transfer questions (listed in context). Multiple choice, 4 options, verified answer.
JSON: {"question": string, "options": [string], "correctIndex": number, "context": string (short label of the new context), "explanation": string (why correct answer is correct)}`;
  }
}

export const askTutor = createServerFn({ method: "POST" })
  .inputValidator((d: { action: Action; payload: Record<string, unknown> }) => {
    if (!["start", "diagnose", "intervene", "transfer", "course"].includes(d?.action)) throw new Error("Bad action");
    if (JSON.stringify(d.payload ?? {}).length > 20000) throw new Error("Input too long");
    return d;
  })
  .handler(async ({ data }) => {
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("AI is not configured");
    const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Lovable-API-Key": key,
        "X-Lovable-AIG-SDK": "fetch",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-6-astra",
        instructions: SYSTEM,
        input: [{ role: "user", content: promptFor(data.action, data.payload) }],
        reasoning: { effort: "low" },
        store: false,
        stream: true,
        text: {
          format: {
            type: "json_schema",
            name: "tutor_reply",
            strict: true,
            schema: {
              type: "object",
              properties: { json: { type: "string", description: "The requested JSON object, serialized" } },
              required: ["json"],
              additionalProperties: false,
            },
          },
        },
      }),
    });
    if (res.status === 429) throw new Error("Too many requests right now — wait a moment and retry.");
    if (res.status === 402) throw new Error("AI credits are exhausted for this workspace.");
    if (!res.ok || !res.body) throw new Error(`AI request failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let text = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const d = line.slice(5).trim();
        if (!d || d === "[DONE]") continue;
        try {
          const ev = JSON.parse(d);
          if (ev.type === "response.output_text.delta") text += ev.delta;
          if (ev.type === "error" || ev.type === "response.failed") throw new Error("AI generation failed");
        } catch (e) {
          if (e instanceof Error && e.message === "AI generation failed") throw e;
        }
      }
    }
    const outer = JSON.parse(text) as { json: string };
    const inner = outer.json.replace(/^```(json)?/m, "").replace(/```$/m, "").trim();
    JSON.parse(inner);
    return { json: inner };
  });
