 
 
import type { Moment } from "moment";
import { Platform } from "obsidian";
import { HUMANIZE_FORMAT } from "../periodic/constants";
import type { Granularity } from "../periodic/types";

export function isMetaPressed(e: MouseEvent | KeyboardEvent): boolean {
	return Platform.isMacOS ? e.metaKey : e.ctrlKey;
}

export function getRelativeDate(granularity: Granularity, date: Moment): string {
	if (granularity === "week") {
		const thisWeek = window.moment().startOf(granularity);
		const fromNow = window.moment(date).diff(thisWeek, "week");
		if (fromNow === 0) return "This week";
		if (fromNow === -1) return "Last week";
		if (fromNow === 1) return "Next week";
		return window.moment.duration(fromNow, granularity).humanize(true);
	}

	if (granularity === "day") {
		const today = window.moment().startOf("day");
		const fromNow = window.moment(date).from(today);
		return window.moment(date).calendar(null, {
			lastWeek: "[Last] dddd",
			lastDay: "[Yesterday]",
			sameDay: "[Today]",
			nextDay: "[Tomorrow]",
			nextWeek: "dddd",
			sameElse: () => `[${fromNow}]`,
		});
	}

	return date.format(HUMANIZE_FORMAT[granularity] ?? "");
}
