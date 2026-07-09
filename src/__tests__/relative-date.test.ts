import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import moment from "moment";
import { Platform } from "obsidian";
import { isMetaPressed, getRelativeDate } from "../utils/relative-date";

describe("isMetaPressed", () => {
	afterEach(() => {
		Platform.isMacOS = false;
	});

	it("checks metaKey on macOS", () => {
		Platform.isMacOS = true;
		expect(isMetaPressed({ metaKey: true, ctrlKey: false } as KeyboardEvent)).toBe(true);
		expect(isMetaPressed({ metaKey: false, ctrlKey: true } as KeyboardEvent)).toBe(false);
	});

	it("checks ctrlKey off macOS", () => {
		Platform.isMacOS = false;
		expect(isMetaPressed({ metaKey: true, ctrlKey: false } as KeyboardEvent)).toBe(false);
		expect(isMetaPressed({ metaKey: false, ctrlKey: true } as KeyboardEvent)).toBe(true);
	});
});

describe("getRelativeDate", () => {
	beforeEach(() => {
		// Sunday, 2026-07-05 00:00 — pinned to a week boundary so week-diff
		// truncation is symmetric for both past and future offsets.
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 6, 5, 0, 0, 0));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe("week granularity", () => {
		it('labels the current week "This week"', () => {
			expect(getRelativeDate("week", moment())).toBe("This week");
		});

		it('labels last week "Last week"', () => {
			expect(getRelativeDate("week", moment().subtract(1, "week"))).toBe("Last week");
		});

		it('labels next week "Next week"', () => {
			expect(getRelativeDate("week", moment().add(1, "week"))).toBe("Next week");
		});

		it("humanizes weeks further away in days (moment has no default 'weeks' bucket)", () => {
			expect(getRelativeDate("week", moment().add(3, "week"))).toBe("in 21 days");
			expect(getRelativeDate("week", moment().subtract(3, "week"))).toBe("21 days ago");
		});
	});

	describe("day granularity", () => {
		it('labels today "Today"', () => {
			expect(getRelativeDate("day", moment())).toBe("Today");
		});

		it('labels yesterday "Yesterday"', () => {
			expect(getRelativeDate("day", moment().subtract(1, "day"))).toBe("Yesterday");
		});

		it('labels tomorrow "Tomorrow"', () => {
			expect(getRelativeDate("day", moment().add(1, "day"))).toBe("Tomorrow");
		});

		it("labels last week's day by weekday name", () => {
			expect(getRelativeDate("day", moment().subtract(3, "day"))).toBe("Last Thursday");
		});
	});

	describe("other granularities", () => {
		it("falls back to the HUMANIZE_FORMAT for the granularity", () => {
			expect(getRelativeDate("year", moment("2026-01-01"))).toBe("2026");
			expect(getRelativeDate("month", moment("2026-05-01"))).toBe("May 2026");
		});
	});
});
