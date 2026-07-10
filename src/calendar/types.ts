 
import type { Moment } from "moment";

// ── Calendar source ────────────────────────────────────────────────────────────

/**
 * A user-configured calendar feed.
 *  - `url`  — remote ICS/iCal URL (fetched via requestUrl)
 *  - `file` — vault-relative path to a local .ics file
 */
export interface CalendarSource {
	id: string;
	name: string;
	type: "url" | "file";
	/** Remote URL or vault-relative file path. */
	value: string;
	/** CSS color string (e.g. "#4A90D9") or empty string for the default accent. */
	color: string;
	enabled: boolean;
	/** Whether this source's events are shown in the calendar UI (filter panel toggle). Defaults to true. */
	visible: boolean;
}

// ── Calendar event ─────────────────────────────────────────────────────────────

export interface CalendarEvent {
	uid: string;
	summary: string;
	start: Moment;
	end: Moment | null;
	allDay: boolean;
	description?: string;
	/** ID of the CalendarSource this event came from. */
	sourceId: string;
	/** Color inherited from the source (may be empty). */
	sourceColor: string;
}

// ── Colour palette for new sources ────────────────────────────────────────────

export const CALENDAR_COLORS = [
	"#4A90D9", // blue
	"#7ED321", // green
	"#F5A623", // orange
	"#D0021B", // red
	"#9013FE", // purple
	"#50E3C2", // teal
	"#B8E986", // lime
	"#BD10E0", // magenta
] as const;
