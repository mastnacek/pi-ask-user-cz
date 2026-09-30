/**
 * End-to-end smoke test over Pi's RPC mode.
 *
 * Scenario 1 — the happy path, in three records:
 *   tool_execution_start    args            -> what the MODEL wrote (must stay English)
 *   extension_ui_request    title/options   -> what the USER is shown  (must be Czech)
 *   tool_execution_end      result          -> what the MODEL gets back (must be English)
 *
 * Scenario 2 — the error contract:
 *   tool_execution_end      isError         -> a rejected question must be a real failure
 *
 * RPC mode is the only headless way to see scenario 1: `ctx.ui.custom()` returns
 * undefined there, so the fork takes its documented `rpc-fallback` path and drives the
 * same translated params through `ui.select` — the exact strings the TUI dialog
 * renders.
 *
 * Scenario 2 uses a RESERVED option label ("Other"). That is deliberate: it passes the
 * tool schema, so the engine does not reject the call for us, and it is rejected by
 * this plugin's own validator instead — which is the path whose result shape is under
 * test. Anything schema-invalid (an empty `questions`, a single option) would be turned
 * away by the engine before `execute` runs, proving nothing about our envelope.
 *
 * Scenario 2 is INCONCLUSIVE, not failed, when the model declines to make the invalid
 * call. A model choosing not to produce bad arguments is not a defect in this plugin,
 * and a flaky negative test is worse than an honest gap.
 *
 * Run: node scripts/rpc-smoke.mjs [extra pi args]
 * Requires a working model provider (two real turns) and pi-prompt-translate enabled.
 */

import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const extraArgs = process.argv.slice(2);

const HAPPY_PROMPT =
	"You MUST call the ask_user_question tool now, as your very first action. Do not call any other tool, do not read files, do not explain. Ask exactly one question with exactly two options about picking a Python web framework: one option 'Django' and one option 'FastAPI'.";

// The reserved label is the whole point: schema-valid, rejected by our validator.
const ERROR_PROMPT =
	"You MUST call the ask_user_question tool now, as your very first action. Do not call any other tool, do not explain, and do not 'fix' the arguments. Call it with exactly one question whose two options are labelled 'Other' and 'Kivy'. This is a deliberate error-path test; the exact label 'Other' is required.";

const CZECH = /[ěščřžýáíéďťňůúó]/i;

/** Spawn one Pi RPC child and collect the records scenario N cares about. */
function runScenario({ prompt, wantDialog }) {
	return new Promise((resolve) => {
		// A clean cwd keeps the repo's AGENTS.md / career prompts out of the way, and the
		// tool allowlist means the model *cannot* answer in prose instead of calling the
		// tool — the only way this could silently pass without asking anything.
		const child = spawn(
			"pi",
			["--mode", "rpc", "--no-session", "--tools", "ask_user_question", ...extraArgs],
			{ stdio: ["pipe", "pipe", "pipe"], shell: true, cwd: join(tmpdir(), "pi-ask-user-cz-smoke") },
		);

		const seen = { args: null, dialog: null, result: null, isError: undefined, warned: false };
		let buffer = "";
		let answered = 0;
		let settled = false;

		const send = (record) => child.stdin.write(`${JSON.stringify(record)}\n`);
		const done = (value) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			try {
				child.kill();
			} catch {
				/* already gone */
			}
			resolve({ ...seen, answered });
		};

		function handle(record) {
			if (process.env.RPC_SMOKE_DEBUG && record.type !== "extension_ui_request") {
				console.log(`[debug] ${JSON.stringify(record).slice(0, 400)}`);
			}
			switch (record.type) {
				case "tool_execution_start":
					if (record.toolName === "ask_user_question" && seen.args === null) seen.args = record.args;
					break;
				case "extension_ui_request":
					if (record.method === "notify" && /ask_user_question/.test(record.message ?? "")) seen.warned = true;
					if (record.method === "select" && wantDialog) {
						seen.dialog = record;
						// Pick a real option, never the appended custom-answer row (which
						// would send the run down the `input` path this harness never answers).
						const pick =
							record.options.find((o) => !/^\d+\.\s*Napište|^✍️|Type something/i.test(o)) ?? record.options[0];
						answered++;
						send({ type: "extension_ui_response", id: record.id, value: pick });
					}
					break;
				case "tool_execution_end":
					if (record.toolName === "ask_user_question") {
						seen.result = record.result;
						seen.isError = record.isError;
					}
					break;
				case "agent_end":
				case "turn_end":
					if (seen.result) done();
					break;
				default:
					break;
			}
		}

		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk) => {
			buffer += chunk;
			// Strict JSONL: split on LF only, strip CR. Never use readline (it also splits
			// on U+2028/U+2029, which are legal inside JSON strings).
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
			if (!seen.result) {
				console.error(`\npi exited (${code}) before the tool finished — no proof collected`);
				done();
			}
		});

		const timer = setTimeout(() => {
			console.error("\nTIMEOUT: no tool result");
			done();
		}, 420_000);
		timer.unref?.();

		send({ id: "req-1", type: "prompt", message: prompt });
	});
}

