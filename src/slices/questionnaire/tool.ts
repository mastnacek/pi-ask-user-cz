/**
 * pi-ask-user-cz — the `ask_user_question` tool: a structured option selector with an
 * automatically appended `Napište vlastní.` custom-answer row, rendered in Czech.
 *
 * Fork of `@juicesharp/rpiv-ask-user-question` v2.11.0. The split with upstream:
 *
 * - **Dialog chrome** is Czech, resolved locally from `locales/cs.json` (see
 *   `src/shared/i18n.ts` — upstream's `SUPPORTED_LOCALES` gate cannot load a Czech
 *   locale that the nine shipped languages do not include).
 * - **The questionnaire content** — question, header, option labels, option
 *   descriptions — is translated at render time through `pi-prompt-translate-czk`, so
 *   the model keeps authoring it in English and the user reads it in Czech.
 * - **The tool result envelope is English.** The model is handed the exact question and
 *   option labels it wrote, so the conversation never drifts into a language the user
 *   did not ask it to speak. See `translate-blocks.ts` for the restore and for what is
 *   deliberately left untranslated (previews, the user's own free text and notes).
 * - **The tool description, prompt snippet and guidelines stay English**, matching
 *   upstream and the translate plugin's own "only the TUI is translated" rule: those
 *   are prompt inputs, and translating them changes model behaviour.
 *
 * Every translation path degrades to English — plugin absent, translation disabled,
 * model failure, marker-contract breach — never an error and never a dialog that is
 * half Czech and half English.
 *
 * Upstream doc comments are preserved where behaviour is unchanged; see README.md for
 * the diff against v2.11.0.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ASK_USER_QUESTION_TOOL_NAME } from "../../shared/contract.js";
import { loadConfig, resolveCollapseKey, validateGuidanceFields } from "../../shared/config.js";
import { emitAskUserBlockedEvent, emitAskUserPromptEvent } from "./prompt-events.js";
// Static import is fine — rpc-fallback pulls only types + the i18n bridge,
// none of the ~560ms TUI render graph that QuestionnaireSession lazy-loads.
import { type DialogUI, hasDialogUI, runRpcQuestionnaire } from "./rpc-fallback.js";
import {
	makeSessionFactory,
	type OverlayHandleRef,
	registerCollapseKeyListener,
	type SessionLoad,
	type SessionModule,
	type SessionRef,
} from "./session-factory.js";
import { displayLabel, sentinelsToAppend } from "./session/row-intent.js";
import { normalizeQuestionParams } from "./params/normalize.js";
import { DEFAULT_PROMPT_GUIDELINES, DEFAULT_PROMPT_SNIPPET, DEFAULT_TOOL_DESCRIPTION } from "./params/prompt-copy.js";
import { buildQuestionnaireResponse, buildToolResult } from "./params/envelope.js";
import {
	type QuestionData,
	type QuestionnaireError,
	type QuestionnaireResult,
	type QuestionParams,
	QuestionParamsSchema,
} from "./params/types.js";
import { validateQuestionnaire } from "./params/validate.js";
import { restoreEnglishAnswers } from "./translate-blocks.js";
import { translateParams } from "./translate.js";
import type { WrappingSelectItem } from "./view/components/wrapping-select.js";

function rejectWithoutUi() {
	const details: QuestionnaireResult = { answers: [], cancelled: true, error: "no_ui" };
	return buildToolResult(ERROR_NO_UI, details, true);
}

/** Sequential native-dialog walker for RPC hosts; brackets it with the blocked-event pair + terminal bell. */
async function runRpcPath(pi: ExtensionAPI, ui: DialogUI, typed: QuestionParams) {
	emitAskUserBlockedEvent(pi, true);
	try {
		emitTerminalAttention();
		return await runRpcQuestionnaire(ui, typed);
	} finally {
		emitAskUserBlockedEvent(pi, false);
	}
}

