/**
 * Glue between this fork and `pi-prompt-translate-czk`.
 *
 * The fork does not own a translator and does not want one: the user already runs
 * prompt-translate for prompts and answers, and that plugin already has the model,
 * the target language, the cost accounting and the kill switch. So the questionnaire
 * is translated through that plugin's own `translate(..., "tool")` entry point, which
 * is exactly the literal contract this needs:
 *
 *   "Translate every block of text to <lang>. The blocks are separated by lines of the
 *    form <<<n>>>." … "Output nothing but the markers and their translations" …
 *    "Keep code, commands, flags, file paths, file names, numbers, markdown and
 *    placeholders unchanged."
 *
 * `formatBlocks` and `parseBlocks` are imported from that plugin rather than
 * reimplemented, so the marker protocol (all-or-nothing, exactly 0..n-1, each block
 * non-empty) has one implementation. The module instance is shared — same resolved
 * path as the running extension — so `state.config` here is the user's live config.
 *
 * Degradation is English, never an error and never a half-translated dialog:
 * plugin not installed -> English; translation disabled -> English; transient model
 * failure -> English; marker-contract breach -> English.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { applyTranslations, collectTranslatableTexts, type TranslatedParams } from "./translate-blocks.js";
import type { QuestionParams } from "./tool/types.js";

/** `null` = render the English original (no translation happened). */
export type MaybeTranslated = TranslatedParams | null;

interface TranslateApi {
	translate: (
		ctx: ExtensionContext,
		text: string,
		targetLanguage: string,
		purpose: "prompt" | "answer" | "tool",
		conversationContext?: string,
	) => Promise<{ text: string }>;
}

interface PluginApi extends TranslateApi {
	formatBlocks: (fields: readonly { text: string }[]) => string;
	parseBlocks: (output: string, count: number) => (string | undefined)[] | null;
	state: TranslateStateApi["state"];
}

interface TranslateStateApi {
	state: { config: { enabled: boolean; targetLanguage: string } };
}

/** The modules this fork borrows from the translate plugin, by path under its root. */
const PLUGIN_MODULES = [
	{ suffix: "src/shared/translate/index", pick: (m: Record<string, unknown>) => ({ translate: m.translate }) },
	{ suffix: "src/slices/pipeline/tool-ui", pick: (m: Record<string, unknown>) => ({ formatBlocks: m.formatBlocks, parseBlocks: m.parseBlocks }) },
	// `state` is not re-exported by tool-ui, so the live config has to come from the
	// module that owns it. Same resolved file as the running extension, so this is the
	// user's live config, not a second copy of it.
	{ suffix: "src/shared/state", pick: (m: Record<string, unknown>) => ({ state: m.state }) },
] as const;

/**
 * Where the translate plugin may live. `git:github.com/mastnacek/pi-prompt-translate-czk`
 * resolves to the git checkout under the agent home, which is the copy that is
 * actually loaded; the sibling directory is the development tree it was published
 * from. Both are probed with `.ts` and `.js` specifiers because Pi's jiti loader maps
 * the `.js` specifiers the plugin's own internal imports use onto its `.ts` files.
 */
