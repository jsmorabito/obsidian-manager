import type { App } from "obsidian";
import NLDParser, { type NLDResult } from "./parser";
import type { NLDatesSettings } from "../settings";
import type TimeManagerPlugin from "../main";

export type { NLDResult };

/**
 * NLDatesModule — owns the chrono-node parser and exposes parse methods to
 * every other nldates sub-module (commands, suggest, modals, URI handler).
 *
 * Designed to be created in main.ts onload() and initialised in onLayoutReady()
 * so that chrono picks up the correct moment locale.
 */
export class NLDatesModule {
	private parser!: NLDParser;
	readonly plugin: TimeManagerPlugin;

	constructor(plugin: TimeManagerPlugin) {
		this.plugin = plugin;
	}

	/** Call this inside app.workspace.onLayoutReady() — locale must be ready first. */
	initialize(): void {
		this.parser = new NLDParser();
	}

	get app(): App {
		return this.plugin.app;
	}

	get settings(): NLDatesSettings {
		return this.plugin.settings.time.time.nlDates;
	}

	/**
	 * Parse a natural language date string and format it with an explicit format.
	 */
	parse(dateString: string, format: string): NLDResult {
		const date = this.parser.getParsedDate(dateString, this.settings.weekStart);
		const m = window.moment(date);
		const formattedString = m.isValid() ? m.format(format) : "Invalid date";
		if (!m.isValid()) {
			console.debug(`[time-tools/nldates] Could not parse: "${dateString}"`);
		}
		return { formattedString, date, moment: m };
	}

	/**
	 * Parse a natural language date string using the current daily-note format
	 * as the output format. This is the default for date insertion and autosuggest.
	 */
	parseDate(dateString: string): NLDResult {
		const format = this.plugin.settings.time.time.day.format || "YYYY-MM-DD";
		return this.parse(dateString, format);
	}

	/**
	 * Like parseDate, but picks the granularity format that matches the input.
	 * "this month" / "next month" → month format
	 * "this year"  / "next year"  → year format
	 * "this week"  / "next week"  → week format
	 * Everything else             → day format
	 */
	parseDateSmart(dateString: string): NLDResult {
		const lower = dateString.toLowerCase();
		if (/\bmonth\b/.test(lower)) {
			return this.parse(dateString, this.plugin.settings.time.time.month.format || "YYYY-MM");
		}
		if (/\byear\b/.test(lower)) {
			return this.parse(dateString, this.plugin.settings.time.time.year.format || "YYYY");
		}
		if (/\bweek\b/.test(lower)) {
			return this.parse(dateString, this.plugin.settings.time.time.week.format || "gggg-[W]ww");
		}
		return this.parseDate(dateString);
	}

	/** Parse a natural language time string using the configured time format. */
	parseTime(dateString: string): NLDResult {
		return this.parse(dateString, this.settings.timeFormat);
	}

	/** Parse a natural language date+time string using date + separator + time. */
	parseDateTime(dateString: string): NLDResult {
		const dayFmt = this.plugin.settings.time.time.day.format || "YYYY-MM-DD";
		const format = `${dayFmt}${this.settings.separator}${this.settings.timeFormat}`;
		return this.parse(dateString, format);
	}
}
