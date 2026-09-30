/**
 * The two helpers this fork used to import from `@juicesharp/rpiv-config`.
 *
 * Upstream splits them into a shared package so the whole rpiv-* family agrees on
 * config lookup. This fork has no other rpiv-* member, so inlining the two
 * functions is one file instead of a dependency: the guidance fields are three
 * optional strings, and the lookup is a JSON read with a legacy-path fallback.
 *
 * Config namespace is this fork's own (`pi-ask-user-cz`), so an upstream
 * `rpiv-ask-user-question` config on the same machine stays untouched.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Prompt-override fields the model reads. All optional; all-or-nothing per field. */
export interface GuidanceFields {
	description?: string;
	promptSnippet?: string;
	promptGuidelines?: string[];
}

function readJson(path: string): unknown {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		// A missing or malformed config is not an error: the caller falls back to
		// the built-in description, which is the documented upstream behaviour too.
		return undefined;
	}
}

/**
 * XDG config path first, then the pre-2.0.0 `~/.config` path. Mirrors upstream
 * `loadJsonConfigWithLegacyFallback` so a config written by either version works.
 */
export function loadJsonConfigWithLegacyFallback<T>(namespace: string): T {
	const candidates = [
		join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), namespace, "config.json"),
		join(homedir(), ".config", namespace, "config.json"),
	];
	for (const path of candidates) {
		const parsed = readJson(path);
		if (parsed && typeof parsed === "object") return parsed as T;
	}
	return {} as T;
}

/**
 * Pick the usable guidance values out of a raw config blob, defaulting to an empty
 * object — never `undefined`. The caller reads `guidance.description ?? DEFAULT`, so
 * an empty object is the "nothing overridden" answer; returning undefined here would
 * turn the most common case (no config file at all) into a crash.
 *
 * A non-string description or a non-string-array of guidelines is dropped field by
 * field rather than failing the whole config. An empty string is a valid value (it
 * intentionally blanks the text), so only the type is checked.
 */
export function validateGuidanceFields(value: unknown): GuidanceFields {
	if (!value || typeof value !== "object") return {};
	const raw = value as Record<string, unknown>;
	const out: GuidanceFields = {};
	if (typeof raw.description === "string") out.description = raw.description;
	if (typeof raw.promptSnippet === "string") out.promptSnippet = raw.promptSnippet;
	if (Array.isArray(raw.promptGuidelines) && raw.promptGuidelines.every((g) => typeof g === "string")) {
		out.promptGuidelines = raw.promptGuidelines as string[];
	}
	return out;
}
