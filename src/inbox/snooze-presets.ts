import { moment } from "obsidian";

export interface SnoozePreset {
	label: string;
	sublabel: string;
	getTime: () => string;
}

/** Shared quick-snooze presets used by both the SnoozeModal and SnoozePopover. */
export function getSnoozePresets(): SnoozePreset[] {
	return [
		{
			label: "In 1 hour",
			sublabel: moment().add(1, "hour").format("ddd, D MMM, h:mm a"),
			getTime: () => moment().add(1, "hour").toISOString(),
		},
		{
			label: "Later today",
			sublabel: moment().hour(17).minute(0).second(0).format("ddd, D MMM, h:mm a"),
			getTime: () => moment().hour(17).minute(0).second(0).toISOString(),
		},
		{
			label: "Tomorrow morning",
			sublabel: moment().add(1, "day").hour(9).minute(0).second(0).format("ddd, D MMM, h:mm a"),
			getTime: () => moment().add(1, "day").hour(9).minute(0).second(0).toISOString(),
		},
		{
			label: "Next week",
			sublabel: moment().add(1, "week").startOf("isoWeek").hour(9).minute(0).second(0).format("ddd, D MMM, h:mm a"),
			getTime: () =>
				moment().add(1, "week").startOf("isoWeek").hour(9).minute(0).second(0).toISOString(),
		},
		{
			label: "Next month",
			sublabel: moment().add(1, "month").startOf("month").hour(9).minute(0).second(0).format("ddd, D MMM, 9:00 a"),
			getTime: () =>
				moment().add(1, "month").startOf("month").hour(9).minute(0).second(0).toISOString(),
		},
	];
}
