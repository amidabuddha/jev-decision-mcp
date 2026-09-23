import { z } from "zod";

const entry = z.union([z.string().min(1), z.record(z.string(), z.json()), z.array(z.json())]);
const description = entry.nullable();
const key = z.string().min(1);
const question = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("choice"),
    instructions: entry,
    criteria: z.record(key, description).refine(
      (value) => Object.keys(value).length >= 1 && Object.keys(value).length <= 255,
      "Choice requires 1 to 255 options",
    ),
  }),
  z.strictObject({
    type: z.literal("score"),
    instructions: entry,
    // A tuple emits draft-07 `items: [...]`, which Codex cannot deserialize.
    // Homogeneous array items preserve the same 2–10-level contract.
    criteria: z.array(entry).min(2).max(10),
  }),
  z.strictObject({
    type: z.literal("noul"),
    instructions: entry,
    criteria: z.strictObject({ true: description.optional(), false: description.optional() }).optional(),
  }),
]);

export const decisionInput = z.strictObject({
  state: entry.describe("Relevant source text or JSON context; include evidence, definitions and policies needed for the questions."),
  questions: z.record(key, question).refine((value) => Object.keys(value).length > 0, "Provide at least one question")
    .describe("Named independent questions over the same state. IDs are not model instructions; write each full judgment in instructions."),
  model: z.string().trim().min(1).optional().describe("Optional TypeSafe model override; defaults to the configured model or jev-latest."),
});
export type DecisionInput = z.infer<typeof decisionInput>;

const probability = z.number().min(0).max(1);
const probabilities = z.record(key, probability);
const answer = z.discriminatedUnion("type", [
  z.object({ type: z.literal("noul"), noul: probability }),
  z.object({ type: z.literal("choice"), choice: z.string(), probabilities, confidence: probability }),
  z.object({ type: z.literal("score"), score: z.number(), legend: z.record(key, description), probabilities, confidence: probability }),
]);
export const decisionOutput = z.object({
  model: z.string().min(1),
  answers: z.record(key, answer),
  usage: z.object({ input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative() }),
});
export type DecisionOutput = z.infer<typeof decisionOutput>;

function sameKeys(actual: object, expected: string[]): boolean {
  return Object.keys(actual).length === expected.length && expected.every((id) => Object.hasOwn(actual, id));
}

export function validateResponse(raw: unknown, input: DecisionInput): DecisionOutput {
  const result = decisionOutput.parse(raw);
  if (!sameKeys(result.answers, Object.keys(input.questions))) throw new Error("Answer IDs do not match questions");
  for (const [id, question] of Object.entries(input.questions)) {
    const answer = result.answers[id];
    if (!answer || answer.type !== question.type) throw new Error("Answer type does not match question");
    if (answer.type === "noul") continue;
    const levels = question.type === "choice" ? Object.keys(question.criteria)
      : question.type === "score" ? question.criteria.map((_, index) => String(index)) : [];
    if (!sameKeys(answer.probabilities, levels)) throw new Error("Probability labels do not match criteria");
    const values = Object.values(answer.probabilities);
    const sum = values.reduce((a, b) => a + b, 0);
    // Jev can return probabilities rounded to two decimals (observed totals
    // include 0.99). Each rounded entry can contribute at most 0.005 error.
    // Keep the tighter check for higher-precision responses, and never
    // normalize the upstream values or accept a distribution with no mass.
    const roundedToCents = values.every((p) => Math.abs(p * 100 - Math.round(p * 100)) < 1e-9);
    const tolerance = roundedToCents ? values.length * 0.005 : 0.001;
    if (sum <= 0 || Math.abs(sum - 1) > tolerance + 1e-12) throw new Error("Probabilities do not sum to one within rounding tolerance");
    if (answer.type === "choice" && !levels.includes(answer.choice)) throw new Error("Unknown choice");
    if (answer.type === "score" && (answer.score < 0 || answer.score > levels.length - 1 || !sameKeys(answer.legend, levels))) {
      throw new Error("Score or legend does not match criteria");
    }
  }
  return result;
}
