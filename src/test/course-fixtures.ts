export function coursePlan(topicNames: [string, string, string, string]) {
  const topic = (id: string, name: string, prerequisite: string[] = []) => ({
    id,
    name,
    why: `Supports the learner's goal of ${name}.`,
    covers: [name],
    prerequisites: prerequisite,
    objectives: [`Explain ${name}`],
    subtopics: [{ name: `${name} foundations`, objective: `Describe ${name}` }],
    lesson: {
      explanation: `A focused explanation of ${name}.`,
      examples: [{ prompt: `Example of ${name}`, walkthrough: `Work through ${name}.` }],
      guidedPractice: [
        {
          prompt: `Practice ${name}`,
          hint: `Consider ${name}.`,
          successCriteria: `Use ${name} correctly.`,
        },
      ],
    },
    minutes: 15,
  });
  return {
    title: `Journey for ${topicNames[0]}`,
    goal: `Learn ${topicNames[3]}`,
    outcomes: [`Apply ${topicNames[3]}`],
    phases: [
      {
        id: "foundations",
        title: "Foundations",
        purpose: "Build the needed foundations.",
        topics: [topic("topic-1", topicNames[0]), topic("topic-2", topicNames[1], ["topic-1"])],
        assessment: {
          title: "Foundation check",
          purpose: "Apply both foundations.",
          objectiveQuestions: [
            {
              id: "foundations-check",
              objective: "Apply foundations",
              question: "Which result is correct?",
              options: ["0", "1", "2", "3"],
              correctIndex: 1,
              explanation: "The result is 1.",
              hint: "Check the operation.",
              points: 2,
            },
          ],
          openQuestions: [
            {
              id: "foundations-explain",
              objective: "Explain foundations",
              prompt: "Explain your reasoning.",
              referenceCriteria: "The answer should preserve equality.",
              rubric: [{ criterion: "Explains equality", points: 2 }],
              hint: "Describe what happens to both sides.",
            },
          ],
          passCriteria: "Score 80% or more and explain the reasoning.",
        },
      },
      {
        id: "application",
        title: "Application",
        purpose: "Apply the foundations to the goal.",
        topics: [
          topic("topic-3", topicNames[2], ["topic-2"]),
          topic("topic-4", topicNames[3], ["topic-3"]),
        ],
        assessment: {
          title: "Goal challenge",
          purpose: "Demonstrate transfer.",
          objectiveQuestions: [
            {
              id: "application-check",
              objective: "Apply the goal",
              question: "Which result is correct?",
              options: ["0", "1", "2", "3"],
              correctIndex: 1,
              explanation: "The result is 1.",
              hint: "Check the operation.",
              points: 2,
            },
          ],
          openQuestions: [
            {
              id: "application-explain",
              objective: "Explain the goal",
              prompt: "Explain your reasoning.",
              referenceCriteria: "The answer should preserve equality.",
              rubric: [{ criterion: "Explains reasoning", points: 2 }],
              hint: "Describe the key step.",
            },
          ],
          passCriteria: "Score 80% or more and explain the reasoning.",
        },
      },
    ],
  };
}
