import { Notice, ObsidianProtocolData, moment } from "obsidian";
import { openPeriodicNote } from "../periodic/api";
import { parseTruthy } from "./utils";
import type { NLDatesModule } from "./module";

/**
 * Handles the `obsidian://time-tools?day=<NL date>` URI scheme.
 *
 * Supported parameters:
 *   day      — natural language date string (URL-encoded)
 *   newPane  — "yes" | "no" | "1" | "0" (default: "yes")
 *
 * Example: obsidian://time-tools?day=next%20friday
 *
 * This is registered only when `settings.nlDates.uriHandlerEnabled` is true.
 * The toggle lives in Settings → Natural Language Dates.
 */
export async function handleNLDateURI(
	nld: NLDatesModule,
	params: ObsidianProtocolData
): Promise<void> {
	const dayParam = params["day"];
	if (!dayParam) {
		new Notice("[time-tools] URI handler: missing `day` parameter.");
		return;
	}

	const result = nld.parseDate(dayParam);
	if (!result.moment.isValid()) {
		new Notice(`[time-tools] Could not parse date: "${dayParam}"`);
		return;
	}

	try {
		await openPeriodicNote(nld.plugin, "day", moment(result.date), {
			inNewSplit: parseTruthy(params["newPane"] ?? "yes"),
		});
	} catch (err) {
		console.error("[time-tools/nldates] URI handler error:", err);
		new Notice("[time-tools] could not open the periodic note for that date.");
	}
}
