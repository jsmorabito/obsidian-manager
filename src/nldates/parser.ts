import * as chrono from "chrono-node";
import type { Chrono } from "chrono-node";
import { Parser } from "chrono-node";
import {
	ORDINAL_NUMBER_PATTERN,
	parseOrdinalNumberPattern,
	getLastDayOfMonth,
	getLocaleWeekStart,
	type DayOfWeek,
} from "./utils";

export interface NLDResult {
	formattedString: string;
	date: Date;
	moment: moment.Moment;
}

// ── Chrono instance factory ───────────────────────────────────────────────────

function getConfiguredChrono(): Chrono {
	// Clone a pre-built locale instance so we don't mutate the shared singleton.
	const locale = window.moment.locale();
	const c = (locale === "en-gb" ? chrono.en.GB : chrono.en.casual).clone();

	// Custom rule 1 — "Christmas" always resolves to December 25.
	c.parsers.push({
		pattern: () => /\bChristmas\b/i,
		extract: () => ({ day: 25, month: 12 }),
	});

	// Custom rule 2 — ordinal numbers resolve to that day in the current month.
	// e.g. "3rd" → 3rd of the current month, "twenty-first" → the 21st.
	c.parsers.push({
		pattern: () => new RegExp(ORDINAL_NUMBER_PATTERN),
		extract: (_context, match) => ({
			day: parseOrdinalNumberPattern(match[0]),
			month: window.moment().month(),
		}),
	} as Parser);

	return c;
}

// ── Parser class ──────────────────────────────────────────────────────────────

export default class NLDParser {
	private chrono: Chrono;

	constructor() {
		this.chrono = getConfiguredChrono();
	}

	getParsedDate(selectedText: string, weekStartPreference: DayOfWeek): Date {
		const parser = this.chrono;
		const initialParse = parser.parse(selectedText);
		const weekdayIsCertain = initialParse[0]?.start.isCertain("weekday");

		const weekStart =
			weekStartPreference === "locale-default"
				? getLocaleWeekStart()
				: weekStartPreference;

		const thisDateMatch = selectedText.match(/this\s([\w]+)/i);
		const nextDateMatch = selectedText.match(/next\s([\w]+)/i);
		const lastDayOfMatch = selectedText.match(/(last day of|end of)\s*([^\n\r]*)/i);
		const midOf = selectedText.match(/mid\s([\w]+)/i);

		// When the weekday is certain, use start-of-week as the reference so
		// relative weekday names are anchored consistently.
		const referenceDate = weekdayIsCertain
			? window.moment().weekday(0).toDate()
			: new Date();

		if (thisDateMatch && thisDateMatch[1] === "week") {
			return parser.parseDate(`this ${String(weekStart)}`, referenceDate) ?? new Date();
		}

		if (thisDateMatch && thisDateMatch[1] === "month") {
			return window.moment().startOf("month").toDate();
		}

		if (thisDateMatch && thisDateMatch[1] === "year") {
			return window.moment().startOf("year").toDate();
		}

		if (nextDateMatch && nextDateMatch[1] === "week") {
			return (
				parser.parseDate(`next ${String(weekStart)}`, referenceDate, {
					forwardDate: true,
				}) ?? new Date()
			);
		}

		if (nextDateMatch && nextDateMatch[1] === "month") {
			const thisMonth = parser.parseDate("this month", new Date(), { forwardDate: true });
			return (
				parser.parseDate(selectedText, thisMonth ?? new Date(), { forwardDate: true }) ??
				new Date()
			);
		}

		if (nextDateMatch && nextDateMatch[1] === "year") {
			const thisYear = parser.parseDate("this year", new Date(), { forwardDate: true });
			return (
				parser.parseDate(selectedText, thisYear ?? new Date(), { forwardDate: true }) ??
				new Date()
			);
		}

		if (lastDayOfMatch) {
			const tempDate = parser.parse(lastDayOfMatch[2]);
			const year = tempDate[0]?.start.get("year") ?? new Date().getFullYear();
			const month = tempDate[0]?.start.get("month") ?? new Date().getMonth() + 1;
			const lastDay = getLastDayOfMonth(year, month);
			return (
				parser.parseDate(`${year}-${month}-${lastDay}`, new Date(), {
					forwardDate: true,
				}) ?? new Date()
			);
		}

		if (midOf) {
			return (
				parser.parseDate(`${midOf[1]} 15th`, new Date(), { forwardDate: true }) ??
				new Date()
			);
		}

		return parser.parseDate(selectedText, referenceDate) ?? new Date();
	}
}
