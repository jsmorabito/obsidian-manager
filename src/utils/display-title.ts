import { moment } from "obsidian";
import type { Granularity } from "../periodic/types";
import { halfOf, startOfHalfYear, endOfHalfYear, parseHalfYear } from "../periodic/half-year";

export interface PeriodicDisplay {
	/** Large left-side headline shown in the note header. */
	primary: string;
	/** Small right-side label (day of week, quarter, month range, etc.). */
	secondary: string;
}

/**
 * Returns the primary headline and secondary label for a periodic note header.
 *
 * day     "2026-05-27"  →  { primary: "May 27th, 2026",   secondary: "Wednesday" }
 * week    "2026-W22"    →  { primary: "Week 4 of May",    secondary: "2026-W22"  }
 * month   "2026-05"     →  { primary: "May 2026",         secondary: "Q2 2026"   }
 * quarter "2026-Q2"     →  { primary: "Q2 2026",          secondary: "Apr – Jun" }
 * year    "2026"        →  { primary: "2026",             secondary: ""          }
 */
export function getPeriodicDisplay(
	basename: string,
	format: string,
	granularity: Granularity
): PeriodicDisplay {
	// Half-year files use "2026-H1" which moment can't parse with "YYYY-[H]H" in strict mode.
	// Use the custom parser instead.
	const m = granularity === "half-year"
		? (parseHalfYear(basename) ?? moment.invalid())
		: moment(basename, format, /* strict */ true);
	if (!m.isValid()) return { primary: basename, secondary: "" };

	switch (granularity) {
		case "day":
			return {
				primary:   m.format("MMMM Do, YYYY"), // "May 27th, 2026"
				secondary: m.format("dddd"),           // "Wednesday"
			};

		case "week": {
			// Use ISO week boundaries to match the default gggg-[W]ww file format.
			// startOf("week") would use the locale's week start (Sun in the US),
			// which shifts the range one day early relative to the ISO Monday start.
			const weekStart = m.clone().startOf("isoWeek");
			const weekEnd   = m.clone().endOf("isoWeek");
			const weekInMonth = Math.ceil(weekStart.date() / 7);
			// If the week crosses a month boundary, include abbreviated month names.
			const dateRange = weekStart.month() === weekEnd.month()
				? `${weekStart.format("Do")} – ${weekEnd.format("Do")}`
				: `${weekStart.format("MMM Do")} – ${weekEnd.format("MMM Do")}`;
			return {
				primary:   `Week ${weekInMonth} of ${weekStart.format("MMMM")}`,
				secondary: dateRange,
			};
		}

		case "month":
			return {
				primary:   m.format("MMMM YYYY"),              // "May 2026"
				secondary: `Q${m.quarter()} ${m.format("YYYY")}`, // "Q2 2026"
			};

		case "quarter": {
			const startMonth = m.clone().startOf("quarter").format("MMM");
			const endMonth   = m.clone().endOf("quarter").format("MMM");
			return {
				primary:   `Q${m.quarter()} ${m.format("YYYY")}`, // "Q2 2026"
				secondary: `${startMonth} – ${endMonth}`,          // "Apr – Jun"
			};
		}

		case "half-year": {
			// basename is "2026-H1" — parse via halfOf helpers
			const h = halfOf(m);
			const hStart = startOfHalfYear(m);
			const hEnd   = endOfHalfYear(m);
			return {
				primary:   `H${h} ${m.format("YYYY")}`,
				secondary: `${hStart.format("MMM")} – ${hEnd.format("MMM")}`,
			};
		}

		case "year":
			return { primary: basename, secondary: "" };
	}
}
