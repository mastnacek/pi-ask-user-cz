/**
 * The tool error contract.
 *
 * The engine treats a returned object WITHOUT `isError: true` as a success no matter
 * what its content says, so these assertions are the only thing standing between a
 * rejected questionnaire and a model that believes the user answered it. The bug this
 * pins is not hypothetical: every failure path used to return a plain object, which
 * made a validation rejection indistinguishable from the user declining.
 *
 * The decline case is asserted as a SUCCESS on purpose. A user saying no is a
 * completed question, not a failure, and marking it `isError` would teach the model
 * to retry a question the user already answered.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { buildToolResult, DECLINE_MESSAGE, buildQuestionnaireResponse } from "../src/slices/questionnaire/params/envelope.js";
import type { QuestionnaireResult } from "../src/slices/questionnaire/params/types.js";

const failed: QuestionnaireResult = { answers: [], cancelled: true, error: "reserved_label" };
const declined: QuestionnaireResult = { answers: [], cancelled: true };

test("a failure result is marked isError, and keeps details for the UI", () => {
	const result = buildToolResult("Error: boom", failed, true);
	assert.equal(result.isError, true, "the model would otherwise read this as a success");
	assert.deepEqual(result.details, failed, "details must survive for UI and programmatic callers");
	assert.match(result.content[0].text, /Error:/);
});

test("isError is absent, not false, on a success result", () => {
	const result = buildToolResult("all good", { answers: [], cancelled: false });
	assert.ok(!("isError" in result), "a success must not carry the flag at all");
});

test("a decline is a success, not a failure", () => {
	const result = buildQuestionnaireResponse(declined, {
		questions: [{ question: "Q?", header: "H", options: [{ label: "A" }, { label: "B" }] }],
	} as never);
	assert.ok(!("isError" in result), "the user declining is an outcome, not an error");
	assert.equal(result.content[0].text, DECLINE_MESSAGE);
});

test("an answered questionnaire is a success", () => {
	const result = buildQuestionnaireResponse(
		{
			cancelled: false,
			answers: [{ questionIndex: 0, question: "Q?", kind: "option", answer: "A" }],
		},
		{ questions: [{ question: "Q?", header: "H", options: [{ label: "A" }, { label: "B" }] }] } as never,
	);
	assert.ok(!("isError" in result));
	assert.match(result.content[0].text, /"Q\?"="A"/);
});

test("a declined result carrying a note still succeeds", () => {
	const result = buildQuestionnaireResponse({ ...declined, globalNote: "later" }, { questions: [] } as never);
	assert.ok(!("isError" in result), "a note on a decline must not flip it to a failure");
});
