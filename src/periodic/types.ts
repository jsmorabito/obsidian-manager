export type Granularity = "day" | "week" | "month" | "quarter" | "half-year" | "year";

export const granularities: Granularity[] = ["day", "week", "month", "quarter", "half-year", "year"];

export interface PeriodicConfig {
	enabled: boolean;
	format: string;
	folder: string;
	templatePath: string;
}

export interface DisplayConfig {
	periodicity: string;
	relativeUnit: string;
	labelOpenPresent: string;
	icon: string;
}

export const displayConfigs: Record<Granularity, DisplayConfig> = {
	day: {
		periodicity: "daily",
		relativeUnit: "today",
		labelOpenPresent: "Open today's daily note",
		icon: "calendar-day",
	},
	week: {
		periodicity: "weekly",
		relativeUnit: "this week",
		labelOpenPresent: "Open this week's note",
		icon: "calendar-week",
	},
	month: {
		periodicity: "monthly",
		relativeUnit: "this month",
		labelOpenPresent: "Open this month's note",
		icon: "calendar-month",
	},
	quarter: {
		periodicity: "quarterly",
		relativeUnit: "this quarter",
		labelOpenPresent: "Open this quarter's note",
		icon: "calendar-range",
	},
	"half-year": {
		periodicity: "half-yearly",
		relativeUnit: "this half-year",
		labelOpenPresent: "Open this half-year's note",
		icon: "calendar-range",
	},
	year: {
		periodicity: "yearly",
		relativeUnit: "this year",
		labelOpenPresent: "Open this year's note",
		icon: "calendar",
	},
};
