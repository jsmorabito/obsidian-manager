/**
 * TargetDateService
 *
 * Reads and writes the `targetDate` frontmatter field (only one field needed).
 *
 * Frontmatter shape:
 *   targetDate: "[[2026-07]]"   ← wikilink to the periodic note (clickable)
 *
 * The granularity is inferred from the inner value's format, so
 * `targetGranularity` is no longer written. Existing files that still carry
 * `targetGranularity` continue to work (read as fallback).
 */

import { moment } from "obsidian";
import type { App, TFile } from "obsidian";
// eslint-disable-next-line no-restricted-imports
import type { Moment } from "moment";
import type { TargetGranularity, TargetDate, ResolvedTargetDate } from "./types";

export const FM_TARGET_DATE = "targetDate";
/** Legacy key — no longer written, but still read for backward compat. */
export const FM_TARGET_GRAN = "targetGranularity";

// ── Wikilink helpers ───────────────────────────────────────────────────────────

/** Wrap a bare string in `[[ ]]`. */
function toWikilink(s: string): string { return `[[${s}]]`; }

/** Strip `[[ ]]` from a string if present; otherwise return as-is. */
export function stripWikilink(s: string): string {
	const m = /^\[\[(.+?)(?:\|.+?)?\]\]$/.exec(s);
	return m ? m[1] : s;
}

// ── Format helpers ─────────────────────────────────────────────────────────────

export function formatTargetDate(date: Moment, gran: TargetGranularity): string {
	switch (gran) {
		case "day":       return date.format("YYYY-MM-DD");
		case "week":      return date.format("YYYY-[W]WW");
		case "month":     return date.format("YYYY-MM");
		case "quarter":   return date.format("YYYY-[Q]Q");
		case "half-year": {
			const h = date.month() < 6 ? 1 : 2;
			return `${date.year()}-H${h}`;
		}
		case "year":      return date.format("YYYY");
	}
}

/**
 * Infer granularity from the bare (non-wikilink) value string.
 * Matches the fixed formats used by formatTargetDate.
 */
export function inferGranularity(bare: string): TargetGranularity | null {
	if (/^\d{4}-\d{2}-\d{2}$/.test(bare))  return "day";
	if (/^\d{4}-W\d{2}$/.test(bare))        return "week";   // gggg-[W]ww → 2026-W27
	if (/^\d{4}-\d{2}$/.test(bare))         return "month";
	if (/^\d{4}-Q[1-4]$/.test(bare))        return "quarter";
	if (/^\d{4}-H[12]$/.test(bare))         return "half-year";
	if (/^\d{4}$/.test(bare))               return "year";
	return null;
}

/** Human-readable label for display in target cards. */
export function labelTargetDate(raw: string, gran: TargetGranularity): string {
	const bare = stripWikilink(raw);
	switch (gran) {
		case "day":       return moment(bare, "YYYY-MM-DD").format("MMM D, YYYY");
		case "week":      return `Week ${moment(bare, "YYYY-[W]WW").format("W, YYYY")}`;
		case "month":     return moment(bare, "YYYY-MM").format("MMMM YYYY");
		case "quarter":   return bare.replace(/(\d{4})-Q(\d)/, "Q$2 $1");
		case "half-year": return bare.replace(/(\d{4})-H(\d)/, "H$2 $1");
		case "year":      return bare;
	}
}

/**
 * Parse a stored targetDate value + granularity into the END moment of that
 * period. Strips wikilink syntax automatically. Returns null if malformed.
 */
export function targetDateToEndMoment(raw: string, gran: TargetGranularity): Moment | null {
	const bare = stripWikilink(raw);
	switch (gran) {
		case "day": {
			const m = moment(bare, "YYYY-MM-DD", true);
			return m.isValid() ? m.endOf("day") : null;
		}
		case "week": {
			const m = moment(bare, "YYYY-[W]WW", true);
			return m.isValid() ? m.endOf("isoWeek") : null;
		}
		case "month": {
			const m = moment(bare, "YYYY-MM", true);
			return m.isValid() ? m.endOf("month") : null;
		}
		case "quarter": {
			const m = moment(bare, "YYYY-[Q]Q", true);
			return m.isValid() ? m.endOf("quarter") : null;
		}
		case "half-year": {
			const match = /^(\d{4})-H([12])$/.exec(bare);
			if (!match) return null;
			const year = parseInt(match[1], 10);
			const half = parseInt(match[2], 10);
			const endMonth = half === 1 ? 5 : 11; // June or December (0-indexed)
			return moment({ year, month: endMonth }).endOf("month");
		}
		case "year": {
			const m = moment(bare, "YYYY", true);
			return m.isValid() ? m.endOf("year") : null;
		}
	}
}

// ── Service ────────────────────────────────────────────────────────────────────

export class TargetDateService {
	constructor(private readonly app: App) {}

	/**
	 * Write targetDate as a wikilink (e.g. [[2026-07]]).
	 * Removes the legacy targetGranularity field if present.
	 */
	async setTargetDate(file: TFile, date: Moment, gran: TargetGranularity): Promise<void> {
		const bare = formatTargetDate(date, gran);
		const value = gran === "half-year" ? bare : toWikilink(bare);
		await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
			fm[FM_TARGET_DATE] = value;
			// Remove the old granularity field — granularity is now inferred.
			delete fm[FM_TARGET_GRAN];
		});
	}

	/** Remove targetDate (and legacy targetGranularity) from frontmatter. */
	async clearTargetDate(file: TFile): Promise<void> {
		await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
			delete fm[FM_TARGET_DATE];
			delete fm[FM_TARGET_GRAN];
		});
	}

	/** Read the target date from cached metadata. Returns null if not set. */
	getTargetDate(file: TFile): TargetDate | null {
		const cache = this.app.metadataCache.getFileCache(file);
		const stored = (cache?.frontmatter as Record<string, unknown> | undefined)?.[FM_TARGET_DATE];
		if (typeof stored !== "string") return null;

		const bare = stripWikilink(stored);

		// Prefer legacy targetGranularity for backward compat, then infer.
		const legacyGran = cache?.frontmatter?.[FM_TARGET_GRAN] as TargetGranularity | undefined;
		const granularity = legacyGran ?? inferGranularity(bare);
		if (!granularity) return null;

		return { raw: bare, granularity };
	}

	/**
	 * Return all markdown files whose target date END falls within
	 * [rangeStart, rangeEnd], sorted by end date ascending.
	 */
	getFilesWithTargetInRange(
		rangeStart: Moment,
		rangeEnd: Moment
	): Array<{ file: TFile; target: ResolvedTargetDate }> {
		const results: Array<{ file: TFile; target: ResolvedTargetDate }> = [];

		for (const file of this.app.vault.getMarkdownFiles()) {
			const td = this.getTargetDate(file);
			if (!td) continue;
			const endMoment = targetDateToEndMoment(td.raw, td.granularity);
			if (!endMoment) continue;
			if (
				endMoment.isSameOrAfter(rangeStart, "day") &&
				endMoment.isSameOrBefore(rangeEnd, "day")
			) {
				results.push({ file, target: { ...td, endMoment } });
			}
		}

		results.sort((a, b) => a.target.endMoment.valueOf() - b.target.endMoment.valueOf());
		return results;
	}
}
