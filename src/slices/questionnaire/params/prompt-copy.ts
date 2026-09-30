/**
 * Prompt copy read by the model: tool description, one-line system prompt
 * snippet, and runtime constraints.
 *
 * Supports two presets:
 * - "concise" (default): Lean ~215-word positive prompt referencing `asking-well` skill.
 * - "legacy": Original upstream v2.11.0 567-word verbose prompt.
 *
 * Switchable via `preset` field in `~/.config/pi-ask-user-cz/config.json`.
 */

import { MAX_OPTIONS, MAX_QUESTIONS, MIN_OPTIONS } from "./types.js";

export type GuidancePreset = "concise" | "legacy";

/* =========================================================================
 * 1. CONCISE PRESET (Default)
 * ========================================================================= */

export const CONCISE_PROMPT_SNIPPET =
	`Ask the user up to ${MAX_QUESTIONS} structured multiple-choice questions when the next step requires an executive decision only they can make`;

export const CONCISE_TOOL_DESCRIPTION = `Ask the user structured multiple-choice questions and wait for their answers.

Runtime constraints (unmet constraints fail validation):
- ${MIN_OPTIONS}-${MAX_OPTIONS} options per question, up to ${MAX_QUESTIONS} questions per invocation.
- Each option requires a concise outcome-oriented label (1-5 words) and a trade-off description.
- An unnamed free-text input and Esc (abandon) are appended automatically by the runtime.
- Attach \`preview\` with ASCII diagrams, UI mockups, or code snippets whenever visual comparison clarifies the choice (single-select only; incompatible with \`multiSelect: true\`).

For question phrasing, frontier batching, and preview design, read the \`asking-well\` skill before invoking.`;

export const CONCISE_PROMPT_GUIDELINES: string[] = [
	`Invoke when progress blocks on human judgment: architectural trade-offs, preferences, or project scope. Resolve factual unknowns via codebase tools before asking; never ask the user what the filesystem or LSP can answer.`,

	`Batch questions into rounds using the frontier principle: include every question answerable right now in one invocation. Defer dependent questions to a subsequent round after answers are received.`,

	`Place your recommended choice first, suffixed with "(Recommended)". Order remaining options by likelihood. Author labels naming the concrete outcome rather than abstract categories. Provide \`preview\` diagrams for architectural or layout choices.`,
];

/* =========================================================================
 * 2. LEGACY PRESET (Upstream v2.11.0)
 * ========================================================================= */

export const LEGACY_PROMPT_SNIPPET =
	`Ask the user up to ${MAX_QUESTIONS} structured questions (${MIN_OPTIONS}-${MAX_OPTIONS} options each) when requirements are ambiguous`;

export const LEGACY_PROMPT_GUIDELINES: string[] = [
	`Use ask_user_question whenever the user's request is underspecified and you cannot proceed without concrete decisions — you can ask up to ${MAX_QUESTIONS} questions per invocation.`,
	`Each question MUST have ${MIN_OPTIONS}-${MAX_OPTIONS} options. Every option requires a concise label (1-5 words) and a description explaining what the choice means or its trade-offs. The user can additionally type a custom answer via the automatically appended "Type something." row on every question, or press Esc to abandon the questionnaire. Do NOT author "Other" or "Type something." labels yourself — reserved labels are rejected at runtime.`,
	`Set multiSelect: true when multiple answers are valid. Provide an options[].preview markdown string when an option benefits from richer side-by-side context (mockups, code snippets, diagrams, configs) — single-select only. The "Type something." row is appended to every question; in preview mode it expands to the full pane width while typing so the custom answer is not cramped into the narrow options column. If you recommend a specific option, make that the first option and append "(Recommended)" to its label.`,
	"Do not stack multiple ask_user_question calls back-to-back — group all clarifying questions into one invocation.",
];

export const LEGACY_TOOL_DESCRIPTION = `Ask the user one or more structured questions during execution. Use when you need to:
1. Gather user preferences or requirements
2. Clarify ambiguous instructions
3. Get decisions on implementation choices as you work
4. Offer choices to the user about what direction to take

Usage notes:
- Users can type a custom answer via the automatically appended "Type something." row on every question or press Esc to abandon the questionnaire. Do NOT author "Other" or "Type something." labels yourself — reserved labels are rejected at runtime.
- Use multiSelect: true when multiple answers are valid. The "Type something." row is available on every question, including when options carry a \`preview\`; in preview mode it expands to the full pane width while typing so the custom answer is not cramped into the narrow options column.
- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label.

Preview feature:
Use the optional \`preview\` field on options when presenting concrete artifacts that users need to visually compare:
- ASCII mockups of UI layouts or components
- Code snippets showing different implementations
- Diagram variations
- Configuration examples

Preview content is rendered as markdown in a monospace box. Multi-line text with newlines is supported. When any option has a preview, the UI switches to a side-by-side layout with a vertical option list on the left and preview on the right. Do not use previews for simple preference questions where labels and descriptions suffice. Note: previews are only supported for single-select questions (not multiSelect).`;

/* =========================================================================
 * 3. DEFAULT & RESOLVER
 * ========================================================================= */

export const DEFAULT_PROMPT_SNIPPET = CONCISE_PROMPT_SNIPPET;
export const DEFAULT_TOOL_DESCRIPTION = CONCISE_TOOL_DESCRIPTION;
export const DEFAULT_PROMPT_GUIDELINES = CONCISE_PROMPT_GUIDELINES;

export function getPromptCopy(preset: GuidancePreset = "concise"): {
	promptSnippet: string;
	description: string;
	promptGuidelines: string[];
} {
	if (preset === "legacy") {
		return {
			promptSnippet: LEGACY_PROMPT_SNIPPET,
			description: LEGACY_TOOL_DESCRIPTION,
			promptGuidelines: LEGACY_PROMPT_GUIDELINES,
		};
	}
	return {
		promptSnippet: CONCISE_PROMPT_SNIPPET,
		description: CONCISE_TOOL_DESCRIPTION,
		promptGuidelines: CONCISE_PROMPT_GUIDELINES,
	};
}
