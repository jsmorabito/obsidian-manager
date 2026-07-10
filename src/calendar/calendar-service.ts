/**
 * CalendarService
 *
 * Responsible for fetching, caching, and querying calendar events from all
 * enabled CalendarSource entries in the plugin settings.
 *
 * Two-level cache:
 *   1. rawCache  — raw ICS text per source, TTL_MS (15 min). Avoids re-fetching.
 *   2. parsedCache — CalendarEvent[] per {sourceId}|{rangeStart}|{rangeEnd}.
 *      Avoids re-running ical.js RRULE expansion on every view switch.
 *      Entries are evicted whenever their source's raw entry is replaced or invalidated.
 */

import { moment, requestUrl } from "obsidian";
import type TimeManagerPlugin from "../main";
import { parseICSInRange, isEventOnDate } from "./ics-parser";
import type { CalendarEvent, CalendarSource } from "./types";
 
import type { Moment } from "moment";

const TTL_MS = 15 * 60 * 1000; // 15 minutes

interface CacheEntry {
	raw: string;
	fetchedAt: number;
}

export class CalendarService {
	private readonly cache = new Map<string, CacheEntry>();
	/** Parsed events keyed by `{sourceId}|{rangeStart YYYY-MM-DD}|{rangeEnd YYYY-MM-DD}`. */
	private readonly parsedCache = new Map<string, CalendarEvent[]>();

	constructor(private readonly plugin: TimeManagerPlugin) {}

	/**
	 * Return all events that overlap the given calendar day, sorted by start time
	 * (all-day events first, then chronological).
	 */
	async getEventsForDate(date: ReturnType<typeof moment>): Promise<CalendarEvent[]> {
		const all = await this.getAllEventsForRange(date, date);
		return all.sort((a, b) => {
			if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
			return a.start.valueOf() - b.start.valueOf();
		});
	}

	/**
	 * Return all events that overlap [rangeStart, rangeEnd], grouped by calendar day.
	 * Days with no events are omitted from the map.
	 * Keys are YYYY-MM-DD strings.
	 */
	async getEventsForRange(
		rangeStart: Moment,
		rangeEnd: Moment
	): Promise<Map<string, CalendarEvent[]>> {
		const all = await this.getAllEventsForRange(rangeStart, rangeEnd);

		const result = new Map<string, CalendarEvent[]>();
		const cursor = rangeStart.clone().startOf("day");
		const end = rangeEnd.clone().endOf("day");

		while (cursor.isSameOrBefore(end, "day")) {
			const eventsOnDay = all
				.filter((e) => isEventOnDate(e, cursor))
				.sort((a, b) => {
					if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
					return a.start.valueOf() - b.start.valueOf();
				});
			if (eventsOnDay.length > 0) {
				result.set(cursor.format("YYYY-MM-DD"), eventsOnDay);
			}
			cursor.add(1, "day");
		}

		return result;
	}

	/** Force-refresh a specific source (or all sources if no id given). */
	invalidate(sourceId?: string): void {
		if (sourceId) {
			this.cache.delete(sourceId);
			// Evict all parsedCache entries for this source.
			for (const key of this.parsedCache.keys()) {
				if (key.startsWith(`${sourceId}|`)) this.parsedCache.delete(key);
			}
		} else {
			this.cache.clear();
			this.parsedCache.clear();
		}
	}

	// ── Private ─────────────────────────────────────────────────────────────────

	private async getAllEventsForRange(
		rangeStart: Moment,
		rangeEnd: Moment
	): Promise<CalendarEvent[]> {
		const sources = this.plugin.settings.time.calendarSources.filter((s) => s.enabled);
		const batches = await Promise.all(
			sources.map((s) => this.getEventsForSource(s, rangeStart, rangeEnd))
		);
		return batches.flat();
	}

	private async getEventsForSource(
		source: CalendarSource,
		rangeStart: Moment,
		rangeEnd: Moment
	): Promise<CalendarEvent[]> {
		const rangeKey = `${source.id}|${rangeStart.format("YYYY-MM-DD")}|${rangeEnd.format("YYYY-MM-DD")}`;

		// Check the parsed cache first — avoids re-running ical.js on every view switch.
		const cachedParsed = this.parsedCache.get(rangeKey);
		if (cachedParsed) return cachedParsed;

		let raw: string;
		let rawWasFresh = false;
		try {
			const cached = this.cache.get(source.id);
			if (cached && Date.now() - cached.fetchedAt < TTL_MS) {
				raw = cached.raw;
			} else {
				raw = await this.fetchRaw(source);
				rawWasFresh = true;
			}
		} catch (err) {
			// Individual source failure — log and return empty so other sources
			// still render. A subsequent fetch (e.g. after a view switch) will
			// retry once the network is available.
			console.error(`[time-tools] Calendar source "${source.name}" failed:`, err);
			return [];
		}

		// If we just fetched new raw ICS, evict all stale parsed entries for this
		// source so they get re-expanded against the new data on next access.
		if (rawWasFresh) {
			for (const key of this.parsedCache.keys()) {
				if (key.startsWith(`${source.id}|`)) this.parsedCache.delete(key);
			}
		}

		const events = parseICSInRange(raw, source.id, source.color, rangeStart, rangeEnd);
		this.parsedCache.set(rangeKey, events);
		return events;
	}

	private async fetchRaw(source: CalendarSource): Promise<string> {
		try {
			const text = source.type === "url"
				? await this.fetchURL(source.value)
				: await this.readVaultFile(source.value);
			this.cache.set(source.id, { raw: text, fetchedAt: Date.now() });
			return text;
		} catch (err) {
			console.error(`[time-tools] Calendar source "${source.name}" failed:`, err);
			// Return stale data rather than nothing if we have it.
			const stale = this.cache.get(source.id);
			if (stale) return stale.raw;
			throw err;
		}
	}

	private async fetchURL(url: string): Promise<string> {
		const resp = await requestUrl({ url, method: "GET" });
		if (resp.status < 200 || resp.status >= 300) {
			throw new Error(`HTTP ${resp.status}`);
		}
		return resp.text;
	}

	private async readVaultFile(vaultPath: string): Promise<string> {
		return this.plugin.app.vault.adapter.read(vaultPath);
	}
}
