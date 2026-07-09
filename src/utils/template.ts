/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
// Template substitution. Ported from liamcain/obsidian-periodic-notes (MIT).
// Extended to support {{name:FORMAT}} and {{name±Nd:FORMAT}} for all granularities.
// eslint-disable-next-line no-restricted-imports
import type { Moment } from "moment";
import { App, normalizePath, Notice } from "obsidian";
import type { Granularity } from "../periodic/types";
import { startOfHalfYear } from "../periodic/half-year";

// ── Shared helpers ─────────────────────────────────────────────────────────────

function getDaysOfWeek(): string[] {
	const { moment } = window;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let weekStart = (moment.localeData() as any)._week.dow;
	const daysOfWeek = [
		"sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
	];
	while (weekStart) {
		const day = daysOfWeek.shift();
		if (day) daysOfWeek.push(day);
		weekStart--;
	}
	return daysOfWeek;
}

function getDayOfWeekNumericalValue(dayOfWeekName: string): number {
	return getDaysOfWeek().indexOf(dayOfWeekName.toLowerCase());
}

/**
 * Apply a generic `{{name}}`, `{{name:FORMAT}}`, and `{{name±Nd:FORMAT}}` pattern.
 *
 * - `{{name}}`              → baseDate formatted with defaultFormat
 * - `{{name:YYYY-MM}}`      → baseDate formatted with the given moment format
 * - `{{name+1m:YYYY-MM}}`   → baseDate offset by +1 month, then formatted
 * - `{{name-2d}}`           → baseDate offset by -2 days, formatted with defaultFormat
 *
 * varName may contain a hyphen (e.g. "half-year") — it is regex-escaped internally.
 */
// moment.add() is case-sensitive for "m" (minutes) vs "M" (months) and only
// recognizes "Q" (uppercase) for quarters — but the template syntax documented
// in getTemplateVariableReference() uses lowercase for every unit. Remap the
// ambiguous ones so {{month+1m}} / {{quarter+1q}} do what they say.
const OFFSET_UNIT_MAP: Record<string, moment.DurationInputArg2> = {
	y: "y", q: "Q", m: "M", w: "w", d: "d", h: "h", s: "s",
};

function applyGranularPattern(
	content: string,
	varName: string,
	baseDate: Moment,
	defaultFormat: string
): string {
	const escaped = varName.replace(/[-]/g, "\\$&");
	const pattern = new RegExp(
		`{{\\s*${escaped}\\s*(([+-]\\d+)([yqmwdhs]))?\\s*(:.+?)?}}`,
		"gi"
	);
	return content.replace(pattern, (_, _calc, timeDelta, unit, momentFormat) => {
		const d = baseDate.clone();
		if (timeDelta && unit) d.add(parseInt(timeDelta, 10), OFFSET_UNIT_MAP[(unit as string).toLowerCase()]);
		if (momentFormat) return d.format((momentFormat as string).substring(1).trim());
		return d.format(defaultFormat);
	});
}

// ── Main export ────────────────────────────────────────────────────────────────

