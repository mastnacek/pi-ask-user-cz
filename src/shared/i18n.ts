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
 * Reserved-label validation stays English-locked (see the questionnaire slice's
 * `session/row-intent.ts`): the sentinels the user sees are Czech, but the guard
 * still compares the canonical English `ROW_INTENT_META[kind].label`, so the model
 * is told about the same reserved words in every locale. `displayLabel(kind)` —
 * the only row-aware helper — therefore lives in that slice next to the META table
 * it reads, keeping this kernel free of slice imports.
 *
 * The JSON is read with `readFileSync` rather than a JSON import: Pi loads extensions
 * through jiti, and a static JSON module specifier is one more loader feature to
 * depend on for a file that is read exactly once at startup.
 *
 * DEPTH CONTRACT: this file is `src/shared/i18n.ts`, so the locale is exactly two
 * levels up. The `catch` above turns a wrong `..` count into a silently English
 * dialog rather than a crash, which is the worst possible failure for a Czech-only
 * fork — `scripts/smoke.mjs` asserts `hasCzechTable()` so the mistake fails the build.
 */

import { readFileSync } from "node:fs";

export const I18N_NAMESPACE = "pi-ask-user-cz";

/** Kept for API parity with upstream; this fork resolves Czech locally. */
export type ScopeFn = (key: string, fallback: string) => string;

function loadCzech(): Record<string, string> {
	try {
		return JSON.parse(readFileSync(new URL("../../locales/cs.json", import.meta.url), "utf8"));
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

/** True when the Czech table actually loaded — false means every key falls back to English. */
export function hasCzechTable(): boolean {
	return Object.keys(STRINGS).length > 0;
}
