/**
 * The pure half of the Czech render: which model-authored strings get translated,
 * and how a Czech answer is mapped back to the English label the model wrote.
 *
 * Split from `src/slices/questionnaire/translate.ts` so this file has no I/O and no dependency
 * on the translate plugin — the marker round-trip and the label restore are exactly
 * the two things that can silently corrupt an answer, so they are the two things the
 * test drives.
 *
 * What is translated: `question`, `header`, and every option's `label` and
 * `description` — the prose the user reads.
 *
 * What is NOT translated, deliberately:
 * - `preview`. It is an artifact (ASCII mockup, code, config, diagram), and the
 *   translate engine's `tool` contract already says to keep code, commands, flags,
 *   paths and markdown verbatim. Translating it would be the one place where a
 *   literal translation actively corrupts meaning.
 * - `multiSelect`. Structural.
 * - The user's own words. Free-text answers, per-question notes and the global note
 *   are the user typing Czech at the model; those are passed through untouched, which
 *   is also what "must not change anything" demands.
 *
 * Label length: option labels are hard-limited to `MAX_LABEL_LENGTH` by the TypeBox
 * schema on the way *in*, and the option list wraps rather than truncates, so a Czech
 * label that is longer than its English original renders fine. `header` has no such
 * luxury — it is a short tab chip — so a translated header over `MAX_HEADER_LENGTH`
 * keeps its English original instead of overflowing the tab bar.
 */

import { MAX_HEADER_LENGTH, type QuestionParams, type QuestionnaireResult } from "./params/types.js";

/** The strings to translate, in the exact order the marker payload is built. */
export function collectTranslatableTexts(params: QuestionParams): string[] {
	const texts: string[] = [];
	for (const question of params.questions) {
		texts.push(question.question, question.header);
		for (const option of question.options) {
			texts.push(option.label, option.description);
		}
	}
	return texts;
}

/** Czech label -> English label, per question index. */
export type LabelMap = Map<number, Map<string, string>>;

export interface TranslatedParams {
	/** What the dialog renders. */
	display: QuestionParams;
	labelMap: LabelMap;
}

/**
 * Write the translations back into a copy of the params and record how to undo it.
 *
 * The copy is structural (questions/options arrays are new, the strings are new);
 * `preview` values are shared by reference, which is exactly right — they are not
 * translated, so both copies must show the same artifact.
 */
export function applyTranslations(params: QuestionParams, texts: readonly string[]): TranslatedParams {
	const labelMap: LabelMap = new Map();
	let cursor = 0;

	const questions = params.questions.map((question, questionIndex) => {
		const translatedQuestion = texts[cursor++];
		const translatedHeader = texts[cursor++];
		// The tab chip has a hard width. A Czech header that no longer fits keeps the
		// English original — the header is a category label, so the loss is cosmetic,
		// while an overflowing tab bar is a layout bug.
		const header =
			translatedHeader !== undefined && translatedHeader.length <= MAX_HEADER_LENGTH
				? translatedHeader
				: question.header;

		const perQuestion = new Map<string, string>();
		const options = question.options.map((option) => {
			const label = texts[cursor++];
			const description = texts[cursor++];
			if (label !== undefined) perQuestion.set(label, option.label);
			return {
				...option,
				label: label ?? option.label,
				description: description ?? option.description,
			};
		});

		labelMap.set(questionIndex, perQuestion);
		return {
			...question,
			question: translatedQuestion ?? question.question,
			header,
			options,
		};
	});

	return { display: { questions }, labelMap };
}

/**
 * Rewrite a Czech result back into the model's own English words.
 *
 * The model authored the English question and the English option labels, so those are
 * what belongs in the tool result envelope: a conversation that shows the model
 * Czech labels it never wrote invites it to keep replying in Czech. Custom answers,
 * notes and the preview echo are the user's or the artifact's own text and stay as-is.
 *
 * An unknown label is passed through rather than dropped — a miss must never turn a
 * real answer into `(no input)`.
 */
export function restoreEnglishAnswers(
	result: QuestionnaireResult,
	params: QuestionParams,
	labelMap: LabelMap,
): QuestionnaireResult {
	const restore = (index: number, label: string | null | undefined): string | null => {
		if (label === null || label === undefined) return label ?? null;
		return labelMap.get(index)?.get(label) ?? label;
	};

	return {
		...result,
		answers: result.answers.map((answer) => {
			const original = params.questions[answer.questionIndex];
			if (!original) return answer;
			return {
				...answer,
				question: original.question,
				answer: answer.kind === "option" ? restore(answer.questionIndex, answer.answer) : answer.answer,
				...(answer.selected
					? { selected: answer.selected.map((label) => restore(answer.questionIndex, label) as string) }
					: {}),
			};
		}),
	};
}
