import type { Granularity } from "./types";

export const DEFAULT_DAILY_NOTE_FORMAT = "YYYY-MM-DD";
export const DEFAULT_WEEKLY_NOTE_FORMAT = "GGGG-[W]WW";
export const DEFAULT_MONTHLY_NOTE_FORMAT = "YYYY-MM";
export const DEFAULT_QUARTERLY_NOTE_FORMAT = "YYYY-[Q]Q";
export const DEFAULT_YEARLY_NOTE_FORMAT = "YYYY";

export const DEFAULT_HALF_YEARLY_NOTE_FORMAT = "YYYY-[H]H";

export const DEFAULT_FORMAT: Record<Granularity, string> = Object.freeze({
	day: DEFAULT_DAILY_NOTE_FORMAT,
	week: DEFAULT_WEEKLY_NOTE_FORMAT,
	month: DEFAULT_MONTHLY_NOTE_FORMAT,
	quarter: DEFAULT_QUARTERLY_NOTE_FORMAT,
	"half-year": DEFAULT_HALF_YEARLY_NOTE_FORMAT,
	year: DEFAULT_YEARLY_NOTE_FORMAT,
});

export const HUMANIZE_FORMAT: Record<Granularity, string> = Object.freeze({
	day: "YYYY-MM-DD",
	week: "YYYY [W]WW",
	month: "MMMM YYYY",
	quarter: "YYYY [Q]Q",
	"half-year": "YYYY [H]H",
	year: "YYYY",
});
