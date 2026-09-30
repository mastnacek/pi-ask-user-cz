/**
 * Czech strings for the dialog chrome, self-contained.
 *
 * Upstream routes every `t(key, fallback)` through `@juicesharp/rpiv-i18n`, whose
 * `SUPPORTED_LOCALES` constant gates both the `/languages` picker and the set of
 * `locales/*.json` files `registerLocalesFromDir` will read. Czech is not in that
 * list of nine, so a `locales/cs.json` dropped into the upstream package is never
 * loaded and never offered. This fork therefore keeps its own tiny scope: the Czech
 * map is read once at module init and `t()` resolves against it, falling back to the
 * inline English literal the call site already passes.
 *
 * Per-key English fallback is upstream's contract and is kept: a key missing from
 * cs.json renders the call-site literal, never a blank.
 *
 * Call sites MUST use this module at render time — never bake the result into a
 * top-level `const`, which would freeze the strings at module init.
 *
 * Reserved-label validation stays English-locked (see row-intent.ts): the sentinels
 * the user sees are Czech, but the guard still compares the canonical English
 * `ROW_INTENT_META[kind].label`, so the model is told about the same reserved words
 * in every locale.
 *
 * The JSON is read with `readFileSync` rather than a JSON import: Pi loads extensions
 * through jiti, and a static JSON module specifier is one more loader feature to
 * depend on for a file that is read exactly once at startup.
 */

import { readFileSync } from "node:fs";
import { ROW_INTENT_META, type SentinelKind } from "./row-intent.js";

export const I18N_NAMESPACE = "pi-ask-user-cz";

/** Kept for API parity with upstream; this fork resolves Czech locally. */
export type ScopeFn = (key: string, fallback: string) => string;

function loadCzech(): Record<string, string> {
	try {
		return JSON.parse(readFileSync(new URL("../locales/cs.json", import.meta.url), "utf8"));
	} catch {
		// Missing or malformed locale file: every call site already passes an English
		// literal, so the dialog stays online in English rather than blank.
		return {};
	}
}

const STRINGS = loadCzech();

export const t: ScopeFn = (key, fallback) => {
	const value = STRINGS[key];
	return typeof value === "string" && value.length > 0 ? value : fallback;
};

export function displayLabel(kind: SentinelKind): string {
	return t(`sentinel.${kind}`, ROW_INTENT_META[kind].label);
}
