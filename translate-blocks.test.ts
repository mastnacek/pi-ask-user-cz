/**
 * The two pure functions that can silently corrupt an answer, tested directly.
 *
 * What matters is the round trip: the model writes English, the dialog shows Czech,
 * and the model gets *its own* English back. A marker breach or a mis-ordered
 * translation would break exactly that, and the damage is invisible on screen — the
 * user sees a perfectly good Czech dialog while the conversation silently drifts.
 *
 * The `<<<n>>>` formatter/parser below is a local stand-in for the translate plugin's
 * `formatBlocks` / `parseBlocks` (which live in another package and are exercised
 * there). Keeping it local is the point: this test asserts the *contract* the fork
 * depends on — one block in, one block out, same order — without loading a model
 * client to do it.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
	applyTranslations,
	collectTranslatableTexts,
	restoreEnglishAnswers,
} from "./translate-blocks.js";
import { MAX_HEADER_LENGTH, type QuestionParams, type QuestionnaireResult } from "./tool/types.js";
import { inspectPluginCandidates } from "./translate-questionnaire.js";

/** Emulates the translate plugin's `tool` purpose: marker-delimited, literal, ordered. */
function fakeTranslate(texts: readonly string[], prefix = "Přeloženo:"): string[] {
	return texts.map((text) => `${prefix} ${text}`);
}

function toBlocks(texts: readonly string[]): string {
	return texts.map((text, i) => `<<<${i}>>>\n${text}`).join("\n");
}

function fromBlocks(payload: string, count: number): string[] | null {
	const parsed: (string | undefined)[] = new Array(count).fill(undefined);
	const seen: number[] = [];
	let current: number | undefined;
	let buffer: string[] = [];
	const flush = () => {
		if (current !== undefined && current < count) parsed[current] = buffer.join("\n").trim();
		buffer = [];
	};
	for (const line of payload.split(/\r?\n/)) {
		const match = /^<<<(\d+)>>>$/.exec(line.trim());
		if (match) {
			flush();
			current = Number(match[1]);
			seen.push(current);
			continue;
		}
		if (current !== undefined) buffer.push(line);
	}
	flush();
	// Same all-or-nothing rule the plugin applies: exactly 0..count-1, in order, none empty.
	if (seen.length !== count) return null;
	for (let i = 0; i < count; i++) if (seen[i] !== i || parsed[i] === undefined) return null;
	return parsed as string[];
}

const ENGLISH: QuestionParams = {
	questions: [
		{
			question: "Which storage should we use?",
			header: "Storage",
			options: [
				{ label: "SQLite", description: "Single file, no server", preview: "```sql\nCREATE TABLE t(id INT);\n```" },
				{ label: "Postgres (Recommended)", description: "Server, migrations" },
			],
		},
		{
			question: "Which parts do you want?",
			header: "Scope",
			multiSelect: true,
			options: [
				{ label: "Backend", description: "API and storage" },
				{ label: "Frontend", description: "UI" },
			],
		},
	],
};

test("collect order is question, header, then label/description per option", () => {
	assert.deepEqual(collectTranslatableTexts(ENGLISH), [
		"Which storage should we use?",
		"Storage",
		"SQLite",
		"Single file, no server",
		"Postgres (Recommended)",
		"Server, migrations",
		"Which parts do you want?",
		"Scope",
		"Backend",
		"API and storage",
		"Frontend",
		"UI",
	]);
});

test("previews are not translated — a code block must survive byte-identical", () => {
	const { display } = applyTranslations(ENGLISH, fakeTranslate(collectTranslatableTexts(ENGLISH)));
	assert.equal(display.questions[0].options[0].preview, ENGLISH.questions[0].options[0].preview);
	assert.equal(display.questions[0].options[0].preview, "```sql\nCREATE TABLE t(id INT);\n```");
});

test("a header that no longer fits the tab chip keeps its English original", () => {
	const texts = collectTranslatableTexts(ENGLISH);
	const translated = fakeTranslate(texts);
	// Widen the first header past the chip limit, the way Czech routinely does.
	translated[1] = "Použité úložiště dat, dlouhý popis";
	assert.ok(translated[1].length > MAX_HEADER_LENGTH);
	const { display } = applyTranslations(ENGLISH, translated);
	assert.equal(display.questions[0].header, "Storage");
	// Everything else is still Czech — the fallback is per field, not per questionnaire.
	assert.equal(display.questions[0].question, "Přeloženo: Which storage should we use?");
});

