/**
 * Construction of the TUI questionnaire session and the raw terminal listener that
 * keeps the collapse shortcut alive while the overlay is hidden.
 *
 * Split out of `src/slices/questionnaire/tool.ts` for size only; behaviour is upstream's. Both
 * halves exist only to give the session its overlay handle and its two dynamic
 * imports, which must stay lazy per invocation.
 */

import { isKeyRelease, isKeyRepeat, matchesKey, type OverlayHandle, type TUI } from "@earendil-works/pi-tui";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { COLLAPSE_KEY_OFF, formatKeySpecForDisplay } from "../../shared/config.js";
import { t } from "../../shared/i18n.js";
import type { QuestionParams, QuestionnaireError, QuestionnaireResult } from "./params/types.js";
import type { WrappingSelectItem } from "./view/components/wrapping-select.js";

export type SessionModule = typeof import("./session/questionnaire.js");

/** Result of the lazy render-graph load: the module, or an LLM-facing restart envelope. */
export type SessionLoad =
	| { ok: true; module: SessionModule }
	| { ok: false; error: Extract<QuestionnaireError, "session_load_failed" | "stale_module_cache">; message: string };

export type SessionRef = { current: import("./session/questionnaire.js").QuestionnaireSession | null };

export type OverlayHandleRef = { current: OverlayHandle | undefined };

/**
 * Register the raw terminal listener that toggles collapse while the overlay is hidden.
 * Returns the remover, or undefined when the key is off / the host has no raw input hook —
 * callers derive `canReopenWhileHidden` from this.
 */
export function registerCollapseKeyListener(
	ctx: ExtensionContext,
	collapseKey: string,
	sessionRef: SessionRef,
	overlayHandleRef: OverlayHandleRef,
): (() => void) | undefined {
	if (collapseKey === COLLAPSE_KEY_OFF || typeof ctx.ui.onTerminalInput !== "function") return undefined;
	let hasAnnouncedHide = false;
	return ctx.ui.onTerminalInput((data) => {
		const handle = overlayHandleRef.current;
		if (!handle) return undefined;
		// Only act while the questionnaire is hidden (its handleInput is
		// unreachable) or actually focused. When some other overlay is on
		// top (e.g. `/btw`), leave the keystroke to that overlay instead of
		// toggling the questionnaire from underneath it.
		if (!handle.isHidden() && !handle.isFocused()) return undefined;
		if (!matchesKey(data, collapseKey as Parameters<typeof matchesKey>[1])) return undefined;
		// Kitty-protocol terminals report press, repeat, and release separately.
		// Toggle only on the initial press so a tap does not immediately reopen
		// the overlay and a held key does not toggle it repeatedly.
		if (isKeyRelease(data) || isKeyRepeat(data)) return { consume: true };
		sessionRef.current?.toggleCollapsedExternal();
		if (handle.isHidden() && !hasAnnouncedHide) {
			hasAnnouncedHide = true;
			ctx.ui.notify?.(`ask_user_question hidden — press ${formatKeySpecForDisplay(collapseKey)} to reopen`, "info");
		}
		return { consume: true };
	});
}

/**
 * Build the `ctx.ui.custom` component factory: constructs the session (capturing it in
 * `sessionRef`) and exposes its component. `editInput` keeps its two dynamic imports —
 * they must stay lazy per-invocation.
 *
 * `typed` here is the *display* params: the session renders these, so the user sees
 * Czech. The model never sees this object — the answer restore maps the selection back
 * to its English label before the envelope is built.
 */
export function makeSessionFactory(config: {
	ctx: ExtensionContext;
	typed: QuestionParams;
	itemsByTab: WrappingSelectItem[][];
	collapseKey: string;
	canReopenWhileHidden: boolean;
	sessionRef: SessionRef;
	Session: SessionModule["QuestionnaireSession"];
}) {
	const { ctx, typed, itemsByTab, collapseKey, canReopenWhileHidden, sessionRef, Session } = config;
	return (
		tui: TUI,
		theme: Theme,
		keybindings: import("./session/questionnaire.js").QuestionnaireSessionConfig["keybindings"],
		done: (result: QuestionnaireResult) => void,
	): import("./session/questionnaire.js").QuestionnaireSessionComponent => {
		const session = new Session({
			tui,
			theme,
			params: typed,
			itemsByTab,
			done,
			keybindings,
			editInput: async (value) => {
				try {
					const [{ SettingsManager }, { editWithExternalEditor }] = await Promise.all([
						import("@earendil-works/pi-coding-agent"),
						import("./session/external-editor.js"),
					]);
					const editorCommand = SettingsManager.create(ctx.cwd, undefined, {
						projectTrusted: ctx.isProjectTrusted(),
					}).getExternalEditorCommand();
					if (!editorCommand) throw new Error("No external editor command is configured");
					return await editWithExternalEditor(tui, editorCommand, value);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					ctx.ui.notify(`${t("editor.failed", "External editor failed")}: ${message}`, "error");
					return undefined;
				}
			},
			collapseKey,
			canReopenWhileHidden,
		});
		sessionRef.current = session;
		return session.component;
	};
}
