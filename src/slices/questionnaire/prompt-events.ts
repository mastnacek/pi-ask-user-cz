/**
 * The two events other plugins can listen to, kept out of `src/slices/questionnaire/tool.ts` for
 * size. Payload shapes live in `events.ts`; this file only builds and emits them.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	ASK_USER_BLOCKED_EVENT,
	ASK_USER_PROMPT_EVENT,
	type AskUserBlockedEventPayload,
	type AskUserPromptEventPayload,
} from "../../shared/contract.js";
import type { QuestionParams } from "./params/types.js";

/**
 * Announce the questionnaire to external listeners (notification plugins, …).
 *
 * Callers pass the *display* params, not the model's English ones: this payload
 * exists to tell the user what is being asked, and in this fork the user reads Czech.
 */
export function emitAskUserPromptEvent(pi: ExtensionAPI, params: QuestionParams): void {
	const payload: AskUserPromptEventPayload = {
		questions: params.questions.map((q) => ({
			question: q.question,
			header: q.header,
			multiSelect: q.multiSelect ?? false,
			options: q.options.map((o) => ({
				label: o.label,
				description: o.description,
				hasPreview: typeof o.preview === "string" && o.preview.length > 0,
			})),
		})),
	};
	pi.events.emit(ASK_USER_PROMPT_EVENT, payload);
}

export function emitAskUserBlockedEvent(pi: ExtensionAPI, active: boolean): void {
	const payload: AskUserBlockedEventPayload = { active };
	pi.events.emit(ASK_USER_BLOCKED_EVENT, payload);
}
