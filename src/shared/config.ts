import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { GuidanceFields } from "./config-source.js";
import { loadJsonConfigWithLegacyFallback, validateGuidanceFields } from "./config-source.js";

/** Key spec for the overlay collapse/expand shortcut, e.g. `"ctrl+]"` or `"alt+o"`. */
export type CollapseKeySpec = string;

export const DEFAULT_COLLAPSE_KEY: CollapseKeySpec = "ctrl+]";
export const COLLAPSE_KEY_OFF: CollapseKeySpec = "off";

export type GuidancePreset = "concise" | "legacy";

export interface AskUserQuestionConfig {
	/**
	 * Prompt copy style:
	 * - "concise" (default): lean prompt (~215 words) with positive framing & asking-well skill.
	 * - "legacy": original verbose prompt (567 words) with strict rule listings.
	 */
	preset?: GuidancePreset;
	guidance?: GuidanceFields;
	/**
	 * Key spec for the collapse/expand shortcut, in the same format as pi-coding-agent
	 * keybinding ids (`modifier+key`, e.g. `ctrl+]`, `alt+o`, `ctrl+shift+h`). Defaults
	 * to `"ctrl+]"`. Set this to a key that is reachable on your keyboard layout — Latin
	 * American layouts (where `]` is on the shifted layer) often want `"ctrl+}"` instead.
	 * Pass `"off"` to disable the collapse shortcut entirely.
	 */
	collapseKey?: CollapseKeySpec;
}

// Named keys accepted by pi-tui's `matchesKey` (keys.js switch on the parsed base key).
// parseKeyId lowercases the id before matching, so lowercase spellings are canonical.
const SPECIAL_KEYS = new Set([
	"escape",
	"esc",
	"enter",
	"return",
	"tab",
	"space",
	"backspace",
	"delete",
	"insert",
	"clear",
	"home",
	"end",
	"pageup",
	"pagedown",
	"up",
	"down",
	"left",
	"right",
	...Array.from({ length: 12 }, (_, i) => `f${i + 1}`),
]);

const MODIFIERS = new Set(["ctrl", "shift", "alt", "super"]);

function isValidCollapseKeySpec(spec: string): boolean {
	// Mirror pi-tui's KeyId grammar strictly: zero or more distinct modifiers, then a
	// base key that is a single printable character or a named special key. A loose
	// check is not enough — pi-tui's `parseKeyId` takes the LAST `+`-part as the key
	// and ignores unknown parts, so a typo like `ctr+]` would silently match every
	// bare `]` keypress (and the raw terminal listener would consume them globally).
	if (!spec) return false;
	if (spec.startsWith("+") || spec.endsWith("+") || spec.includes("++")) return false;
	const parts = spec.split("+");
	const base = parts[parts.length - 1] ?? "";
	const modifiers = parts.slice(0, -1);
	if (modifiers.length !== new Set(modifiers).size) return false;
	if (!modifiers.every((m) => MODIFIERS.has(m))) return false;
	return base.length === 1 ? /[a-z0-9_\-!@#$%^&*()|~`'":;,./<>?[\]{}=\\]/.test(base) : SPECIAL_KEYS.has(base);
}

export function resolvePreset(config: Pick<AskUserQuestionConfig, "preset">): GuidancePreset {
	const raw = config.preset?.trim().toLowerCase();
	return raw === "legacy" ? "legacy" : "concise";
}

export function resolveCollapseKey(config: Pick<AskUserQuestionConfig, "collapseKey">): CollapseKeySpec {
	const raw = config.collapseKey?.trim().toLowerCase();
	if (raw === undefined || raw === "") return DEFAULT_COLLAPSE_KEY;
	if (raw === COLLAPSE_KEY_OFF) return COLLAPSE_KEY_OFF;
	return isValidCollapseKeySpec(raw) ? raw : DEFAULT_COLLAPSE_KEY;
}

// The only compound-word names in SPECIAL_KEYS — first-letter capitalization
// alone would render them "Pageup"/"Pagedown".
const COMPOUND_KEY_DISPLAY: Record<string, string> = {
	pageup: "PageUp",
	pagedown: "PageDown",
};

/**
 * Pretty-print a resolved key spec for UI copy: each `+`-part gets its first
 * character uppercased (`"ctrl+]"` → `"Ctrl+]"`, `"alt+o"` → `"Alt+O"`,
 * `"f9"` → `"F9"`, `"ctrl+pagedown"` → `"Ctrl+PageDown"`). Display-only — key
 * matching always uses the raw lowercase spec (`matchesKey` lowercases ids),
 * so never feed the result back into it.
 */
export function formatKeySpecForDisplay(spec: CollapseKeySpec): string {
	return spec
		.split("+")
		.map(
			(part) =>
				COMPOUND_KEY_DISPLAY[part] ??
				(part.length <= 1 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)),
		)
		.join("+");
}

const CONFIG_DIR = join(homedir(), ".pi", "agent");
export const GLOBAL_CONFIG_FILE = join(CONFIG_DIR, "pi-ask-user-cz.json");

/** Project override: <cwd>/.pi/pi-ask-user-cz.json (wins over the global file). */
export function projectConfigPath(cwd: string): string {
	return join(cwd, ".pi", "pi-ask-user-cz.json");
}

function readLayer(path: string): Partial<AskUserQuestionConfig> {
	try {
		if (existsSync(path)) {
			return JSON.parse(readFileSync(path, "utf8")) as Partial<AskUserQuestionConfig>;
		}
	} catch {
		// Corrupt or unreadable layer — return empty.
	}
	return {};
}

export function loadConfig(cwd?: string): AskUserQuestionConfig {
	const legacyGlobal = loadJsonConfigWithLegacyFallback<AskUserQuestionConfig>("pi-ask-user-cz");
	const globalLayer = readLayer(GLOBAL_CONFIG_FILE);
	const fromGlobal = { ...legacyGlobal, ...globalLayer };
	if (!cwd) return fromGlobal;
	const projectLayer = readLayer(projectConfigPath(cwd));
	return { ...fromGlobal, ...projectLayer };
}

/**
 * Persist a patch: `--global` (isGlobal) writes ~/.pi/agent/, otherwise the
 * project file under <cwd>/.pi/. Without a cwd the global file is the target.
 */
export function saveConfig(
	patch: Partial<AskUserQuestionConfig>,
	isGlobal = false,
	cwd?: string,
): void {
	const target = isGlobal || !cwd ? GLOBAL_CONFIG_FILE : projectConfigPath(cwd);
	try {
		mkdirSync(dirname(target), { recursive: true });
		const layer = readLayer(target);
		const tmp = `${target}.tmp`;
		writeFileSync(tmp, JSON.stringify({ ...layer, ...patch }, null, 2), "utf8");
		renameSync(tmp, target);

		// If saving globally, also keep legacy ~/.config/pi-ask-user-cz/config.json in sync
		if (isGlobal || !cwd) {
			const xdgDir = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config", "pi-ask-user-cz");
			mkdirSync(xdgDir, { recursive: true });
			writeFileSync(join(xdgDir, "config.json"), JSON.stringify({ ...layer, ...patch }, null, 2), "utf8");
		}
	} catch {
		try {
			rmSync(`${target}.tmp`, { force: true });
		} catch {
			// Ignore cleanup error.
		}
	}
}

export { validateGuidanceFields };
