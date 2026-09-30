/**
 * pi-ask-user-cz — entry point.
 *
 * Registers the `ask_user_question` tool and the non-interactive reconciler (upstream
 * behaviour, unchanged). The Czech dialog strings need no registration step here:
 * `state/i18n-bridge.ts` reads `locales/cs.json` itself at module init, which is what
 * lets this fork use a locale the upstream i18n SDK does not ship.
 *
 * See `ask-user-question.ts` for where the English/Czech split happens.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerAskUserQuestionTool } from "./ask-user-question.js";
import { registerAskUserQuestionReconciler } from "./reconcile.js";

export {
	ASK_USER_BLOCKED_EVENT,
	ASK_USER_PROMPT_EVENT,
	type AskUserBlockedEventPayload,
	type AskUserPromptEventPayload,
	type AskUserPromptOption,
	type AskUserPromptQuestion,
} from "./events.js";

export { ASK_USER_QUESTION_TOOL_NAME, BEL, PREWARM_DELAY_MS } from "./ask-user-question.js";

export default function (pi: ExtensionAPI) {
	registerAskUserQuestionTool(pi);
	registerAskUserQuestionReconciler(pi);
}
