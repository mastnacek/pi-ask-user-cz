import { t } from "../../../../shared/i18n.js";

/** Matches recommended suffix in English or Czech. */
export const RECOMMENDED_SUFFIX_REGEX = /\s*\((?:recommended|doporučeno|doporučené)\)\s*$/i;

/**
 * Split text by inline code segments (`code`) and apply appropriate styling.
 * Preserves the backticks so the code remains visually distinct, while styling
 * the code with `codeStyle` and surrounding text with `proseStyle`.
 */
export function formatInlineCode(
	text: string,
	proseStyle: (text: string) => string,
	codeStyle: (code: string) => string,
): string {
	if (!text.includes("`")) {
		return proseStyle(text);
	}
	const parts = text.split(/(`[^`]+`)/g);
	return parts
		.map((part) => {
			if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
				return codeStyle(part);
			}
			return part.length > 0 ? proseStyle(part) : "";
		})
		.join("");
}

export interface ParsedOptionLabel {
	cleanLabel: string;
	isRecommended: boolean;
	badgeText: string;
}

/**
 * Parses an option label to detect and strip recommended tags.
 */
export function parseOptionLabel(rawLabel: string): ParsedOptionLabel {
	const match = rawLabel.match(RECOMMENDED_SUFFIX_REGEX);
	if (!match) {
		return { cleanLabel: rawLabel, isRecommended: false, badgeText: "" };
	}
	const cleanLabel = rawLabel.slice(0, match.index).trimEnd();
	const badgeWord = t("option.recommended", "Doporučeno");
	return {
		cleanLabel,
		isRecommended: true,
		badgeText: `★ ${badgeWord}`,
	};
}