/** Canonical tool name — re-exported from the kernel; see `src/shared/contract.ts`. */

const ERROR_NO_UI = "Error: UI not available (running in non-interactive mode)";

const ERROR_NO_CUSTOM_UI =
	"Error: this client cannot render the questionnaire (custom UI is unavailable, e.g. RPC/ACP hosts such as Zed or Paseo). The user never saw the questions — do NOT treat this as a decline. Ask the questions as plain chat text instead, without using this tool.";

const ERROR_SESSION_LOAD_FAILED =
	"Error: the questionnaire UI failed to load — the host's installed dependencies were likely replaced or removed on disk while Pi was running (e.g. a package-manager install touched the store). The user never saw the questions — do NOT treat this as a decline. Ask the questions as plain chat text instead, and tell the user that restoring this tool requires repairing the install if needed and restarting Pi.";

const ERROR_STALE_MODULE_CACHE =
	"Error: the questionnaire UI cannot load — the host's module cache went stale after an earlier failed load (typically dependencies replaced on disk mid-session). This is unrecoverable within the current Pi process. The user never saw the questions — do NOT treat this as a decline. Ask the questions as plain chat text instead, and tell the user to restart Pi to restore this tool.";

/** Standard terminal bell — same byte rpiv-warp exports as OSC_TERMINATOR. */
export const BEL = "\x07";

/**
 * Emit one portable terminal attention signal without touching redirected output.
 * Writes to stdout rather than rpiv-warp's `/dev/tty` transport: the `isTTY` gate
 * both proves an interactive terminal owns the coming wait and keeps the byte out
 * of piped RPC transports (VS Code pendant, Zed) — a `/dev/tty` write would ring
 * even when the questionnaire renders in a remote host's own UI.
 */
function emitTerminalAttention(): void {
	try {
		if (process.stdout.isTTY) process.stdout.write(BEL);
	} catch {
		// Terminal attention is best effort; the questionnaire must still proceed.
	}
}

/** Delay before the background session-graph pre-warm; mirrors rpiv-workflow's /wf prewarm. */
export const PREWARM_DELAY_MS = 2000;

/**
 * Lazy-load the ~560ms QuestionnaireSession view/TUI render graph, guarding
 * the two failure shapes of issue #107. Pi's jiti loader registers a module in
 * its graph cache BEFORE evaluating the body and does not evict it when
 * evaluation throws (jiti 2.7.0), so one failed load — e.g. `pnpm install
 * --force` replacing the store entry mid-session — leaves every later import
 * of this specifier resolving to a namespace without the class. That state is
 * unrecoverable in-process (cache-busting specifiers fail jiti resolution);
 * both branches therefore return an LLM-facing envelope that names the restart
 * requirement instead of leaking a bare "not a constructor" TypeError.
 */
export async function loadQuestionnaireSession(): Promise<SessionLoad> {
	let mod: SessionModule;
	try {
		mod = await import("./session/questionnaire.js");
	} catch (e) {
		const cause = e instanceof Error ? e.message : String(e);
		return { ok: false, error: "session_load_failed", message: `${ERROR_SESSION_LOAD_FAILED} (cause: ${cause})` };
	}
	if (typeof mod.QuestionnaireSession !== "function") {
		const keys = JSON.stringify(Object.keys(mod));
		return {
			ok: false,
			error: "stale_module_cache",
			message: `${ERROR_STALE_MODULE_CACHE} (resolved namespace keys: ${keys})`,
		};
	}
	return { ok: true, module: mod };
}

/**
 * A TUI questionnaire ALWAYS resolves a QuestionnaireResult (cancel included), so
 * `undefined` uniquely means "host cannot render", never "user declined". RPC builds
 * that predate ctx.mode land here: run the dialog walker when the host has the
 * primitives; otherwise tell the model the user never saw the questions.
 */
