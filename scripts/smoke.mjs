/**
 * Smoke test: does the package's own module graph hold together, unbundled?
 *
 * Why this exists. The unit suite is bundled with esbuild, which rewrites
 * `import.meta.url` to the bundle's own location, so it structurally cannot
 * observe where this package resolves its own files. That is precisely the blind
 * spot a VSA move opens: `src/shared/i18n.ts` reads `locales/cs.json` through a
 * relative `import.meta.url`, and a wrong `..` count does not crash — it returns
 * an empty table and a Czech-only fork renders a perfectly healthy English dialog
 * with no error anywhere. The only honest check is to load the real graph through
 * the same jiti Pi uses.
 *
 * What it does NOT do: verify that Pi supplies the peer dependencies. Pi resolves
 * `@earidil-works/*` from its own installation; this script does not reimplement
 * that, because a hand-rolled alias for an ESM-only `exports` map is a second
 * loader to keep correct and would test the harness, not the package. Checks that
 * need the peers are therefore skipped, visibly, where they are not naturally
 * resolvable — which is the bare `~/.pi/agent/git/...` checkout with no
 * `node_modules` above it. Run this from the dev tree (`npm test`), where the
 * workspace hoists the engine and every check runs.
 *
 * Run: `node scripts/smoke.mjs`
 */

import { dirname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = fileURLToPath(new URL("..", import.meta.url));

/**
 * Normalise to forward slashes before touching the filesystem.
 *
 * `path.join` emits backslashes on Windows, and on this machine `existsSync`
 * answers `false` for the backslash spelling of a path it happily answers `true`
 * for with forward slashes — so every `join`-built probe below failed silently and
 * the resolver reported "no engine" in a tree where the engine is right there.
 * Node accepts forward slashes on Windows, so normalising is free and makes the
 * probes agree with the paths the rest of the script builds.
 */
const posix = (p) => p.replace(/\\/g, "/");

/**
 * Locate the engine. The package declares its peers as `"*"` and carries no
 * dependencies on purpose, so nothing here can assume an install step ran.
 * Two sources, both deterministic:
 * `PI_PACKAGE_DIR` (exported by the running Pi, authoritative when set) and a
 * parent `node_modules` walk-up (the dev tree, where the workspace hoists the engine).
 * Never a hardcoded path. An earlier version also scanned `PATH` for the `pi`
 * executable; it was removed as the one part of this resolver that could not be made
 * to behave consistently, and it is redundant — the engine that matters is either
 * exported by the host or hoisted above the checkout.
 */
function engineCandidates() {
	const found = [];
	const push = (pkg) => {
		if (pkg && existsSync(posix(pkg)) && !found.includes(pkg)) found.push(pkg);
	};

	if (process.env.PI_PACKAGE_DIR) push(join(process.env.PI_PACKAGE_DIR, "package.json"));

	for (let dir = root; ; dir = dirname(dir)) {
		const pkg = join(dir, "node_modules", "@earendil-works", "pi-coding-agent", "package.json");
		if (existsSync(posix(pkg))) {
			push(pkg);
			break;
		}
		if (dirname(dir) === dir) break;
	}

	return found;
}


function makeJiti() {
	for (const pkg of engineCandidates()) {
		try {
			return createRequire(pkg)("jiti").createJiti(pkg, { interopDefault: true });
		} catch {
			// Engine present but jiti not resolvable from it — try the next candidate.
		}
	}
	throw new Error(
		"jiti unreachable. Looked via PI_PACKAGE_DIR, a parent node_modules walk-up, and pi on PATH.\n" +
			`Tried:\n  ${engineCandidates().join("\n  ") || "(nothing)"}`,
	);
}

let failed = 0;
let skipped = 0;
function check(name, ok, detail = "") {
	if (ok) console.log(`ok   ${name}`);
	else {
		failed++;
		console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
	}
}
function skip(name, why) {
	skipped++;
	console.log(`skip ${name} — ${why}`);
}

const jiti = makeJiti();
const load = (...parts) => jiti.import(join(root, ...parts));

// 1. The composition root evaluates. Any wrong path in the layout throws here.
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

// 5. The factory must actually run. Evaluating the module is not registering the
//    tool: everything it touches statically is resolved here, so a moved path in
//    the eager graph fails at this line and nowhere later.
const registered = [];
const listeners = [];
rootModule.default({
	registerTool: (t) => registered.push(t.name),
	on: (event) => {
		listeners.push(event);
		return () => {};
	},
	getActiveTools: () => [],
	setActiveTools: () => {},
});
check("factory registers the tool", registered.includes("ask_user_question"), `got ${JSON.stringify(registered)}`);
check(
	"factory subscribes before_agent_start and session_shutdown",
	listeners.includes("before_agent_start") && listeners.includes("session_shutdown"),
	`got ${JSON.stringify(listeners)}`,
);

// 6. The render graph must stay behind a dynamic import. Loading it at
//    registration would make every session ~560ms slower, and no runtime
//    assertion can see that — so assert the construct itself.
const toolSource = readFileSync(join(root, "src", "slices", "questionnaire", "tool.ts"), "utf8");
check(
	"render graph is still a dynamic import",
	/await import\("\.\/session\/questionnaire\.js"\)/.test(toolSource) &&
		!/^\s*import[^\n]*from "\.\/session\/questionnaire\.js"/m.test(toolSource),
	"session/questionnaire.ts must be reached only via await import()",
);

// 7. The two lazy edges, resolved for real. They sit behind `await import()` and
//    their failures are swallowed into an LLM-facing envelope, so a moved
//    specifier here would pass every check above and fail at question time.
const toolModule = await load("src", "slices", "questionnaire", "tool.ts");
const graph = await toolModule.loadQuestionnaireSession();

// A missing *peer* is a host condition: Pi supplies @earidil-works/* and typebox
// from its own installation, and a bare `node` process outside Pi may resolve them
// or not (this workspace's pi-tui even ships an empty `exports` array, which the
// strict CJS resolver rejects while jiti's own resolver loads it — so no
// require.resolve probe can answer this). A missing *relative* path, by contrast,
// is always this package's bug, which is the entire point of the check.
const MISSING_PEER = /Cannot find module ['"](@earidil-works\/[^'"]+|typebox)['"]/;

if (graph.ok) {
	check("render graph exports QuestionnaireSession", typeof graph.module.QuestionnaireSession === "function");
	const editor = await load("src", "slices", "questionnaire", "session", "external-editor.ts");
	check("lazy external-editor module resolves", typeof editor.editWithExternalEditor === "function");
} else {
	const peer = String(graph.message).match(MISSING_PEER);
	if (peer) {
		skip("lazy render graph + external editor", `peer ${peer[1]} is not resolvable in this process; Pi supplies it at runtime`);
	} else {
		check("lazy render graph resolves", false, `${graph.error}: ${graph.message}`);
	}
}

const summary = failed === 0 ? `all checks passed${skipped ? ` (${skipped} skipped)` : ""}` : `${failed} check(s) FAILED`;
console.log(`\nsmoke: ${summary}`);
process.exit(failed === 0 ? 0 : 1);
