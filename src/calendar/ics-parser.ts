/**
 * ICS parsing and recurring-event expansion via ical.js.
 *
 * ical.js is a battle-tested library with full RFC 5545 support:
 *   - RRULE expansion (DAILY/WEEKLY/MONTHLY/YEARLY, BYDAY, COUNT, UNTIL)
 *   - VTIMEZONE / timezone-aware DATE-TIME values
 *   - RECURRENCE-ID exception handling
 *   - EXDATE excluded occurrences
 *
 * This replaces the previous hand-rolled parser which had timezone and
 * RRULE-expansion bugs.
 */

import ICAL from "ical.js";

import { moment } from "obsidian";
import type { CalendarEvent } from "./types";
 
import type { Moment } from "moment";

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Parse a full ICS document and return all events expanded into the given
 * date range (rangeStart inclusive, rangeEnd inclusive).
 *
 * Recurring events are fully expanded via ical.js's RecurExpansion, which
 * correctly handles RRULE, EXDATE, RECURRENCE-ID overrides, and timezones.
 */
export function parseICSInRange(
	raw: string,
	sourceId: string,
	sourceColor: string,
	rangeStart: Moment,
	rangeEnd: Moment
): CalendarEvent[] {
	let parsed: unknown[];
	try {
		parsed = ICAL.parse(raw) as unknown[];
	} catch (e) {
		console.error("[time-tools] ical.js parse error:", e);
		return [];
	}

	const vcalendar = new ICAL.Component(parsed);
	const results: CalendarEvent[] = [];

	// ical.js range as ICAL.Time
	const icalStart = momentToICALTime(rangeStart.clone().startOf("day"));
	const icalEnd   = momentToICALTime(rangeEnd.clone().endOf("day"));

	const vevents = vcalendar.getAllSubcomponents("vevent");

	for (const vevent of vevents) {
		try {
			const event = new ICAL.Event(vevent);

			// Skip exception (RECURRENCE-ID) VEVENTs — they are handled
			// automatically by ical.js when you expand the parent series.
			if (event.isRecurrenceException()) continue;

			if (event.isRecurring()) {
				// Expand all occurrences that overlap the range
				const expand = new ICAL.RecurExpansion({
					component: vevent,
					dtstart: event.startDate,
				});

				let next = expand.next();
				while (next) {
					// Stop once we've passed the range end
					if (next.compare(icalEnd) > 0) break;

					const occurrence = event.getOccurrenceDetails(next);
					const occStart = occurrence.startDate;
					const occEnd   = occurrence.endDate;

					// Skip occurrences that end before the range starts
					if (occEnd && occEnd.compare(icalStart) < 0) {
						next = expand.next();
						continue;
					}
					if (occStart.compare(icalStart) < 0 && (!occEnd || occEnd.compare(icalStart) <= 0)) {
						next = expand.next();
						continue;
					}

					const evt = icalOccurrenceToEvent(occurrence, sourceId, sourceColor);
					if (evt) results.push(evt);

					next = expand.next();
				}
			} else {
				// Non-recurring event — check overlap with range
				const startTime = event.startDate;
				const endTime   = event.endDate ?? startTime;

				if (startTime.compare(icalEnd) > 0) continue;
				if (endTime.compare(icalStart) < 0) continue;

				const evt = icalEventToCalendarEvent(event, vevent, sourceId, sourceColor);
				if (evt) results.push(evt);
			}
		} catch (e) {
			console.warn("[time-tools] Failed to process vevent:", e);
		}
	}

	return results;
}

/**
 * Parse a full ICS document and return ALL events (no range filter).
 * Used to populate the cache; range filtering is done separately.
 *
 * @deprecated Prefer parseICSInRange for new callers.
 */
export function parseICS(
	raw: string,
	sourceId: string,
	sourceColor: string
): CalendarEvent[] {
	// Return non-recurring events and the base occurrence of each recurring event.
	let parsed: unknown[];
	try {
		parsed = ICAL.parse(raw) as unknown[];
	} catch (e) {
		console.error("[time-tools] ical.js parse error:", e);
		return [];
	}

	const vcalendar = new ICAL.Component(parsed);
	const results: CalendarEvent[] = [];

	for (const vevent of vcalendar.getAllSubcomponents("vevent")) {
		try {
			const event = new ICAL.Event(vevent);
			if (event.isRecurrenceException()) continue;
			const evt = icalEventToCalendarEvent(event, vevent, sourceId, sourceColor);
			if (evt) results.push(evt);
		} catch { /* skip */ }
	}

	return results;
}

/**
 * Returns true if a CalendarEvent overlaps the given calendar day.
 * Kept for compatibility with CalendarService's day-grouping loop.
 */
export function isEventOnDate(event: CalendarEvent, date: Moment): boolean {
	const dayStart = date.clone().startOf("day");
	const dayEnd   = date.clone().endOf("day");

	if (event.allDay) {
		const evtEnd = event.end ?? event.start.clone().add(1, "day");
		return event.start.isBefore(dayEnd) && evtEnd.isAfter(dayStart);
	}

	const evtEnd = event.end ?? event.start.clone().add(1, "hour");
	return event.start.isBefore(dayEnd) && evtEnd.isAfter(dayStart);
}

// ── expandRecurringEvent is no longer used but kept for API compatibility ───────
export function expandRecurringEvent(
	_base: CalendarEvent & { rrule: string },
	_rangeStart: Moment,
	_rangeEnd: Moment
): CalendarEvent[] {
	// RRULE expansion is now handled inside parseICSInRange via ical.js.
	return [];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function momentToICALTime(m: Moment): InstanceType<typeof ICAL.Time> {
	return ICAL.Time.fromDateTimeString(m.format("YYYY-MM-DDTHH:mm:ss"));
}

function icalTimeToMoment(t: InstanceType<typeof ICAL.Time>): Moment {
	// toJSDate() respects the timezone stored in the ICAL.Time object.
	return moment(t.toJSDate());
}

function icalOccurrenceToEvent(
	occ: ReturnType<InstanceType<typeof ICAL.Event>["getOccurrenceDetails"]>,
	sourceId: string,
	sourceColor: string
): CalendarEvent | null {
	const summary = occ.item.summary || "";
	if (!summary) return null;

	const allDay = occ.startDate.isDate;
	const start  = icalTimeToMoment(occ.startDate);
	const end    = occ.endDate ? icalTimeToMoment(occ.endDate) : null;
	const uid    = occ.item.uid || `${sourceId}::${summary}::${start.toISOString()}`;

	return {
		uid: `${uid}::${occ.startDate.toString()}`,
		summary,
		start,
		end,
		allDay,
		description: occ.item.description || undefined,
		sourceId,
		sourceColor,
	};
}

function icalEventToCalendarEvent(
	event: InstanceType<typeof ICAL.Event>,
	_vevent: InstanceType<typeof ICAL.Component>,
	sourceId: string,
	sourceColor: string
): CalendarEvent | null {
	const summary = event.summary || "";
	if (!summary) return null;

	const allDay = event.startDate.isDate;
	const start  = icalTimeToMoment(event.startDate);
	const end    = event.endDate ? icalTimeToMoment(event.endDate) : null;
	const uid    = event.uid || `${sourceId}::${summary}::${start.toISOString()}`;

	return {
		uid,
		summary,
		start,
		end,
		allDay,
		description: event.description || undefined,
		sourceId,
		sourceColor,
	};
}
