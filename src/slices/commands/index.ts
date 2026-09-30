/**
 * `/ask-user-cz` command — settings menu and configuration inspector.
 *
 * Implements the Trailing Space Contract:
 * - Non-terminal choices (`preset `, `collapseKey `, `--global `) append trailing space.
 * - Terminal choices (`preset concise`, `status`, etc.) do not append space.
 *
 * Lazy Parameter Completion:
 * - Fully typed non-terminal token (`preset`, `collapseKey`) immediately reveals child choices.
 *
 * Current-Value State Annotation:
 * - Active values marked with `✓` in label and ` · ● AKTIVNÍ` in description.
 * - No ANSI escapes in autocomplete descriptions.
 *
 * Global Config Cascade:
 * - Accepts `--global` flag: global writes ~/.pi/agent/pi-ask-user-cz.json, without it writes <cwd>/.pi/pi-ask-user-cz.json.
 */

import type { AutocompleteItem } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
	loadConfig,
	resolvePreset,
	resolveCollapseKey,
	formatKeySpecForDisplay,
	saveConfig,
	type GuidancePreset,
} from "../../shared/config.js";

/** Preset choices and descriptions */
const PRESET_OPTIONS: ReadonlyArray<{ id: GuidancePreset; label: string; desc: string }> = [
	{ id: "concise", label: "concise", desc: "Nový štíhlý styl (~215 slov) se skillem asking-well" },
	{ id: "legacy", label: "legacy", desc: "Původní podrobný styl (567 slov) s detailními pravidly" },
];

/** Collapse key shortcut choices */
const COLLAPSE_OPTIONS = ["ctrl+]", "alt+o", "off"] as const;

function buildPresetRows(activePreset: GuidancePreset, isGlobal: boolean): AutocompleteItem[] {
	return PRESET_OPTIONS.map((opt) => {
		const isActive = opt.id === activePreset;
		const baseVal = `preset ${opt.id}`;
		return {
			value: isGlobal ? `--global ${baseVal}` : baseVal,
			label: isActive ? `${opt.label} ✓` : opt.label,
			description: `${opt.desc}${isActive ? " · ● AKTIVNÍ" : ""}`,
		};
	});
}

function buildCollapseRows(activeKey: string, isGlobal: boolean): AutocompleteItem[] {
	return COLLAPSE_OPTIONS.map((key) => {
		const isActive = key.toLowerCase() === activeKey.toLowerCase();
		const baseVal = `collapseKey ${key}`;
		return {
			value: isGlobal ? `--global ${baseVal}` : baseVal,
			label: isActive ? `${key} ✓` : key,
			description: `Zkratka pro sbalení dialogu${isActive ? " · ● AKTIVNÍ" : ""}`,
		};
	});
}

export function getArgumentCompletions(prefix: string): AutocompleteItem[] | null {
	const trimmed = prefix.trimStart();
	const isGlobal = trimmed.startsWith("--global");
	const afterGlobal = isGlobal ? trimmed.slice(8).trimStart() : trimmed;

	const config = loadConfig();
	const activePreset = resolvePreset(config);
	const activeKey = resolveCollapseKey(config);

	const tokens = afterGlobal.split(/\s+/).filter(Boolean);
	const firstToken = tokens[0]?.toLowerCase();

	// 1. Parameter level: `preset ...`
	if (firstToken === "preset") {
		const childPrefix = tokens.length > 1 ? tokens[1]!.toLowerCase() : "";
		const rows = buildPresetRows(activePreset, isGlobal);
		const filtered = rows.filter((r) => r.label.toLowerCase().startsWith(childPrefix));
		return filtered.length > 0 ? filtered : null;
	}

	// 2. Parameter level: `collapseKey ...`
	if (firstToken === "collapsekey") {
		const childPrefix = tokens.length > 1 ? tokens[1]!.toLowerCase() : "";
		const rows = buildCollapseRows(activeKey, isGlobal);
		const filtered = rows.filter((r) => r.label.toLowerCase().startsWith(childPrefix));
		return filtered.length > 0 ? filtered : null;
	}

	// 3. Top level catalogue:
	const catalogue: AutocompleteItem[] = [
		{
			value: isGlobal ? "--global preset " : "preset ",
			label: "preset",
			description: `Styl promptu (nyní: ${activePreset}) · ● AKTIVNÍ`,
		},
		{
			value: isGlobal ? "--global collapseKey " : "collapseKey ",
			label: "collapseKey",
			description: `Zkratka sbalení (nyní: ${formatKeySpecForDisplay(activeKey)})`,
		},
		{
			value: isGlobal ? "--global status" : "status",
			label: "status",
			description: "Zobrazit aktuální konfiguraci pluginu",
		},
	];

	if (!isGlobal) {
		catalogue.push({
			value: "--global ",
			label: "--global",
			description: "Aplikovat nastavení globálně pro všechny relace",
		});
	}

	if (afterGlobal === "") {
		return catalogue;
	}

	const filtered = catalogue.filter((item) => item.label.toLowerCase().startsWith(afterGlobal.toLowerCase()));
	return filtered.length > 0 ? filtered : null;
}

export function registerAskUserCommand(pi: ExtensionAPI): void {
	pi.registerCommand("ask-user-cz", {
		description: "Nastavení a správa pluginu pi-ask-user-cz (styl promptu, zkratky)",
		getArgumentCompletions,
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const rawTokens = args.trim().split(/\s+/).filter(Boolean);
			const isGlobal = rawTokens.some((token) => token.toLowerCase() === "--global");
			const tokens = rawTokens.filter((token) => token.toLowerCase() !== "--global");
			const sub = (tokens[0] ?? "status").toLowerCase();
			const scope = isGlobal ? "globálně" : "pro projekt";

			if (sub === "preset") {
				const choice = tokens[1]?.toLowerCase();
				if (choice !== "concise" && choice !== "legacy") {
					if (ctx.hasUI) {
						ctx.ui.notify("Použití: /ask-user-cz preset concise | legacy [--global]", "warning");
					}
					return;
				}
				saveConfig({ preset: choice as GuidancePreset }, isGlobal, ctx.cwd);
				if (ctx.hasUI) {
					ctx.ui.notify(`Styl promptu nastaven na: ${choice} (${scope}, projeví se po /reload)`, "info");
				}
				return;
			}

			if (sub === "collapsekey") {
				const key = tokens[1];
				if (!key) {
					if (ctx.hasUI) {
						ctx.ui.notify("Použití: /ask-user-cz collapseKey <zkratka|off> [--global]", "warning");
					}
					return;
				}
				saveConfig({ collapseKey: key }, isGlobal, ctx.cwd);
				if (ctx.hasUI) {
					ctx.ui.notify(`Zkratka pro sbalení nastavena na: ${key} (${scope})`, "info");
				}
				return;
			}

			// Default: status
			const config = loadConfig(ctx.cwd);
			const preset = resolvePreset(config);
			const collapseKey = resolveCollapseKey(config);

			const info = [
				`Konfigurace pi-ask-user-cz:`,
				`  Styl promptu (preset): ${preset}`,
				`  Zkratka pro sbalení:   ${formatKeySpecForDisplay(collapseKey)}`,
				`  Platnost:              ${isGlobal ? "globální" : "aktivní relace/projekt"}`,
			].join("\n");

			if (ctx.hasUI) {
				ctx.ui.notify(info, "info");
			}
		},
	});
}
