/**
 * End-to-end smoke test over Pi's RPC mode: proves the whole chain in three records.
 *
 *   tool_execution_start    args            -> what the MODEL wrote (must stay English)
 *   extension_ui_request    title/options   -> what the USER is shown  (must be Czech)
 *   tool_execution_end      result          -> what the MODEL gets back (must be English)
 *
 * RPC mode is the only headless way to see this: `ctx.ui.custom()` returns undefined
 * there, so the fork takes its documented `rpc-fallback` path and drives the same
 * translated params through `ui.select` — the exact strings the TUI dialog renders.
 *
 * Run: node scripts/rpc-smoke.mjs [extra pi args]
 * Requires a working model provider (one real turn) and pi-prompt-translate enabled.
 */

import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const extraArgs = process.argv.slice(2);
const PROMPT =
	"You MUST call the ask_user_question tool now, as your very first action. Do not call any other tool, do not read files, do not explain. Ask exactly one question with exactly two options about picking a Python web framework: one option 'Django' and one option 'FastAPI'.";

// A clean cwd keeps the repo's AGENTS.md / career prompts out of the way, and the tool
// allowlist means the model *cannot* answer the question in prose instead of asking it —
// which is the only way this smoke test could silently pass without asking anything.
const child = spawn(
	"pi",
	["--mode", "rpc", "--no-session", "--tools", "ask_user_question", ...extraArgs],
	{ stdio: ["pipe", "pipe", "pipe"], shell: true, cwd: join(tmpdir(), "pi-ask-user-cz-smoke") },
);

let buffer = "";
const seen = { start: null, dialog: null, end: null, warned: false };
let answered = 0;

const send = (record) => child.stdin.write(`${JSON.stringify(record)}\n`);

const finish = (code) => {
	try {
		child.kill();
	} catch {
		/* already gone */
	}
	process.exit(code);
};

const CZECH = /[ěščřžýáíéďťňůúó]/i;

function handle(record) {
	if (process.env.RPC_SMOKE_DEBUG) {
		if (record.type !== "extension_ui_request") console.log(`[debug] ${JSON.stringify(record).slice(0, 400)}`);
	}
	switch (record.type) {
		case "tool_execution_start":
			console.log(`(tool: ${record.toolName})`);
			if (record.toolName === "ask_user_question") {
				seen.start = record.args;
				console.log("\n=== 1. what the MODEL wrote (expect English) ===");
				console.log(JSON.stringify(record.args, null, 2));
			}
			break;
		case "extension_ui_request":
			if (record.method === "notify" && /ask_user_question/.test(record.message ?? "")) {
				seen.warned = true;
				console.log(`\n!! notification: [${record.notifyType}] ${record.message}`);
			}
			if (record.method === "select") {
				seen.dialog = record;
				console.log("\n=== 2. what the USER is shown (expect Czech) ===");
				console.log(`title:   ${record.title}`);
				for (const option of record.options) console.log(`option:  ${option}`);
				// Pick a real option, never the appended custom-answer row (which would
				// send the run down the `input` path this harness does not answer).
				const pick = record.options.find((o) => !/^\d+\.\s*Napište|^✍️|Type something/i.test(o)) ?? record.options[0];
				console.log(`\n-> answering with: ${pick}`);
				answered++;
				send({ type: "extension_ui_response", id: record.id, value: pick });
			}
			break;
		case "tool_execution_end":
			if (record.toolName === "ask_user_question") {
				seen.end = record.result;
				console.log("\n=== 3. what the MODEL gets back (expect English) ===");
				console.log(record.result?.content?.[0]?.text ?? JSON.stringify(record.result));
			}
			break;
		case "agent_end":
		case "turn_end":
			if (seen.end) report();
			break;
		case "agent_start":
			console.log("(agent started)");
			break;
		case "tool_execution_start":
			console.log(`(tool: ${record.toolName})`);
			break;
		default:
			break;
	}
}

function report() {
	const args = JSON.stringify(seen.start ?? {});
	const title = seen.dialog?.title ?? "";
	// The appended custom-answer row is Czech in this fork by construction, so counting
	// it would make "the user saw Czech" pass even when every model-authored string is
	// still English. Judge only the options the model actually authored.
	const authored = (seen.dialog?.options ?? []).filter((o) => !/Napište|Type something|✍️/.test(o));
	const options = authored.join(" | ");
	const envelope = seen.end?.content?.[0]?.text ?? "";

	const checks = [
		["model authored the question in English", !CZECH.test(args)],
		["user was shown a Czech question", CZECH.test(title)],
		["user was shown Czech options", CZECH.test(options)],
		["no skip warning was raised", !seen.warned],
		["options reached the model in English", !CZECH.test(envelope)],
		["the envelope names the English question the model wrote", /Which|Python|framework/i.test(envelope)],
	];
	console.log("\n=== verdict ===");
	let ok = true;
	for (const [label, pass] of checks) {
		console.log(`${pass ? "PASS" : "FAIL"}  ${label}`);
		if (!pass) ok = false;
	}
	finish(ok && answered > 0 ? 0 : 1);
}

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
	buffer += chunk;
	// Strict JSONL: split on LF only, strip CR. Never use readline (it also splits on
	// U+2028/U+2029, which are legal inside JSON strings).
	let index;
	while ((index = buffer.indexOf("\n")) >= 0) {
		const line = buffer.slice(0, index).replace(/\r$/, "");
		buffer = buffer.slice(index + 1);
		if (line.trim().length === 0) continue;
		try {
			handle(JSON.parse(line));
		} catch {
			// Non-JSON diagnostics on stdout are not protocol records; ignore them.
		}
	}
});

child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => process.stderr.write(chunk));

child.on("exit", (code) => {
	if (!seen.end) {
		console.error(`\npi exited (${code}) before the tool finished — no proof collected`);
		finish(1);
	}
});

send({ id: "req-1", type: "prompt", message: PROMPT });
setTimeout(() => {
	console.error("\nTIMEOUT: no tool result within 420s");
	finish(1);
}, 420_000).unref?.();
