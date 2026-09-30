/**
 * Prompt copy read by the model: tool description, one-line system prompt
 * snippet, and runtime constraints.
 *
 * Split by responsibility:
 * - snippet     — routing trigger in tools summary.
 * - description — runtime constraints and hard invariants rejected by validator.
 * - guidelines  — execution boundaries in rules.
 * - craft       — question phrasing, frontiers, previews. Offloaded to `asking-well` skill.
 *
 * English locked: models author and receive English; UI renders Czech.
 */

import { MAX_OPTIONS, MAX_QUESTIONS, MIN_OPTIONS } from "./types.js";

export const DEFAULT_PROMPT_SNIPPET =
	`Ask the user up to ${MAX_QUESTIONS} structured multiple-choice questions when the next step requires an executive decision only they can make`;

export const DEFAULT_TOOL_DESCRIPTION = `Ask the user structured multiple-choice questions and wait for their answers.

Runtime constraints (unmet constraints fail validation):
- ${MIN_OPTIONS}-${MAX_OPTIONS} options per question, up to ${MAX_QUESTIONS} questions per invocation.
- Each option requires a concise outcome-oriented label (1-5 words) and a trade-off description.
- An unnamed free-text input and Esc (abandon) are appended automatically by the runtime.
- Attach \`preview\` with ASCII diagrams, UI mockups, or code snippets whenever visual comparison clarifies the choice (single-select only; incompatible with \`multiSelect: true\`).

For question phrasing, frontier batching, and preview design, read the \`asking-well\` skill before invoking.`;

export const DEFAULT_PROMPT_GUIDELINES: string[] = [
	`Invoke when progress blocks on human judgment: architectural trade-offs, preferences, or project scope. Resolve factual unknowns via codebase tools before asking; never ask the user what the filesystem or LSP can answer.`,

	`Batch questions into rounds using the frontier principle: include every question answerable right now in one invocation. Defer dependent questions to a subsequent round after answers are received.`,

	`Place your recommended choice first, suffixed with "(Recommended)". Order remaining options by likelihood. Author labels naming the concrete outcome rather than abstract categories. Provide \`preview\` diagrams for architectural or layout choices.`,
];
