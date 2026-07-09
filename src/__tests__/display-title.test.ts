import { describe, it, expect } from "vitest";
import { getPeriodicDisplay } from "../utils/display-title";

describe("getPeriodicDisplay", () => {
	it("formats a day note", () => {
		expect(getPeriodicDisplay("2026-05-27", "YYYY-MM-DD", "day")).toEqual({
			primary: "May 27th, 2026",
			secondary: "Wednesday",
		});
	});

	it("formats a week note using ISO week boundaries", () => {
		expect(getPeriodicDisplay("2026-W22", "GGGG-[W]WW", "week")).toEqual({
			primary: "Week 4 of May",
			secondary: "25th – 31st",
		});
	});

	it("formats a week note that crosses a month boundary with abbreviated month names", () => {
		// 2026-W05 is Jan 26 - Feb 1, 2026
		expect(getPeriodicDisplay("2026-W05", "GGGG-[W]WW", "week")).toEqual({
			primary: "Week 4 of January",
			secondary: "Jan 26th – Feb 1st",
		});
	});

	it("formats a month note", () => {
		expect(getPeriodicDisplay("2026-05", "YYYY-MM", "month")).toEqual({
			primary: "May 2026",
			secondary: "Q2 2026",
		});
	});

	it("formats a quarter note", () => {
		expect(getPeriodicDisplay("2026-Q2", "YYYY-[Q]Q", "quarter")).toEqual({
			primary: "Q2 2026",
			secondary: "Apr – Jun",
		});
	});

	it("formats a half-year note", () => {
		expect(getPeriodicDisplay("2026-H1", "YYYY-[H]H", "half-year")).toEqual({
			primary: "H1 2026",
			secondary: "Jan – Jun",
		});
	});

	it("formats a year note", () => {
		expect(getPeriodicDisplay("2026", "YYYY", "year")).toEqual({
			primary: "2026",
			secondary: "",
		});
	});

	it("falls back to the raw basename when it can't be parsed", () => {
		expect(getPeriodicDisplay("not-a-date", "YYYY-MM-DD", "day")).toEqual({
			primary: "not-a-date",
			secondary: "",
		});
	});
});