function report(label, checks) {
	console.log(`\n=== ${label} ===`);
	let ok = true;
	let inconclusive = false;
	for (const [text, pass] of checks) {
		if (pass === null) {
			inconclusive = true;
			console.log(`SKIP  ${text}`);
			continue;
		}
		console.log(`${pass ? "PASS" : "FAIL"}  ${text}`);
		if (!pass) ok = false;
	}
	return { ok, inconclusive };
}

console.log("=== scenario 1: happy path (English in, Czech shown, English back) ===");
const happy = await runScenario({ prompt: HAPPY_PROMPT, wantDialog: true });

console.log("\n=== 1. what the MODEL wrote (expect English) ===");
console.log(JSON.stringify(happy.args ?? {}, null, 2));
console.log("\n=== 2. what the USER is shown (expect Czech) ===");
console.log(`title:   ${happy.dialog?.title ?? "(no dialog — the tool never asked)"}`);
for (const option of happy.dialog?.options ?? []) console.log(`option:  ${option}`);
console.log("\n=== 3. what the MODEL gets back (expect English) ===");
console.log(happy.result?.content?.[0]?.text ?? JSON.stringify(happy.result));

const happyArgs = JSON.stringify(happy.args ?? {});
const happyTitle = happy.dialog?.title ?? "";
// The appended custom-answer row is Czech in this fork by construction, so counting it
// would make "the user saw Czech" pass even when every model-authored string is still
// English. Judge only the options the model actually authored.
const authored = (happy.dialog?.options ?? []).filter((o) => !/Napište|Type something|✍️/.test(o));
const happyEnvelope = happy.result?.content?.[0]?.text ?? "";

const happyVerdict = report("verdict: happy path", [
	["model authored the question in English", !CZECH.test(happyArgs)],
	["user was shown a Czech question", CZECH.test(happyTitle)],
	["user was shown Czech options", CZECH.test(authored.join(" | "))],
	["no skip warning was raised", !happy.warned],
	["options reached the model in English", !CZECH.test(happyEnvelope)],
	["the envelope names the English question the model wrote", /Which|Python|framework/i.test(happyEnvelope)],
	["the tool actually asked something", happy.answered > 0],
]);

console.log("\n\n=== scenario 2: error contract (a rejected question must be isError) ===");
const failed = await runScenario({ prompt: ERROR_PROMPT, wantDialog: false });
console.log(`\nisError: ${failed.isError}`);
console.log(`result:  ${failed.result?.content?.[0]?.text ?? JSON.stringify(failed.result)}`);

const errorText = failed.result?.content?.[0]?.text ?? "";
const madeTheCall = failed.result !== null;
const errorVerdict = report("verdict: error contract", [
	// A model that will not produce bad arguments leaves us nothing to judge. That is
	// model behaviour, not a plugin defect, so it is reported as a gap, not a failure.
	["the model produced a tool result to judge", madeTheCall ? true : null],
	["the rejected call is reported as an error, not a success", madeTheCall ? failed.isError === true : null],
	["the reason is the reserved label", madeTheCall ? /reserved/i.test(errorText) : null],
	["no dialog was shown for a rejected question", madeTheCall ? failed.dialog === null : null],
]);

const ok = happyVerdict.ok && errorVerdict.ok;
if (errorVerdict.inconclusive) {
	console.log("\nscenario 2 was inconclusive — the model did not make the invalid call.");
}
console.log(ok ? "\nRPC SMOKE: PASS" : "\nRPC SMOKE: FAIL");
process.exit(ok ? 0 : 1);
