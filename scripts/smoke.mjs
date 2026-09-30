/**
 * Smoke test for the things a file-move refactor can break silently.
 *
 * The unit suite is bundled with esbuild, which rewrites `import.meta.url` to the
 * bundle's own location — so it can never observe where this package resolves its
 * own files. That is exactly the blind spot a VSA move opens: `src/shared/i18n.ts`
 * reads `locales/cs.json` through a relative `import.meta.url`, and a wrong `..`
 * count does not crash. It returns an empty table, every key falls back to its
 * English literal, and a Czech-only fork renders a perfectly healthy English
 * dialog with no error anywhere. The only honest check is to load the real
 * module graph through the same jiti Pi uses, unbundled.
 *
 * Run: `node scripts/smoke.mjs`
 */

import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

/**
 * Resolve the engine, then jiti through it. The package carries no dependencies
 * on purpose (a git package must not need an install), and jiti ships inside the
 * engine rather than the workspace root — the same node_modules walk-up the
 * skill documents, so no install path is ever hardcoded.
 */
function loadJiti() {
	for (let dir = root; ; dir = dirname(dir)) {
		const pkg = join(dir, "node_modules", "@earendil-works", "pi-coding-agent", "package.json");
		if (existsSync(pkg)) return createRequire(pkg)("jiti").createJiti(pkg, { interopDefault: true });
		if (dirname(dir) === dir) throw new Error("engine not found in any parent node_modules");
	}
}

let failed = 0;
function check(name, ok, detail = "") {
	if (ok) console.log(`ok   ${name}`);
	else {
		failed++;
		console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
	}
}

const jiti = loadJiti();
const load = (...parts) => jiti.import(join(root, ...parts));

// 1. The composition root evaluates. Any wrong path in the new layout throws here.
const rootModule = await load("index.ts");
check("index.ts evaluates through jiti", typeof rootModule.default === "function");
check("composition root re-exports the tool name", rootModule.ASK_USER_QUESTION_TOOL_NAME === "ask_user_question");
check("composition root re-exports both events", rootModule.ASK_USER_PROMPT_EVENT === "rpiv:ask-user:prompt");

// 2. The kernel loads its own locale file. This is the regression the move risks.
const i18n = await load("src", "shared", "i18n.ts");
check("cs.json resolves from src/shared (depth contract)", i18n.hasCzechTable() === true);
check("t() returns Czech, not the English fallback", i18n.t("sentinel.other", "Type something.") === "Napište vlastní.");
check("t() still falls back per key", i18n.t("no.such.key", "English fallback") === "English fallback");

// 3. displayLabel moved into the slice and still resolves Czech through the kernel.
const rowIntent = await load("src", "slices", "questionnaire", "session", "row-intent.ts");
check("displayLabel renders Czech from the slice", rowIntent.displayLabel("other") === "Napište vlastní.");

// 4. The kernel is importable on its own, i.e. it does not drag a slice in with it.
const contract = await load("src", "shared", "contract.ts");
check("kernel contract exports the tool name", contract.ASK_USER_QUESTION_TOOL_NAME === "ask_user_question");

// 5. The ~560ms render graph must stay behind a dynamic import. Loading it at
//    registration would make every session slower, and no runtime assertion can
//    see that — so assert the construct itself.
const toolSource = readFileSync(join(root, "src", "slices", "questionnaire", "tool.ts"), "utf8");
check(
	"render graph is still a dynamic import",
	/await import\("\.\/session\/questionnaire\.js"\)/.test(toolSource) &&
		!/^\s*import[^\n]*from "\.\/session\/questionnaire\.js"/m.test(toolSource),
	"session/questionnaire.ts must be reached only via await import()",
);

console.log(failed === 0 ? "\nsmoke: all checks passed" : `\nsmoke: ${failed} check(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
