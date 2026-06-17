// eslint-disable-next-line no-restricted-imports
import type { Moment } from "moment";

export function halfOf(date: Moment): 1 | 2 {
	return date.month() < 6 ? 1 : 2;
}

export function startOfHalfYear(date: Moment): Moment {
	const h = halfOf(date);
	return date.clone().month(h === 1 ? 0 : 6).startOf("month");
}

export function endOfHalfYear(date: Moment): Moment {
	const h = halfOf(date);
	return date.clone().month(h === 1 ? 5 : 11).endOf("month");
}

/** Add n half-years (each = 6 months). n may be negative. */
export function addHalfYears(date: Moment, n: number): Moment {
	return date.clone().add(n * 6, "months");
}

export function isSameHalfYear(a: Moment, b: Moment): boolean {
	return a.year() === b.year() && halfOf(a) === halfOf(b);
}

/** Format a moment as "2026-H1" or "2026-H2". */
export function formatHalfYear(date: Moment): string {
	return `${date.year()}-H${halfOf(date)}`;
}

/** Parse "2026-H1" → start of that half-year, or null if invalid. */
export function parseHalfYear(str: string): Moment | null {
	const m = /^(\d{4})-H([12])$/.exec(str);
	if (!m) return null;
	const year = parseInt(m[1], 10);
	const half = parseInt(m[2], 10);
	return window.moment({ year, month: half === 1 ? 0 : 6, date: 1 });
}