function candidateRoots(): string[] {
	const roots = [join(homedir(), ".pi", "agent", "git", "github.com", "mastnacek", "pi-prompt-translate-czk")];
	try {
		// ../pi-ask-user-cz -> ../pi-prompt-translate-czk
		roots.push(new URL("../../pi-prompt-translate-czk", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
	} catch {
		// No resolvable sibling (installed as a package): the agent-home root stands alone.
	}
	return roots;
}

/** The files this fork imports, relative to a plugin root (extension-less, as on disk). */
export const PLUGIN_ENTRY_FILES = PLUGIN_MODULES.map((m) => m.suffix);

/**
 * Which candidate roots actually contain the plugin's entry files.
 *
 * Exported for the test: the *import* of another package's TypeScript can only happen
 * under Pi's jiti loader, so the layout contract is what is verifiable outside Pi, and
 * a layout change is the realistic way this seam breaks.
 */
export function inspectPluginCandidates(): { root: string; present: boolean; missing: string[] }[] {
	return candidateRoots().map((root) => {
		const missing = PLUGIN_ENTRY_FILES.filter(
			(file) => !existsSync(join(root, `${file}.ts`)) && !existsSync(join(root, `${file}.js`)),
		);
		return { root, present: missing.length === 0, missing };
	});
}

let cached: PluginApi | null | undefined;
let cachedRoot: string | null = null;

async function loadPlugin(): Promise<PluginApi | null> {
	if (cached !== undefined) return cached;
	cached = null;
	for (const root of candidateRoots()) {
		for (const ext of [".ts", ".js"]) {
			try {
				const parts: Record<string, unknown> = {};
				for (const module of PLUGIN_MODULES) {
					const loaded = (await import(
						pathToFileURL(join(root, module.suffix) + ext).href
					)) as Record<string, unknown>;
					Object.assign(parts, module.pick(loaded));
				}
				if (
					typeof parts.translate !== "function" ||
					typeof parts.parseBlocks !== "function" ||
					typeof parts.formatBlocks !== "function" ||
					!parts.state
				) {
					continue;
				}
				cached = parts as unknown as PluginApi;
				cachedRoot = root;
				return cached;
			} catch {
				// Wrong root or wrong extension — try the next candidate.
			}
		}
	}
	return cached;
}

/**
 * Which root the translate plugin was loaded from, or `null` when it is not installed.
 *
 * Diagnostics and the test both need this: the resolver probes absolute paths into
 * another package's TypeScript sources, and if that ever stops working the symptom is
 * only "the dialog stayed English" at question time. Exposing the resolved root turns
 * that into a one-line check.
 */
export async function resolveTranslatePluginRoot(): Promise<string | null> {
	await loadPlugin();
	return cached === null ? null : (cachedRoot ?? null);
}

let warnedMissingPlugin = false;

/**
 * The dialogue is in Czech, the questionnaire must be too. A skip is therefore never
 * silent: one notification naming the reason. This is the exact failure the fork
 * exists to prevent — a dialog that came up English with no explanation, which is
 * indistinguishable from "the model wrote it in English".
 */
function warnOnce(ctx: ExtensionContext, reason: string): void {
	if (warnedMissingPlugin) return;
	warnedMissingPlugin = true;
	ctx.ui.notify?.(`ask_user_question: ${reason} — questionnaire shown in English`, "warning");
}

/**
 * Translate the questionnaire for display. Returns `null` whenever the caller should
 * render the English original.
 */
export async function translateParams(ctx: ExtensionContext, params: QuestionParams): Promise<MaybeTranslated> {
	const texts = collectTranslatableTexts(params);
	if (texts.length === 0) return null;

	try {
		const plugin = await loadPlugin();
		// The kill switch is the user's, not ours: prompt-translate off means every
		// surface English, including this one.
		if (!plugin) {
			warnOnce(ctx, "pi-prompt-translate-czk not found");
			return null;
		}
		if (!plugin.state.config.enabled) return null;

		const blocks = plugin.formatBlocks(texts.map((text) => ({ text })));
		const result = await plugin.translate(
			ctx,
			blocks,
			plugin.state.config.targetLanguage,
			"tool",
		);
		const parsed = plugin.parseBlocks(result.text, texts.length);
		// All-or-nothing, same rule the plugin applies to its own tool-UI cards: a
		// shifted or partial marker set would put one Czech label under another
		// question's text, and the answer restore would then hand the model a label it
		// never wrote. English is the only safe fallback.
		if (!parsed) {
			warnOnce(ctx, "translation did not honour the <<<n>>> marker contract");
			return null;
		}
		return applyTranslations(params, parsed as string[]);
	} catch (error) {
		// A failing translation must never block the questionnaire — but it must not be
		// invisible either, or the fork looks like it simply does not work.
		warnOnce(ctx, `translation failed (${error instanceof Error ? error.message : String(error)})`);
		return null;
	}
}