test("round trip: what the model gets back is exactly what it wrote", () => {
	const texts = collectTranslatableTexts(ENGLISH);
	const parsed = fromBlocks(toBlocks(fakeTranslate(texts)), texts.length);
	assert.ok(parsed, "the fake translator must honour the marker contract");
	const { display, labelMap } = applyTranslations(ENGLISH, parsed);

	// The user reads Czech…
	assert.equal(display.questions[0].options[0].label, "Přeloženo: SQLite");
	assert.equal(display.questions[1].options[1].label, "Přeloženo: Frontend");
	assert.equal(display.questions[1].multiSelect, true);

	// …and picks by the Czech label the dialog showed.
	const picked: QuestionnaireResult = {
		answers: [
			{
				questionIndex: 0,
				question: display.questions[0].question,
				kind: "option",
				answer: display.questions[0].options[1].label,
			},
			{
				questionIndex: 1,
				question: display.questions[1].question,
				kind: "multi",
				answer: null,
				selected: [display.questions[1].options[0].label, display.questions[1].options[1].label],
			},
		],
		cancelled: false,
	};

	const restored = restoreEnglishAnswers(picked, ENGLISH, labelMap);
	assert.equal(restored.answers[0].question, "Which storage should we use?");
	assert.equal(restored.answers[0].answer, "Postgres (Recommended)");
	assert.equal(restored.answers[1].question, "Which parts do you want?");
	assert.deepEqual(restored.answers[1].selected, ["Backend", "Frontend"]);
});

test("the user's own words are never rewritten", () => {
	const texts = collectTranslatableTexts(ENGLISH);
	const { labelMap } = applyTranslations(ENGLISH, fakeTranslate(texts));
	const typed: QuestionnaireResult = {
		answers: [
			{ questionIndex: 0, question: "Přeloženo: Which storage should we use?", kind: "custom", answer: "radši Postgres" },
			{ questionIndex: 1, question: "Přeloženo: Which parts do you want?", kind: "custom", answer: "jen UI", notes: "a ne API" },
		],
		cancelled: false,
		globalNote: "děkuji",
	};
	const restored = restoreEnglishAnswers(typed, ENGLISH, labelMap);
	assert.equal(restored.answers[0].answer, "radši Postgres");
	assert.equal(restored.answers[1].notes, "a ne API");
	assert.equal(restored.globalNote, "děkuji");
	// The question text is still the model's own, even for a free-text answer.
	assert.equal(restored.answers[0].question, "Which storage should we use?");
});

test("an unknown label passes through instead of becoming '(no input)'", () => {
	const { labelMap } = applyTranslations(ENGLISH, fakeTranslate(collectTranslatableTexts(ENGLISH)));
	const restored = restoreEnglishAnswers(
		{
			answers: [{ questionIndex: 0, question: "?", kind: "option", answer: "Neznámá volba" }],
			cancelled: false,
		},
		ENGLISH,
		labelMap,
	);
	assert.equal(restored.answers[0].answer, "Neznámá volba");
});

test("a cancelled result is returned untouched", () => {
	const { labelMap } = applyTranslations(ENGLISH, fakeTranslate(collectTranslatableTexts(ENGLISH)));
	const cancelled: QuestionnaireResult = { answers: [], cancelled: true };
	assert.deepEqual(restoreEnglishAnswers(cancelled, ENGLISH, labelMap), cancelled);
});

test("a marker-contract breach yields no translation at all, never a partial one", () => {
	const texts = collectTranslatableTexts(ENGLISH);
	const shifted = fakeTranslate(texts).slice(1);
	// A model that starts at <<<1>>> still emits N blocks, but every one lands in the
	// wrong field — the exact failure the plugin rejects wholesale.
	assert.equal(fromBlocks(toBlocks(shifted).replace("<<<0>>>", ""), texts.length), null);
});

test("the translate plugin's entry files are where the resolver looks for them", () => {
	// The import of another package's TypeScript only happens under Pi's jiti loader,
	// so what is verifiable outside Pi is the layout contract — and a layout change is
	// the realistic way that seam breaks. The import itself is proven by the live
	// dialog: Czech options mean it resolved, a warning notification means it did not.
	const candidates = inspectPluginCandidates();
	const usable = candidates.filter((c) => c.present);
	assert.ok(usable.length > 0, `no translate plugin found: ${JSON.stringify(candidates)}`);
	for (const candidate of usable) console.log(`    translate plugin: ${candidate.root}`);
});