export function applyTemplateTransformations(
	filename: string,
	granularity: Granularity,
	date: Moment,
	format: string,
	rawTemplateContents: string
): string {
	// ── Shared (all granularities) ────────────────────────────────────────────
	let t = rawTemplateContents
		.replace(/{{\s*date\s*}}/gi,  filename)
		.replace(/{{\s*title\s*}}/gi, filename)
		.replace(/{{\s*time\s*}}/gi,  window.moment().format("HH:mm"));

	// {{date:FORMAT}} and {{date±Nd:FORMAT}} — works for every granularity.
	// Uses the note's own date as the base (same as the daily-specific block did before).
	const now = window.moment();
	const noteDate = date.clone().set({
		hour:   now.get("hour"),
		minute: now.get("minute"),
		second: now.get("second"),
	});
	t = applyGranularPattern(t, "date", noteDate, format);

	// ── Daily ─────────────────────────────────────────────────────────────────
	if (granularity === "day") {
		t = t
			.replace(/{{\s*yesterday\s*}}/gi, date.clone().subtract(1, "day").format(format))
			.replace(/{{\s*tomorrow\s*}}/gi,  date.clone().add(1, "day").format(format));
		// {{time:FORMAT}} and {{time±Nd:FORMAT}}
		t = applyGranularPattern(t, "time", noteDate, "HH:mm");
	}

	// ── Weekly ────────────────────────────────────────────────────────────────
	if (granularity === "week") {
		// {{week:FORMAT}} / {{week±Nw:FORMAT}} — based on Monday of the week
		const weekStart = date.clone().startOf("isoWeek").set({
			hour:   now.get("hour"),
			minute: now.get("minute"),
			second: now.get("second"),
		});
		t = applyGranularPattern(t, "week", weekStart, format);

		// {{monday:FORMAT}} … {{sunday:FORMAT}} — specific day within the week
		t = t.replace(
			/{{\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s*:(.*?)}}/gi,
			(_, dayOfWeek, momentFormat) => {
				const day = getDayOfWeekNumericalValue(dayOfWeek);
				return date.weekday(day).format((momentFormat as string).trim());
			}
		);
	}

	// ── Monthly ───────────────────────────────────────────────────────────────
	if (granularity === "month") {
		const monthStart = date.clone().startOf("month").set({
			hour:   now.get("hour"),
			minute: now.get("minute"),
			second: now.get("second"),
		});
		t = applyGranularPattern(t, "month", monthStart, format);
	}

	// ── Quarterly ─────────────────────────────────────────────────────────────
	if (granularity === "quarter") {
		const quarterStart = date.clone().startOf("quarter").set({
			hour:   now.get("hour"),
			minute: now.get("minute"),
			second: now.get("second"),
		});
		t = applyGranularPattern(t, "quarter", quarterStart, format);
	}

	// ── Half-yearly ───────────────────────────────────────────────────────────
	if (granularity === "half-year") {
		const halfStart = startOfHalfYear(date).set({
			hour:   now.get("hour"),
			minute: now.get("minute"),
			second: now.get("second"),
		});
		t = applyGranularPattern(t, "half-year", halfStart, format);
	}

	// ── Yearly ────────────────────────────────────────────────────────────────
	if (granularity === "year") {
		const yearStart = date.clone().startOf("year").set({
			hour:   now.get("hour"),
			minute: now.get("minute"),
			second: now.get("second"),
		});
		t = applyGranularPattern(t, "year", yearStart, format);
	}

	return t;
}

// ── Settings reference ─────────────────────────────────────────────────────────

/**
 * Returns a human-readable list of the template variables available for a
 * given granularity.  Used in the settings tab to render a reference block.
 */
export function getTemplateVariableReference(granularity: Granularity): string[][] {
	const shared: string[][] = [
		["{{date}}",         "Note filename (e.g. 2026-06-04)"],
		["{{title}}",        "Same as {{date}}"],
		["{{time}}",         "Current time — HH:mm"],
		["{{date:FORMAT}}",  "Note date with moment.js format"],
		["{{date+1d:FMT}}", "Note date offset by any amount — e.g. +1d, -2w, +1m"],
	];

	const specific: Record<Granularity, string[][]> = {
		day: [
			["{{yesterday}}",         "Previous day in note format"],
			["{{tomorrow}}",          "Next day in note format"],
			["{{time:FORMAT}}",       "Current time with format"],
		],
		week: [
			["{{week:FORMAT}}",       "Monday of the week with format"],
			["{{week+1w:FORMAT}}",    "Next week's Monday with format"],
			["{{monday:FORMAT}}",     "Specific day of the week — monday…sunday"],
		],
		month: [
			["{{month:FORMAT}}",      "First day of the month with format"],
			["{{month+1m:FORMAT}}",   "Next month start with format"],
		],
		quarter: [
			["{{quarter:FORMAT}}",    "First day of the quarter with format"],
			["{{quarter+1q:FORMAT}}", "Next quarter start with format"],
		],
		"half-year": [
			["{{half-year:FORMAT}}",  "First day of the half-year with format"],
		],
		year: [
			["{{year:FORMAT}}",       "First day of the year with format"],
			["{{year+1y:FORMAT}}",    "Next year start with format"],
		],
	};

	return [...shared, ...specific[granularity]];
}

// ── File reader ────────────────────────────────────────────────────────────────

export async function getTemplateContents(
	app: App,
	templatePath: string | undefined
): Promise<string> {
	const { metadataCache, vault } = app;
	if (!templatePath || templatePath === "/") return "";

	const normalizedTemplatePath = normalizePath(templatePath);
	try {
		const templateFile = metadataCache.getFirstLinkpathDest(normalizedTemplatePath, "");
		return templateFile ? vault.cachedRead(templateFile) : "";
	} catch (err) {
		console.error(`Obsidian Time Tools: failed to read template '${normalizedTemplatePath}'`, err);
		// eslint-disable-next-line obsidianmd/ui/sentence-case
		new Notice("Obsidian Time Tools: failed to read note template");
		return "";
	}
}
