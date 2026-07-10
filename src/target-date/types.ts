 
import type { Moment } from "moment";

export type TargetGranularity = "day" | "week" | "month" | "quarter" | "half-year" | "year";

export interface TargetDate {
	/** The stored string value, e.g. "2026-Q2", "2026-06", "2026-H1". */
	raw: string;
	granularity: TargetGranularity;
}

export interface ResolvedTargetDate extends TargetDate {
	/** The end moment of the target period (for range comparisons). */
	endMoment: Moment;
}
