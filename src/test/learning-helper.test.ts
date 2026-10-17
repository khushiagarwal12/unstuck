import { describe, expect, it } from "vitest";

import { runTutor, type Generate } from "@/lib/tutor-core";
import { helperReplySchema } from "@/lib/tutor-schemas";

const response = (mode: string, representation: object, teachingMethod: string | null = null) => ({
  mode,
  title: "A focused explanation",
  explanation: "This keeps the same lesson context.",
  teachingMethod,
  representation,
});

function scripted(reply: object) {
  const prompts: string[] = [];
  const generate: Generate = async ({ prompt }) => {
    prompts.push(prompt);
    return JSON.stringify(reply);
  };
  return { generate, prompts };
}

describe("persistent learning helper", () => {
  it("changes a prose explanation into the requested structured flowchart", async () => {
    const { generate } = scripted(
      response("flowchart", {
        kind: "flowchart",
        nodes: [
          { id: "identify", label: "Identify the known values" },
          { id: "choose", label: "Choose the operation" },
        ],
        edges: [{ from: "identify", to: "choose", label: "then" }],
        textAlternative: "First identify the known values, then choose the operation.",
      }),
    );
    const result = JSON.parse(
      await runTutor(generate, "helper", {
        mode: "flowchart",
        request: "Show this as a flowchart.",
        context: JSON.stringify({ lesson: "A prose explanation of solving equations." }),
      }),
    );
    expect(helperReplySchema.parse(result).representation.kind).toBe("flowchart");
    expect(result.representation.nodes).toHaveLength(2);
    expect(JSON.stringify(result)).not.toMatch(/mermaid|<svg/i);
  });

  it("rejects malformed diagram links and table rows before rendering", () => {
    expect(() =>
      helperReplySchema.parse(
        response("flowchart", {
          kind: "flowchart",
          nodes: [
            { id: "one", label: "One" },
            { id: "two", label: "Two" },
          ],
          edges: [{ from: "one", to: "missing" }],
          textAlternative: "One then two.",
        }),
      ),
    ).toThrow(/edges/);
    expect(() =>
      helperReplySchema.parse(
        response("comparison-table", {
          kind: "comparison-table",
          headers: ["Concept", "Meaning"],
          rows: [["Speed"]],
          textAlternative: "A comparison.",
        }),
      ),
    ).toThrow(/header count/);
  });

  it("requires worked examples and comparison requests to return different structures", async () => {
    const example = scripted(
      response("worked-example", {
        kind: "worked-example",
        steps: ["Start with 8", "Subtract 3 to get 5"],
      }),
    );
    const exampleResult = JSON.parse(
      await runTutor(example.generate, "helper", {
        mode: "worked-example",
        request: "Show an example.",
        context: "Current method is a text explanation.",
      }),
    );
    expect(exampleResult.representation.kind).toBe("worked-example");

    const table = scripted(
      response("comparison-table", {
        kind: "comparison-table",
        headers: ["Concept", "Meaning"],
        rows: [
          ["Speed", "Distance per time"],
          ["Acceleration", "Change in velocity per time"],
        ],
        textAlternative:
          "Speed measures distance per time; acceleration measures how velocity changes over time.",
      }),
    );
    const tableResult = JSON.parse(
      await runTutor(table.generate, "helper", {
        mode: "comparison-table",
        request: "Compare these concepts.",
        context: "Lesson on speed and acceleration.",
      }),
    );
    expect(tableResult.representation.kind).toBe("comparison-table");
    expect(tableResult.representation.rows).toHaveLength(2);
  });

  it("only charts explicitly labeled data values from the supplied material", async () => {
    const valid = scripted(
      response("bar-chart", {
        kind: "bar-chart",
        title: "Counts",
        xLabel: "Group",
        yLabel: "Count",
        bars: [
          { label: "Group A", value: 3 },
          { label: "Group B", value: 7 },
        ],
        textAlternative: "Group B has four more than Group A.",
      }),
    );
    const result = JSON.parse(
      await runTutor(valid.generate, "helper", {
        mode: "bar-chart",
        request: "Chart these values.",
        context: "Material table.",
        numericEvidence: "Group A: 3\nGroup B: 7",
      }),
    );
    expect(result.representation.kind).toBe("bar-chart");

    const invented = scripted(
      response("bar-chart", {
        kind: "bar-chart",
        title: "Counts",
        xLabel: "Group",
        yLabel: "Count",
        bars: [
          { label: "Group A", value: 3 },
          { label: "Group B", value: 70 },
        ],
        textAlternative: "A chart.",
      }),
    );
    await expect(
      runTutor(invented.generate, "helper", {
        mode: "bar-chart",
        request: "Chart these values.",
        context: "Material table.",
        numericEvidence: "Group A: 3\nGroup B: 7",
      }),
    ).rejects.toThrow(/verify chart values/);
  });

  it("returns no chart when the source has no labeled dataset", async () => {
    const { generate } = scripted(
      response("bar-chart", {
        kind: "text",
        body: "I can explain the quantities, but the notes do not provide chartable data.",
        notice: "No labeled numerical dataset was supplied, so no chart is shown.",
      }),
    );
    const result = JSON.parse(
      await runTutor(generate, "helper", {
        mode: "bar-chart",
        request: "Show a chart.",
        context: "The lesson explains 4 + 6.",
        numericEvidence: "The lesson explains 4 + 6.",
      }),
    );
    expect(result.representation.kind).toBe("text");
    expect(result.representation.notice).toMatch(/no chart/i);
  });

  it("limits active-assessment requests to non-answer-revealing hints", async () => {
    const { generate, prompts } = scripted(
      response("hint", {
        kind: "text",
        body: "First identify which quantity is changing; do not calculate it yet.",
      }),
    );
    const result = JSON.parse(
      await runTutor(generate, "helper", {
        mode: "hint",
        request: "Give me a hint.",
        context: "Question: determine the unknown.",
        assessmentActive: true,
      }),
    );
    expect(result.mode).toBe("hint");
    expect(prompts[0]).toContain("never reveal a final answer");
    await expect(
      runTutor(generate, "helper", {
        mode: "worked-example",
        request: "Solve it.",
        context: "Question: determine the unknown.",
        assessmentActive: true,
      }),
    ).rejects.toThrow(/hints only/);

    const verboseHint = scripted(
      response("hint", {
        kind: "text",
        body: "x".repeat(281),
      }),
    );
    await expect(
      runTutor(verboseHint.generate, "helper", {
        mode: "hint",
        request: "Give a hint.",
        context: "Question context.",
      }),
    ).rejects.toThrow(/concise hint/);
  });

  it("rejects a claimed different method that only repeats the current method", async () => {
    const { generate } = scripted(
      response(
        "different-method",
        {
          kind: "text",
          body: "Try the same explanation again.",
          notice: undefined,
        },
        "Visual explanation",
      ),
    );
    await expect(
      runTutor(generate, "helper", {
        mode: "different-method",
        request: "Use a different way.",
        context: "Lesson context.",
        currentMethod: "Visual explanation",
      }),
    ).rejects.toThrow(/different teaching method/);
  });
});