async function resolveUndefinedResult(ctx: ExtensionContext, typed: QuestionParams) {
	if (hasDialogUI(ctx.ui)) {
		return buildQuestionnaireResponse(await runRpcQuestionnaire(ctx.ui, typed), typed);
	}
	const details: QuestionnaireResult = { answers: [], cancelled: true, error: "no_custom_ui" };
	return buildToolResult(ERROR_NO_CUSTOM_UI, details, true);
}

/**
 * Pre-warm the lazy session graph once startup settles (#107). A graph
 * evaluated while the paths Pi resolved at boot still exist stays in memory
 * for the process lifetime, so later on-disk dependency churn (e.g. `pnpm
 * install --force` replacing the store mid-session) can no longer poison
 * jiti's graph cache. Swallowed failure is safe: the first real call
 * re-imports and surfaces it through loadQuestionnaireSession's structured
 * envelope. unref keeps the timer from holding a non-TUI embedder's process
 * open.
 *
 * Started from `session_start`, never from the extension factory: some
 * invocations load extensions without ever starting a session, and a timer
 * created there would outlive the load it was warming for. The composition root
 * owns the subscription and calls the returned canceller on `session_shutdown`,
 * so quit, reload and session replacement all converge on clearing it.
 */
export function startSessionGraphPrewarm(): () => void {
	const timer = setTimeout(() => void loadQuestionnaireSession().catch(() => undefined), PREWARM_DELAY_MS);
	timer.unref?.();
	return () => clearTimeout(timer);
}

export function buildItemsForQuestion(question: QuestionData): WrappingSelectItem[] {
	const items: WrappingSelectItem[] = question.options.map((o) => ({
		kind: "option",
		label: o.label,
		description: o.description,
	}));
	for (const kind of sentinelsToAppend(question)) {
		items.push({ kind, label: displayLabel(kind) });
	}
	return items;
}

