import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import moment from "moment";
import {
	applyTemplateTransformations,
	getTemplateVariableReference,
} from "../utils/template";

describe("applyTemplateTransformations", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 6, 8, 14, 30, 0)); // 2026-07-08 14:30 (Wed)
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("replaces {{date}}, {{title}}, and {{time}} for the shared block", () => {
		const date = moment("2026-07-08", "YYYY-MM-DD");
		const out = applyTemplateTransformations(
			"2026-07-08",
			"day",
			date,
			"YYYY-MM-DD",
			"# {{title}}\nCreated at {{time}}\n{{date}}"
		);
		expect(out).toBe("# 2026-07-08\nCreated at 14:30\n2026-07-08");
	});

	it("applies {{date+Nd:FORMAT}} offsets against the note's own date", () => {
		const date = moment("2026-07-08", "YYYY-MM-DD");
		const out = applyTemplateTransformations(
			"2026-07-08",
			"day",
			date,
			"YYYY-MM-DD",
			"{{date+1d:YYYY-MM-DD}} / {{date-2d:YYYY-MM-DD}}"
		);
		expect(out).toBe("2026-07-09 / 2026-07-06");
	});

	it("replaces {{yesterday}} and {{tomorrow}} for day notes", () => {
		const date = moment("2026-07-08", "YYYY-MM-DD");
		const out = applyTemplateTransformations(
			"2026-07-08",
			"day",
			date,
			"YYYY-MM-DD",
			"{{yesterday}} / {{tomorrow}}"
		);
		expect(out).toBe("2026-07-07 / 2026-07-09");
	});

	it("replaces {{week}} and specific weekday variables for week notes", () => {
		const date = moment("2026-07-08", "YYYY-MM-DD"); // Wednesday, ISO week 28
		const out = applyTemplateTransformations(
			"2026-W28",
			"week",
			date,
			"GGGG-[W]WW",
			"{{week:YYYY-MM-DD}} | {{monday:YYYY-MM-DD}} | {{friday:YYYY-MM-DD}}"
		);
		expect(out).toBe("2026-07-06 | 2026-07-06 | 2026-07-10");
	});

	it("applies {{month+Nm:FORMAT}} offsets from the start of the month", () => {
		const date = moment("2026-07-08", "YYYY-MM-DD");
		const out = applyTemplateTransformations(
			"2026-07",
			"month",
			date,
			"YYYY-MM",
			"{{month:YYYY-MM}} / {{month+1m:YYYY-MM}}"
		);
		expect(out).toBe("2026-07 / 2026-08");
	});

	it("applies {{quarter+Nq:FORMAT}} offsets from the start of the quarter", () => {
		const date = moment("2026-07-08", "YYYY-MM-DD"); // Q3
		const out = applyTemplateTransformations(
			"2026-Q3",
			"quarter",
			date,
			"YYYY-[Q]Q",
			"{{quarter:YYYY-[Q]Q}} / {{quarter+1q:YYYY-[Q]Q}}"
		);
		expect(out).toBe("2026-Q3 / 2026-Q4");
	});

	it("leaves unmatched template variables untouched", () => {
		const date = moment("2026-07-08", "YYYY-MM-DD");
		const out = applyTemplateTransformations(
			"2026-07-08",
			"day",
			date,
			"YYYY-MM-DD",
			"{{not-a-real-variable}}"
		);
		expect(out).toBe("{{not-a-real-variable}}");
	});
});

describe("getTemplateVariableReference", () => {
	it("includes the shared variables plus granularity-specific ones", () => {
		const day = getTemplateVariableReference("day");
		const names = day.map(([name]) => name);
		expect(names).toContain("{{date}}");
		expect(names).toContain("{{yesterday}}");
		expect(names).toContain("{{tomorrow}}");
	});

	it("does not leak another granularity's specific variables", () => {
		const day = getTemplateVariableReference("day");
		const names = day.map(([name]) => name);
		expect(names).not.toContain("{{week:FORMAT}}");
	});
});
