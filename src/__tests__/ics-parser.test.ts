import { describe, it, expect } from "vitest";
import moment from "moment";
import { parseICSInRange, isEventOnDate } from "../calendar/ics-parser";
import type { CalendarEvent } from "../calendar/types";

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//EN
BEGIN:VEVENT
UID:simple-1@test
DTSTART:20260710T090000Z
DTEND:20260710T100000Z
SUMMARY:Simple Meeting
DESCRIPTION:A simple one-off meeting
END:VEVENT
BEGIN:VEVENT
UID:allday-1@test
DTSTART;VALUE=DATE:20260712
DTEND;VALUE=DATE:20260713
SUMMARY:All Day Event
END:VEVENT
BEGIN:VEVENT
UID:recurring-1@test
DTSTART:20260706T140000Z
DTEND:20260706T150000Z
SUMMARY:Weekly Standup
RRULE:FREQ=WEEKLY;COUNT=5
EXDATE:20260720T140000Z
END:VEVENT
END:VCALENDAR
`;

function byUid(events: CalendarEvent[], uidPrefix: string): CalendarEvent[] {
	return events.filter((e) => e.uid.startsWith(uidPrefix));
}

describe("parseICSInRange", () => {
	it("returns non-recurring and all-day events that overlap the range", () => {
		const events = parseICSInRange(
			ICS,
			"src1",
			"#4A90D9",
			moment.utc("2026-07-01"),
			moment.utc("2026-08-10")
		);

		const simple = byUid(events, "simple-1@test");
		expect(simple).toHaveLength(1);
		expect(simple[0].summary).toBe("Simple Meeting");
		expect(simple[0].allDay).toBe(false);
		expect(simple[0].description).toBe("A simple one-off meeting");
		expect(simple[0].start.toISOString()).toBe(moment.utc("2026-07-10T09:00:00Z").toISOString());
		expect(simple[0].sourceId).toBe("src1");
		expect(simple[0].sourceColor).toBe("#4A90D9");

		const allDay = byUid(events, "allday-1@test");
		expect(allDay).toHaveLength(1);
		expect(allDay[0].allDay).toBe(true);
	});

	it("expands a weekly RRULE and honors EXDATE", () => {
		const events = parseICSInRange(
			ICS,
			"src1",
			"#4A90D9",
			moment.utc("2026-07-01"),
			moment.utc("2026-08-10")
		);

		const recurring = byUid(events, "recurring-1@test").sort(
			(a, b) => a.start.valueOf() - b.start.valueOf()
		);

		// COUNT=5 starting 2026-07-06 weekly → 07-06, 07-13, 07-20, 07-27, 08-03
		// minus the excluded 07-20 instance.
		expect(recurring).toHaveLength(4);
		expect(recurring.map((e) => e.start.toISOString())).toEqual([
			moment.utc("2026-07-06T14:00:00Z").toISOString(),
			moment.utc("2026-07-13T14:00:00Z").toISOString(),
			moment.utc("2026-07-27T14:00:00Z").toISOString(),
			moment.utc("2026-08-03T14:00:00Z").toISOString(),
		]);
	});

	it("excludes events outside the requested range", () => {
		const events = parseICSInRange(
			ICS,
			"src1",
			"#4A90D9",
			moment.utc("2026-07-15"),
			moment.utc("2026-07-31")
		);

		expect(byUid(events, "simple-1@test")).toHaveLength(0);
		expect(byUid(events, "allday-1@test")).toHaveLength(0);
		// Only the 07-27 occurrence falls in this narrower range (07-20 is excluded).
		expect(byUid(events, "recurring-1@test")).toHaveLength(1);
	});

	it("returns an empty array and does not throw on malformed input", () => {
		expect(parseICSInRange("not an ics file", "src1", "#000", moment.utc(), moment.utc())).toEqual([]);
	});
});

describe("isEventOnDate", () => {
	it("returns true when a timed event overlaps the given day", () => {
		const event: CalendarEvent = {
			uid: "1",
			summary: "Test",
			start: moment.utc("2026-07-10T09:00:00Z"),
			end: moment.utc("2026-07-10T10:00:00Z"),
			allDay: false,
			sourceId: "s",
			sourceColor: "",
		};
		expect(isEventOnDate(event, moment.utc("2026-07-10T00:00:00Z"))).toBe(true);
		expect(isEventOnDate(event, moment.utc("2026-07-11T00:00:00Z"))).toBe(false);
	});

	it("returns true when an all-day event overlaps the given day", () => {
		const event: CalendarEvent = {
			uid: "2",
			summary: "All Day",
			start: moment.utc("2026-07-12T00:00:00Z"),
			end: moment.utc("2026-07-13T00:00:00Z"),
			allDay: true,
			sourceId: "s",
			sourceColor: "",
		};
		expect(isEventOnDate(event, moment.utc("2026-07-12T12:00:00Z"))).toBe(true);
		expect(isEventOnDate(event, moment.utc("2026-07-13T12:00:00Z"))).toBe(false);
	});
});