export function registerAskUserQuestion(pi: ExtensionAPI): () => void {
	const guidance = validateGuidanceFields(loadConfig().guidance);
	pi.registerTool({
		name: ASK_USER_QUESTION_TOOL_NAME,
		label: "Ask User Question",
		description: guidance.description ?? DEFAULT_TOOL_DESCRIPTION,
		promptSnippet: guidance.promptSnippet ?? DEFAULT_PROMPT_SNIPPET,
		promptGuidelines: guidance.promptGuidelines ?? DEFAULT_PROMPT_GUIDELINES,
		parameters: QuestionParamsSchema,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			// Line-terminator normalization runs once here, ahead of validation, so
			// every downstream consumer — validator, TUI, RPC walker, envelope, prompt
			// event — sees the same clean text (#192).
			const typed = normalizeQuestionParams(params as unknown as QuestionParams);
			if (!ctx.hasUI) return rejectWithoutUi();

			const validation = validateQuestionnaire(typed);
			if (!validation.ok) {
				const details: QuestionnaireResult = {
					answers: [],
					cancelled: true,
					error: validation.error,
				};
				return buildToolResult(validation.message, details, true);
			}

			// The fork's one job: the dialog renders Czech, the model keeps English.
			// `typed` stays the model's own English params for validation, the LLM
			// envelope and the answer restore; `display` is what the user reads. A `null`
			// translation (plugin absent, disabled, model failure, marker breach) makes
			// them the same object, so the English path is upstream's code path verbatim.
			const translated = await translateParams(ctx, typed);
			const display = translated?.display ?? typed;
			const restore = (result: QuestionnaireResult) =>
				translated ? restoreEnglishAnswers(result, typed, translated.labelMap) : result;

			// Emit event for external listeners (e.g., notification plugins). Display
			// params, because the listener's job is to tell the user what is being asked.
			emitAskUserPromptEvent(pi, display);

			// Terminal-only rendering is gated on ctx.mode, not ctx.hasUI: hasUI is true in
			// RPC too, where `ui.custom()` resolves undefined and `onTerminalInput` is a
			// no-op. Deciding here — before the render graph is touched — means a host that
			// cannot render never pays the ~560ms QuestionnaireSession import only to
			// discover custom() gave it nothing. RPC builds that predate ctx.mode report
			// no mode at all and are treated as TUI, which is the pre-0.79 behaviour, and
			// are still caught by the custom()-undefined backstop below.
			const mode = (ctx as { mode?: string }).mode;
			const canRenderOverlay = mode === undefined || mode === "tui";
			if (!canRenderOverlay) {
				return hasDialogUI(ctx.ui)
					? buildQuestionnaireResponse(restore(await runRpcPath(pi, ctx.ui, display)), typed)
					: buildToolResult(ERROR_NO_CUSTOM_UI, { answers: [], cancelled: true, error: "no_custom_ui" }, true);
			}

			const itemsByTab: WrappingSelectItem[][] = display.questions.map((q) => buildItemsForQuestion(q));

			// Lazy — QuestionnaireSession pulls the ~560ms view/TUI render graph;
			// load it only when the tool runs, not at extension registration.
			const sessionLoad = await loadQuestionnaireSession();
			if (!sessionLoad.ok) {
				const details: QuestionnaireResult = { answers: [], cancelled: true, error: sessionLoad.error };
				return buildToolResult(sessionLoad.message, details, true);
			}
			const { QuestionnaireSession } = sessionLoad.module;
			// Resolve the collapse/expand key spec from config. Default is `ctrl+]`; users
			// with non-US layouts (e.g. Latin American, where `]` is shifted) can override
			// via the `collapseKey` config field. `resolveCollapseKey` also accepts the
			// sentinel value `"off"` to disable the shortcut entirely.
			const collapseKey = resolveCollapseKey(loadConfig());

			// Capture the overlay handle so the session can call `setHidden()` when the
			// user toggles collapse, and register a raw terminal input listener for the
			// same key so the toggle still works while the overlay is hidden (pi-tui does
			// not route input to a hidden overlay's `component.handleInput`).
			const sessionRef: SessionRef = { current: null };
			const overlayHandleRef: OverlayHandleRef = { current: undefined };
			const removeOverlayInputListener = registerCollapseKeyListener(ctx, collapseKey, sessionRef, overlayHandleRef);
			// Hiding the overlay is only reversible through the raw listener above, so
			// the session may emit `setHidden` only when it was actually registered;
			// otherwise collapse falls back to the visible one-line row.
			const canReopenWhileHidden = removeOverlayInputListener !== undefined;

			emitAskUserBlockedEvent(pi, true);
			try {
				emitTerminalAttention();
				const result = await ctx.ui.custom<QuestionnaireResult>(
					makeSessionFactory({
						ctx,
						typed: display,
						itemsByTab,
						collapseKey,
						canReopenWhileHidden,
						sessionRef,
						Session: QuestionnaireSession,
					}),
					{
						overlay: true,
						overlayOptions: {
							anchor: "bottom-center",
							width: "100%",
							maxHeight: "100%",
							margin: { left: 0, right: 0, bottom: 0 },
						},
						onHandle: (handle) => {
							overlayHandleRef.current = handle;
							sessionRef.current?.setOverlayHandle(handle);
						},
					},
				);

				if (result === undefined) {
					return resolveUndefinedResult(ctx, display);
				}

				return buildQuestionnaireResponse(restore(result), typed);
			} finally {
				removeOverlayInputListener?.();
				emitAskUserBlockedEvent(pi, false);
			}
		},
	});

	// No `pi.on` subscription of its own, so nothing to hand back beyond the
	// no-op: the signature is uniform so the composition root can drain blindly.
	// The pre-warm timer deliberately does NOT start here — see
	// startSessionGraphPrewarm and the session_start wiring in the root.
	return () => {};
}

export { buildQuestionnaireResponse, buildToolResult };
