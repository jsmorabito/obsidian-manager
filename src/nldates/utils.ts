import { App, Editor, EditorPosition, EditorRange, normalizePath } from "obsidian";

// ── Word boundary detection ───────────────────────────────────────────────────

// Obsidian exposes the underlying CodeMirror 6 state on Editor.cm so we can
// resolve word boundaries at the cursor position without a selection.
declare module "obsidian" {
	interface Editor {
		cm: {
			state: {
				wordAt(pos: number): { from: number; to: number } | null;
			};
		};
	}
}

function getWordBoundaries(editor: Editor): EditorRange | null {
	const cursor = editor.getCursor();
	const pos = editor.posToOffset(cursor);
	const word = editor.cm.state.wordAt(pos);
	if (!word) return null;
	return {
		from: editor.offsetToPos(word.from),
		to: editor.offsetToPos(word.to),
	};
}

/**
 * Returns the current selection text. If nothing is selected, expands to the
 * word under the cursor (same behaviour as the original nldates plugin).
 */
export function getSelectedText(editor: Editor): string {
	if (editor.somethingSelected()) {
		return editor.getSelection();
	}
	const boundaries = getWordBoundaries(editor);
	if (boundaries) {
		editor.setSelection(boundaries.from, boundaries.to);
	}
	return editor.getSelection();
}

/**
 * Moves the cursor to account for the length difference between the old and
 * new string after an in-place replacement.
 */
export function adjustCursor(
	editor: Editor,
	cursor: EditorPosition,
	newStr: string,
	oldStr: string
): void {
	editor.setCursor({
		line: cursor.line,
		ch: cursor.ch + (newStr.length - oldStr.length),
	});
}

// ── Date utilities ────────────────────────────────────────────────────────────

export function getFormattedDate(date: Date, format: string): string {
	return window.moment(date).format(format);
}

export function getLastDayOfMonth(year: number, month: number): number {
	return new Date(year, month, 0).getDate();
}

export function parseTruthy(flag: string): boolean {
	return ["y", "yes", "1", "t", "true"].includes(flag.toLowerCase());
}

// ── Week start ────────────────────────────────────────────────────────────────

const DAYS_OF_WEEK = [
	"sunday",
	"monday",
	"tuesday",
	"wednesday",
	"thursday",
	"friday",
	"saturday",
] as const;

export type DayOfWeek = (typeof DAYS_OF_WEEK)[number] | "locale-default";

export function getWeekNumber(dayOfWeek: Omit<DayOfWeek, "locale-default">): number {
	return DAYS_OF_WEEK.indexOf(dayOfWeek as (typeof DAYS_OF_WEEK)[number]);
}

export function getLocaleWeekStart(): Omit<DayOfWeek, "locale-default"> {
	const localeData = window.moment.localeData() as unknown as { _week: { dow: number } };
	return DAYS_OF_WEEK[localeData._week.dow];
}

// ── Link generation ───────────────────────────────────────────────────────────

/**
 * Generates a wikilink or markdown link depending on the vault's "use markdown
 * links" setting, mirroring the approach used in the original nldates plugin.
 */
export function generateMarkdownLink(app: App, subpath: string, alias?: string): string {
	const useMarkdownLinks = (
		app.vault as unknown as { getConfig(key: string): boolean }
	).getConfig("useMarkdownLinks");
	const path = normalizePath(subpath);

	if (useMarkdownLinks) {
		return alias
			? `[${alias}](${path.replace(/ /g, "%20")})`
			: `[${subpath}](${path})`;
	}
	return alias ? `[[${path}|${alias}]]` : `[[${path}]]`;
}

/**
 * Determines the alias string for a date link.
 *
 * @param defaultAlias   - The `defaultAlias` moment format from nlDates settings.
 * @param parseDate      - Bound parseDate function from NLDatesModule.
 * @param dateInput      - The raw NL string the user typed.
 * @param useSuggestionLabel - True when Shift was held (keep input as alias).
 */
export function getDateLinkAlias(
	defaultAlias: string,
	parseDate: (s: string) => { moment: moment.Moment },
	dateInput: string,
	useSuggestionLabel: boolean
): string | undefined {
	if (useSuggestionLabel) return dateInput;
	if (defaultAlias) {
		const parsed = parseDate(dateInput);
		return parsed.moment.isValid() ? parsed.moment.format(defaultAlias) : undefined;
	}
	return undefined;
}

// ── Ordinal number pattern ────────────────────────────────────────────────────
// Used as a custom chrono-node parser so "3rd", "15th", "twenty-first" etc.
// resolve to that day in the current month.

const ORDINAL_WORD_DICTIONARY: Record<string, number> = {
	first: 1,
	second: 2,
	third: 3,
	fourth: 4,
	fifth: 5,
	sixth: 6,
	seventh: 7,
	eighth: 8,
	ninth: 9,
	tenth: 10,
	eleventh: 11,
	twelfth: 12,
	thirteenth: 13,
	fourteenth: 14,
	fifteenth: 15,
	sixteenth: 16,
	seventeenth: 17,
	eighteenth: 18,
	nineteenth: 19,
	twentieth: 20,
	"twenty first": 21,
	"twenty-first": 21,
	"twenty second": 22,
	"twenty-second": 22,
	"twenty third": 23,
	"twenty-third": 23,
	"twenty fourth": 24,
	"twenty-fourth": 24,
	"twenty fifth": 25,
	"twenty-fifth": 25,
	"twenty sixth": 26,
	"twenty-sixth": 26,
	"twenty seventh": 27,
	"twenty-seventh": 27,
	"twenty eighth": 28,
	"twenty-eighth": 28,
	"twenty ninth": 29,
	"twenty-ninth": 29,
	thirtieth: 30,
	"thirty first": 31,
	"thirty-first": 31,
};

function matchAnyPattern(dict: Record<string, unknown>): string {
	const joined = Object.keys(dict)
		.sort((a, b) => b.length - a.length)
		.join("|")
		.replace(/\./g, "\\.");
	return `(?:${joined})`;
}

export const ORDINAL_NUMBER_PATTERN = `(?:${matchAnyPattern(ORDINAL_WORD_DICTIONARY)}|[0-9]{1,2}(?:st|nd|rd|th)?)`;

export function parseOrdinalNumberPattern(match: string): number {
	const lower = match.toLowerCase();
	if (ORDINAL_WORD_DICTIONARY[lower] !== undefined) return ORDINAL_WORD_DICTIONARY[lower];
	return parseInt(lower.replace(/(?:st|nd|rd|th)$/i, ""), 10);
}
