/**
 * pi-ask-user-cz — composition root.
 *
 * Wiring only: kernel constants, two slice registrations, one shutdown drain.
 * No logic lives here. The Czech dialog strings need no registration step —
 * `src/shared/i18n.ts` reads `locales/cs.json` itself at module init, which is
 * what lets this fork use a locale the upstream i18n SDK does not ship.
 *
 * Layout: `src/shared/` is the kernel (contract, config, i18n) and imports no
 * slice; `src/slices/*` are isolated features that import the kernel and never
 * each other. The tool name sits in the kernel precisely because `questionnaire`
 * and `reconcile` both need it and slices may not import siblings.
 *
 * See `src/slices/questionnaire/tool.ts` for where the English/Czech split
 * happens, and `src/shared/contract.ts` for the public event surface.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerAskUserQuestion, startSessionGraphPrewarm } from "./src/slices/questionnaire/index.js";
import { registerAskUserQuestionReconciler } from "./src/slices/reconcile/index.js";
import { registerAskUserCommand } from "./src/slices/commands/index.js";

export {
	ASK_USER_BLOCKED_EVENT,
	ASK_USER_PROMPT_EVENT,
	ASK_USER_QUESTION_TOOL_NAME,
	BEL,
	PREWARM_DELAY_MS,
	type AskUserBlockedEventPayload,
	type AskUserPromptEventPayload,
	type AskUserPromptOption,
	type AskUserPromptQuestion,
} from "./src/slices/questionnaire/index.js";

export default function (pi: ExtensionAPI) {
	// Subagent and child sessions load every global extension. This tool opens an
	// interactive overlay and reconciles the tool list, neither of which belongs in
	// a subagent's turn, so the whole extension stands down there.
	if (process.env.PI_SUBAGENT === "true" || Boolean(process.env.PI_CHILD_SESSION)) return;

	// Wire order: tools, then lifecycle reconciliation, then the drain. Each
	// registration returns its own unsubscriber.
	registerAskUserCommand(pi);
	const dispose: (() => void)[] = [registerAskUserQuestion(pi), registerAskUserQuestionReconciler(pi)];

	// The lazy render graph is warmed from `session_start`, never from the factory:
	// some invocations load extensions without starting a session, and a timer made
	// there would outlive the load it was warming for. The canceller joins the same
	// drain as the subscriptions, so one handler clears all of it.
	let cancelPrewarm: (() => void) | undefined;
	dispose.push(
		pi.on("session_start", () => {
			cancelPrewarm?.();
			cancelPrewarm = startSessionGraphPrewarm();
		}),
	);

	// `session_shutdown` is itself the drainer, so it is deliberately not stored.
	// Quit, reload, session replacement and exit all converge here; `splice` keeps
	// it idempotent across those.
	pi.on("session_shutdown", () => {
		cancelPrewarm?.();
		cancelPrewarm = undefined;
		for (const off of dispose.splice(0)) off();
	});
}
