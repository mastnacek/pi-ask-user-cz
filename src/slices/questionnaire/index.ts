/**
 * `questionnaire` slice — the `ask_user_question` tool.
 *
 * One capability, so one slice. `view/`, `session/` and `params/` are internal
 * structure, not separate slices: they import each other in a cycle
 * (`params/types` → `session/row-intent` → `params/types`, and
 * `session/selectors` ↔ `view/`), which is exactly the kind of tangle that VSA
 * forbids *between* slices and is fine *inside* one. Splitting them would mean
 * inventing an interface between the view and the state to hide a cycle that
 * only exists because they are one feature — the definition of a deep module
 * earning nothing.
 *
 * `rpc-fallback.ts` stays a separate file rather than a separate slice for the
 * opposite reason: it must stay OUT of the ~560ms TUI render graph, and it is
 * statically imported by `tool.ts` precisely so it never pulls that graph in.
 *
 * Surface: one registration function. Everything else is internal.
 */

export { registerAskUserQuestion } from "./tool.js";
export {
	ASK_USER_QUESTION_TOOL_NAME,
	ASK_USER_BLOCKED_EVENT,
	ASK_USER_PROMPT_EVENT,
	type AskUserBlockedEventPayload,
	type AskUserPromptEventPayload,
	type AskUserPromptOption,
	type AskUserPromptQuestion,
} from "../../shared/contract.js";
export { BEL, buildItemsForQuestion, loadQuestionnaireSession, PREWARM_DELAY_MS, startSessionGraphPrewarm } from "./tool.js";
